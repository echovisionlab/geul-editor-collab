import type { JsonValue } from "@bufbuild/protobuf";
import type { BlockRoomDocumentType } from "@echovisionlab/geul-common/collaboration/block-room-codec";
import type { ResidentBlockMetadataUpdate } from "./resident-block-runtime.ts";

type JsonRecord = Record<string, JsonValue>;

export interface MetadataUpdateRequest {
  update: ResidentBlockMetadataUpdate;
}

function objectRecord(value: JsonValue | undefined): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request_body_invalid");
  }
  return value as JsonRecord;
}

function assertAllowedKeys(record: JsonRecord, keys: readonly string[]): void {
  if (Object.keys(record).some((key) => !keys.includes(key))) {
    throw new Error("request_body_invalid");
  }
}

function optionalString(
  record: JsonRecord,
  key: string,
  nullable: true,
): string | null | undefined;
function optionalString(
  record: JsonRecord,
  key: string,
  nullable?: false,
): string | undefined;
function optionalString(
  record: JsonRecord,
  key: string,
  nullable = false,
): string | null | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  if (nullable && value === null) return null;
  if (typeof value !== "string") throw new Error("request_body_invalid");
  return value;
}

function stringList(value: JsonValue): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error("request_body_invalid");
  }
  return value as string[];
}

function optionalStringList(
  record: JsonRecord,
  key: string,
): string[] | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  return stringList(record[key]);
}

function optionalStringMap(
  record: JsonRecord,
  key: string,
): Record<string, string> | undefined {
  if (!Object.hasOwn(record, key)) return undefined;
  const value = record[key];
  const nested = objectRecord(value);
  if (Object.values(nested).some((item) => typeof item !== "string")) {
    throw new Error("request_body_invalid");
  }
  return nested as Record<string, string>;
}

const domainKeys: Record<BlockRoomDocumentType, readonly string[]> = {
  post: ["title", "summary"],
  page: ["title", "summary"],
  work: ["sourceTitle", "summary"],
  "program-event": ["title", "summary"],
  artist: ["title"],
  label: ["title"],
  release: ["title", "creditNotes"],
  campaign: ["subject"],
  "email-template": ["subject"],
  "terms-history": ["title"],
  "privacy-history": ["title"],
};

function parseCreditNote(value: JsonValue): {
  creditId: string;
  note: string;
} {
  const record = objectRecord(value);
  assertAllowedKeys(record, ["creditId", "note"]);
  if (typeof record.creditId !== "string" || typeof record.note !== "string") {
    throw new Error("request_body_invalid");
  }
  return { creditId: record.creditId, note: record.note };
}

function parseCreditNotes(
  value: JsonValue | undefined,
): { creditId: string; note: string }[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("request_body_invalid");
  return value.map(parseCreditNote);
}

export function parsePostDocumentMetadataRequest(
  value: JsonValue,
): MetadataUpdateRequest {
  const record = { ...objectRecord(value) };
  const observed = parseObservedMetadata(record.observed, [
    "categoryIds",
    "tagIds",
  ]);
  delete record.observed;
  assertAllowedKeys(record, ["categoryIds", "tagIds"]);
  const categoryIds = optionalStringList(record, "categoryIds");
  const tagIds = optionalStringList(record, "tagIds");
  if (categoryIds === undefined && tagIds === undefined) {
    throw new Error("request_body_invalid");
  }
  requireObservedCollections(record, observed, ["categoryIds", "tagIds"]);
  return {
    update: {
      type: "post",
      scope: "document",
      observed,
      categoryIds,
      tagIds,
    },
  };
}

function parseObservedMetadata(
  value: JsonValue | undefined,
  keys: readonly string[],
): JsonRecord | undefined {
  if (value === undefined) return undefined;
  const record = objectRecord(value);
  assertAllowedKeys(record, keys);
  for (const [key, field] of Object.entries(record)) {
    if (field === undefined) throw new Error("request_body_invalid");
    if (key === "socialLinks") {
      optionalStringMap({ socialLinks: field }, "socialLinks");
      continue;
    }
    stringList(field);
  }
  return record;
}

function parseResidentDocumentKeys(
  type: "artist" | "label",
  record: JsonRecord,
): void {
  const keys =
    type === "artist"
      ? [
          "realName",
          "countryCode",
          "website",
          "socialLinks",
          "slug",
          "labelIds",
          "parentArtistId",
        ]
      : ["slug", "countryCode", "website", "socialLinks", "parentLabelId"];
  assertAllowedKeys(record, keys);
  if (Object.keys(record).length === 0) throw new Error("request_body_invalid");
}

function parseArtistDocumentFields(
  record: JsonRecord,
): Extract<ResidentBlockMetadataUpdate, { type: "artist" }> {
  return {
    type: "artist",
    scope: "document",
    realName: optionalString(record, "realName", true),
    countryCode: optionalString(record, "countryCode", true),
    website: optionalString(record, "website", true),
    socialLinks: optionalStringMap(record, "socialLinks"),
    slug: optionalString(record, "slug", true),
    labelIds: optionalStringList(record, "labelIds"),
    parentArtistId: optionalString(record, "parentArtistId", true),
  };
}

