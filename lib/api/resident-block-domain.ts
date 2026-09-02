import type { BlockRoomDocumentType } from "@echovisionlab/geul-common/collaboration/block-room-codec";
import type { CollaborationPrincipal } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import type {
  RichTextBlockMutationBatch,
  LocalizedRichTextDocument,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { applyResidentBlockBatch } from "./resident-block-batch.ts";
import { loadResidentBlockDocument } from "./resident-block-load.ts";
import { updateResidentBlockMetadata } from "./resident-block-metadata.ts";

export type ResidentRichTextDocumentType = Exclude<
  BlockRoomDocumentType,
  "post" | "page" | "work"
>;

export interface ResidentSourceMetadataProjection {
  locale: string;
  title?: string;
  summary?: string;
  subject?: string;
  creditNotes?: readonly { creditId: string; note: string }[];
}

export interface ResidentRichTextDocumentLoad {
  document: LocalizedRichTextDocument;
  documentRevision: string;
  locale: string;
  localeExists: boolean;
  targetRevision?: string;
  presentLocaleValues: readonly AIDocumentFieldTarget[];
  sourceMetadata: ResidentSourceMetadataProjection;
  localeMetadata?: ResidentSourceMetadataProjection;
}

export interface ResidentRichTextDocumentAck {
  documentRevision: string;
  changed: boolean;
  sourceChanged: boolean;
  locale: string;
  targetRevision?: string;
}

export type ResidentRichTextMetadataUpdate =
  | { type: "artist"; title?: string }
  | { type: "label"; title?: string }
  | {
      type: "release";
      title?: string;
      creditNotes?: readonly { creditId: string; note: string }[];
    }
  | {
      type: "program-event";
      title?: string;
      summary?: string | null;
    }
  | { type: "campaign"; subject?: string }
  | { type: "email-template"; subject?: string }
  | { type: "privacy-history"; title?: string }
  | { type: "terms-history"; title?: string };

export interface ResidentRichTextMetadataAck extends ResidentRichTextDocumentAck {
  changedLocales: string[];
}

export async function loadResidentRichTextDocument(
  type: ResidentRichTextDocumentType,
  entityId: string,
  locale: string,
  principal: CollaborationPrincipal,
): Promise<ResidentRichTextDocumentLoad> {
  return loadResidentBlockDocument(type, entityId, locale, principal);
}

export async function applyResidentRichTextBlockBatch(
  type: ResidentRichTextDocumentType,
  entityId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
): Promise<ResidentRichTextDocumentAck> {
  return applyResidentBlockBatch(
    type,
    entityId,
    locale,
    batch,
    expectedTargetRevision,
    affectedLocaleValues,
  );
}

export async function updateResidentRichTextMetadata(
  entityId: string,
  locale: string,
  input: ResidentRichTextMetadataUpdate,
  expectedRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
): Promise<ResidentRichTextMetadataAck> {
  return updateResidentBlockMetadata(
    entityId,
    locale,
    input,
    expectedRevision,
    expectedTargetRevision,
    contributorMemberIds,
  );
}
