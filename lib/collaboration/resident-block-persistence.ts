import type * as Y from "yjs";
import {
  mergeBlockRoomChangeSets,
  type BlockRoomChangeSet,
} from "@echovisionlab/geul-common/collaboration/block-room-codec";
import {
  BlockMutationBaseline,
  type BlockMutationAck,
  type BlockMutationBatch,
  type CanonicalBlockChanges,
  type CanonicalBlockDocument,
} from "./block-mutation-batch.ts";
import { CollaborationConflictError } from "../api/transport.ts";
import { requireSaveContributorMemberIds } from "./mutation-contributors.ts";

export interface ResidentBlockCheckpointRequest {
  expectedDocumentRevision: string;
  contributorMemberIds: string[];
}

export interface ResidentBlockAdapter<TBase = unknown, TLocale = unknown> {
  ensureAuthority(document: Y.Doc): void;
  decodeFull(document: Y.Doc): CanonicalBlockDocument<TBase, TLocale>;
  decodeAffected(
    document: Y.Doc,
    changeSet: BlockRoomChangeSet,
  ): CanonicalBlockChanges<TBase, TLocale>;
  save(batch: BlockMutationBatch<TBase, TLocale>): Promise<BlockMutationAck>;
  checkpoint?(request: ResidentBlockCheckpointRequest): Promise<unknown>;
}

export interface ResidentBlockLoad<TBase = unknown, TLocale = unknown> {
  documentRevision: string;
  targetRevision?: string;
  sourceLocale: string;
  locale: string;
  localeExists: boolean;
  snapshot: CanonicalBlockDocument<TBase, TLocale>;
}

export interface ResidentBlockPersistResult {
  documentRevision: string;
  targetRevision?: string;
  sourceLocale: string;
  locale: string;
  localeExists: boolean;
  blockCatalogFingerprint: string;
  contributorMemberIds: string[];
}

interface ResidentRoom<TBase, TLocale> {
  adapter: ResidentBlockAdapter<TBase, TLocale>;
  baseline: BlockMutationBaseline<TBase, TLocale>;
  documentName: string;
  sourceLocale: string;
  locale: string;
  localeExists: boolean;
  blockCatalogFingerprint: string;
  pendingChangeSet?: BlockRoomChangeSet;
  pendingOrigins?: Array<{ origin: unknown; originKind: "local" | "remote" }>;
  stopObserving: () => void;
}

export interface ResidentExternalMutationRevisionTuple {
  expectedDocumentRevision: string;
  acceptedDocumentRevision: string;
  expectedTargetRevision?: string;
  acceptedTargetRevision?: string;
}

function persistResult<TBase, TLocale>(
  room: ResidentRoom<TBase, TLocale>,
  contributorMemberIds: readonly string[],
): ResidentBlockPersistResult {
  return {
    documentRevision: room.baseline.revision,
    ...(room.baseline.target === undefined
      ? {}
      : { targetRevision: room.baseline.target }),
    sourceLocale: room.sourceLocale,
    locale: room.locale,
    localeExists: room.localeExists,
    blockCatalogFingerprint: room.blockCatalogFingerprint,
    contributorMemberIds: [...new Set(contributorMemberIds)].sort(),
  };
}

async function saveBatch<TBase, TLocale>(
  room: ResidentRoom<TBase, TLocale>,
  batch: BlockMutationBatch<TBase, TLocale>,
): Promise<BlockMutationAck> {
  return await room.adapter.save(batch);
}

function acknowledgeSave<TBase, TLocale>(
  room: ResidentRoom<TBase, TLocale>,
  ack: BlockMutationAck,
): void {
  room.baseline.acknowledge(ack);
  if (room.locale === room.sourceLocale || ack.targetRevision) return;
  room.localeExists = false;
  throw new CollaborationConflictError(
    "target_revision_changed",
    "target_locale_deleted",
  );
}

export class ResidentBlockPersistence<TBase = unknown, TLocale = unknown> {
  private readonly rooms = new WeakMap<Y.Doc, ResidentRoom<TBase, TLocale>>();
  private readonly documents = new Map<string, Y.Doc>();