function parseLabelDocumentFields(
  record: JsonRecord,
): Extract<ResidentBlockMetadataUpdate, { type: "label" }> {
  return {
    type: "label",
    scope: "document",
    countryCode: optionalString(record, "countryCode", true),
    website: optionalString(record, "website", true),
    socialLinks: optionalStringMap(record, "socialLinks"),
    slug: optionalString(record, "slug", true),
    parentLabelId: optionalString(record, "parentLabelId", true),
  };
}

export function parseResidentDocumentMetadataRequest(
  type: "artist" | "label",
  value: JsonValue,
): MetadataUpdateRequest {
  const record = { ...objectRecord(value) };
  const observedKeys =
    type === "artist" ? ["socialLinks", "labelIds"] : ["socialLinks"];
  const observed = parseObservedMetadata(record.observed, observedKeys);
  delete record.observed;
  parseResidentDocumentKeys(type, record);
  requireObservedCollections(record, observed, observedKeys);
  return {
    update: {
      ...(type === "artist"
        ? parseArtistDocumentFields(record)
        : parseLabelDocumentFields(record)),
      observed,
    },
  };
}

function requireObservedCollections(
  desired: JsonRecord,
  observed: JsonRecord | undefined,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const desiredPresent = Object.hasOwn(desired, key);
    const observedPresent =
      observed !== undefined && Object.hasOwn(observed, key);
    if (desiredPresent !== observedPresent) {
      throw new Error("request_body_invalid");
    }
  }
}

function parseSourceMetadataRecord(
  type: BlockRoomDocumentType,
  value: JsonValue,
): JsonRecord {
  const record = objectRecord(value);
  assertAllowedKeys(record, domainKeys[type]);
  return record;
}

type SourceMetadataFactory = (record: JsonRecord) => MetadataUpdateRequest;

function releaseMetadataFields(
  record: JsonRecord,
): Extract<ResidentBlockMetadataUpdate, { type: "release" }> {
  return {
    type: "release",
    title: optionalString(record, "title"),
    creditNotes: parseCreditNotes(record.creditNotes),
  };
}

const sourceMetadataFactories: Record<
  Exclude<BlockRoomDocumentType, "release">,
  SourceMetadataFactory
> = {
  post: (record) => ({
    update: {
      type: "post",
      scope: "locale",
      title: optionalString(record, "title", true),
      summary: optionalString(record, "summary", true),
    },
  }),
  page: (record) => ({
    update: {
      type: "page",
      title: optionalString(record, "title"),
      summary: optionalString(record, "summary", true),
    },
  }),
  work: (record) => ({
    update: {
      type: "work",
      sourceTitle: optionalString(record, "sourceTitle"),
      summary: optionalString(record, "summary", true),
    },
  }),
  "program-event": (record) => ({
    update: {
      type: "program-event",
      title: optionalString(record, "title"),
      summary: optionalString(record, "summary", true),
    },
  }),
  artist: (record) => ({
    update: { type: "artist", title: optionalString(record, "title") },
  }),
  label: (record) => ({
    update: { type: "label", title: optionalString(record, "title") },
  }),
  campaign: (record) => ({
    update: { type: "campaign", subject: optionalString(record, "subject") },
  }),
  "email-template": (record) => ({
    update: {
      type: "email-template",
      subject: optionalString(record, "subject"),
    },
  }),
  "terms-history": (record) => ({
    update: {
      type: "terms-history",
      title: optionalString(record, "title"),
    },
  }),
  "privacy-history": (record) => ({
    update: {
      type: "privacy-history",
      title: optionalString(record, "title"),
    },
  }),
};

function parseReleaseMetadataRequest(
  record: JsonRecord,
): MetadataUpdateRequest {
  const observed = record.observed;
  delete record.observed;
  const request = {
    update: releaseMetadataFields(parseSourceMetadataRecord("release", record)),
  };
  if (request.update.creditNotes === undefined && observed !== undefined) {
    throw new Error("request_body_invalid");
  }
  if (request.update.creditNotes === undefined) {
    return request;
  }
  if (observed === undefined) throw new Error("request_body_invalid");
  const observedRecord = objectRecord(observed);
  assertAllowedKeys(observedRecord, ["creditNotes"]);
  if (observedRecord.creditNotes === undefined)
    throw new Error("request_body_invalid");
  parseCreditNotes(observedRecord.creditNotes);
  request.update.observed = { creditNotes: observedRecord.creditNotes };
  return request;
}

export function parseSourceMetadataRequest(
  type: BlockRoomDocumentType,
  value: JsonValue,
): MetadataUpdateRequest {
  if (type === "release") {
    return parseReleaseMetadataRequest({ ...objectRecord(value) });
  }
  return sourceMetadataFactories[type](parseSourceMetadataRecord(type, value));
}
