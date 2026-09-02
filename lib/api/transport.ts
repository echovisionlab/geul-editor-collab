import { env } from "../../env.ts";
import { fromBinary } from "@bufbuild/protobuf";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import {
  CollaborationConflictDetailSchema,
  CollaborationConflictReason,
  CollaborationMutationRejectionDetailSchema,
  CollaborationMutationRejectionReason,
} from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { injectCorrelation } from "@echovisionlab/geul-telemetry";

export type CollaborationConflictReasonName =
  | "locale_ownership_changed"
  | "document_revision_changed"
  | "target_revision_changed";

export type CollaborationMutationRejectionReasonName =
  | "non_source_structure_forbidden"
  | "room_locale_mismatch"
  | "non_source_shared_field_forbidden"
  | "non_source_file_relation_forbidden"
  | "non_source_document_metadata_forbidden";

export class CollaborationConflictError extends Error {
  constructor(
    readonly reason: CollaborationConflictReasonName,
    message = "collaboration_conflict",
  ) {
    super(message);
    this.name = "CollaborationConflictError";
  }
}

/**
 * The domain persistence API authoritatively confirmed that the collaborative
 * resource no longer exists. This is intentionally distinct from transport,
 * database, and other dependency failures: only this error closes live rooms.
 */
export class CollaborationResourceNotFoundError extends Error {
  constructor(
    readonly documentType: CollaborativeDocumentType,
    readonly resourceId: string,
  ) {
    super("collaboration_resource_not_found");
    this.name = "CollaborationResourceNotFoundError";
  }
}

export class CollaborationMutationRejectionError extends Error {
  constructor(readonly reason: CollaborationMutationRejectionReasonName) {
    super("collaboration_mutation_rejected");
    this.name = "CollaborationMutationRejectionError";
  }
}

/**
 * The persistence API returned a definitive non-success response. Unlike a
 * lost response or transport failure, this proves that the mutation was not
 * acknowledged and must not be converted into a revision conflict/reload.
 */
export class CollaborationPersistenceRejectedError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
  ) {
    super("collaboration_persistence_rejected");
    this.name = "CollaborationPersistenceRejectedError";
  }
}

export function throwIfCollaborationResourceNotFound(
  response: Response,
  documentType: CollaborativeDocumentType,
  resourceId: string,
): void {
  if (response.status === 404) {
    throw new CollaborationResourceNotFoundError(documentType, resourceId);
  }
}

const collaborationConflictReasonNames: Partial<
  Record<CollaborationConflictReason, CollaborationConflictReasonName>
> = {
  [CollaborationConflictReason.LOCALE_OWNERSHIP_CHANGED]:
    "locale_ownership_changed",
  [CollaborationConflictReason.DOCUMENT_REVISION_CHANGED]:
    "document_revision_changed",
  [CollaborationConflictReason.TARGET_REVISION_CHANGED]:
    "target_revision_changed",
};

const collaborationMutationRejectionReasonNames: Partial<
  Record<
    CollaborationMutationRejectionReason,
    CollaborationMutationRejectionReasonName
  >
> = {
  [CollaborationMutationRejectionReason.NON_SOURCE_STRUCTURE_FORBIDDEN]:
    "non_source_structure_forbidden",
  [CollaborationMutationRejectionReason.ROOM_LOCALE_MISMATCH]:
    "room_locale_mismatch",
  [CollaborationMutationRejectionReason.NON_SOURCE_SHARED_FIELD_FORBIDDEN]:
    "non_source_shared_field_forbidden",
  [CollaborationMutationRejectionReason.NON_SOURCE_FILE_RELATION_FORBIDDEN]:
    "non_source_file_relation_forbidden",
  [CollaborationMutationRejectionReason.NON_SOURCE_DOCUMENT_METADATA_FORBIDDEN]:
    "non_source_document_metadata_forbidden",
};

function createInternalHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Internal-Service": env.TOKEN_SIGNING_SECRET,
  };
  injectCorrelation(headers, {
    set(carrier, key, value) {
      carrier[key] = value;
    },
  });
  return headers;
}

