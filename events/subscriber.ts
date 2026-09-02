import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import {
  editorRuntimeEventSchema,
  type OgGenerationLifecycleRuntimeEvent,
  type OgGenerationRuntimeEntityType,
  type OgGenerationRuntimeStatus,
} from "@echovisionlab/geul-common/collaboration/runtime-events";
import {
  deserializeProto,
  Signals,
  OgEntityType,
  OgGenerationLifecycleEventSchema,
  OgGenerationStatus,
  type OgGenerationLifecycleEvent,
} from "@echovisionlab/geul-event";
import type { Server } from "@hocuspocus/server";
import {
  broadcastStatelessToDocumentType,
  broadcastStatelessToEntityDocuments,
} from "../lib/entity-document-broadcast.ts";
import { logger } from "../lib/logger.ts";
import { startSignalSubscriber } from "../lib/postgresql/messaging.ts";

interface CollaborativeOgTarget {
  documentType: CollaborativeDocumentType | null;
  entityType: OgGenerationRuntimeEntityType;
  routeScoped: boolean;
}

interface ResolvedOgTarget extends CollaborativeOgTarget {
  entityId: string;
  locale?: string;
}

const collaborativeOgTargets = new Map<OgEntityType, CollaborativeOgTarget>([
  [
    OgEntityType.POST,
    {
      documentType: CollaborativeDocumentType.POST,
      entityType: "post",
      routeScoped: false,
    },
  ],
  [
    OgEntityType.PAGE,
    {
      documentType: CollaborativeDocumentType.PAGE,
      entityType: "page",
      routeScoped: false,
    },
  ],
  [
    OgEntityType.WORK,
    {
      documentType: CollaborativeDocumentType.WORK,
      entityType: "work",
      routeScoped: false,
    },
  ],
  [
    OgEntityType.LABEL,
    {
      documentType: CollaborativeDocumentType.LABEL,
      entityType: "label",
      routeScoped: false,
    },
  ],
  [
    OgEntityType.ARTIST,
    {
      documentType: CollaborativeDocumentType.ARTIST,
      entityType: "artist",
      routeScoped: false,
    },
  ],
  [
    OgEntityType.RELEASE,
    {
      documentType: CollaborativeDocumentType.RELEASE,
      entityType: "release",
      routeScoped: false,
    },
  ],
  [
    OgEntityType.FORM,
    {
      documentType: CollaborativeDocumentType.FORM,
      entityType: "form",
      routeScoped: false,
    },
  ],
  [
    OgEntityType.PRIVACY,
    {
      documentType: CollaborativeDocumentType.PRIVACY_HISTORY,
      entityType: "privacy",
      routeScoped: true,
    },
  ],
  [
    OgEntityType.TERMS,
    {
      documentType: CollaborativeDocumentType.TERMS_HISTORY,
      entityType: "terms",
      routeScoped: true,
    },
  ],
  // Site and series recover lifecycle state through the canonical polling API.
  [
    OgEntityType.SITE,
    { documentType: null, entityType: "site", routeScoped: false },
  ],
  [
    OgEntityType.SERIES,
    { documentType: null, entityType: "series", routeScoped: false },
  ],
]);

function collaborativeOgTarget(
  entityType: OgEntityType,
): CollaborativeOgTarget {
  const target = collaborativeOgTargets.get(entityType);
  if (!target) {
    throw new Error(`Unsupported OG lifecycle entity type: ${entityType}`);
  }
  return target;
}

function requireNonBlank(value: string, field: string): string {
  if (!value.trim()) {
    throw new Error(`OG lifecycle ${field} is required`);
  }
  return value;
}

function optionalNonBlank(
  value: string | undefined,
  field: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNonBlank(value, field);
}

function resolveOgTarget(event: OgGenerationLifecycleEvent): ResolvedOgTarget {
  const target = event.target;
  if (!target) {
    throw new Error("OG lifecycle target is required");
  }
  const mapped = collaborativeOgTarget(target.entityType);
  const entityId = requireNonBlank(target.entityId, "target.entity_id");

  switch (target.scope.case) {
    case "entity":
      return { ...mapped, entityId };
    case "locale":
      return {
        ...mapped,
        entityId,
        locale: requireNonBlank(target.scope.value.locale, "target.locale"),
      };
    case undefined:
      throw new Error("OG lifecycle target scope is required");
  }
}

function lifecycleRuntimeStatus(
  status: OgGenerationStatus,
): OgGenerationRuntimeStatus {
  switch (status) {
    case OgGenerationStatus.QUEUED:
      return "queued";
    case OgGenerationStatus.PROCESSING:
      return "processing";
    case OgGenerationStatus.READY:
      return "ready";
    case OgGenerationStatus.FAILED:
      return "failed";
    case OgGenerationStatus.SUPERSEDED:
      return "superseded";
    case OgGenerationStatus.CANCELLED:
      return "cancelled";
    case OgGenerationStatus.UNSPECIFIED:
    default:
      throw new Error(`Unsupported OG lifecycle status: ${status}`);
  }
}

