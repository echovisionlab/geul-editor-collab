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
  sorted,
} from "./edit-session-contributor-types.ts";
import { EditSessionDeletionManager } from "./edit-session-deletion.ts";
import { EditSessionDocumentRegistry } from "./edit-session-documents.ts";
import { EditSessionFinalizationCoordinator } from "./edit-session-finalization.ts";

type PersistDocument<TDocument> = (
  documentName: string,
  document: TDocument,
  options: DocumentSaveOptions,
) => Promise<unknown>;

export abstract class EditSessionLifecycle<
  TDocument extends EditSessionDocumentLike,
> {
  protected readonly sessions = new Map<string, EditSessionState>();
  protected readonly pendingContributors = new Map<
    string,
    PendingContributors
  >();
  private mutationSequence = 0;
  private unloadGuardsReleased = false;
  private shuttingDown = false;
  protected readonly documents: EditSessionDocumentRegistry<TDocument>;
  private readonly deletion: EditSessionDeletionManager<TDocument>;
  private readonly finalization: EditSessionFinalizationCoordinator<TDocument>;

  constructor(
    protected readonly options: EditSessionContributorTrackerOptions<TDocument>,
  ) {
    this.documents = new EditSessionDocumentRegistry(options);
    this.finalization = new EditSessionFinalizationCoordinator({
      options,
      documents: this.documents,
      sessions: this.sessions,
      pendingContributors: this.pendingContributors,
      cancelTimer: (session) => this.cancelTimer(session),
      notifyEntitySettled: (documentName) =>
        this.notifyEntitySettled(documentName),
      persistWith: (persistDocument, documentName, document, saveOptions) =>
        this.persistWith(persistDocument, documentName, document, saveOptions),
      isShuttingDown: () => this.shuttingDown,
    });
    this.deletion = new EditSessionDeletionManager(
      this.documents,
      options,
      this.sessions,
      this.pendingContributors,
      (session) => this.cancelTimer(session),
      (documentName) => this.notifyEntitySettled(documentName),
    );
  }

  protected abstract persistWith(
    persistDocument: PersistDocument<TDocument>,
    documentName: string,
    document: TDocument,
    options: DocumentSaveOptions,
  ): Promise<unknown>;

  protected isDeletedEntity(entityDocumentName: string): boolean {
    return this.deletion.isDeletedEntity(entityDocumentName);
  }

  protected markPendingContributor(
    documentName: string,
    memberId: string,
  ): void {
    let pending = this.pendingContributors.get(documentName);
    if (!pending) {
      pending = new Map<string, number>();
      this.pendingContributors.set(documentName, pending);
    }
    if (pending.size > 0 && !pending.has(memberId)) {
      throw new Error("collaboration_mutation_actor_mixed");
    }
    pending.set(memberId, ++this.mutationSequence);
  }

  protected pendingMutationContributorMemberIds(
    documentName: string,
  ): string[] {
    return sorted(this.pendingContributors.get(documentName)?.keys() ?? []);
  }

  protected getOrCreateSession(entityDocumentName: string): EditSessionState {
    const existing = this.sessions.get(entityDocumentName);
    if (existing) {
      return existing;
    }
    const created: EditSessionState = {
      contributors: new Set<string>(),
      nextContributors: new Set<string>(),
      checkpointDueAt: Date.now() + EDIT_SESSION_VERSION_CHECKPOINT_MS,
      finalizing: false,
      generation: 0,
      retryAttempts: 0,
    };
    this.sessions.set(entityDocumentName, created);
    return created;
  }

  connected(documentName: string, memberId: string | undefined): void {
    void memberId;
    const scope = this.checkpointScope(documentName);
    if (!scope) {
      return;
    }
    const session = this.sessions.get(scope.entityDocumentName);
    if (!session) {
      return;
    }
    if (session.timerMode === "room-close") {
      this.cancelTimer(session);
    }
    session.retryAttempts = 0;
    if (!session.finalizing && !session.timer) {
      this.scheduleFinalization(
        scope.entityDocumentName,
        session,
        activeCheckpointDelay(session),
        "active-window",
      );
    }
  }

  disconnected(documentName: string): void {
    const scope = this.checkpointScope(documentName);
    if (!scope) {
      return;
    }
    const session = this.sessions.get(scope.entityDocumentName);
    if (
      !session ||
      session.finalizing ||
      session.retryAttempts > EDIT_SESSION_MAX_RETRIES
    ) {
      return;
    }
    if (this.documents.hasConnectedEditor(scope.entityDocumentName)) {
      return;
    }
    this.cancelTimer(session);
    this.scheduleFinalization(
      scope.entityDocumentName,
      session,
      EDIT_SESSION_RECONNECT_GRACE_MS,
      "room-close",
    );
  }

  contributorMemberIds(documentName: string): string[] {
    const scope = this.documents.scope(documentName);
    const pending = sorted(
      this.pendingContributors.get(documentName)?.keys() ?? [],
    );
    if (!scope) {
      return pending;
    }
    const session = this.sessions.get(scope.entityDocumentName);
    if (!session) {
      return pending;
    }
    return sorted([...session.contributors, ...session.nextContributors]);
  }

  preventsUnload(documentName: string): boolean {
    if (!this.unloadGuardsReleased && this.shuttingDown) {
      return true;
    }
    const scope = this.documents.scope(documentName);
    return Boolean(
      !this.unloadGuardsReleased &&
      scope &&
      this.sessions.has(scope.entityDocumentName),
    );
  }

  beginShutdown(): void {
    this.shuttingDown = true;
    for (const session of this.sessions.values()) {
      this.cancelTimer(session);
    }
  }

  release(): void {
    this.beginShutdown();
    this.unloadGuardsReleased = true;
  }

  documentUnloaded(documentName: string): void {
    this.pendingContributors.delete(documentName);
    this.notifyEntitySettled(documentName);
    this.deletion.documentUnloaded(documentName);
  }

  async drainForShutdown(): Promise<void> {
    this.beginShutdown();

    await this.deletion.drain();
    await this.finalization.drain();
  }

  protected discardDeletedEntity(entityDocumentName: string): Promise<void> {
    return this.deletion.discard(entityDocumentName);
  }

  protected discardInvalidatedEntity(
    entityDocumentName: string,
  ): Promise<void> {
    return this.deletion.discard(entityDocumentName, false);
  }

  protected cancelTimer(session: EditSessionState): void {
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = undefined;
      session.timerMode = undefined;
    }
  }

  protected advancePendingContributors(
    documentName: string,
    snapshot: PendingContributors,
  ): void {
    const current = this.pendingContributors.get(documentName);
    if (!current) {
      return;
    }
    for (const [memberId, sequence] of snapshot) {
      if (current.get(memberId) === sequence) {
        current.delete(memberId);
      }
    }
    if (current.size === 0) {
      this.pendingContributors.delete(documentName);
    }
    this.notifyEntitySettled(documentName);
  }

  protected notifyEntitySettled(documentName: string): void {
    const parsed = this.documents.parse(documentName);
    if (!parsed || !this.options.supportsVersionCheckpoints(parsed.type)) {
      return;
    }
    const entityDocumentName = documentName;
    if (this.sessions.has(entityDocumentName)) {
      return;
    }
    for (const [pendingDocumentName, contributors] of this
      .pendingContributors) {
      if (contributors.size > 0 && pendingDocumentName === entityDocumentName) {
        return;
      }
    }
    this.options.onEntitySettled?.(entityDocumentName);
  }

  protected scheduleFinalization(
    entityDocumentName: string,
    session: EditSessionState,
    delayMs: number,
    mode: FinalizationMode,
  ): void {
    this.finalization.schedule(entityDocumentName, session, delayMs, mode);
  }

  private checkpointScope(documentName: string) {
    const scope = this.documents.scope(documentName);
    return scope;
  }
}
