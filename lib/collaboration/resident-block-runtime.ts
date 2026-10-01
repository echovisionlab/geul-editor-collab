import {
  decodeCanonicalBlockRoomAffectedNodes,
  blockRoomPresentLocaleValues,
  hydrateCanonicalBlockRoom,
  materializeCanonicalBlockRoom,
  observeBlockRoomChanges,
  type BlockRoomChangeSet,
  type BlockRoomDocumentType,
  roomLocale,
  roomSourceLocale,
} from "@echovisionlab/geul-common/collaboration/block-room-codec";
import {
  CollaborativeDocumentType,
  parseDocumentName,
  residentBlockDocumentType,
  type DocumentSaveOptions,
} from "@echovisionlab/geul-common/collaboration/document";
import type { JsonValue } from "@bufbuild/protobuf";
import type { DocumentLayout } from "@echovisionlab/geul-proto/common/common_pb.ts";
import type { CollaborationPrincipal } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import * as Y from "yjs";
import { logger } from "../logger.ts";
import {
  CollaborationConflictError,
  CollaborationMutationRejectionError,
} from "../api/transport.ts";
import type { CanonicalBlockChanges } from "./block-mutation-batch.ts";
import {
  decodeBlockRoomSnapshot,
  type BlockRoomLocaleData,
} from "./block-room-snapshot.ts";
import {
  ResidentBlockPersistence,
  type ResidentBlockCheckpointRequest,
  type ResidentBlockPersistResult,
} from "./resident-block-persistence.ts";
import {
  type ResidentBlockMetadataAck,
  type ResidentBlockMetadataUpdate,
} from "./resident-block-metadata.ts";
import {
  createResidentBlockGateways,
  type ResidentBlockDomainGateway,
} from "./resident-block-gateways.ts";
import { ResidentBlockMetadataState } from "./resident-block-metadata-state.ts";
import { persistResidentBlockWithAcknowledgment } from "./resident-block-durability.ts";
import {
  assertMetadataScopeAllowed,
  assertResponseLocale,
  invokeMetadataUpdate,
} from "./resident-block-runtime-metadata.ts";
import {
  captureResidentBlockRootAuthority,
  RESIDENT_BLOCK_ROOT_AUTHORITY_REPAIR_ORIGIN,
  restoreResidentBlockRootAuthority,
} from "./resident-block-authority.ts";
import {
  applyAcceptedResidentInteractiveMutation,
  type ResidentInteractiveMutationInput,
} from "./resident-interactive-mutation.ts";

import type { ResidentBlockBootstrapSnapshot } from "./resident-block-load.ts";

export type { ResidentBlockBootstrapSnapshot } from "./resident-block-load.ts";

export type { ResidentBlockMetadataUpdate };

export type { ResidentBlockDomainGateway };

export type { ResidentInteractiveMutationInput };

function decodeAffectedBlockRoomChanges(
  document: Y.Doc,
  documentType: BlockRoomDocumentType,
  changeSet: BlockRoomChangeSet,
  locale: string,
): CanonicalBlockChanges<JsonValue, BlockRoomLocaleData> {
  const affected = decodeCanonicalBlockRoomAffectedNodes(
    document,
    documentType,
    changeSet,
  );
  const localeByBlock = new Map<string, BlockRoomLocaleData>();
  for (const node of affected.localeNodes) {
    localeByBlock.set(node.id, { kind: node.kind, payload: node.payload });
  }
  return {
    locale,
    blocks: affected.baseNodes.map((node) => ({
      blockId: node.id,
      parentBlockId: node.parentId,
      containerSlot: node.containerSlot,
      position: node.position,
      kind: node.kind,
      baseData: node.payload,
      ...(localeByBlock.has(node.id)
        ? { localeData: localeByBlock.get(node.id) }
        : {}),
      adapterData: {
        family: node.family,
        ...(node.pageSectionId ? { sectionId: node.pageSectionId } : {}),
        ...(node.columnId ? { columnId: node.columnId } : {}),
      },
    })),
    affectedBaseBlockIds: changeSet.affectedBaseBlockIds,
    deletedBaseBlockIds: affected.deletedBaseBlockIds,
    affectedLocaleBlockIds: changeSet.affectedLocaleBlockIds,
    affectedLocaleValueTargets: affected.localeValueTargets,
    deletedLocaleBlockIds: affected.deletedLocaleBlockIds,
  };
}