function occurredAtMilliseconds(event: OgGenerationLifecycleEvent): number {
  const occurredAt = event.occurredAt;
  if (!occurredAt) {
    throw new Error("OG lifecycle occurred_at is required");
  }
  if (
    !Number.isInteger(occurredAt.nanos) ||
    occurredAt.nanos < 0 ||
    occurredAt.nanos > 999_999_999
  ) {
    throw new Error("OG lifecycle occurred_at nanos are invalid");
  }
  const milliseconds =
    occurredAt.seconds * 1_000n +
    BigInt(Math.floor(occurredAt.nanos / 1_000_000));
  const value = Number(milliseconds);
  if (!Number.isSafeInteger(value)) {
    throw new Error("OG lifecycle occurred_at is outside the supported range");
  }
  return value;
}

function runtimeAsset(
  event: OgGenerationLifecycleEvent,
  status: OgGenerationRuntimeStatus,
): { assetId?: string; assetUrl?: string } {
  if (!event.asset) {
    return {};
  }
  if (status !== "ready") {
    throw new Error(`OG lifecycle ${status} event must not include an asset`);
  }
  const assetId = requireNonBlank(event.asset.assetId, "asset.asset_id");
  const assetUrl = event.asset.url.trim() ? event.asset.url : undefined;
  return {
    assetId,
    ...(assetUrl ? { assetUrl } : {}),
  };
}

function toRuntimeEvent(
  event: OgGenerationLifecycleEvent,
  target: ResolvedOgTarget,
): OgGenerationLifecycleRuntimeEvent {
  const generationId = requireNonBlank(event.generationId, "generation_id");
  const runId = requireNonBlank(event.runId, "run_id");
  const status = lifecycleRuntimeStatus(event.status);
  const errorCode = optionalNonBlank(event.errorCode, "error_code");
  const error = optionalNonBlank(event.error, "error");
  const replacementGenerationId = optionalNonBlank(
    event.replacementGenerationId,
    "replacement_generation_id",
  );
  const asset = runtimeAsset(event, status);
  const runtimeEvent: OgGenerationLifecycleRuntimeEvent = {
    version: 1,
    kind: "og.lifecycle",
    entityType: target.entityType,
    entityId: target.entityId,
    ...(target.locale ? { locale: target.locale } : {}),
    correlationId: generationId,
    timestampMs: occurredAtMilliseconds(event),
    payload: {
      generationId,
      runId,
      status,
      ...asset,
      ...(errorCode ? { errorCode } : {}),
      ...(error ? { error } : {}),
      ...(replacementGenerationId ? { replacementGenerationId } : {}),
    },
  };

  editorRuntimeEventSchema.parse(runtimeEvent);
  return runtimeEvent;
}

/** Relay reconstructable OG lifecycle signals to connected editors. */
export async function startEventSubscriber(server: Server): Promise<void> {
  await startSignalSubscriber(Signals.ogLifecycle, async (content) => {
    const event = deserializeProto<OgGenerationLifecycleEvent>(
      OgGenerationLifecycleEventSchema,
      content,
    );
    const target = resolveOgTarget(event);
    const runtimeEvent = toRuntimeEvent(event, target);

    logger.info("Received OG lifecycle event", {
      generationId: event.generationId,
      runId: event.runId,
      entityType: target.entityType,
      entityId: target.entityId,
      locale: target.locale,
      status: runtimeEvent.payload.status,
    });

    if (target.documentType === null) {
      logger.debug(
        "Skipping OG lifecycle broadcast - Web polling owns this entity",
        {
          entityType: target.entityType,
          entityId: target.entityId,
        },
      );
      return;
    }

    const payload = JSON.stringify(runtimeEvent);
    const broadcastCount = target.routeScoped
      ? broadcastStatelessToDocumentType({
          documents: server.hocuspocus.documents,
          type: target.documentType,
          payload,
        })
      : broadcastStatelessToEntityDocuments({
          documents: server.hocuspocus.documents,
          type: target.documentType,
          entityId: target.entityId,
          payload,
        });

    if (broadcastCount > 0) {
      logger.info("Broadcasted OG lifecycle event to entity documents", {
        generationId: event.generationId,
        entityId: target.entityId,
        locale: target.locale,
        status: runtimeEvent.payload.status,
        broadcastCount,
      });
    } else {
      logger.debug("No connected entity documents for OG lifecycle event", {
        generationId: event.generationId,
        entityId: target.entityId,
        locale: target.locale,
        status: runtimeEvent.payload.status,
      });
    }
  });
}
