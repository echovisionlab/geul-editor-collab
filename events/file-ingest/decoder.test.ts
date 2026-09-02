import { create, toBinary } from "@bufbuild/protobuf";
import { randomTestUuid } from "@echovisionlab/geul-common/test/random-id";
import {
  FileIngestAttachedEventSchema,
  FileIngestDownloadEventSchema,
  FileIngestFailedEventSchema,
  FileIngestFailureReason,
  FileIngestFinalizedEventSchema,
  FileIngestMediaKind,
  FileIngestSignalTypes,
  FileIngestSource,
  FileIngestUploadEventSchema,
  TranscodeEntityType,
} from "@echovisionlab/geul-event";
import { describe, expect, it } from "vitest";
import {
  decodeFileIngestEvent,
  fileIngestSourceToRuntimeSource,
} from "./decoder.ts";

describe("decodeFileIngestEvent", () => {
  it("decodes the typed Track attachment identity and replacement CAS", () => {
    const trackId = randomTestUuid();
    const fileId = randomTestUuid();
    const attemptId = randomTestUuid();
    const expectedCurrentFileId = randomTestUuid();
    const event = create(FileIngestAttachedEventSchema, {
      correlationId: randomTestUuid(),
      sequenceNumber: 1n,
      timestampMs: 1n,
      identity: {
        entityType: TranscodeEntityType.TRACK,
        entityId: trackId,
        fileId,
        target: { fileId, objectKey: `media/${fileId}.ogg`, extension: "ogg" },
        source: FileIngestSource.DIRECT_UPLOAD,
        mediaKind: FileIngestMediaKind.TRACK_AUDIO,
        attemptId,
        expectedCurrentFileId,
      },
      fileName: "track.ogg",
      mimeType: "audio/ogg",
      fileSize: 1234n,
    });

    expect(
      decodeFileIngestEvent(
        toBinary(FileIngestAttachedEventSchema, event),
        FileIngestSignalTypes.attached,
      ),
    ).toMatchObject({
      entityType: TranscodeEntityType.TRACK,
      entityId: trackId,
      fileId,
      attemptId,
      expectedCurrentFileId,
      mediaKind: FileIngestMediaKind.TRACK_AUDIO,
      stage: "attached",
      attached: {
        fileName: "track.ogg",
        mimeType: "audio/ogg",
        fileSize: 1234n,
      },
    });
  });

  it("rejects absent identity and unknown signal types", () => {
    const event = create(FileIngestAttachedEventSchema, {});
    expect(() =>
      decodeFileIngestEvent(
        toBinary(FileIngestAttachedEventSchema, event),
        FileIngestSignalTypes.attached,
      ),
    ).toThrow("missing identity");
    expect(() =>
      decodeFileIngestEvent(Uint8Array.of(), "file.unknown"),
    ).toThrow("Unsupported file ingest signal type");
  });

  it.each([
    [FileIngestSignalTypes.upload, FileIngestUploadEventSchema, "uploading"],
    [
      FileIngestSignalTypes.download,
      FileIngestDownloadEventSchema,
      "downloading",
    ],
    [
      FileIngestSignalTypes.finalized,
      FileIngestFinalizedEventSchema,
      "finalized",
    ],
  ] as const)("decodes %s lifecycle envelopes", (signal, schema, stage) => {
    const fileId = randomTestUuid();
    const event = create(schema, {
      identity: {
        entityType: TranscodeEntityType.TRACK,
        entityId: randomTestUuid(),
        fileId,
        target: { fileId, objectKey: `media/${fileId}`, extension: "wav" },
        source: FileIngestSource.REMOTE_URL,
        mediaKind: FileIngestMediaKind.TRACK_AUDIO,
      },
      correlationId: randomTestUuid(),
      sequenceNumber: 2n,
      timestampMs: 3n,
      progress: { percentage: 25, bytesCompleted: 1n, bytesTotal: 4n },
    });
    expect(
      decodeFileIngestEvent(toBinary(schema, event), signal),
    ).toMatchObject({
      fileId,
      stage,
      source: FileIngestSource.REMOTE_URL,
    });
  });

  it.each([
    [FileIngestFailureReason.EXPIRED, "expired"],
    [FileIngestFailureReason.UNSPECIFIED, "failed"],
  ] as const)("maps failure reason %s to %s", (reason, stage) => {
    const fileId = randomTestUuid();
    const event = create(FileIngestFailedEventSchema, {
      identity: {
        entityType: TranscodeEntityType.TRACK,
        entityId: randomTestUuid(),
        fileId,
        target: { fileId, objectKey: `media/${fileId}`, extension: "wav" },
        source: FileIngestSource.DIRECT_UPLOAD,
        mediaKind: FileIngestMediaKind.TRACK_AUDIO,
      },
      reason,
      error: "failure",
    });
    expect(
      decodeFileIngestEvent(
        toBinary(FileIngestFailedEventSchema, event),
        FileIngestSignalTypes.failed,
      ),
    ).toMatchObject({ stage, failed: { reason, error: "failure" } });
  });

  it("maps known and future ingest sources to runtime sources", () => {
    expect(
      fileIngestSourceToRuntimeSource(FileIngestSource.DIRECT_UPLOAD),
    ).toBe("upload");
    expect(fileIngestSourceToRuntimeSource(FileIngestSource.REMOTE_URL)).toBe(
      "embed",
    );
    expect(fileIngestSourceToRuntimeSource(FileIngestSource.UNSPECIFIED)).toBe(
      "embed",
    );
  });
});
