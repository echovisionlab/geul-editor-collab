import type {
  BlockRoomDocumentType,
  BlockRoomTypedDocument,
} from "@echovisionlab/geul-common/collaboration/block-room-codec";
import type { DocumentLayout } from "@echovisionlab/geul-proto/common/common_pb.ts";
import type { CollaborationPrincipal } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
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
  type ResidentSourceMetadataProjection,
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

export interface ResidentBlockDomainLoad {
  document: BlockRoomTypedDocument;
  documentRevision: string;
  locale: string;
  sourceLocale: string;
  localeExists: boolean;
  targetRevision?: string;
  presentLocaleValues: readonly AIDocumentFieldTarget[];
  sourceMetadata: ResidentSourceMetadataProjection;
  localeMetadata?: ResidentSourceMetadataProjection;
}

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

function requireMetadata(
  value: ResidentSourceMetadataProjection | undefined,
  reason: string,
): ResidentSourceMetadataProjection {
  if (!value?.locale) throw new Error(reason);
  return value;
}

function sameMetadata(
  left: ResidentSourceMetadataProjection,
  right: ResidentSourceMetadataProjection,
): boolean {
  if (
    left.locale !== right.locale ||
    left.title !== right.title ||
    left.summary !== right.summary ||
    left.subject !== right.subject
  ) {
    return false;
  }
  const leftNotes = left.creditNotes ?? [];
  const rightNotes = right.creditNotes ?? [];
  return (
    leftNotes.length === rightNotes.length &&
    leftNotes.every(
      (note, index) =>
        note.creditId === rightNotes[index]?.creditId &&
        note.note === rightNotes[index]?.note,
    )
  );
}

function assertTargetLocaleAuthority(input: {
  localeExists: boolean;
  targetRevision?: string;
}): void {
  if (input.localeExists !== Boolean(input.targetRevision?.trim())) {
    throw new Error("block_target_revision_presence_mismatch");
  }
}

function assertLocaleLoadAuthority(input: {
  locale: string;
  sourceMetadata: ResidentSourceMetadataProjection;
  localeExists: boolean;
  localeMetadata?: ResidentSourceMetadataProjection;
  targetRevision?: string;
}): void {
  const isSource = input.locale === input.sourceMetadata.locale;
  if (input.localeExists !== (input.localeMetadata !== undefined)) {
    throw new Error("block_locale_metadata_presence_mismatch");
  }
  if (input.localeMetadata && input.localeMetadata.locale !== input.locale) {
    throw new Error("block_locale_metadata_locale_mismatch");
  }
  if (!isSource) {
    assertTargetLocaleAuthority(input);
    return;
  }
  if (!input.localeExists || input.targetRevision !== undefined) {
    throw new Error("block_source_locale_authority_invalid");
  }
  if (
    !sameMetadata(
      requireMetadata(
        input.localeMetadata,
        "block_source_locale_metadata_mismatch",
      ),
      input.sourceMetadata,
    )
  ) {
    throw new Error("block_source_locale_metadata_mismatch");
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
      requireRequestedLocale(response.locale, locale);
      const sourceMetadata = requireMetadata(
        response.sourceMetadata,
        `block_source_metadata_missing:${documentType}`,
      );
      const loaded = {
        document: response.document,
        documentRevision: response.documentRevision,
        locale: response.locale,
        sourceLocale: sourceMetadata.locale,
        localeExists: response.localeExists,
        presentLocaleValues: response.presentLocaleValues,
        ...(response.targetRevision === undefined
          ? {}
          : { targetRevision: response.targetRevision }),
        sourceMetadata,
        ...(response.localeMetadata === undefined
          ? {}
          : { localeMetadata: response.localeMetadata }),
      };
      assertLocaleLoadAuthority(loaded);
      return loaded;
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
      requireRequestedLocale(response.locale, locale);
      const sourceMetadata = requireMetadata(
        projectSourceMetadata(response.sourceMetadata),
        "block_source_metadata_missing:post",
      );
      const loaded = {
        document,
        documentRevision: response.documentRevision,
        locale: response.locale,
        sourceLocale: sourceMetadata.locale,
        localeExists: response.localeExists,
        presentLocaleValues: response.presentLocaleValues,
        ...(response.targetRevision === undefined
          ? {}
          : { targetRevision: response.targetRevision }),
        sourceMetadata,
        ...(response.localeMetadata === undefined
          ? {}
          : { localeMetadata: projectSourceMetadata(response.localeMetadata) }),
      };
      assertLocaleLoadAuthority(loaded);
      return loaded;
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
      requireRequestedLocale(response.locale, locale);
      const sourceMetadata = requireMetadata(
        projectSourceMetadata(response.sourceMetadata),
        "block_source_metadata_missing:page",
      );
      const loaded = {
        document,
        documentRevision: response.documentRevision,
        locale: response.locale,
        sourceLocale: sourceMetadata.locale,
        localeExists: response.localeExists,
        presentLocaleValues: response.presentLocaleValues,
        ...(response.targetRevision === undefined
          ? {}
          : { targetRevision: response.targetRevision }),
        sourceMetadata,
        ...(response.localeMetadata === undefined
          ? {}
          : { localeMetadata: projectSourceMetadata(response.localeMetadata) }),
      };
      assertLocaleLoadAuthority(loaded);
      return loaded;
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
      requireRequestedLocale(response.locale, locale);
      const sourceMetadata = requireMetadata(
        projectSourceMetadata(response.sourceMetadata),
        "block_source_metadata_missing:work",
      );
      const loaded = {
        document,
        documentRevision: response.documentRevision,
        locale: response.locale,
        sourceLocale: sourceMetadata.locale,
        localeExists: response.localeExists,
        presentLocaleValues: response.presentLocaleValues,
        ...(response.targetRevision === undefined
          ? {}
          : { targetRevision: response.targetRevision }),
        sourceMetadata,
        ...(response.localeMetadata === undefined
          ? {}
          : { localeMetadata: projectSourceMetadata(response.localeMetadata) }),
      };
      assertLocaleLoadAuthority(loaded);
      return loaded;
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
