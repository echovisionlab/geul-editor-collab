import type { JsonValue } from "@bufbuild/protobuf";
import type {
  BlockRoomDocumentType,
  BlockRoomTypedDocument,
} from "@echovisionlab/geul-common/collaboration/block-room-codec";
import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import type { ResidentSourceMetadataProjection } from "../api/resident-block-domain.ts";

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
  documentMetadata?: Record<string, JsonValue>;
}

export interface ResidentBlockBootstrapSnapshot extends ResidentBlockDomainLoad {
  documentName: string;
  documentType: BlockRoomDocumentType;
  blockCatalogFingerprint: string;
  documentMetadata: Record<string, JsonValue>;
  metadataSequence: number;
}

export interface ResidentBlockLoadResponse {
  documentRevision: string;
  locale: string;
  localeExists: boolean;
  targetRevision?: string;
  presentLocaleValues: readonly AIDocumentFieldTarget[];
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

export function normalizeResidentBlockLoad(input: {
  document: BlockRoomTypedDocument;
  response: ResidentBlockLoadResponse;
  requestedLocale: string;
  sourceMetadata?: ResidentSourceMetadataProjection;
  localeMetadata?: ResidentSourceMetadataProjection;
  sourceMetadataMissingReason: string;
}): ResidentBlockDomainLoad {
  if (input.response.locale !== input.requestedLocale) {
    throw new Error(`block_document_locale_mismatch:${input.requestedLocale}`);
  }
  const sourceMetadata = requireMetadata(
    input.sourceMetadata,
    input.sourceMetadataMissingReason,
  );
  const loaded: ResidentBlockDomainLoad = {
    document: input.document,
    documentRevision: input.response.documentRevision,
    locale: input.response.locale,
    sourceLocale: sourceMetadata.locale,
    localeExists: input.response.localeExists,
    presentLocaleValues: input.response.presentLocaleValues,
    ...(input.response.targetRevision === undefined
      ? {}
      : { targetRevision: input.response.targetRevision }),
    sourceMetadata,
    ...(input.localeMetadata === undefined
      ? {}
      : { localeMetadata: input.localeMetadata }),
  };
  assertLocaleLoadAuthority(loaded);
  return loaded;
}