function residentBlockAuthorityEnsurer(
  documentType: BlockRoomDocumentType,
  entityId: string,
  locale: string,
  authority: ReturnType<typeof captureResidentBlockRootAuthority>,
): (room: Y.Doc) => void {
  return (room) => {
    const restoredFields = restoreResidentBlockRootAuthority(room, authority);
    if (restoredFields.length === 0) return;
    logger.warn("Repaired client-authored collaboration room authority", {
      document_type: documentType,
      entity_id: entityId,
      locale,
      restored_fields: restoredFields.join(","),
    });
  };
}

function requireResidentDocumentType(
  type: Parameters<typeof residentBlockDocumentType>[0],
  documentName: string,
): BlockRoomDocumentType {
  const documentType = residentBlockDocumentType(type);
  if (!documentType)
    throw new Error(`resident_block_type_required:${documentName}`);
  return documentType;
}

export { residentBlockDocumentType } from "@echovisionlab/geul-common/collaboration/document";

export class ResidentBlockRuntime {
  readonly persistence = new ResidentBlockPersistence<
    JsonValue,
    BlockRoomLocaleData
  >();
  private readonly metadataState = new ResidentBlockMetadataState();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly acceptedInteractiveOrigins = new WeakSet<object>();
  private readonly domainGateways: Record<
    BlockRoomDocumentType,
    ResidentBlockDomainGateway
  >;

  constructor(
    domainGateways: Partial<
      Record<BlockRoomDocumentType, ResidentBlockDomainGateway>
    > = {},
  ) {
    this.domainGateways = createResidentBlockGateways(domainGateways);
  }

  async load(
    documentName: string,
    document: Y.Doc,
    principal: CollaborationPrincipal,
  ): Promise<void> {
    const parsed = parseDocumentName(documentName);
    const documentType = requireResidentDocumentType(parsed.type, documentName);
    const gateway = this.domainGateways[documentType];
    const loaded = await gateway.load(
      parsed.entityId,
      parsed.locale,
      principal,
    );
    if (
      loaded.locale !== parsed.locale ||
      loaded.document.locale !== parsed.locale
    ) {
      throw new Error("resident_room_locale_mismatch");
    }
    this.metadataState.load(documentName, loaded);
    hydrateCanonicalBlockRoom(
      document,
      documentType,
      loaded.sourceLocale,
      loaded.document,
      loaded.presentLocaleValues,
    );
    if (
      roomSourceLocale(document) !== loaded.sourceLocale ||
      roomLocale(document) !== parsed.locale
    ) {
      throw new Error("resident_room_authority_mismatch");
    }
    const rootAuthority = captureResidentBlockRootAuthority(document);
    const stopObserving = observeBlockRoomChanges(
      document,
      ({ changeSet, origin, originKind }) => {
        if (origin === RESIDENT_BLOCK_ROOT_AUTHORITY_REPAIR_ORIGIN) return;
        if (
          typeof origin === "object" &&
          origin !== null &&
          this.acceptedInteractiveOrigins.has(origin)
        ) {
          return;
        }
        this.persistence.recordChange(documentName, document, changeSet, {
          origin,
          originKind,
        });
      },
    );
    this.persistence.register(
      documentName,
      document,
      {
        documentRevision: loaded.documentRevision,
        ...(loaded.targetRevision === undefined
          ? {}
          : { targetRevision: loaded.targetRevision }),
        sourceLocale: loaded.sourceLocale,
        locale: loaded.locale,
        localeExists: loaded.localeExists,
        snapshot: decodeBlockRoomSnapshot(
          document,
          documentType,
          loaded.sourceLocale,
        ),
      },
      {
        ensureAuthority: residentBlockAuthorityEnsurer(
          documentType,
          parsed.entityId,
          parsed.locale,
          rootAuthority,
        ),
        decodeFull: (room) =>
          decodeBlockRoomSnapshot(room, documentType, loaded.sourceLocale),
        decodeAffected: (room, changeSet) =>
          decodeAffectedBlockRoomChanges(
            room,
            documentType,
            changeSet,
            loaded.locale,
          ),
        save: (batch) => gateway.save(parsed.entityId, parsed.locale, batch),
        ...(gateway.checkpoint
          ? {
              checkpoint: (request: ResidentBlockCheckpointRequest) =>
                gateway.checkpoint!(parsed.entityId, parsed.locale, request),
            }
          : {}),
      },
      () => stopObserving(),
    );
  }

