import type { ResidentSourceMetadataProjection } from "../api/resident-block-domain.ts";
import type { ResidentBlockMetadataUpdate } from "./resident-block-metadata.ts";

export function applyResidentSourceMetadataUpdate(
  current: ResidentSourceMetadataProjection | undefined,
  update: ResidentBlockMetadataUpdate,
): ResidentSourceMetadataProjection | undefined {
  if (("scope" in update && update.scope === "document") || !current) {
    return current;
  }

  return {
    ...current,
    ...titleUpdate(update),
    ...summaryUpdate(update),
    ...subjectUpdate(update),
    ...creditNotesUpdate(update),
  };
}

function titleUpdate(update: ResidentBlockMetadataUpdate) {
  if (!("title" in update) || update.title === undefined) return {};
  return { title: update.title ?? undefined };
}

function summaryUpdate(update: ResidentBlockMetadataUpdate) {
  if (!("summary" in update) || update.summary === undefined) return {};
  return { summary: update.summary ?? undefined };
}

function subjectUpdate(update: ResidentBlockMetadataUpdate) {
  if (!("subject" in update) || update.subject === undefined) return {};
  return { subject: update.subject };
}

function creditNotesUpdate(update: ResidentBlockMetadataUpdate) {
  if (!("creditNotes" in update) || update.creditNotes === undefined) return {};
  return { creditNotes: [...update.creditNotes] };
}