function createInternalHeadersWith(
  additionalHeaders: Record<string, string> | undefined,
): Record<string, string> {
  return { ...createInternalHeaders(), ...additionalHeaders };
}

export async function postInternalApi(
  path: string,
  body: unknown,
  signal?: AbortSignal,
  additionalHeaders?: Record<string, string>,
): Promise<Response> {
  const response = await fetch(`${env.API_URL}${path}`, {
    method: "POST",
    headers: createInternalHeadersWith(additionalHeaders),
    body: JSON.stringify(body),
    signal,
  });
  const conflictReason = await readCollaborationConflictReason(response);
  if (conflictReason) {
    throw new CollaborationConflictError(conflictReason);
  }
  const rejectionReason =
    await readCollaborationMutationRejectionReason(response);
  if (rejectionReason) {
    throw new CollaborationMutationRejectionError(rejectionReason);
  }
  return response;
}

async function readCollaborationMutationRejectionReason(
  response: Response,
): Promise<CollaborationMutationRejectionReasonName | undefined> {
  if (response.status !== 400) return undefined;
  try {
    const data = (await response.clone().json()) as {
      code?: unknown;
      details?: unknown;
    };
    if (data.code !== "invalid_argument" || !Array.isArray(data.details)) {
      return undefined;
    }
    for (const detail of data.details) {
      const reason = decodeCollaborationMutationRejectionDetail(detail);
      if (reason) return reason;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function decodeCollaborationMutationRejectionDetail(
  detail: unknown,
): CollaborationMutationRejectionReasonName | undefined {
  if (typeof detail !== "object" || detail === null) return undefined;
  if (
    !("type" in detail) ||
    !("value" in detail) ||
    detail.type !== "api.intra.v1.CollaborationMutationRejectionDetail" ||
    typeof detail.value !== "string"
  ) {
    return undefined;
  }
  const decoded = fromBinary(
    CollaborationMutationRejectionDetailSchema,
    Buffer.from(detail.value, "base64"),
  );
  return collaborationMutationRejectionReasonNames[decoded.reason];
}

async function readCollaborationConflictReason(
  response: Response,
): Promise<CollaborationConflictReasonName | undefined> {
  if (response.status !== 400) {
    return undefined;
  }
  try {
    const data = (await response.clone().json()) as {
      code?: unknown;
      details?: unknown;
    };
    if (data.code !== "failed_precondition" || !Array.isArray(data.details)) {
      return undefined;
    }
    for (const detail of data.details) {
      const reason = decodeCollaborationConflictDetail(detail);
      if (reason) {
        return reason;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function decodeCollaborationConflictDetail(
  detail: unknown,
): CollaborationConflictReasonName | undefined {
  if (typeof detail !== "object" || detail === null) {
    return undefined;
  }
  if (
    !("type" in detail) ||
    !("value" in detail) ||
    detail.type !== "api.intra.v1.CollaborationConflictDetail" ||
    typeof detail.value !== "string"
  ) {
    return undefined;
  }
  const decoded = fromBinary(
    CollaborationConflictDetailSchema,
    Buffer.from(detail.value, "base64"),
  );
  return collaborationConflictReasonNames[decoded.reason];
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function hasResponseCode(
  response: Response,
  status: number,
  code: string,
): Promise<boolean> {
  if (response.status !== status) {
    return false;
  }
  try {
    const data = (await response.clone().json()) as { code?: unknown };
    return data.code === code;
  } catch {
    return false;
  }
}

/**
 * Connect error serialization may omit the typed detail while still returning
 * the canonical failed_precondition code. Every document adapter maps that result
 * to the same collaboration conflict so the runtime fences Post, Page, and
 * Work identically.
 */
export async function throwIfCollaborationConflictResponse(
  response: Response,
): Promise<void> {
  if (await hasResponseCode(response, 400, "failed_precondition")) {
    throw new CollaborationConflictError("document_revision_changed");
  }
}