  applyAcceptedInteractiveMutation(
    documentName: string,
    document: Y.Doc,
    input: ResidentInteractiveMutationInput,
  ): Promise<void> {
    return this.enqueue(documentName, () =>
      Promise.resolve(
        applyAcceptedResidentInteractiveMutation(
          this.persistence,
          this.acceptedInteractiveOrigins,
          documentName,
          document,
          input,
        ),
      ),
    );
  }

  persist(
    documentName: string,
    document: Y.Doc,
    contributorMemberIds: readonly string[],
  ): Promise<ResidentBlockPersistResult> {
    return this.enqueue(documentName, () =>
      persistResidentBlockWithAcknowledgment(documentName, document, () =>
        this.persistence.persist(documentName, document, contributorMemberIds),
      ),
    );
  }

  checkpoint(
    documentName: string,
    document: Y.Doc,
    contributorMemberIds: readonly string[],
  ): Promise<ResidentBlockPersistResult> {
    return this.enqueue(documentName, () =>
      persistResidentBlockWithAcknowledgment(documentName, document, () =>
        this.persistence.checkpoint(
          documentName,
          document,
          contributorMemberIds,
        ),
      ),
    );
  }

  updatePageDocumentLayout(
    documentName: string,
    document: Y.Doc,
    documentLayout: DocumentLayout,
    contributorMemberIds: readonly string[],
    observedLayout: DocumentLayout,
  ): Promise<ResidentBlockMetadataAck> {
    return this.enqueue(documentName, async () => {
      const parsed = parseDocumentName(documentName);
      if (parsed.type !== CollaborativeDocumentType.PAGE) {
        throw new Error(`resident_page_type_required:${documentName}`);
      }
      const gateway = this.domainGateways.page;
      if (!gateway.updatePageDocumentLayout) {
        throw new Error("resident_page_metadata_gateway_required");
      }
      const metadata = this.persistence.snapshot(documentName);
      if (!metadata)
        throw new Error(`resident_document_not_loaded:${documentName}`);
      if (metadata.locale !== metadata.sourceLocale) {
        throw new CollaborationMutationRejectionError(
          "non_source_document_metadata_forbidden",
        );
      }
      const contributors = [...new Set(contributorMemberIds)].sort();
      const canonicalLayout = this.metadataState.mergePageLayout(
        documentName,
        documentLayout,
        observedLayout,
      );
      const response = await gateway.updatePageDocumentLayout(
        parsed.entityId,
        parsed.locale,
        {
          expectedDocumentRevision: metadata.documentRevision,
          documentLayout: canonicalLayout,
          contributorMemberIds: contributors,
        },
      );
      if (response.locale !== parsed.locale) {
        throw new CollaborationConflictError(
          "document_revision_changed",
          "collaboration_response_locale_mismatch",
        );
      }
      this.persistence.acknowledgeMetadataRevision(
        documentName,
        document,
        metadata.documentRevision,
        response.documentRevision,
      );
      return {
        ...response,
        locale: metadata.locale,
        changedLocales: [],
        metadataUpdate: this.metadataState.acknowledgePageLayout(
          documentName,
          canonicalLayout,
        ),
      };
    });
  }

