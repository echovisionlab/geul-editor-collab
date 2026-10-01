import type {
  BlockRoomDocumentType,
  BlockRoomTypedDocument,
} from "@echovisionlab/geul-common/collaboration/block-room-codec";
import { create, toJson } from "@bufbuild/protobuf";
import {
  DocumentLayoutSchema,
  type DocumentLayout,
} from "@echovisionlab/geul-proto/common/common_pb.ts";
import type { CollaborationPrincipal } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import {
  applyPageBlockBatch,
  createPageVersionCheckpoint,
  loadPageBlockDocument,
  updatePageDocumentMetadata,
} from "../api/page.ts";
import {
  applyPostBlockBatch,
  createPostVersionCheckpoint,
  loadPostBlockDocument,
} from "../api/post.ts";
import {
  applyResidentRichTextBlockBatch,
  loadResidentRichTextDocument,
  type ResidentRichTextDocumentType,
} from "../api/resident-block-domain.ts";
import {
  applyWorkBlockBatch,
  createWorkVersionCheckpoint,
  loadWorkBlockDocument,
} from "../api/work.ts";
import type {
  BlockMutationAck,
  BlockMutationBatch,
} from "./block-mutation-batch.ts";
import {
  normalizeResidentBlockLoad,
  type ResidentBlockDomainLoad,
} from "./resident-block-load.ts";
import {
  createPageMutationBatch,
  createRichTextMutationBatch,
} from "./block-proto-batch.ts";
import type { BlockRoomLocaleData } from "./block-room-snapshot.ts";
import {
  type ResidentBlockMetadataAck,
  type ResidentBlockMetadataUpdate,
  updateResidentBlockMetadata,
} from "./resident-block-metadata.ts";
import type { ResidentBlockCheckpointRequest } from "./resident-block-persistence.ts";
import { projectSourceMetadata } from "../api/resident-block-load.ts";

type RoomBatch = BlockMutationBatch<unknown, BlockRoomLocaleData>;

export interface ResidentBlockDomainGateway {
  load(
    entityId: string,
    locale: string,
    principal: CollaborationPrincipal,
  ): Promise<ResidentBlockDomainLoad>;
  save(
    entityId: string,
    locale: string,
    batch: RoomBatch,
  ): Promise<BlockMutationAck>;
  checkpoint?(
    entityId: string,
    locale: string,
    request: ResidentBlockCheckpointRequest,
  ): Promise<unknown>;
  updatePageDocumentLayout?(
    entityId: string,
    locale: string,
    request: {
      expectedDocumentRevision: string;
      documentLayout: DocumentLayout;
      contributorMemberIds: string[];
    },
  ): Promise<{
    documentRevision: string;
    changed: boolean;
    sourceChanged: boolean;
    locale: string;
  }>;
  updateMetadata?(
    entityId: string,
    locale: string,
    request: ResidentBlockMetadataUpdate,
    expectedDocumentRevision: string,
    expectedTargetRevision: string | undefined,
    contributorMemberIds: readonly string[],
  ): Promise<ResidentBlockMetadataAck>;
}

function requireDocument(
  document: BlockRoomTypedDocument | undefined,
  documentType: BlockRoomDocumentType,
): BlockRoomTypedDocument {
  if (!document) {
    throw new Error(`block_document_missing:${documentType}`);
  }
  return document;
}

function requireRequestedLocale(actual: string, locale: string): void {
  if (actual !== locale) {
    throw new Error(`block_document_locale_mismatch:${locale}`);
  }
}

function richTextAck(response: {
  documentRevision: string;
  changed: boolean;
  sourceChanged: boolean;
  locale: string;
  targetRevision?: string;
}): BlockMutationAck {
  return {
    documentRevision: response.documentRevision,
    changed: response.changed,
    sourceChanged: response.sourceChanged,
    locale: response.locale,
    ...(response.targetRevision === undefined
      ? {}
      : { targetRevision: response.targetRevision }),
  };
}

function residentRichTextGateway(
  documentType: ResidentRichTextDocumentType,
): ResidentBlockDomainGateway {
  return {
    async load(entityId, locale, principal) {
      const response = await loadResidentRichTextDocument(
        documentType,
        entityId,
        locale,
        principal,
      );
      return {
        ...normalizeResidentBlockLoad({
          document: response.document,
          response,
          requestedLocale: locale,
          sourceMetadata: response.sourceMetadata,
          ...(response.localeMetadata === undefined
            ? {}
            : { localeMetadata: response.localeMetadata }),
          sourceMetadataMissingReason: `block_source_metadata_missing:${documentType}`,
        }),
        documentMetadata: response.documentMetadata,
      };
    },
    async save(entityId, locale, batch) {
      const response = await applyResidentRichTextBlockBatch(
        documentType,
        entityId,
        locale,
        createRichTextMutationBatch(batch),
        batch.expectedTargetRevision,
        batch.affectedLocaleValueTargets,
      );
      requireRequestedLocale(response.locale, locale);
      return richTextAck(response);
    },
    updateMetadata: updateResidentBlockMetadata,
  };
}

