import {
  FileIngestMediaKind,
  FileIngestSource,
} from "@echovisionlab/geul-event";
import { describe, expect, it } from "vitest";
import { runtimeLifecyclePayload } from "./runtime.ts";
import type {
  FileIngestRuntimeEvent,
  ResolvedIngestDocument,
} from "./types.ts";

const resolved: ResolvedIngestDocument = {
  documentType: 1,
  documentEntityId: "document-1",
  runtimeEntityType: "post",
  trackId: "track-1",
  releaseId: "release-1",
};

function event(
  overrides: Partial<FileIngestRuntimeEvent> = {},
): FileIngestRuntimeEvent {
  return {
    identity: {} as FileIngestRuntimeEvent["identity"],
    correlationId: "correlation-1",
    sequenceNumber: 2n,
    timestampMs: 3n,
    entityType: 1,
    entityId: "entity-1",
    fileId: "file-1",
    source: FileIngestSource.DIRECT_UPLOAD,
    mediaKind: FileIngestMediaKind.TRACK_AUDIO,
    stage: "uploading",
    ...overrides,
  };
}

describe("file ingest runtime lifecycle payload", () => {
  it("emits explicit progress and failed detail", () => {
    const payload = JSON.parse(
      runtimeLifecyclePayload(
        event({
          progress: {
            percentage: 25,
            bytesCompleted: 10n,
            bytesTotal: 40n,
          } as unknown as FileIngestRuntimeEvent["progress"],
          failed: { reason: 1, error: "failed" },
        }),
        resolved,
      ),
    ) as { payload: Record<string, unknown> };
    expect(payload.payload).toMatchObject({
      progress: 25,
      bytesCompleted: 10,
      bytesTotal: 40,
      error: "failed",
      source: "upload",
    });
  });

  it.each([
    ["finalized", 100],
    ["downloading", 0],
  ] as const)("uses the %s fallback progress", (stage, progress) => {
    const payload = JSON.parse(
      runtimeLifecyclePayload(event({ stage }), resolved),
    ) as {
      payload: Record<string, unknown>;
    };
    expect(payload.payload.progress).toBe(progress);
  });

  it.each([
    [123n, 123],
    [456, 456],
    [Number.POSITIVE_INFINITY, undefined],
    [undefined, undefined],
  ] as const)("normalizes attached file size %s", (fileSize, expected) => {
    const payload = JSON.parse(
      runtimeLifecyclePayload(
        event({
          stage: "attached",
          source: FileIngestSource.REMOTE_URL,
          attached: { fileName: "", mimeType: "", fileSize },
        }),
        resolved,
      ),
    ) as { payload: Record<string, unknown> };
    expect(payload.payload).toMatchObject({ progress: 100, source: "embed" });
    expect(payload.payload.fileSize).toBe(expected);
    expect(payload.payload.fileName).toBeUndefined();
    expect(payload.payload.mimeType).toBeUndefined();
  });
});