  updateMetadata(
    documentName: string,
    document: Y.Doc,
    update: ResidentBlockMetadataUpdate,
    contributorMemberIds: readonly string[],
  ): Promise<ResidentBlockMetadataAck> {
    return this.enqueue(documentName, async () => {
      const parsed = parseDocumentName(documentName);
      const documentType = residentBlockDocumentType(parsed.type);
      if (!documentType || documentType !== update.type) {
        throw new Error(
          `resident_metadata_type_required:${documentName}:${update.type}`,
        );
      }
      const gateway = this.domainGateways[documentType];
      if (!gateway.updateMetadata) {
        throw new Error(`resident_metadata_gateway_required:${documentType}`);
      }
      const metadata = this.persistence.snapshot(documentName);
      if (!metadata)
        throw new Error(`resident_document_not_loaded:${documentName}`);
      assertMetadataScopeAllowed(metadata, update);
      const contributors = [...new Set(contributorMemberIds)].sort();
      const canonicalUpdate = this.metadataState.mergeUpdate(
        documentName,
        update,
      );
      const response = await invokeMetadataUpdate(
        gateway.updateMetadata,
        parsed.entityId,
        parsed.locale,
        canonicalUpdate,
        metadata,
        contributors,
      );
      assertResponseLocale(response.locale, parsed.locale);
      this.persistence.acknowledgeMetadataRevision(
        documentName,
        document,
        metadata.documentRevision,
        response.documentRevision,
        response.targetRevision,
      );
      const metadataUpdate = this.metadataState.acknowledge(
        documentName,
        canonicalUpdate,
        metadata.sourceLocale,
        parsed.locale,
      );
      return { ...response, metadataUpdate };
    });
  }

  persistEditSession(
    documentName: string,
    document: Y.Doc,
    options: DocumentSaveOptions,
  ): Promise<ResidentBlockPersistResult> {
    return this.enqueue(documentName, () =>
      this.persistEditSessionNow(documentName, document, options),
    );
  }

  withPersistenceQueue<T>(
    queueKey: string,
    operation: (
      persist: (
        documentName: string,
        document: Y.Doc,
        options: DocumentSaveOptions,
      ) => Promise<ResidentBlockPersistResult>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(queueKey, () =>
      operation((documentName, document, options) =>
        this.persistEditSessionNow(documentName, document, options),
      ),
    );
  }

  bootstrap(
    documentName: string,
    document: Y.Doc,
  ): ResidentBlockBootstrapSnapshot {
    const parsed = parseDocumentName(documentName);
    const documentType = residentBlockDocumentType(parsed.type);
    if (!documentType)
      throw new Error(`resident_block_type_required:${documentName}`);
    const metadata = this.persistence.snapshot(documentName);
    if (!metadata)
      throw new Error(`resident_document_not_loaded:${documentName}`);
    return {
      documentName,
      documentType,
      locale: parsed.locale,
      sourceLocale: metadata.sourceLocale,
      localeExists: metadata.localeExists,
      ...(metadata.targetRevision === undefined
        ? {}
        : { targetRevision: metadata.targetRevision }),
      document: materializeCanonicalBlockRoom(document, documentType),
      documentRevision: metadata.documentRevision,
      presentLocaleValues: blockRoomPresentLocaleValues(document),
      blockCatalogFingerprint: metadata.blockCatalogFingerprint,
      ...this.metadataState.bootstrap(documentName),
    };
  }

  unload(documentName: string): void {
    this.metadataState.clear(documentName);
    this.persistence.unregisterDocument(documentName);
  }

  private persistEditSessionNow(
    documentName: string,
    document: Y.Doc,
    options: DocumentSaveOptions,
  ): Promise<ResidentBlockPersistResult> {
    const contributorMemberIds = options.contributorMemberIds ?? [];
    // A version checkpoint captures only an already acknowledged revision.
    // It must not acknowledge any newer room body that has not reached storage.
    if (options.versionCheckpoint)
      return this.persistence.checkpointAcknowledged(
        documentName,
        document,
        contributorMemberIds,
      );
    return persistResidentBlockWithAcknowledgment(documentName, document, () =>
      this.persistence.persist(documentName, document, contributorMemberIds),
    );
  }

  private enqueue<T>(
    queueKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(queueKey);
    const ready = previous
      ? previous.then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    const queued = ready.then(operation);
    this.queues.set(queueKey, queued);
    const cleanup = () => {
      if (this.queues.get(queueKey) === queued) this.queues.delete(queueKey);
    };
    queued.then(cleanup, cleanup);
    return queued;
  }
}
