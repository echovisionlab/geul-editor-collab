import type { Hocuspocus } from "@hocuspocus/server";

interface ShutdownConnectionLike {
  socketId: string;
}

interface ShutdownDocumentLike<TConnection extends ShutdownConnectionLike> {
  name: string;
  getConnections(): Iterable<TConnection>;
}

function connectionKey(documentName: string, socketId: string): string {
  return `${documentName}\u0000${socketId}`;
}

export interface ShutdownConnectionAdmission {
  readonly documentName: string;
  readonly socketId: string;
  readonly token: symbol;
}

const shutdownSocketAdmissionScope = Symbol("shutdown-socket-admission-scope");

type ShutdownSocketAdmissionContext<
  TConnection extends ShutdownConnectionLike,
> = {
  [shutdownSocketAdmissionScope]?: ShutdownSocketAdmissionScope<TConnection>;
};

export class ShutdownConnectionDrain<
  TConnection extends ShutdownConnectionLike,
> {
  private readonly connections = new Map<string, Set<TConnection>>();
  private readonly pendingAdmissions = new Set<ShutdownConnectionAdmission>();
  private stopping = false;
  private drainPromise?: Promise<void>;
  private resolveDrain?: () => void;
  private emptyCheck?: ReturnType<typeof setImmediate>;

  beginAdmission(
    documentName: string,
    socketId: string,
  ): ShutdownConnectionAdmission | null {
    if (this.stopping) {
      return null;
    }
    const admission = {
      documentName,
      socketId,
      token: Symbol("collab-admission"),
    };
    this.pendingAdmissions.add(admission);
    return admission;
  }

  releaseAdmission(admission?: ShutdownConnectionAdmission): void {
    if (!admission) {
      return;
    }
    this.pendingAdmissions.delete(admission);
    this.scheduleEmptyCheck();
  }

  connected(
    documentName: string,
    socketId: string,
    connection: TConnection,
    admission?: ShutdownConnectionAdmission,
  ): boolean {
    if (
      admission &&
      (admission.documentName !== documentName ||
        admission.socketId !== socketId ||
        !this.pendingAdmissions.has(admission))
    ) {
      this.releaseAdmission(admission);
      return true;
    }
    // Transfer the admission to established-connection tracking without an
    // observable empty interval for the shutdown drain.
    this.add(documentName, socketId, connection);
    this.releaseAdmission(admission);
    return this.stopping;
  }

  disconnected(documentName: string, socketId: string): void {
    const key = connectionKey(documentName, socketId);
    const connections = this.connections.get(key);
    const connection = connections?.values().next().value;
    if (!connections || !connection) {
      this.scheduleEmptyCheck();
      return;
    }
    connections.delete(connection);
    if (connections.size === 0) {
      this.connections.delete(key);
    }
    this.scheduleEmptyCheck();
  }

  begin(documents: Iterable<ShutdownDocumentLike<TConnection>>): Promise<void> {
    if (this.drainPromise) {
      return this.drainPromise;
    }
    this.stopping = true;
    for (const document of documents) {
      for (const connection of document.getConnections()) {
        this.add(document.name, connection.socketId, connection);
      }
    }
    this.drainPromise = new Promise<void>((resolve) => {
      this.resolveDrain = resolve;
    });
    this.scheduleEmptyCheck();
    return this.drainPromise;
  }

  private add(
    documentName: string,
    socketId: string,
    connection: TConnection,
  ): void {
    const key = connectionKey(documentName, socketId);
    let connections = this.connections.get(key);
    if (!connections) {
      connections = new Set<TConnection>();
      this.connections.set(key, connections);
    }
    connections.add(connection);
  }

  private scheduleEmptyCheck(): void {
    if (
      !this.stopping ||
      this.pendingAdmissions.size > 0 ||
      this.connections.size > 0 ||
      this.emptyCheck
    ) {
      return;
    }
    this.emptyCheck = setImmediate(() => {
      this.emptyCheck = undefined;
      if (this.pendingAdmissions.size === 0 && this.connections.size === 0) {
        this.resolveDrain?.();
      }
    });
  }
}

/**
 * Owns every document admission started by one physical websocket. Hocuspocus
 * does not call onDisconnect when that socket closes before authentication has
 * established a Document Connection, so the socket close itself must release
 * these transient admissions.
 */
export class ShutdownSocketAdmissionScope<
  TConnection extends ShutdownConnectionLike,
> {
  private readonly admissions = new Set<ShutdownConnectionAdmission>();
  private closed = false;

  constructor(private readonly drain: ShutdownConnectionDrain<TConnection>) {}

  beginAdmission(
    documentName: string,
    socketId: string,
  ): ShutdownConnectionAdmission | null {
    if (this.closed) {
      return null;
    }
    const admission = this.drain.beginAdmission(documentName, socketId);
    if (admission) {
      this.admissions.add(admission);
    }
    return admission;
  }

  releaseAdmission(admission?: ShutdownConnectionAdmission): void {
    if (!admission) {
      return;
    }
    this.admissions.delete(admission);
    this.drain.releaseAdmission(admission);
  }

  connected(
    documentName: string,
    socketId: string,
    connection: TConnection,
    admission?: ShutdownConnectionAdmission,
  ): boolean {
    if (admission) {
      this.admissions.delete(admission);
    }
    return this.drain.connected(documentName, socketId, connection, admission);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const admission of this.admissions) {
      this.drain.releaseAdmission(admission);
    }
    this.admissions.clear();
  }
}

export function shutdownSocketAdmissionScopeFromContext<
  TConnection extends ShutdownConnectionLike,
>(context: unknown): ShutdownSocketAdmissionScope<TConnection> | undefined {
  if (typeof context !== "object" || context === null) {
    return undefined;
  }
  return (context as ShutdownSocketAdmissionContext<TConnection>)[
    shutdownSocketAdmissionScope
  ];
}

/**
 * Adds a per-websocket admission scope through Hocuspocus' public
 * defaultContext boundary and closes it from the real ClientConnection close
 * callback. No Hocuspocus internals or persistent state are patched.
 */
export function bindShutdownAdmissionsToHocuspocus<
  Context,
  TConnection extends ShutdownConnectionLike,
>(
  hocuspocus: Hocuspocus<Context>,
  drain: ShutdownConnectionDrain<TConnection>,
): void {
  const handleConnection = hocuspocus.handleConnection.bind(hocuspocus);
  hocuspocus.handleConnection = ((incoming, request, defaultContext) => {
    const scope = new ShutdownSocketAdmissionScope(drain);
    const context = {
      ...(defaultContext ?? ({} as Context)),
      [shutdownSocketAdmissionScope]: scope,
    } as Context;
    const clientConnection = handleConnection(incoming, request, context);
    const handleClose = clientConnection.handleClose.bind(clientConnection);
    clientConnection.handleClose = (event) => {
      scope.close();
      handleClose(event);
    };
    return clientConnection;
  }) as typeof hocuspocus.handleConnection;
}
