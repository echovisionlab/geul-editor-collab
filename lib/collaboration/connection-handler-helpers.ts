import type { Connection, ServerConfiguration } from "@hocuspocus/server";
import { logger } from "../logger.ts";
import { presenceForMember } from "./admission.ts";
import { AwarenessConnectionOwnership } from "./awareness-ownership.ts";
import type {
  AuthenticatedMemberContext,
  CollabConnectionContext,
} from "./connection-context.ts";
import type { MetadataAiReconnectGrace } from "./metadata-ai-reconnect-grace.ts";
import type { ShutdownConnectionDrain } from "./shutdown-connection-drain.ts";
import { shutdownSocketAdmissionScopeFromContext } from "./shutdown-connection-drain.ts";
import { shutdownAdmissionFromContext } from "./connection-context.ts";
import { COLLAB_RELOAD_REQUIRED_SIGNAL } from "./room-epoch.ts";
import { authenticatedMemberId } from "./edit-session-contributor-types.ts";

type ConnectedPayload = Parameters<
  NonNullable<ServerConfiguration["connected"]>
>[0];
type BeforeHandleMessagePayload = Parameters<
  NonNullable<ServerConfiguration["beforeHandleMessage"]>
>[0];
type BeforeSyncPayload = Parameters<
  NonNullable<ServerConfiguration["beforeSync"]>
>[0];
type BeforeHandleAwarenessPayload = Parameters<
  NonNullable<ServerConfiguration["beforeHandleAwareness"]>
>[0];
type DisconnectPayload = Parameters<
  NonNullable<ServerConfiguration["onDisconnect"]>
>[0];

interface BlockRoomConnectionProtocol {
  connected(
    connection: Connection,
    context: CollabConnectionContext,
    documentName: string,
    document: Connection["document"],
  ): void;
  beforeSync(
    connection: Pick<Connection, "close" | "sendStateless">,
    context: CollabConnectionContext,
    documentName: string,
    document: Connection["document"],
    type: number,
    payload: Uint8Array,
  ): void;
}

export interface ConnectionHookDependencies {
  shutdownConnections: ShutdownConnectionDrain<Connection>;
  metadataAiGrace: MetadataAiReconnectGrace;
  editSessions(): {
    connected(documentName: string, memberId: string | undefined): void;
    disconnected(documentName: string): void;
    flushPendingMutationBefore(
      documentName: string,
      document: Connection["document"],
      authenticatedMemberId: string | undefined,
    ): Promise<void>;
  };
  blockRooms: BlockRoomConnectionProtocol;
  isDocumentFenced(documentName: string): boolean;
  settlePendingRoomInvalidation(
    documentName: string,
    document: Connection["document"],
  ): Promise<void>;
}

export interface ConnectionHookState {
  awarenessOwnership: AwarenessConnectionOwnership<CollabConnectionContext>;
  awarenessConnections: Map<string, Connection>;
  connectionKey(documentName: string, socketId: string): string;
  authorizeFrame(
    connection: Connection,
    context: CollabConnectionContext,
    documentName: string,
  ): Promise<void>;
}

function registerConnection(
  dependencies: ConnectionHookDependencies,
  connection: Connection,
  context: unknown,
  documentName: string,
  socketId: string,
): boolean {
  const socketAdmission =
    shutdownSocketAdmissionScopeFromContext<Connection>(context);
  const rejected = socketAdmission
    ? socketAdmission.connected(
        documentName,
        socketId,
        connection,
        shutdownAdmissionFromContext(context),
      )
    : dependencies.shutdownConnections.connected(
        documentName,
        socketId,
        connection,
        shutdownAdmissionFromContext(context),
      );
  if (rejected) {
    connection.close();
  }
  return !rejected;
}

function createConnectedHandler(
  dependencies: ConnectionHookDependencies,
  state: ConnectionHookState,
) {
  return async ({
    connection,
    context,
    documentName,
    socketId,
  }: ConnectedPayload) => {
    const collabContext = context as CollabConnectionContext;
    const member = collabContext.member;
    if (
      !registerConnection(
        dependencies,
        connection,
        context,
        documentName,
        socketId,
      )
    ) {
      return;
    }
    connection.readOnly = collabContext.canEdit === false;
    if (dependencies.isDocumentFenced(documentName)) {
      signalReloadRequired(connection);
      await dependencies.settlePendingRoomInvalidation(
        documentName,
        connection.document,
      );
      return;
    }
    state.awarenessConnections.set(
      state.connectionKey(documentName, socketId),
      connection,
    );
    dependencies.editSessions().connected(documentName, member?.id);
    dependencies.metadataAiGrace.connected(connection.document, member?.id);
    dependencies.blockRooms.connected(
      connection,
      collabContext,
      documentName,
      connection.document,
    );
  };
}

