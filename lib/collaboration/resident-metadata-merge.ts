import type { JsonValue } from "@bufbuild/protobuf";

export type DocumentMetadata = Record<string, JsonValue>;

/** Apply the author's changes to the current value, retaining unseen peer edits. */
export function mergeMetadataValue(
  current: JsonValue | undefined,
  observed: JsonValue,
  desired: JsonValue,
): JsonValue {
  if (Array.isArray(observed) && Array.isArray(desired))
    return mergeStringLists(current, observed, desired);
  if (isRecord(observed) && isRecord(desired))
    return mergeRecords(current, observed, desired);
  throw new Error("metadata_observed_collection_required");
}

function isRecord(value: JsonValue | undefined): value is DocumentMetadata {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeStringLists(
  current: JsonValue | undefined,
  observedValues: JsonValue[],
  desiredValues: JsonValue[],
): string[] {
  const observed = requireStringList(
    observedValues,
    "metadata_observed_id_list_required",
  );
  const desired = requireStringList(
    desiredValues,
    "metadata_observed_id_list_required",
  );
  const currentIds = readCurrentStringList(current);
  const original = new Set(observed);
  const desiredIds = new Set(desired);
  const removed = new Set(observed.filter((id) => !desiredIds.has(id)));
  const result = currentIds.filter((id) => !removed.has(id));
  for (const id of desired) {
    if (!original.has(id) && !result.includes(id)) result.push(id);
  }
  return result;
}

function readCurrentStringList(current: JsonValue | undefined): string[] {
  if (current === undefined) return [];
  return requireStringList(current, "metadata_current_id_list_required");
}

function requireStringList(value: JsonValue, error: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    throw new Error(error);
  return value;
}

function mergeRecords(
  current: JsonValue | undefined,
  observed: DocumentMetadata,
  desired: DocumentMetadata,
): DocumentMetadata {
  const result = Object.assign(
    Object.create(null) as DocumentMetadata,
    isRecord(current) ? current : {},
  );
  deleteRemovedKeys(result, observed, desired);
  applyChangedKeys(result, observed, desired);
  return result;
}

function deleteRemovedKeys(
  result: DocumentMetadata,
  observed: DocumentMetadata,
  desired: DocumentMetadata,
): void {
  for (const key of Object.keys(observed)) {
    if (!Object.hasOwn(desired, key)) delete result[key];
  }
}

function applyChangedKeys(
  result: DocumentMetadata,
  observed: DocumentMetadata,
  desired: DocumentMetadata,
): void {
  for (const [key, value] of Object.entries(desired)) {
    if (!Object.hasOwn(observed, key) || observed[key] !== value)
      result[key] = value;
  }
}
