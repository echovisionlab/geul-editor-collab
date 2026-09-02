import {
  type EditSessionContributorTrackerOptions,
  type EditSessionDocumentLike,
  type EditSessionState,
  type PendingContributors,
} from "./edit-session-contributor-types.ts";
import { EditSessionDocumentRegistry } from "./edit-session-documents.ts";

export class EditSessionDeletionManager<
  TDocument extends EditSessionDocumentLike,
> {
  private readonly deletedEntities = new Set<string>();
  private readonly cleanupPromises = new Map<string, Promise<void>>();

  constructor(
    private readonly documents: EditSessionDocumentRegistry<TDocument>,
    private readonly options: EditSessionContributorTrackerOptions<TDocument>,
    private readonly sessions: Map<string, EditSessionState>,
    private readonly pendingContributors: Map<string, PendingContributors>,
    private readonly cancelTimer: (session: EditSessionState) => void,
    private readonly notifyEntitySettled: (documentName: string) => void,
  ) {}

  isDeletedEntity(entityDocumentName: string): boolean {
    return this.deletedEntities.has(entityDocumentName);
  }

  discard(
    entityDocumentName: string,
    notifyEntityDeleted = true,
  ): Promise<void> {
    const existing = this.cleanupPromises.get(entityDocumentName);
    if (existing) {
      return existing;
    }
    const cleanup = this.discardNow(
      entityDocumentName,
      notifyEntityDeleted,
    ).finally(() => {
      this.cleanupPromises.delete(entityDocumentName);
    });
    this.cleanupPromises.set(entityDocumentName, cleanup);
    return cleanup;
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.cleanupPromises.values());
  }

  documentUnloaded(documentName: string): string | undefined {
    const parsed = this.documents.parse(documentName);
    if (!parsed) {
      return undefined;
    }
    const entityDocumentName = documentName;
    if (this.documents.allForEntity(entityDocumentName).length > 0) {
      return undefined;
    }
    this.deletedEntities.delete(entityDocumentName);
    return entityDocumentName;
  }

  private async discardNow(
    entityDocumentName: string,
    notifyEntityDeleted: boolean,
  ): Promise<void> {
    this.deletedEntities.add(entityDocumentName);
    this.removeSession(entityDocumentName);
    this.clearContributors(entityDocumentName);
    if (notifyEntityDeleted) {
      await this.closeConnections(entityDocumentName);
    }
    this.notifyEntitySettled(entityDocumentName);
    await this.unloadDocuments(entityDocumentName);
  }

  private removeSession(entityDocumentName: string): void {
    const session = this.sessions.get(entityDocumentName);
    if (!session) {
      return;
    }
    this.cancelTimer(session);
    this.sessions.delete(entityDocumentName);
  }

  private clearContributors(entityDocumentName: string): void {
    for (const documentName of [...this.pendingContributors.keys()]) {
      if (documentName === entityDocumentName) {
        this.pendingContributors.delete(documentName);
      }
    }
  }

  private async closeConnections(entityDocumentName: string): Promise<void> {
    try {
      await this.options.onEntityDeleted?.(entityDocumentName);
    } catch {
      const scope = this.documents.scope(entityDocumentName);
      this.options.logFailure({
        reason: "connection_close_failed",
        entity_type: scope?.entityType,
        entity_id: scope?.entityId,
      });
    }
  }

  private async unloadDocuments(entityDocumentName: string): Promise<void> {
    const scope = this.documents.scope(entityDocumentName);
    for (const { document } of this.documents.allForEntity(
      entityDocumentName,
    )) {
      try {
        await this.options.unloadDocument(document);
      } catch {
        this.options.logFailure({
          reason: "unload_failed",
          entity_type: scope?.entityType,
          entity_id: scope?.entityId,
        });
      }
    }
  }
}
