import { create, fromJson, toJson } from "@bufbuild/protobuf";
import {
  AttachTrackOriginalAudioRequestSchema,
  AttachTrackOriginalAudioResponseSchema,
  AttachTrackOriginalAudioResult,
} from "@echovisionlab/geul-proto/intra/file_ingest_pb.ts";
import { postInternalApi } from "./transport.ts";

export interface AttachTrackOriginalAudioInput {
  trackId: string;
  verifiedFileId: string;
  ingestAttemptId: string;
  expectedCurrentFileId?: string;
}

export interface AttachTrackOriginalAudioAck {
  outcome: "applied" | "already_applied";
  currentFileId: string;
  releaseId: string;
}

export async function attachTrackOriginalAudio(
  input: AttachTrackOriginalAudioInput,
): Promise<AttachTrackOriginalAudioAck> {
  const request = create(AttachTrackOriginalAudioRequestSchema, input);
  const response = await postInternalApi(
    "/api.intra.v1.InternalFileIngestService/AttachTrackOriginalAudio",
    toJson(AttachTrackOriginalAudioRequestSchema, request),
  );
  if (!response.ok) {
    throw new Error(
      `Failed to attach Track original audio: ${response.status} ${response.statusText}`,
    );
  }

  const ack = fromJson(
    AttachTrackOriginalAudioResponseSchema,
    await response.json(),
  );
  if (ack.currentFileId !== input.verifiedFileId || !ack.releaseId) {
    throw new Error("Invalid Track original audio attachment response");
  }
  switch (ack.result) {
    case AttachTrackOriginalAudioResult.APPLIED:
      return {
        outcome: "applied",
        currentFileId: ack.currentFileId,
        releaseId: ack.releaseId,
      };
    case AttachTrackOriginalAudioResult.ALREADY_APPLIED:
      return {
        outcome: "already_applied",
        currentFileId: ack.currentFileId,
        releaseId: ack.releaseId,
      };
    default:
      throw new Error("Invalid Track original audio attachment result");
  }
}
