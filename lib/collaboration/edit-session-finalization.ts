import type { DocumentSaveOptions } from "@echovisionlab/geul-common/collaboration/document";
import {
  EDIT_SESSION_MAX_RETRIES,
  EDIT_SESSION_RECONNECT_GRACE_MS,
  EDIT_SESSION_VERSION_CHECKPOINT_MS,
  activeCheckpointDelay,
  type EditSessionContributorTrackerOptions,
  type EditSessionDocumentLike,
  type EditSessionState,
  type FinalizationMode,
  type PendingContributors,
  EditSessionEntityDeletedError,
  checkpointEntityType,
  sorted,
} from "./edit-session-contributor-types.ts";
import {
  finalizationFailureReason,
  persistEditSessionCheckpoint,
} from "./edit-session-finalizer.ts";
import { CollaborationConflictError } from "../api/transport.ts";
import { EditSessionDocumentRegistry } from "./edit-session-documents.ts";

type PersistDocument<TDocument> = (
  documentName: string,
  document: TDocument,
  options: DocumentSaveOptions,
) => Promise<unknown>;

export interface EditSessionFinalizationDependencies<
  TDocument extends EditSessionDocumentLike,
> {
  options: EditSessionContributorTrackerOptions<TDocument>;
  documents: EditSessionDocumentRegistry<TDocument>;
  sessions: Map<string, EditSessionState>;
  pendingContributors: Map<string, PendingContributors>;
  cancelTimer(session: EditSessionState): void;
  notifyEntitySettled(documentName: string): void;
  persistWith(
    persistDocument: PersistDocument<TDocument>,
    documentName: string,
    document: TDocument,
    options: DocumentSaveOptions,
  ): Promise<unknown>;
  isShuttingDown(): boolean;
}

interface FinalizeOptions {
  ignoreConnections?: boolean;
  throwOnFailure?: boolean;
  unloadDisconnected?: boolean;
}

export class EditSessionFinalizationCoordinator<
  TDocument extends EditSessionDocumentLike,
