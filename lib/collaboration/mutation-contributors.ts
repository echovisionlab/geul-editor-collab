import type { DocumentSaveOptions } from "@echovisionlab/geul-common/collaboration/document";

export function canonicalContributorMemberIds(
  values: readonly string[] | undefined,
): string[] {
  return [
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ].sort();
}

export function requireSaveContributorMemberIds(
  options: Pick<
    DocumentSaveOptions,
    "contributorMemberIds" | "versionCheckpoint"
  >,
): string[] {
  const contributorMemberIds = canonicalContributorMemberIds(
    options.contributorMemberIds,
  );
  if (contributorMemberIds.length === 0) {
    throw new Error("collaboration_mutation_actor_required");
  }
  if (options.versionCheckpoint !== true && contributorMemberIds.length !== 1) {
    throw new Error("collaboration_mutation_actor_mixed");
  }
  return contributorMemberIds;
}
