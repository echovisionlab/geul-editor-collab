import type { JsonValue } from "@bufbuild/protobuf";
import type { BlockRoomDocumentType } from "@echovisionlab/geul-common/collaboration/block-room-codec";
import type { ResidentBlockMetadataUpdate } from "./resident-block-runtime.ts";

function hasOwn(record: Record<string, JsonValue>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function optionalString(
  record: Record<string, JsonValue>,
  key: string,
  nullable = false,
): string | null | undefined {
  if (!hasOwn(record, key)) return undefined;
  const value = record[key];
  if (nullable && value === null) return null;
  if (typeof value !== "string") throw new Error("request_body_invalid");
  return value;
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

function parseCreditNotes(
  value: JsonValue | undefined,
): { creditId: string; note: string }[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        Object.keys(item).some((key) => key !== "creditId" && key !== "note") ||
        typeof item.creditId !== "string" ||
        typeof item.note !== "string",
    )
  ) {
    throw new Error("request_body_invalid");
  }
  return value as { creditId: string; note: string }[];
}

export interface MetadataUpdateRequest {
  update: ResidentBlockMetadataUpdate;
}

// Strict optional-field validation intentionally counts every accepted JSON branch.
// eslint-disable-next-line complexity
export function parsePostDocumentMetadataRequest(
  value: JsonValue,
): MetadataUpdateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request_body_invalid");
  }
  const record = value as Record<string, JsonValue>;
  if (
    Object.keys(record).some(
      (key) => !["categoryIds", "tagIds"].includes(key),
    ) ||
    (!Array.isArray(record.categoryIds) && !Array.isArray(record.tagIds)) ||
    (record.categoryIds !== undefined &&
      (!Array.isArray(record.categoryIds) ||
        record.categoryIds.some((id) => typeof id !== "string"))) ||
    (record.tagIds !== undefined &&
      (!Array.isArray(record.tagIds) ||
        record.tagIds.some((id) => typeof id !== "string")))
  ) {
    throw new Error("request_body_invalid");
  }
  return {
    update: {
      type: "post",
      scope: "document",
      categoryIds: record.categoryIds as string[] | undefined,
      tagIds: record.tagIds as string[] | undefined,
    },
  };
}

function optionalStringMap(record: Record<string, JsonValue>, key: string) {
  if (!hasOwn(record, key)) return undefined;
  const value = record[key];
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.values(value).some((item) => typeof item !== "string")
  ) {
    throw new Error("request_body_invalid");
  }
  return value as Record<string, string>;
}

// Strict nullable/map/list validation intentionally covers both closed document metadata shapes.
// eslint-disable-next-line complexity
export function parseResidentDocumentMetadataRequest(
  type: "artist" | "label",
  value: JsonValue,
): MetadataUpdateRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request_body_invalid");
  }
  const record = value as Record<string, JsonValue>;
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
  if (
    Object.keys(record).length === 0 ||
    Object.keys(record).some((key) => !keys.includes(key))
  ) {
    throw new Error("request_body_invalid");
  }
  const shared = {
    scope: "document" as const,
    countryCode: optionalString(record, "countryCode", true),
    website: optionalString(record, "website", true),
    socialLinks: optionalStringMap(record, "socialLinks"),
    slug: optionalString(record, "slug", true),
  };
  if (type === "label") {
    return {
      update: {
        type,
        ...shared,
        parentLabelId: optionalString(record, "parentLabelId", true),
      },
    };
  }
  const labelIds = record.labelIds;
  if (
    labelIds !== undefined &&
    (!Array.isArray(labelIds) ||
      labelIds.some((item) => typeof item !== "string"))
  ) {
    throw new Error("request_body_invalid");
  }
  return {
    update: {
      type,
      ...shared,
      realName: optionalString(record, "realName", true),
      labelIds: labelIds as string[] | undefined,
      parentArtistId: optionalString(record, "parentArtistId", true),
    },
  };
}

function parseSourceMetadataRecord(
  type: BlockRoomDocumentType,
  value: JsonValue,
): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request_body_invalid");
  }
  const record = value as Record<string, JsonValue>;
  const allowed = new Set(domainKeys[type]);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new Error("request_body_invalid");
  }
  return record;
}

// This switch is the single exhaustive JSON adapter for the closed resident room enum.
// eslint-disable-next-line complexity
function createSourceMetadataRequest(
  type: BlockRoomDocumentType,
  record: Record<string, JsonValue>,
): MetadataUpdateRequest {
  switch (type) {
    case "post":
      return {
        update: {
          type,
          scope: "locale",
          title: optionalString(record, "title", true),
          summary: optionalString(record, "summary", true),
        },
      };
    case "page":
      return {
        update: {
          type,
          title: optionalString(record, "title") ?? undefined,
          summary: optionalString(record, "summary", true),
        },
      };
    case "work":
      return {
        update: {
          type,
          sourceTitle: optionalString(record, "sourceTitle") ?? undefined,
          summary: optionalString(record, "summary", true),
        },
      };
    case "program-event":
      return {
        update: {
          type,
          title: optionalString(record, "title") ?? undefined,
          summary: optionalString(record, "summary", true),
        },
      };
    case "artist":
      return {
        update: {
          type,
          title: optionalString(record, "title") ?? undefined,
        },
      };
    case "label":
      return {
        update: {
          type,
          title: optionalString(record, "title") ?? undefined,
        },
      };
    case "terms-history":
      return {
        update: {
          type,
          title: optionalString(record, "title") ?? undefined,
        },
      };
    case "privacy-history":
      return {
        update: {
          type,
          title: optionalString(record, "title") ?? undefined,
        },
      };
    case "campaign":
    case "email-template":
      return {
        update: {
          type,
          subject: optionalString(record, "subject") ?? undefined,
        },
      };
    case "release":
      return {
        update: {
          type,
          title: optionalString(record, "title") ?? undefined,
          creditNotes: parseCreditNotes(record.creditNotes),
        },
      };
  }
}

export function parseSourceMetadataRequest(
  type: BlockRoomDocumentType,
  value: JsonValue,
): MetadataUpdateRequest {
  return createSourceMetadataRequest(
    type,
    parseSourceMetadataRecord(type, value),
  );
}