> {
  private readonly finalizationPromises = new Map<string, Promise<void>>();

  constructor(
    private readonly dependencies: EditSessionFinalizationDependencies<TDocument>,
  ) {}

  schedule(
    entityDocumentName: string,
    session: EditSessionState,
    delayMs: number,
    mode: FinalizationMode,
  ): void {
    if (this.dependencies.isShuttingDown() || session.timer) {
      return;
    }
    session.timer = setTimeout(() => {
      session.timer = undefined;
      session.timerMode = undefined;
      void this.start(entityDocumentName, session, {
        ignoreConnections: mode === "active-window",
        unloadDisconnected: mode === "room-close",
      });
    }, delayMs);
    session.timerMode = mode;
    session.timer.unref();
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.finalizationPromises.values());
    for (let pass = 0; pass <= EDIT_SESSION_MAX_RETRIES; pass += 1) {
      const entries = [...this.dependencies.sessions.entries()];
      if (entries.length === 0) {
        return;
      }
      for (const [entityDocumentName, session] of entries) {
        session.finalizing = false;
        try {
          await this.start(entityDocumentName, session, {
            ignoreConnections: true,
            throwOnFailure: true,
          });
        } catch {
          // The failure is already classified and logged by finalize. Continue
          // the bounded immediate shutdown retries.
        }
      }
    }

    if (this.dependencies.sessions.size > 0) {
      throw new Error("edit_session_shutdown_drain_exhausted");
    }
  }

  private start(
    entityDocumentName: string,
    session: EditSessionState,
    options: FinalizeOptions = {},
  ): Promise<void> {
    const promise = this.finalize(entityDocumentName, session, options).finally(
      () => {
        this.finalizationPromises.delete(entityDocumentName);
      },
    );
    this.finalizationPromises.set(entityDocumentName, promise);
    return promise;
  }

  private async finalize(
    entityDocumentName: string,
    session: EditSessionState,
    options: FinalizeOptions,
  ): Promise<void> {
    if (
      !options.ignoreConnections &&
      this.dependencies.documents.hasConnectedEditor(entityDocumentName)
    ) {
      this.schedule(
        entityDocumentName,
        session,
        activeCheckpointDelay(session),
        "active-window",
      );
      return;
    }

    session.finalizing = true;
    const generation = session.generation;
    const contributorMemberIds = sorted(session.contributors);
    const source =
      this.dependencies.documents.checkpointDocuments(entityDocumentName)[0];
    try {
      const completed = await persistEditSessionCheckpoint({
        entityDocumentName,
        sourceDocument: source,
        contributorMemberIds,
        canContinue: () =>
          this.canContinue(
            entityDocumentName,
            session,
            generation,
            options.ignoreConnections === true,
          ),
        sourceDocumentIsCurrent: (documentName) =>
          this.dependencies.documents.sourceDocumentIsCurrent(
            entityDocumentName,
            documentName,
          ),
        persistWith: (persistDocument, documentName, document, saveOptions) =>
          this.dependencies.persistWith(
            persistDocument,
            documentName,
            document,
            saveOptions,
          ),
        withPersistenceQueue: (queueKey, operation) =>
          this.dependencies.options.withPersistenceQueue(queueKey, operation),
      });

      if (!completed) {
        return;
      }
      if (this.complete(entityDocumentName, session)) {
        return;
      }
    } catch (error) {
      await this.handleFailure(
        entityDocumentName,
        session,
        error,
        options.throwOnFailure === true,
      );
      return;
    }

    if (
      !options.unloadDisconnected &&
      this.dependencies.documents.hasConnectedEditor(entityDocumentName)
    ) {
      return;
    }
    await this.unloadDisconnectedDocuments(entityDocumentName);
  }

  private complete(
    entityDocumentName: string,
    session: EditSessionState,
  ): boolean {
    const nextContributors = sorted(session.nextContributors);
    if (nextContributors.length === 0) {
      this.dependencies.sessions.delete(entityDocumentName);
      this.dependencies.notifyEntitySettled(entityDocumentName);
      return false;
    }
    session.contributors = new Set(nextContributors);
    session.nextContributors.clear();
    session.checkpointDueAt = Date.now() + EDIT_SESSION_VERSION_CHECKPOINT_MS;
    session.finalizing = false;
    this.scheduleNextCheckpoint(entityDocumentName, session);
    return true;
  }

  private async handleFailure(
    entityDocumentName: string,
    session: EditSessionState,
    error: unknown,
    throwOnFailure: boolean,
  ): Promise<void> {
    if (error instanceof EditSessionEntityDeletedError) {
      return;
    }
    for (const memberId of session.nextContributors) {
      session.contributors.add(memberId);
    }
    session.nextContributors.clear();
    session.finalizing = false;
    session.retryAttempts += 1;
    const scope = this.dependencies.documents.scope(entityDocumentName);
    const reason = finalizationFailureReason(error);
    const entityType = checkpointEntityType(entityDocumentName);
    const failure = {
      reason,
      entity_type: scope?.entityType,
      entity_id: scope?.entityId,
      retry_attempt: session.retryAttempts,
    };
    if (error instanceof CollaborationConflictError) {
      await this.settleConflict(
        entityDocumentName,
        session,
        error,
        reason,
        failure,
      );
      return;
    }
    if (session.retryAttempts > EDIT_SESSION_MAX_RETRIES) {
      const logTerminalFailure =
        scope && entityType
          ? () =>
              this.dependencies.options.logTerminalCheckpointFailure({
                reason,
                entity_type: entityType,
                entity_id: scope.entityId,
                retry_count: session.retryAttempts,
              })
          : () =>
              this.dependencies.options.logFailure({
                ...failure,
                terminal: true,
              });
      logTerminalFailure();
      await this.settleExhaustedFinalization(entityDocumentName, session);
      return;
    }
    this.dependencies.options.logFailure(failure);
    if (throwOnFailure) {
      throw new Error(reason);
    }
    this.scheduleRetry(entityDocumentName, session);
  }

  private async settleConflict(
    entityDocumentName: string,
    session: EditSessionState,
    error: CollaborationConflictError,
    reason: ReturnType<typeof finalizationFailureReason>,
    failure: Record<string, unknown>,
  ): Promise<void> {
    const scope = this.dependencies.documents.scope(entityDocumentName);
    const entityType = checkpointEntityType(entityDocumentName);
    if (scope && entityType) {
      this.dependencies.options.logTerminalCheckpointFailure({
        reason,
        entity_type: entityType,
        entity_id: scope.entityId,
        retry_count: 1,
      });
    } else {
      this.dependencies.options.logFailure({
        ...failure,
        retry_attempt: 1,
        terminal: true,
      });
    }
    await this.dependencies.options.onCheckpointConflict?.(
      entityDocumentName,
      error,
    );
    await this.settleExhaustedFinalization(entityDocumentName, session);
  }

  async settleExhaustedFinalization(
    entityDocumentName: string,
    session: EditSessionState,
  ): Promise<void> {
    if (this.dependencies.sessions.get(entityDocumentName) !== session) {
      return;
    }
    this.dependencies.cancelTimer(session);
    this.dependencies.sessions.delete(entityDocumentName);

    for (const documentName of [
      ...this.dependencies.pendingContributors.keys(),
    ]) {
      const scope = this.dependencies.documents.scope(documentName);
      if (scope?.entityDocumentName === entityDocumentName) {
        this.dependencies.pendingContributors.delete(documentName);
      }
    }
    this.dependencies.notifyEntitySettled(entityDocumentName);

    if (this.dependencies.isShuttingDown()) {
      return;
    }
    await this.unloadDisconnectedDocuments(entityDocumentName);
  }

  private async unloadDisconnectedDocuments(
    entityDocumentName: string,
  ): Promise<void> {
    for (const { document } of this.dependencies.documents.checkpointDocuments(
      entityDocumentName,
    )) {
      if ([...document.getConnections()].length > 0) {
        continue;
      }
      try {
        await this.dependencies.options.unloadDocument(document);
      } catch {
        const scope = this.dependencies.documents.scope(entityDocumentName);
        this.dependencies.options.logFailure({
          reason: "unload_failed",
          entity_type: scope?.entityType,
          entity_id: scope?.entityId,
        });
      }
    }
  }

  private canContinue(
    entityDocumentName: string,
    session: EditSessionState,
    generation: number,
    ignoreConnections: boolean,
  ): boolean {
    if (
      session.generation === generation &&
      session.nextContributors.size === 0 &&
      (ignoreConnections ||
        !this.dependencies.documents.hasConnectedEditor(entityDocumentName))
    ) {
      return true;
    }

    for (const memberId of session.nextContributors) {
      session.contributors.add(memberId);
    }
    session.nextContributors.clear();
    session.finalizing = false;
    this.scheduleRetry(entityDocumentName, session);
    return false;
  }

  private scheduleNextCheckpoint(
    entityDocumentName: string,
    session: EditSessionState,
  ): void {
    if (this.dependencies.documents.hasConnectedEditor(entityDocumentName)) {
      this.schedule(
        entityDocumentName,
        session,
        activeCheckpointDelay(session),
        "active-window",
      );
      return;
    }
    this.schedule(
      entityDocumentName,
      session,
      EDIT_SESSION_RECONNECT_GRACE_MS,
      "room-close",
    );
  }

  private scheduleRetry(
    entityDocumentName: string,
    session: EditSessionState,
  ): void {
    this.schedule(
      entityDocumentName,
      session,
      EDIT_SESSION_RECONNECT_GRACE_MS,
      this.dependencies.documents.hasConnectedEditor(entityDocumentName)
        ? "active-window"
        : "room-close",
    );
  }
}
