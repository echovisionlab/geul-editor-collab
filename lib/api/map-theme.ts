import { create, fromJson, toJson } from "@bufbuild/protobuf";
import {
  MapThemeDocumentSnapshotSchema,
  type MapThemeDocumentSnapshot as CommonMapThemeDocumentSnapshot,
} from "@echovisionlab/geul-common/collaboration/map-theme";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import {
  LoadMapThemeSnapshotResponseSchema,
  SaveMapThemeSnapshotRequestSchema,
  SaveMapThemeSnapshotResponseSchema,
} from "@echovisionlab/geul-proto/intra/map_pb.ts";
import {
  CollaborationConflictError,
  hasResponseCode,
  postInternalApi,
  throwIfCollaborationResourceNotFound,
} from "./transport.ts";

// ============================================================================
// Map Theme collaboration API
// ============================================================================

export type MapThemeDocumentSnapshot = CommonMapThemeDocumentSnapshot;

export interface SaveMapThemeDocumentRequest {
  themeId: string;
  locale: "und";
  snapshot: MapThemeDocumentSnapshot;
  expectedRevision: bigint;
  contributorMemberIds?: string[];
}

export interface SaveMapThemeDocumentResponse {
  success: boolean;
  revision: bigint;
  locale: string;
}

export interface LoadMapThemeDocumentRequest {
  themeId: string;
  locale: "und";
}

export interface LoadMapThemeDocumentResponse {
  snapshot: MapThemeDocumentSnapshot;
  revision: bigint;
  locale: string;
}

export class MapThemeRevisionConflictError extends CollaborationConflictError {
  constructor() {
    super("document_revision_changed", "map_theme_revision_conflict");
    this.name = "MapThemeRevisionConflictError";
  }
}

function mapThemeDocumentSnapshot(snapshot: unknown): MapThemeDocumentSnapshot {
  const message = snapshot as
    | {
        name?: unknown;
        settings?: object;
        lightVariant?: object;
        darkVariant?: object;
      }
    | undefined;
  if (!message?.settings || !message.lightVariant || !message.darkVariant) {
    throw new Error("Invalid map theme document response");
  }
  const result = MapThemeDocumentSnapshotSchema.safeParse({
    name: message.name,
    settings: withoutProtobufMessageType(message.settings),
    lightVariant: withoutProtobufMessageType(message.lightVariant),
    darkVariant: withoutProtobufMessageType(message.darkVariant),
  });
  if (!result.success) {
    throw new Error("Invalid map theme document response");
  }
  return result.data;
}

function withoutProtobufMessageType<T extends object>(
  value: T,
): Omit<T, "$typeName"> {
  const plain = { ...value } as T & { $typeName?: unknown };
  delete plain.$typeName;
  return plain;
}

export async function saveMapThemeDocument(
  req: SaveMapThemeDocumentRequest,
): Promise<SaveMapThemeDocumentResponse> {
  const request = create(SaveMapThemeSnapshotRequestSchema, {
    themeId: req.themeId,
    locale: req.locale,
    snapshot: req.snapshot,
    expectedRevision: req.expectedRevision,
    contributorMemberIds: req.contributorMemberIds,
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalMapService/SaveMapThemeSnapshot",
    toJson(SaveMapThemeSnapshotRequestSchema, request),
  );

  throwIfCollaborationResourceNotFound(
    response,
    CollaborativeDocumentType.MAP_THEME,
    req.themeId,
  );
  if (await hasResponseCode(response, 409, "aborted")) {
    throw new MapThemeRevisionConflictError();
  }
  if (!response.ok) {
    throw new Error(
      `Failed to save map theme document: ${response.status} ${response.statusText}`,
    );
  }

  const result = fromJson(
    SaveMapThemeSnapshotResponseSchema,
    await response.json(),
  );
  return {
    success: result.success,
    revision: result.revision,
    locale: result.locale,
  };
}

export async function loadMapThemeDocument(
  req: LoadMapThemeDocumentRequest,
): Promise<LoadMapThemeDocumentResponse> {
  const response = await postInternalApi(
    "/api.intra.v1.InternalMapService/LoadMapThemeSnapshot",
    { themeId: req.themeId, locale: req.locale },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to load map theme document: ${response.status} ${response.statusText}`,
    );
  }

  const result = fromJson(
    LoadMapThemeSnapshotResponseSchema,
    await response.json(),
  );
  return {
    snapshot: mapThemeDocumentSnapshot(result.snapshot),
    revision: result.revision,
    locale: result.locale,
  };
}
