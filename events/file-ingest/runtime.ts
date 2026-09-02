import {
  FileIngestMediaKind,
  type FileIngestProgress,
} from "@echovisionlab/geul-event";
import { fileIngestSourceToRuntimeSource } from "./decoder.ts";
import type {
  FileIngestProjectionEvent,
  FileIngestRuntimeEvent,
  ResolvedIngestDocument,
} from "./types.ts";

function runtimeProgressFromFileIngestProgress(
  progress: FileIngestProgress | undefined,
  fallbackPercentage: number,
) {
  return {
    progress: progress?.percentage ?? fallbackPercentage,
    bytesCompleted:
      progress?.bytesCompleted == null
        ? undefined
        : Number(progress.bytesCompleted),
    bytesTotal:
      progress?.bytesTotal == null ? undefined : Number(progress.bytesTotal),
  };
}

function runtimeProgressFromFileIngestEvent(event: FileIngestRuntimeEvent) {
  if (event.stage === "attached") {
    return { progress: 100, bytesCompleted: undefined, bytesTotal: undefined };
  }
  const fallbackPercentage = event.stage === "finalized" ? 100 : 0;
  return runtimeProgressFromFileIngestProgress(
    event.progress,
    fallbackPercentage,
  );
}

function fileIngestError(event: FileIngestProjectionEvent): string | undefined {
  return event.failed?.error;
}

function fileIngestAttachedRuntimePayload(
  event: FileIngestProjectionEvent,
): { fileName?: string; mimeType?: string; fileSize?: number } | undefined {
  if (event.stage !== "attached") {
    return undefined;
  }

  return {
    fileName: event.attached?.fileName || undefined,
    mimeType: event.attached?.mimeType || undefined,
    fileSize: normalizedFileSize(event.attached?.fileSize),
  };
}

function normalizedFileSize(
  value: bigint | number | undefined,
): number | undefined {
  const fileSize = typeof value === "bigint" ? Number(value) : value;
  return typeof fileSize === "number" && Number.isFinite(fileSize)
    ? fileSize
    : undefined;
}

export function runtimeLifecyclePayload(
  event: FileIngestRuntimeEvent,
  resolved: ResolvedIngestDocument,
): string {
  const progress = runtimeProgressFromFileIngestEvent(event);
  const attached = fileIngestAttachedRuntimePayload(event);
  const source = fileIngestSourceToRuntimeSource(event.source);

  return JSON.stringify({
    version: 1,
    kind: "file.ingest.lifecycle",
    entityType: resolved.runtimeEntityType,
    entityId: resolved.documentEntityId,
    correlationId: event.correlationId,
    sequence: Number(event.sequenceNumber),
    timestampMs: Number(event.timestampMs),
    payload: {
      fileId: event.fileId,
      uploadId: event.uploadId,
      mediaKind: FileIngestMediaKind[event.mediaKind],
      slotId: event.slotId,
      attemptId: event.attemptId,
      source,
      stage: event.stage,
      progress: progress.progress,
      bytesCompleted: progress.bytesCompleted,
      bytesTotal: progress.bytesTotal,
      fileName: attached?.fileName,
      mimeType: attached?.mimeType,
      fileSize: attached?.fileSize,
      error: fileIngestError(event),
      trackId: resolved.trackId,
      releaseId: resolved.releaseId,
    },
  });
}