  register(
    documentName: string,
    document: Y.Doc,
    load: ResidentBlockLoad<TBase, TLocale>,
    adapter: ResidentBlockAdapter<TBase, TLocale>,
    stopObserving: () => void = () => undefined,
  ): void {
    const resident = this.documents.get(documentName);
    if (resident && resident !== document) {
      throw new Error(`resident_document_already_loaded:${documentName}`);
    }
    const baseline = BlockMutationBaseline.fromSnapshot(
      load.snapshot,
      load.documentRevision,
      load.targetRevision,
    );
    this.rooms.set(document, {
      adapter,
      baseline,
      documentName,
      sourceLocale: load.sourceLocale,
      locale: load.locale,
      localeExists: load.localeExists,
      blockCatalogFingerprint: load.snapshot.blockCatalogFingerprint,
      stopObserving,
    });
    this.documents.set(documentName, document);
  }

  snapshot(documentName: string):
    | {
        documentRevision: string;
        targetRevision?: string;
        sourceLocale: string;
        locale: string;
        localeExists: boolean;
        blockCatalogFingerprint: string;
      }
    | undefined {
    const document = this.documents.get(documentName);
    const room = document ? this.rooms.get(document) : undefined;
    if (!document || !room) return undefined;
    room.adapter.ensureAuthority(document);
    return {
      documentRevision: room.baseline.revision,
      ...(room.baseline.target === undefined
        ? {}
        : { targetRevision: room.baseline.target }),
      sourceLocale: room.sourceLocale,
      locale: room.locale,
      localeExists: room.localeExists,
      blockCatalogFingerprint: room.blockCatalogFingerprint,
    };
  }

  recordChange(
    documentName: string,
    document: Y.Doc,
    changeSet: BlockRoomChangeSet,
    observed?: { origin: unknown; originKind: "local" | "remote" },
  ): void {
    const room = this.room(documentName, document);
    room.pendingChangeSet = mergeBlockRoomChangeSets(
      room.pendingChangeSet,
      changeSet,
    );
    if (observed) {
      (room.pendingOrigins ??= []).push(observed);
    }
  }

  assertExternalMutationReady(
    documentName: string,
    document: Y.Doc,
    revisions: Pick<
      ResidentExternalMutationRevisionTuple,
      "expectedDocumentRevision" | "expectedTargetRevision"
    >,
  ): void {
    const room = this.room(documentName, document);
    room.adapter.ensureAuthority(document);
    if (room.pendingChangeSet || room.pendingOrigins?.length) {
      throw new CollaborationConflictError(
        "document_revision_changed",
        "resident_room_has_uncommitted_changes",
      );
    }
    if (room.baseline.revision !== revisions.expectedDocumentRevision) {
      throw new CollaborationConflictError(
        "document_revision_changed",
        "interactive_mutation_document_revision_changed",
      );
    }
    if (room.baseline.target !== revisions.expectedTargetRevision) {
      throw new CollaborationConflictError(
        "target_revision_changed",
        "interactive_mutation_target_revision_changed",
      );
    }
  }

  acceptExternalMutation(
    documentName: string,
    document: Y.Doc,
    revisions: ResidentExternalMutationRevisionTuple,
  ): void {
    this.assertExternalMutationReady(documentName, document, revisions);
    const room = this.room(documentName, document);
    const snapshot = room.adapter.decodeFull(document);
    room.baseline = BlockMutationBaseline.fromSnapshot(
      snapshot,
      revisions.acceptedDocumentRevision,
      revisions.acceptedTargetRevision,
    );
    room.localeExists =
      room.locale === room.sourceLocale ||
      revisions.acceptedTargetRevision !== undefined;
  }

