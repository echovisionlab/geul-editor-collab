import type { ResidentBlockMetadataUpdate } from "./resident-block-metadata.ts";
import type { ResidentBlockPersistResult } from "./resident-block-persistence.ts";
import type { ResidentBlockDomainGateway } from "./resident-block-gateways.ts";
import type { ResidentBlockMetadataAck } from "./resident-block-metadata.ts";
import {
  CollaborationConflictError,
  CollaborationMutationRejectionError,
} from "../api/transport.ts";

export function assertMetadataScopeAllowed(
  metadata: Pick<
    ResidentBlockPersistResult,
    "locale" | "sourceLocale" | "localeExists"
  >,
  update: ResidentBlockMetadataUpdate,
): void {
  if (metadata.locale !== metadata.sourceLocale && !metadata.localeExists) {
    throw new CollaborationConflictError(
      "target_revision_changed",
      "target_locale_missing",
    );
  }
  if (
    metadata.locale !== metadata.sourceLocale &&
    "scope" in update &&
    update.scope === "document"
  ) {
    throw new CollaborationMutationRejectionError(
      "non_source_document_metadata_forbidden",
    );
  }
}

export async function invokeMetadataUpdate(
  updateMetadata: NonNullable<ResidentBlockDomainGateway["updateMetadata"]>,
  entityId: string,
  locale: string,
  update: ResidentBlockMetadataUpdate,
  metadata: Pick<
    ResidentBlockPersistResult,
    "documentRevision" | "targetRevision"
  >,
  contributors: string[],
): Promise<ResidentBlockMetadataAck> {
  return await updateMetadata(
    entityId,
    locale,
    update,
    metadata.documentRevision,
    metadata.targetRevision,
    contributors,
  );
}

export function assertResponseLocale(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new CollaborationConflictError(
      "document_revision_changed",
      "collaboration_response_locale_mismatch",
    );
  }
}
