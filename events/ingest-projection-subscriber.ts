import {
  FileIngestMediaKind,
  FileIngestSignalTypes,
  Queues,
  TranscodeEntityType,
} from "@echovisionlab/geul-event";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import type { Server } from "@hocuspocus/server";
import {
  attachTrackOriginalAudio,
  type AttachTrackOriginalAudioAck,
  type AttachTrackOriginalAudioInput,
} from "../lib/api/file-ingest.ts";
import { startQueueConsumer } from "../lib/postgresql/messaging.ts";
import { broadcastStatelessToEntityDocuments } from "../lib/entity-document-broadcast.ts";
import { decodeFileIngestEvent } from "./file-ingest/decoder.ts";
import { runtimeLifecyclePayload } from "./file-ingest/runtime.ts";

const MAX_RETRY_COUNT = 60;
const PROJECTION_QUEUE = Queues.releaseTrackOriginalAudioProjection;
const PROJECTION_MESSAGE_TYPE = "api.manage.v1.FileIngestAttachedEvent";

export interface IngestProjectionSubscriberDependencies {
  attachTrackOriginalAudio?: (
    input: AttachTrackOriginalAudioInput,
  ) => Promise<AttachTrackOriginalAudioAck>;
}

interface ProcessedProjection {
  outcome: "applied" | "already_applied";
  trackId: string;
  fileId: string;
  attemptId: string;
  mediaKind: "TRACK_AUDIO";
  currentFileId: string;
  releaseId: string;
  broadcastCount: number;
}

function prepareTrackOriginalAudioAttachment(payload: Uint8Array) {
  const event = decodeFileIngestEvent(payload, FileIngestSignalTypes.attached);
  if (
    event.entityType !== TranscodeEntityType.TRACK ||
    event.mediaKind !== FileIngestMediaKind.TRACK_AUDIO
  ) {
    throw new Error(
      "Track original audio projection requires a Track audio event",
    );
  }
  if (!event.entityId || !event.fileId || !event.attemptId) {
    throw new Error(
      "Track original audio projection requires Track, File, and attempt IDs",
    );
  }
  if (
    event.expectedCurrentFileId !== undefined &&
    event.expectedCurrentFileId.trim().length === 0
  ) {
    throw new Error(
      "Track original audio projection has an invalid expected File ID",
    );
  }
  return {
    event,
    input: {
      trackId: event.entityId,
      verifiedFileId: event.fileId,
      ingestAttemptId: event.attemptId,
      expectedCurrentFileId: event.expectedCurrentFileId,
    },
  };
}

export async function processIngestProjectionMessage(
  server: Server,
  payload: Uint8Array,
  dependencies: IngestProjectionSubscriberDependencies = {},
): Promise<ProcessedProjection> {
  const { event, input } = prepareTrackOriginalAudioAttachment(payload);
  const ack = await (
    dependencies.attachTrackOriginalAudio ?? attachTrackOriginalAudio
  )(input);
  const resolved = {
    documentType: CollaborativeDocumentType.RELEASE,
    documentEntityId: ack.releaseId,
    runtimeEntityType: "release" as const,
    trackId: input.trackId,
    releaseId: ack.releaseId,
  };
  const broadcastCount = broadcastStatelessToEntityDocuments({
    documents: server.hocuspocus.documents,
    type: CollaborativeDocumentType.RELEASE,
    entityId: ack.releaseId,
    payload: runtimeLifecyclePayload(event, resolved),
  });
  return {
    outcome: ack.outcome,
    trackId: input.trackId,
    fileId: input.verifiedFileId,
    attemptId: input.ingestAttemptId,
    mediaKind: "TRACK_AUDIO",
    currentFileId: ack.currentFileId,
    releaseId: ack.releaseId,
    broadcastCount,
  };
}

export async function startIngestProjectionSubscriber(
  server: Server,
  dependencies: IngestProjectionSubscriberDependencies = {},
): Promise<void> {
  await startQueueConsumer({
    queue: PROJECTION_QUEUE,
    expectedMessageType: PROJECTION_MESSAGE_TYPE,
    visibilityTimeoutSeconds: 60,
    maxRetries: MAX_RETRY_COUNT,
    retryDelaySeconds: 5,
    retryBackoff: 1,
    handle: ({ payload }) =>
      processIngestProjectionMessage(server, payload, dependencies).then(
        () => undefined,
      ),
  });
}
