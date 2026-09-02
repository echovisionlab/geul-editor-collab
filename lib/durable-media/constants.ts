import { env } from "../../env.ts";

// Removed typed media node names remain classified as media only so stale or
// malicious payloads cannot bypass the durable-field guard. Wire validation
// rejects those nodes; this set does not make them valid document content.
const MEDIA_BLOCK_TYPES = new Set([
  "image",
  "audio",
  "video",
  "attachment",
  "file",
]);

const FORBIDDEN_MANAGED_MEDIA_FIELDS = new Set([
  "featuredImageUrl",
  "imageUrl",
  "imageLightUrl",
  "imageDarkUrl",
  "logoUrl",
  "logoLightUrl",
  "logoDarkUrl",
  "faviconUrl",
  "loaderUrl",
  "originalUrl",
  "hlsUrl",
  "waveformUrl",
  "spectrogramUrl",
  "thumbnailUrl",
  "meshUrl",
  "meshOptimizationUrl",
  "textureUrl",
  "darkTextureUrl",
  "playbackUrl",
  "posterUrl",
  "downloadUrl",
  "signedUrl",
  "publicUrl",
  "allowOriginalDownload",
  "allow_original_download",
  "fileKey",
  "objectKey",
  "sourceKey",
  "outputKey",
  "ogKey",
  "siteOgKey",
  "hlsManifestKey",
  "waveformKey",
  "spectrogramKey",
  "thumbnailKey",
  "file_key",
  "object_key",
  "source_key",
  "output_key",
  "og_key",
  "site_og_key",
  "hls_manifest_key",
  "waveform_key",
  "spectrogram_key",
  "thumbnail_key",
]);

const FORBIDDEN_MEDIA_BLOCK_FIELDS = new Set([
  "title",
  "url",
  "_tempUrl",
  "pendingUploadFileId",
  "mediaSlotId",
  "mediaAttemptId",
  "processingStatus",
  "processingProgress",
  "uploadStage",
  "entityType",
  "entityId",
  "mimeType",
  "size",
  "duration",
  "clientThumbnail",
]);

const MANAGED_MEDIA_RELATIVE_PATH_PATTERN =
  /(?:^|["'(=\s])\/(?:media(?:-signed)?|assets?|thumbnails?)(?:\/|[?#"')\s]|$)/i;
const MANAGED_MEDIA_ABSOLUTE_URL_PATTERN = /https?:\/\/[^\s"'<>)]*/giu;
const MANAGED_MEDIA_PATH_PATTERN =
  /^\/(?:media(?:-signed)?|assets?|thumbnails?)(?:\/|$)/i;
const MANAGED_MEDIA_OBJECT_KEY_PATTERN =
  /(?:^|["'(=\s])(?:media(?:-signed)?|assets?|thumbnails?)\/[^\s"'<>)]/i;

function parseManagedMediaOrigins(value: string): ReadonlySet<string> {
  const origins = new Set<string>();
  for (const candidate of value.split(",")) {
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = new URL(trimmed);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new Error(
        `MANAGED_MEDIA_ORIGINS must contain absolute HTTP(S) origins: ${trimmed}`,
      );
    }
    origins.add(parsed.origin);
  }
  return origins;
}

const MANAGED_MEDIA_ORIGINS = parseManagedMediaOrigins(
  env.MANAGED_MEDIA_ORIGINS,
);

function hasManagedMediaAbsoluteReference(value: string): boolean {
  return [...value.matchAll(MANAGED_MEDIA_ABSOLUTE_URL_PATTERN)].some(
    ([candidate]) => {
      try {
        const parsed = new URL(candidate);
        return (
          MANAGED_MEDIA_ORIGINS.has(parsed.origin) &&
          MANAGED_MEDIA_PATH_PATTERN.test(parsed.pathname)
        );
      } catch {
        return false;
      }
    },
  );
}

const KNOWN_JSON_STRING_FIELDS = new Set(["tracks"]);

export function isJsonStringField(field: string): boolean {
  return field.endsWith("Json") || KNOWN_JSON_STRING_FIELDS.has(field);
}

function hasPersistedValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

export function isMediaRecord(
  record: Record<string, unknown>,
  inherited: boolean,
  nodeName?: string,
): boolean {
  const type = typeof record.type === "string" ? record.type : "";
  return (
    inherited ||
    MEDIA_BLOCK_TYPES.has(type) ||
    (nodeName !== undefined && MEDIA_BLOCK_TYPES.has(nodeName.toLowerCase()))
  );
}

export function isManagedMediaReference(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (MANAGED_MEDIA_RELATIVE_PATH_PATTERN.test(value) ||
      hasManagedMediaAbsoluteReference(value) ||
      MANAGED_MEDIA_OBJECT_KEY_PATTERN.test(value))
  );
}

export function isForbiddenField(
  field: string,
  value: unknown,
  mediaRecord: boolean,
): boolean {
  if (mediaRecord && field === "title") {
    return true;
  }

  return (
    hasPersistedValue(value) &&
    (FORBIDDEN_MANAGED_MEDIA_FIELDS.has(field) ||
      (mediaRecord && FORBIDDEN_MEDIA_BLOCK_FIELDS.has(field)) ||
      isManagedMediaReference(value))
  );
}
