import { create } from "@bufbuild/protobuf";
import { randomTestUuid } from "@echovisionlab/geul-common/test/random-id";
import {
  MediaProcessingLifecycleEventSchema,
  MediaProcessingStatus,
  TranscodeEntityType,
} from "@echovisionlab/geul-event";
import { MediaProcessingLifecycleOutputsSchema } from "@echovisionlab/geul-proto/secure/events_pb.ts";
import { describe, expect, it } from "vitest";
import { runtimeEventFromLifecycleProto } from "./transcode-subscriber.ts";

function trackLifecycle(status: MediaProcessingStatus) {
  return create(MediaProcessingLifecycleEventSchema, {
    entityType: TranscodeEntityType.TRACK,
    entityId: randomTestUuid(),
    releaseId: randomTestUuid(),
    fileId: randomTestUuid(),
    status,
    timestampMs: 1n,
  });
}

describe("runtimeEventFromLifecycleProto", () => {
  it("maps ready Track processing to the owning Release runtime view", () => {
    const event = trackLifecycle(MediaProcessingStatus.READY);
    event.trackId = event.entityId;
    event.outputs = create(MediaProcessingLifecycleOutputsSchema, {
      hlsGenerationId: "generation-1",
      spectrogramAssetId: "spectrogram-1",
      waveformAssetId: "waveform-1",
      durationSeconds: 123,
    });

    expect(runtimeEventFromLifecycleProto(event)).toMatchObject({
      kind: "media.processing.lifecycle",
      entityType: "release",
      entityId: event.releaseId,
      payload: {
        fileId: event.fileId,
        status: "ready",
        trackId: event.entityId,
        releaseId: event.releaseId,
        outputs: { hlsGenerationId: "generation-1", durationSeconds: 123 },
      },
    });
  });

  it("validates Track lifecycle status shapes", () => {
    const processing = trackLifecycle(MediaProcessingStatus.PROCESSING);
    expect(() => runtimeEventFromLifecycleProto(processing)).toThrow(
      "missing percentage",
    );
    processing.percentage = 42;
    expect(runtimeEventFromLifecycleProto(processing)).toMatchObject({
      payload: { status: "processing", percentage: 42 },
    });

    const failed = trackLifecycle(MediaProcessingStatus.FAILED);
    failed.error = "transcode failed";
    expect(runtimeEventFromLifecycleProto(failed)).toMatchObject({
      payload: { status: "failed", error: "transcode failed" },
    });

    const missingRelease = trackLifecycle(MediaProcessingStatus.FAILED);
    missingRelease.releaseId = "";
    expect(() => runtimeEventFromLifecycleProto(missingRelease)).toThrow(
      "missing release_id",
    );

    const unspecified = trackLifecycle(MediaProcessingStatus.UNSPECIFIED);
    expect(() => runtimeEventFromLifecycleProto(unspecified)).toThrow(
      "unsupported media processing",
    );

    const failedWithPercentage = trackLifecycle(MediaProcessingStatus.FAILED);
    failedWithPercentage.percentage = 1;
    expect(() => runtimeEventFromLifecycleProto(failedWithPercentage)).toThrow(
      "included percentage",
    );

    const readyWithoutOutputs = trackLifecycle(MediaProcessingStatus.READY);
    expect(() => runtimeEventFromLifecycleProto(readyWithoutOutputs)).toThrow(
      "missing outputs",
    );

    const processingWithOutputs = trackLifecycle(
      MediaProcessingStatus.PROCESSING,
    );
    processingWithOutputs.percentage = 1;
    processingWithOutputs.outputs = create(
      MediaProcessingLifecycleOutputsSchema,
      {},
    );
    expect(() => runtimeEventFromLifecycleProto(processingWithOutputs)).toThrow(
      "included outputs",
    );
  });

  it("does not route File-scoped or old document-scoped processing through collaboration", () => {
    for (const entityType of [
      TranscodeEntityType.FILE,
      TranscodeEntityType.POST,
      TranscodeEntityType.PAGE,
      TranscodeEntityType.WORK,
      TranscodeEntityType.PROGRAM_EVENT,
    ]) {
      expect(
        runtimeEventFromLifecycleProto(
          create(MediaProcessingLifecycleEventSchema, {
            entityType,
            entityId: randomTestUuid(),
            fileId: randomTestUuid(),
            status: MediaProcessingStatus.PROCESSING,
            percentage: 10,
          }),
        ),
      ).toBeNull();
    }
  });
});
