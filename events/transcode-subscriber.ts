import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import {
  parseEditorRuntimeEventMessage,
  type MediaProcessingLifecycleRuntimeEvent,
  type MediaProcessingRuntimeOutputs,
  type MediaProcessingRuntimeStatus,
  type RuntimeEntityType,
} from "@echovisionlab/geul-common/collaboration/runtime-events";
import {
  deserializeProto,
  Signals,
  MediaProcessingLifecycleEventSchema,
  MediaProcessingStatus,
  TranscodeEntityType,
  type MediaProcessingLifecycleEvent,
  type MediaProcessingLifecycleOutputs,
} from "@echovisionlab/geul-event";
import type { Server } from "@hocuspocus/server";
import { broadcastStatelessToEntityDocuments } from "../lib/entity-document-broadcast.ts";
import { logger } from "../lib/logger.ts";
import { startSignalSubscriber } from "../lib/postgresql/messaging.ts";

function documentTypeFromRuntimeEntityType(
  entityType: RuntimeEntityType,
): CollaborativeDocumentType | null {
  return runtimeDocumentTypes.get(entityType) ?? null;
}

const runtimeDocumentTypes = new Map<
  RuntimeEntityType,
  CollaborativeDocumentType
>([["release", CollaborativeDocumentType.RELEASE]]);

interface ResolvedLifecycleDocument {
  documentType: CollaborativeDocumentType;
  documentEntityId: string;
  runtimeEntityType: RuntimeEntityType;
  trackId?: string;
  releaseId?: string;
}

function resolveLifecycleDocument(
  event: MediaProcessingLifecycleEvent,
): ResolvedLifecycleDocument | null {
  if (event.entityType !== TranscodeEntityType.TRACK) {
    return null;
  }
  const releaseId = event.releaseId;
  if (!releaseId) {
    throw new Error(
      `track media processing lifecycle missing release_id: ${event.entityId}`,
    );
  }
  return {
    documentType: CollaborativeDocumentType.RELEASE,
    documentEntityId: releaseId,
    runtimeEntityType: "release",
    trackId: event.trackId || event.entityId,
    releaseId,
  };
}

function lifecycleStatusToRuntimeStatus(
  status: MediaProcessingStatus,
): MediaProcessingRuntimeStatus {
  const runtimeStatus = lifecycleRuntimeStatuses.get(status);
  if (!runtimeStatus) {
    throw new Error(`unsupported media processing lifecycle status: ${status}`);
  }
  return runtimeStatus;
}

const lifecycleRuntimeStatuses = new Map<
  MediaProcessingStatus,
  MediaProcessingRuntimeStatus
>([
  [MediaProcessingStatus.PROCESSING, "processing"],
  [MediaProcessingStatus.READY, "ready"],
  [MediaProcessingStatus.FAILED, "failed"],
]);

function outputsFromProto(
  outputs: MediaProcessingLifecycleOutputs,
): MediaProcessingRuntimeOutputs {
  return {
    spectrogramAssetId: outputs.spectrogramAssetId,
    thumbnailAssetId: outputs.thumbnailAssetId,
    hlsGenerationId: outputs.hlsGenerationId,
    durationSeconds: outputs.durationSeconds,
    waveformAssetId: outputs.waveformAssetId,
  };
}

function validateLifecycleShape(
  event: MediaProcessingLifecycleEvent,
  status: MediaProcessingRuntimeStatus,
): void {
  if (status === "processing" && event.percentage == null) {
    throw new Error(
      `processing media lifecycle missing percentage for file ${event.fileId}`,
    );
  }
  if (status !== "processing" && event.percentage != null) {
    throw new Error(
      `non-processing media lifecycle included percentage for file ${event.fileId}`,
    );
  }
  if (status === "ready" && !event.outputs) {
    throw new Error(
      `ready media lifecycle missing outputs for file ${event.fileId}`,
    );
  }
  if (status !== "ready" && event.outputs) {
    throw new Error(
      `non-ready media lifecycle included outputs for file ${event.fileId}`,
    );
  }
}

export function runtimeEventFromLifecycleProto(
  event: MediaProcessingLifecycleEvent,
): MediaProcessingLifecycleRuntimeEvent | null {
  const resolved = resolveLifecycleDocument(event);
  if (!resolved) {
    return null;
  }

  const status = lifecycleStatusToRuntimeStatus(event.status);
  validateLifecycleShape(event, status);

  return {
    version: 1,
    kind: "media.processing.lifecycle",
    entityType: resolved.runtimeEntityType,
    entityId: resolved.documentEntityId,
    correlationId: event.correlationId || undefined,
    sequence: Number(event.sequenceNumber),
    timestampMs: Number(event.timestampMs),
    payload: {
      fileId: event.fileId,
      slotId: event.slotId,
      attemptId: event.attemptId,
      status,
      percentage: status === "processing" ? event.percentage : undefined,
      outputs:
        status === "ready" && event.outputs
          ? outputsFromProto(event.outputs)
          : undefined,
      error: status === "failed" ? event.error : undefined,
      trackId: resolved.trackId,
      releaseId: resolved.releaseId,
    },
  };
}

/**
 * Start the media processing lifecycle subscriber for the collab server.
 *
 * Backend owns processing state and publishes aggregate `media.processing.lifecycle`
 * runtime events after it has persisted transcode/waveform progress. Collab validates and fans
 * those backend-owned events out to connected collaborative documents. Processing state and ready
 * outputs are not persisted into Y.Doc; late joiners fetch a backend runtime snapshot by media
 * identity.
 */
export async function startTranscodeSubscriber(server: Server): Promise<void> {
  await startSignalSubscriber(
    Signals.mediaProcessingLifecycle,
    async (content) => {
      const lifecycleEvent = deserializeProto<MediaProcessingLifecycleEvent>(
        MediaProcessingLifecycleEventSchema,
        content,
      );
      const runtimeEvent = runtimeEventFromLifecycleProto(lifecycleEvent);
      if (!runtimeEvent) {
        return;
      }

      const payload = JSON.stringify(runtimeEvent);
      const event = parseEditorRuntimeEventMessage(payload);
      if (!event || event.kind !== "media.processing.lifecycle") {
        throw new Error(
          "decoded media processing lifecycle failed runtime validation",
        );
      }

      const documentType = documentTypeFromRuntimeEntityType(event.entityType);
      if (!documentType) {
        throw new Error(
          `unsupported runtime media processing entity type: ${event.entityType}`,
        );
      }

      const broadcastCount = broadcastStatelessToEntityDocuments({
        documents: server.hocuspocus.documents,
        type: documentType,
        entityId: event.entityId,
        payload,
      });

      logger.debug(
        "Broadcasted backend media processing lifecycle to entity documents",
        {
          entityType: event.entityType,
          entityId: event.entityId,
          fileId: event.payload.fileId,
          status: event.payload.status,
          percentage: event.payload.percentage,
          broadcastCount,
        },
      );
    },
  );
}
