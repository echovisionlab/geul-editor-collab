import type { FileIngestRuntimeSource } from "@echovisionlab/geul-common";
import {
  deserializeProto,
  FileIngestAttachedEventSchema,
  FileIngestDownloadEventSchema,
  FileIngestFailedEventSchema,
  FileIngestFailureReason,
  FileIngestFinalizedEventSchema,
  FileIngestSignalTypes,
  FileIngestSource,
  FileIngestUploadEventSchema,
  type FileIngestAttachedEvent,
  type FileIngestDownloadEvent,
  type FileIngestFailedEvent,
  type FileIngestFinalizedEvent,
  type FileIngestIdentity,
  type FileIngestUploadEvent,
} from "@echovisionlab/geul-event";
import type { FileIngestRuntimeEvent } from "./types.ts";

const runtimeSources = new Map<FileIngestSource, FileIngestRuntimeSource>([
  [FileIngestSource.DIRECT_UPLOAD, "upload"],
  [FileIngestSource.REMOTE_URL, "embed"],
]);

export function fileIngestSourceToRuntimeSource(
  source: FileIngestSource,
): FileIngestRuntimeSource {
  return runtimeSources.get(source) ?? "embed";
}

function runtimeEventFromEnvelope(
  event: {
    identity?: FileIngestIdentity;
    correlationId: string;
    sequenceNumber: bigint | number;
    timestampMs: bigint | number;
    progress?: FileIngestRuntimeEvent["progress"];
  },
  eventName: string,
  stage: FileIngestRuntimeEvent["stage"],
): FileIngestRuntimeEvent {
  const identity = event.identity;
  if (!identity) {
    throw new Error(`${eventName} missing identity`);
  }

  return {
    identity,
    correlationId: event.correlationId,
    sequenceNumber: event.sequenceNumber,
    timestampMs: event.timestampMs,
    entityType: identity.entityType,
    entityId: identity.entityId,
    fileId: identity.fileId,
    uploadId: identity.uploadId,
    slotId: identity.slotId,
    attemptId: identity.attemptId,
    expectedCurrentFileId: identity.expectedCurrentFileId,
    source: identity.source,
    mediaKind: identity.mediaKind,
    stage,
    progress: event.progress,
  };
}

export function decodeFileIngestEvent(
  message: Uint8Array,
  signalType: string,
): FileIngestRuntimeEvent {
  switch (signalType) {
    case FileIngestSignalTypes.upload: {
      const event = deserializeProto<FileIngestUploadEvent>(
        FileIngestUploadEventSchema,
        message,
      );
      return runtimeEventFromEnvelope(
        event,
        "FileIngestUploadEvent",
        "uploading",
      );
    }
    case FileIngestSignalTypes.download: {
      const event = deserializeProto<FileIngestDownloadEvent>(
        FileIngestDownloadEventSchema,
        message,
      );
      return runtimeEventFromEnvelope(
        event,
        "FileIngestDownloadEvent",
        "downloading",
      );
    }
    case FileIngestSignalTypes.finalized: {
      const event = deserializeProto<FileIngestFinalizedEvent>(
        FileIngestFinalizedEventSchema,
        message,
      );
      return runtimeEventFromEnvelope(
        event,
        "FileIngestFinalizedEvent",
        "finalized",
      );
    }
    case FileIngestSignalTypes.attached: {
      const event = deserializeProto<FileIngestAttachedEvent>(
        FileIngestAttachedEventSchema,
        message,
      );
      return {
        ...runtimeEventFromEnvelope(
          event,
          "FileIngestAttachedEvent",
          "attached",
        ),
        attached: {
          fileName: event.fileName,
          mimeType: event.mimeType,
          fileSize: event.fileSize,
        },
      };
    }
    case FileIngestSignalTypes.failed: {
      const event = deserializeProto<FileIngestFailedEvent>(
        FileIngestFailedEventSchema,
        message,
      );
      return {
        ...runtimeEventFromEnvelope(
          event,
          "FileIngestFailedEvent",
          event.reason === FileIngestFailureReason.EXPIRED
            ? "expired"
            : "failed",
        ),
        failed: {
          reason: event.reason,
          error: event.error,
        },
      };
    }
    default:
      throw new Error(`Unsupported file ingest signal type: ${signalType}`);
  }
}