function createBeforeHandleMessageHandler(state: ConnectionHookState) {
  return async ({
    connection,
    context,
    documentName,
    update,
  }: BeforeHandleMessagePayload) => {
    const collabContext = context as CollabConnectionContext;
    await state.authorizeFrame(connection, collabContext, documentName);
    state.awarenessOwnership.prepareInboundMessage(connection, update);
  };
}

function createBeforeSyncHandler(dependencies: ConnectionHookDependencies) {
  return async ({
    connection,
    context,
    documentName,
    document,
    type,
    payload,
  }: BeforeSyncPayload) => {
    const collabContext = context as CollabConnectionContext;
    const admitted =
      collabContext.blockRoomAdmissionState === undefined ||
      collabContext.blockRoomAdmissionState === "accepted";
    if (
      (type === 1 || type === 2) &&
      admitted &&
      collabContext.canEdit !== false &&
      connection.readOnly !== true
    ) {
      await dependencies
        .editSessions()
        .flushPendingMutationBefore(
          documentName,
          document,
          authenticatedMemberId(collabContext),
        );
    }
    dependencies.blockRooms.beforeSync(
      connection,
      collabContext,
      documentName,
      document,
      type,
      payload,
    );
  };
}

function createBeforeHandleAwarenessHandler(state: ConnectionHookState) {
  return async ({
    context,
    states,
    transactionOrigin,
  }: BeforeHandleAwarenessPayload) => {
    const member = context?.member as AuthenticatedMemberContext | undefined;
    const collabContext = context as CollabConnectionContext | undefined;
    if (
      !member ||
      (collabContext?.blockRoomAdmissionState &&
        collabContext.blockRoomAdmissionState !== "accepted")
    ) {
      states.clear();
      return;
    }
    state.awarenessOwnership.rewriteOwnedStates(
      states,
      transactionOrigin,
      (awareness) => ({ ...awareness, user: presenceForMember(member) }),
    );
  };
}

function releaseAdmission(
  dependencies: ConnectionHookDependencies,
  context: unknown,
): void {
  const admission = shutdownAdmissionFromContext(context);
  const socketAdmission =
    shutdownSocketAdmissionScopeFromContext<Connection>(context);
  if (socketAdmission) {
    socketAdmission.releaseAdmission(admission);
    return;
  }
  dependencies.shutdownConnections.releaseAdmission(admission);
}

function createDisconnectHandler(
  dependencies: ConnectionHookDependencies,
  state: ConnectionHookState,
) {
  return async ({
    documentName,
    context,
    document,
    socketId,
  }: DisconnectPayload) => {
    try {
      dependencies.metadataAiGrace.disconnected(document);
      dependencies.editSessions().disconnected(documentName);
    } finally {
      releaseAdmission(dependencies, context);
      const key = state.connectionKey(documentName, socketId);
      const connection = state.awarenessConnections.get(key);
      if (connection) {
        state.awarenessOwnership.disconnected(connection);
        state.awarenessConnections.delete(key);
      }
      dependencies.shutdownConnections.disconnected(documentName, socketId);
    }
  };
}

function signalReloadRequired(
  connection: Pick<Connection, "close" | "sendStateless">,
): void {
  try {
    connection.sendStateless(
      JSON.stringify({
        kind: COLLAB_RELOAD_REQUIRED_SIGNAL,
        reason: COLLAB_RELOAD_REQUIRED_SIGNAL,
      }),
    );
  } catch {
    // The fenced connection is still closed when the best-effort signal fails.
  }
  try {
    connection.close();
  } catch {
    // The ownership fence remains authoritative even if transport close fails.
  }
}

export function createConnectionHandlers(
  dependencies: ConnectionHookDependencies,
  state: ConnectionHookState,
) {
  return {
    connected: createConnectedHandler(dependencies, state),
    beforeHandleMessage: createBeforeHandleMessageHandler(state),
    beforeSync: createBeforeSyncHandler(dependencies),
    beforeHandleAwareness: createBeforeHandleAwarenessHandler(state),
    onDisconnect: createDisconnectHandler(dependencies, state),
    async onListen({ port }) {
      logger.info("Hocuspocus listening", { port });
    },
  } satisfies Partial<ServerConfiguration>;
}
