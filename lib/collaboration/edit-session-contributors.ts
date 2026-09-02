import type { DocumentSaveOptions } from "@echovisionlab/geul-common/collaboration/document";
import { EditSessionLifecycle } from "./edit-session-lifecycle.ts";
import {
  activeCheckpointDelay,
  authenticatedMemberId,
  isAcceptedConnectionChange,
  type AcceptedDocumentChange,
  type EditSessionDocumentLike,
  EditSessionEntityDeletedError,
} from "./edit-session-contributor-types.ts";
import {
  canonicalContributorMemberIds,
  requireSaveContributorMemberIds,
} from "./mutation-contributors.ts";

export {
  type AcceptedDocumentChange,
  type EditSessionDocumentLike,
  EditSessionEntityDeletedError,
} from "./edit-session-contributor-types.ts";

type PersistDocument<TDocument> = (
  documentName: string,
  document: TDocument,
  options: DocumentSaveOptions,
) => Promise<unknown>;

export class EditSessionContributorTracker<
  TDocument extends EditSessionDocumentLike,
> extends EditSessionLifecycle<TDocument> {
  documentsForEntity(
    entityDocumentName: string,
  ): Array<{ documentName: string; document: TDocument }> {
    return this.documents.allForEntity(entityDocumentName);
  }

  recordAcceptedChange(change: AcceptedDocumentChange): boolean {
    const memberId = this.acceptedContributor(change);
    if (!memberId) {
      return false;
    }

    return this.recordContributor(change.documentName, memberId);
  }

  recordAcceptedStatelessChange(
    documentName: string,
    authenticatedMemberId: string,
  ): boolean {
    const memberId = authenticatedMemberId.trim();
    if (!memberId || !this.documents.parse(documentName)) {
      return false;
    }
    if (this.isDeletedEntity(documentName)) {
      return false;
    }
    this.recordCheckpointContributor(documentName, memberId);
    return true;
  }

  private recordContributor(documentName: string, memberId: string): boolean {
    if (this.isDeletedEntity(documentName)) {
      return false;
    }

    this.markPendingContributor(documentName, memberId);
    this.recordCheckpointContributor(documentName, memberId);
    return true;
  }

  resourceDeleted(entityDocumentName: string): Promise<void> {
    return this.discardDeletedEntity(entityDocumentName);
  }

  resourceInvalidated(entityDocumentName: string): Promise<void> {
    return this.discardInvalidatedEntity(entityDocumentName);
  }

  async flushPendingMutationBefore(
    documentName: string,
    document: TDocument,
    authenticatedMemberId: string | undefined,
  ): Promise<void> {
    const memberId = authenticatedMemberId?.trim();
    if (!memberId || !this.documents.parse(documentName)) {
      throw new Error("collaboration_mutation_actor_required");
    }
    const pending = this.pendingMutationContributorMemberIds(documentName);
    if (pending.length > 1) {
      throw new Error("collaboration_mutation_actor_mixed");
    }
    if (pending.length === 0 || pending[0] === memberId) {
      return;
    }
    await this.persist(documentName, document);
    const remaining = this.pendingMutationContributorMemberIds(documentName);
    if (remaining.length > 0) {
      throw new Error("collaboration_mutation_actor_flush_incomplete");
    }
  }

  private acceptedContributor(
    change: AcceptedDocumentChange,
  ): string | undefined {
    if (!isAcceptedConnectionChange(change)) {
      return undefined;
    }
    const memberId = authenticatedMemberId(change.context);
    const parsed = this.documents.parse(change.documentName);
    if (!memberId || !parsed) {
      return undefined;
    }
    const entityDocumentName = change.documentName;
    return this.isDeletedEntity(entityDocumentName) ? undefined : memberId;
  }

  private recordCheckpointContributor(
    documentName: string,
    memberId: string,
  ): void {
    const scope = this.documents.scope(documentName);
    if (!scope) {
      return;
    }
    const session = this.getOrCreateSession(scope.entityDocumentName);
    if (session.timerMode === "room-close") {
      this.cancelTimer(session);
    }
    session.generation += 1;
    session.retryAttempts = 0;
    (session.finalizing ? session.nextContributors : session.contributors).add(
      memberId,
    );
    if (!session.finalizing && !session.timer) {
      this.scheduleFinalization(
        scope.entityDocumentName,
        session,
        activeCheckpointDelay(session),
        "active-window",
      );
    }
  }

  async persist(
    documentName: string,
    document: TDocument,
    options: DocumentSaveOptions = {},
  ): Promise<unknown> {
    return this.persistWith(
      (queuedDocumentName, queuedDocument, queuedOptions) =>
        this.options.persistDocument(
          queuedDocumentName,
          queuedDocument,
          queuedOptions,
          this.documents.persistenceQueueKey(queuedDocumentName),
        ),
      documentName,
      document,
      options,
    );
  }

  private saveContributorMemberIds(
    documentName: string,
    options: DocumentSaveOptions,
  ): string[] | undefined {
    const explicit =
      options.contributorMemberIds === undefined
        ? undefined
        : canonicalContributorMemberIds(options.contributorMemberIds);
    const contributorMemberIds =
      explicit ?? this.pendingMutationContributorMemberIds(documentName);
    if (
      options.versionCheckpoint !== true &&
      explicit === undefined &&
      contributorMemberIds.length === 0
    ) {
      return undefined;
    }
    return requireSaveContributorMemberIds({
      ...options,
      contributorMemberIds,
    });
  }

  protected async persistWith(
    persistDocument: PersistDocument<TDocument>,
    documentName: string,
    document: TDocument,
    options: DocumentSaveOptions,
  ): Promise<unknown> {
    const parsed = this.documents.parse(documentName);
    const entityDocumentName = parsed ? documentName : undefined;
    if (entityDocumentName && this.isDeletedEntity(entityDocumentName)) {
      throw new EditSessionEntityDeletedError(entityDocumentName);
    }
    const pendingSnapshot = new Map(
      this.pendingContributors.get(documentName) ?? [],
    );
    const contributorMemberIds = this.saveContributorMemberIds(
      documentName,
      options,
    );
    if (!contributorMemberIds) {
      return undefined;
    }
    let result: unknown;
    try {
      result = await persistDocument(documentName, document, {
        ...options,
        contributorMemberIds,
      });
    } catch (error) {
      if (
        entityDocumentName &&
        this.options.isEntityDeleted?.(entityDocumentName, error) === true
      ) {
        await this.discardDeletedEntity(entityDocumentName);
        throw new EditSessionEntityDeletedError(entityDocumentName);
      }
      throw error;
    }
    this.advancePendingContributors(documentName, pendingSnapshot);
    return result;
  }
}
