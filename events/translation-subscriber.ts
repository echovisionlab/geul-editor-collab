import {
  CollaborativeDocumentType,
  type RuntimeEntityType,
} from "@echovisionlab/geul-common";
import {
  deserializeProto,
  Signals,
  TranslationLifecycleEventSchema,
  type TranslationLifecycleEvent,
} from "@echovisionlab/geul-event";
import {
  TranslationEntityType,
  TranslationFailureReason,
} from "@echovisionlab/geul-proto/secure/translation_pb.ts";
import { TranslationLifecycleStatus } from "@echovisionlab/geul-proto/secure/events_pb.ts";
import type { Server } from "@hocuspocus/server";
import { broadcastStatelessToLocaleDocument } from "../lib/entity-document-broadcast.ts";
import { logger } from "../lib/logger.ts";
import { startSignalSubscriber } from "../lib/postgresql/messaging.ts";

interface TranslationDocumentTarget {
  documentType: CollaborativeDocumentType | null;
  entityType: RuntimeEntityType;
}

const translationDocumentTargets = new Map<
  TranslationEntityType,
  TranslationDocumentTarget
>([
  [
    TranslationEntityType.PAGE,
    { documentType: CollaborativeDocumentType.PAGE, entityType: "page" },
  ],
  [
    TranslationEntityType.POST,
    { documentType: CollaborativeDocumentType.POST, entityType: "post" },
  ],
  [
    TranslationEntityType.WORK,
    { documentType: CollaborativeDocumentType.WORK, entityType: "work" },
  ],
  [TranslationEntityType.MENU, { documentType: null, entityType: "menu" }],
  [
    TranslationEntityType.ARTIST,
    { documentType: CollaborativeDocumentType.ARTIST, entityType: "artist" },
  ],
  [
    TranslationEntityType.LABEL,
    { documentType: CollaborativeDocumentType.LABEL, entityType: "label" },
  ],
  [
    TranslationEntityType.RELEASE,
    { documentType: CollaborativeDocumentType.RELEASE, entityType: "release" },
  ],
  [
    TranslationEntityType.EMAIL_TEMPLATE,
    {
      documentType: CollaborativeDocumentType.EMAIL_TEMPLATE,
      entityType: "email_template",
    },
  ],
  [
    TranslationEntityType.EMAIL_LAYOUT,
    {
      documentType: CollaborativeDocumentType.EMAIL_LAYOUT,
      entityType: "email_layout",
    },
  ],
  [
    TranslationEntityType.PRIVACY,
    {
      documentType: CollaborativeDocumentType.PRIVACY_HISTORY,
      entityType: "privacy",
    },
  ],
  [
    TranslationEntityType.TERMS,
    {
      documentType: CollaborativeDocumentType.TERMS_HISTORY,
      entityType: "terms",
    },
  ],
  [
    TranslationEntityType.CAMPAIGN,
    {
      documentType: CollaborativeDocumentType.CAMPAIGN,
      entityType: "campaign",
    },
  ],
  [
    TranslationEntityType.FORM,
    { documentType: CollaborativeDocumentType.FORM, entityType: "form" },
  ],
  [
    TranslationEntityType.PROGRAM_EVENT,
    {
      documentType: CollaborativeDocumentType.PROGRAM_EVENT,
      entityType: "program_event",
    },
  ],
  [
    TranslationEntityType.POST_SERIES,
    { documentType: null, entityType: "series" },
  ],
]);

function translationDocumentTarget(
  entityType: TranslationEntityType,
): TranslationDocumentTarget | null {
  return translationDocumentTargets.get(entityType) ?? null;
}

const translationFailureReasonRuntimeErrors = new Map<number, string>([
  [TranslationFailureReason.PROVIDER_CONFIGURATION, "provider_configuration"],
  [TranslationFailureReason.PROVIDER_AUTHENTICATION, "provider_authentication"],
  [TranslationFailureReason.PROVIDER_RATE_LIMITED, "provider_rate_limited"],
  [TranslationFailureReason.PROVIDER_UNAVAILABLE, "provider_unavailable"],
  [TranslationFailureReason.PROVIDER_REJECTED, "provider_rejected"],
  [
    TranslationFailureReason.PROVIDER_RESPONSE_INVALID,
    "provider_response_invalid",
  ],
  [TranslationFailureReason.TARGET_APPLY_FAILED, "target_apply_failed"],
  [TranslationFailureReason.OG_HANDOFF_FAILED, "og_handoff_failed"],
  [TranslationFailureReason.INTERNAL, "internal"],
]);

function translationFailureReasonToRuntimeError(reason: number): string {
  return (
    translationFailureReasonRuntimeErrors.get(reason) ?? "translation_failed"
  );
}

function translationLifecyclePayload(
  event: TranslationLifecycleEvent,
  target: TranslationDocumentTarget,
): string {
  const runtimeError = translationFailureReasonToRuntimeError(
    event.failureReason,
  );

  return JSON.stringify({
    version: 1,
    kind: "translation.lifecycle",
    entityType: target.entityType,
    entityId: event.entityId,
    locale: event.targetLocale,
    correlationId: event.jobId,
    timestampMs: Number(event.timestampMs),
    payload: {
      jobId: event.jobId,
      targetLocale: event.targetLocale,
      status: "failed",
      error: runtimeError,
    },
  });
}

async function handleTranslationMessage(
  server: Server,
  content: Uint8Array,
): Promise<void> {
  const event = deserializeProto<TranslationLifecycleEvent>(
    TranslationLifecycleEventSchema,
    content,
  );
  const target = translationDocumentTarget(event.entityType);
  if (!target) {
    return;
  }

  if (event.status === TranslationLifecycleStatus.APPLIED) {
    logger.debug("Observed applied translation lifecycle hint", {
      status: "applied",
      entityType: target.entityType,
      entityId: event.entityId,
      targetLocale: event.targetLocale,
      jobId: event.jobId,
    });
    return;
  }
  if (event.status !== TranslationLifecycleStatus.FAILED) {
    throw new Error(
      `Unsupported translation lifecycle status: ${event.status}`,
    );
  }

  const payload = translationLifecyclePayload(event, target);
  const broadcastCount = target.documentType
    ? broadcastStatelessToLocaleDocument({
        documents: server.hocuspocus.documents,
        type: target.documentType,
        entityId: event.entityId,
        locale: event.targetLocale,
        payload,
      })
    : 0;
  logger.debug("Broadcasted exact translation locale failure", {
    status: "failed",
    entityType: target.entityType,
    entityId: event.entityId,
    targetLocale: event.targetLocale,
    jobId: event.jobId,
    broadcastCount,
  });
}

export async function startTranslationSubscriber(
  server: Server,
): Promise<void> {
  await startSignalSubscriber(Signals.translationLifecycle, (content) =>
    handleTranslationMessage(server, content),
  );
}