  async persist(
    documentName: string,
    document: Y.Doc,
    contributorMemberIds: readonly string[],
  ): Promise<ResidentBlockPersistResult> {
    const room = this.room(documentName, document);
    room.adapter.ensureAuthority(document);
    const pendingBatch = room.baseline.pendingBatch;
    if (pendingBatch) {
      const ack = await saveBatch(room, pendingBatch);
      acknowledgeSave(room, ack);
      return persistResult(room, pendingBatch.contributorMemberIds);
    }
    const changeSet = room.pendingChangeSet;
    if (!changeSet) {
      return persistResult(room, contributorMemberIds);
    }
    const mutationContributorMemberIds = requireSaveContributorMemberIds({
      contributorMemberIds: [...contributorMemberIds],
    });
    room.pendingChangeSet = undefined;
    room.pendingOrigins = undefined;
    const batch = changeSet.requiresFullDecode
      ? room.baseline.prepareFull(
          room.adapter.decodeFull(document),
          mutationContributorMemberIds,
          changeSet.affectedLocaleValueTargets,
        )
      : room.baseline.prepareAffected(
          room.adapter.decodeAffected(document, changeSet),
          mutationContributorMemberIds,
        );
    if (
      batch.baseMutations.length === 0 &&
      batch.localeMutations.length === 0
    ) {
      return persistResult(room, batch.contributorMemberIds);
    }
    const ack = await saveBatch(room, batch);
    acknowledgeSave(room, ack);
    return persistResult(room, batch.contributorMemberIds);
  }

  async checkpoint(
    documentName: string,
    document: Y.Doc,
    contributorMemberIds: readonly string[],
  ): Promise<ResidentBlockPersistResult> {
    const persisted = await this.persist(
      documentName,
      document,
      contributorMemberIds,
    );
    const room = this.room(documentName, document);
    if (room.locale !== room.sourceLocale) return persisted;
    if (room.adapter.checkpoint) {
      await room.adapter.checkpoint({
        expectedDocumentRevision: persisted.documentRevision,
        contributorMemberIds: persisted.contributorMemberIds,
      });
    }
    return persisted;
  }

  async checkpointAcknowledged(
    documentName: string,
    document: Y.Doc,
    contributorMemberIds: readonly string[],
  ): Promise<ResidentBlockPersistResult> {
    const room = this.room(documentName, document);
    room.adapter.ensureAuthority(document);
    const contributors = [...new Set(contributorMemberIds)].sort();
    if (room.locale !== room.sourceLocale) {
      return {
        documentRevision: room.baseline.revision,
        ...(room.baseline.target === undefined
          ? {}
          : { targetRevision: room.baseline.target }),
        sourceLocale: room.sourceLocale,
        locale: room.locale,
        localeExists: room.localeExists,
        blockCatalogFingerprint: room.blockCatalogFingerprint,
        contributorMemberIds: contributors,
      };
    }
    if (room.adapter.checkpoint) {
      await room.adapter.checkpoint({
        expectedDocumentRevision: room.baseline.revision,
        contributorMemberIds: contributors,
      });
    }
    return {
      documentRevision: room.baseline.revision,
      sourceLocale: room.sourceLocale,
      locale: room.locale,
      localeExists: room.localeExists,
      blockCatalogFingerprint: room.blockCatalogFingerprint,
      contributorMemberIds: contributors,
    };
  }

  unregister(documentName: string, document: Y.Doc): void {
    if (this.documents.get(documentName) === document) {
      this.documents.delete(documentName);
    }
    const room = this.rooms.get(document);
    room?.stopObserving();
    this.rooms.delete(document);
  }

  unregisterDocument(documentName: string): void {
    const document = this.documents.get(documentName);
    if (document) this.unregister(documentName, document);
  }

  acknowledgeMetadataRevision(
    documentName: string,
    document: Y.Doc,
    expectedDocumentRevision: string,
    documentRevision: string,
    targetRevision?: string,
  ): void {
    const room = this.room(documentName, document);
    if (
      room.locale !== room.sourceLocale &&
      documentRevision !== expectedDocumentRevision
    ) {
      throw new Error("resident_target_document_revision_changed");
    }
    if (room.locale === room.sourceLocale && targetRevision !== undefined) {
      throw new Error("resident_source_target_revision_forbidden");
    }
    room.baseline.advanceDocumentRevision(
      expectedDocumentRevision,
      documentRevision,
    );
    room.baseline.advanceTargetRevision(targetRevision);
    if (room.locale !== room.sourceLocale && !targetRevision) {
      room.localeExists = false;
      throw new CollaborationConflictError(
        "target_revision_changed",
        "target_locale_deleted",
      );
    }
  }

  private room(
    documentName: string,
    document: Y.Doc,
  ): ResidentRoom<TBase, TLocale> {
    const room = this.rooms.get(document);
    if (!room || room.documentName !== documentName) {
      throw new Error(`resident_document_not_loaded:${documentName}`);
    }
    return room;
  }
}