function postGateway(): ResidentBlockDomainGateway {
  return {
    async load(entityId, locale, principal) {
      const response = await loadPostBlockDocument(entityId, locale, principal);
      const document = requireDocument(response.document, "post");
      return {
        ...normalizeResidentBlockLoad({
          document,
          response,
          requestedLocale: locale,
          sourceMetadata: projectSourceMetadata(response.sourceMetadata),
          ...(response.localeMetadata === undefined
            ? {}
            : {
                localeMetadata: projectSourceMetadata(response.localeMetadata),
              }),
          sourceMetadataMissingReason: "block_source_metadata_missing:post",
        }),
        documentMetadata: {
          categoryIds: response.categoryIds,
          tagIds: response.tagIds,
        },
      };
    },
    async save(entityId, locale, batch) {
      const response = await applyPostBlockBatch(
        entityId,
        locale,
        createRichTextMutationBatch(batch),
        batch.expectedTargetRevision,
        batch.affectedLocaleValueTargets,
      );
      requireRequestedLocale(response.locale, locale);
      return richTextAck(response);
    },
    async checkpoint(entityId, locale, request) {
      const response = await createPostVersionCheckpoint(
        entityId,
        locale,
        request.expectedDocumentRevision,
        request.contributorMemberIds,
      );
      requireRequestedLocale(response.locale, locale);
      return response;
    },
    updateMetadata: updateResidentBlockMetadata,
  };
}

function pageGateway(): ResidentBlockDomainGateway {
  return {
    async load(entityId, locale, principal) {
      const response = await loadPageBlockDocument(entityId, locale, principal);
      const document = requireDocument(response.document, "page");
      return {
        ...normalizeResidentBlockLoad({
          document,
          response,
          requestedLocale: locale,
          sourceMetadata: projectSourceMetadata(response.sourceMetadata),
          ...(response.localeMetadata === undefined
            ? {}
            : {
                localeMetadata: projectSourceMetadata(response.localeMetadata),
              }),
          sourceMetadataMissingReason: "block_source_metadata_missing:page",
        }),
        documentMetadata: {
          documentLayout: toJson(
            DocumentLayoutSchema,
            response.documentLayout ?? create(DocumentLayoutSchema),
            { alwaysEmitImplicit: true },
          ),
        },
      };
    },
    async save(entityId, locale, batch) {
      const response = await applyPageBlockBatch(
        entityId,
        locale,
        createPageMutationBatch(batch),
        undefined,
        batch.expectedTargetRevision,
        batch.affectedLocaleValueTargets,
      );
      requireRequestedLocale(response.locale, locale);
      return richTextAck(response);
    },
    async checkpoint(entityId, locale, request) {
      const response = await createPageVersionCheckpoint(
        entityId,
        locale,
        request.expectedDocumentRevision,
        request.contributorMemberIds,
      );
      requireRequestedLocale(response.locale, locale);
      return response;
    },
    async updatePageDocumentLayout(entityId, locale, request) {
      const response = await updatePageDocumentMetadata({
        pageId: entityId,
        expectedRevision: request.expectedDocumentRevision,
        documentLayout: request.documentLayout,
        contributorMemberIds: request.contributorMemberIds,
        locale,
      });
      requireRequestedLocale(response.locale, locale);
      return {
        documentRevision: response.documentRevision,
        changed: response.changed,
        sourceChanged: response.sourceChanged,
        locale: response.locale,
      };
    },
    updateMetadata: updateResidentBlockMetadata,
  };
}

function workGateway(): ResidentBlockDomainGateway {
  return {
    async load(entityId, locale, principal) {
      const response = await loadWorkBlockDocument(entityId, locale, principal);
      const document = requireDocument(response.document, "work");
      return normalizeResidentBlockLoad({
        document,
        response,
        requestedLocale: locale,
        sourceMetadata: projectSourceMetadata(response.sourceMetadata),
        ...(response.localeMetadata === undefined
          ? {}
          : { localeMetadata: projectSourceMetadata(response.localeMetadata) }),
        sourceMetadataMissingReason: "block_source_metadata_missing:work",
      });
    },
    async save(entityId, locale, batch) {
      const response = await applyWorkBlockBatch(
        entityId,
        locale,
        createRichTextMutationBatch(batch),
        batch.expectedTargetRevision,
        batch.affectedLocaleValueTargets,
      );
      requireRequestedLocale(response.locale, locale);
      return richTextAck(response);
    },
    async checkpoint(entityId, locale, request) {
      const response = await createWorkVersionCheckpoint(
        entityId,
        locale,
        request.expectedDocumentRevision,
        request.contributorMemberIds,
      );
      requireRequestedLocale(response.locale, locale);
      return response;
    },
    updateMetadata: updateResidentBlockMetadata,
  };
}

const defaultGateways: Record<
  BlockRoomDocumentType,
  ResidentBlockDomainGateway
> = {
  post: postGateway(),
  page: pageGateway(),
  work: workGateway(),
  "program-event": residentRichTextGateway("program-event"),
  artist: residentRichTextGateway("artist"),
  label: residentRichTextGateway("label"),
  release: residentRichTextGateway("release"),
  campaign: residentRichTextGateway("campaign"),
  "email-template": residentRichTextGateway("email-template"),
  "terms-history": residentRichTextGateway("terms-history"),
  "privacy-history": residentRichTextGateway("privacy-history"),
};

export function createResidentBlockGateways(
  overrides: Partial<
    Record<BlockRoomDocumentType, ResidentBlockDomainGateway>
  > = {},
): Record<BlockRoomDocumentType, ResidentBlockDomainGateway> {
  return { ...defaultGateways, ...overrides };
}
