import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { deserializeProto, Signals } from "@echovisionlab/geul-event";
import {
  ContentEntityType,
  ContentUpdatedEventSchema,
  ContentUpdateSource,
  type ContentUpdatedEvent,
} from "@echovisionlab/geul-proto/secure/events_pb.ts";
import type { Server } from "@hocuspocus/server";
import {
  invalidateCanonicalEntityRooms,
  invalidateCanonicalRoom,
} from "../lib/collaboration/server.ts";
import { logger } from "../lib/logger.ts";
import { startSignalSubscriber } from "../lib/postgresql/messaging.ts";

const collaborativeDocumentTypes = new Map<
  ContentEntityType,
  CollaborativeDocumentType
>([
  [ContentEntityType.POST, CollaborativeDocumentType.POST],
  [ContentEntityType.PAGE, CollaborativeDocumentType.PAGE],
  [ContentEntityType.WORK, CollaborativeDocumentType.WORK],
  [ContentEntityType.ARTIST, CollaborativeDocumentType.ARTIST],
  [ContentEntityType.LABEL, CollaborativeDocumentType.LABEL],
  [ContentEntityType.RELEASE, CollaborativeDocumentType.RELEASE],
  [ContentEntityType.EMAIL_TEMPLATE, CollaborativeDocumentType.EMAIL_TEMPLATE],
  [ContentEntityType.EMAIL_LAYOUT, CollaborativeDocumentType.EMAIL_LAYOUT],
  [ContentEntityType.CAMPAIGN, CollaborativeDocumentType.CAMPAIGN],
  [ContentEntityType.FORM, CollaborativeDocumentType.FORM],
  [ContentEntityType.PRIVACY, CollaborativeDocumentType.PRIVACY_HISTORY],
  [ContentEntityType.TERMS, CollaborativeDocumentType.TERMS_HISTORY],
  [ContentEntityType.PROGRAM_EVENT, CollaborativeDocumentType.PROGRAM_EVENT],
  [ContentEntityType.MENU, CollaborativeDocumentType.MENU],
  [ContentEntityType.POST_SERIES, CollaborativeDocumentType.POST_SERIES],
]);

function requiredNonBlank(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Content updated ${field} is required`);
  }
  return normalized;
}

type ContentUpdateFence =
  | { scope: "entity"; documentRevision: string }
  | {
      scope: "locale";
      documentRevision: string;
      locale: string;
      localeExists: boolean;
      targetRevision?: string;
    };

function externalContentUpdateFence(
  event: ContentUpdatedEvent,
): ContentUpdateFence | undefined {
  if (event.source === ContentUpdateSource.COLLAB) {
    return undefined;
  }
  assertExternalContentUpdateSource(event.source);

  if (!hasLocaleTuple(event)) {
    return event.documentRevision === undefined
      ? undefined
      : {
          scope: "entity",
          documentRevision: requiredNonBlank(
            event.documentRevision,
            "document_revision",
          ),
        };
  }
  return localeContentUpdateFence(event);
}

function assertExternalContentUpdateSource(source: ContentUpdateSource): void {
  if (
    source !== ContentUpdateSource.MANAGE &&
    source !== ContentUpdateSource.SYSTEM &&
    source !== ContentUpdateSource.AI
  ) {
    throw new Error(`Unsupported content update source: ${source}`);
  }
}

function hasLocaleTuple(event: ContentUpdatedEvent): boolean {
  return (
    event.locale !== undefined ||
    event.localeExists !== undefined ||
    event.targetRevision !== undefined
  );
}

function localeContentUpdateFence(
  event: ContentUpdatedEvent,
): ContentUpdateFence {
  if (event.locale === undefined || event.localeExists === undefined) {
    throw new Error("Content updated locale tuple is incomplete");
  }
  if (event.documentRevision === undefined) {
    throw new Error(
      "Content updated document_revision is required for a locale update",
    );
  }
  const documentRevision = requiredNonBlank(
    event.documentRevision,
    "document_revision",
  );
  const locale = requiredNonBlank(event.locale, "locale");

  if (!event.localeExists) {
    return deletedTargetFence(event, documentRevision, locale);
  }

  if (event.targetRevision !== undefined) {
    return existingTargetFence(
      event,
      documentRevision,
      locale,
      event.targetRevision,
    );
  }

  return sourceLocaleFence(event, documentRevision);
}

function deletedTargetFence(
  event: ContentUpdatedEvent,
  documentRevision: string,
  locale: string,
): ContentUpdateFence {
  if (event.targetRevision !== undefined) {
    throw new Error(
      "Content updated deleted locale must not carry target_revision",
    );
  }
  if (event.documentStateChanged) {
    throw new Error(
      "Content updated target deletion must not advance the document revision",
    );
  }
  return {
    scope: "locale",
    documentRevision,
    locale,
    localeExists: false,
  };
}

function existingTargetFence(
  event: ContentUpdatedEvent,
  documentRevision: string,
  locale: string,
  targetRevision: string,
): ContentUpdateFence {
  if (event.documentStateChanged) {
    throw new Error(
      "Content updated target-only mutation must not advance the document revision",
    );
  }
  return {
    scope: "locale",
    documentRevision,
    locale,
    localeExists: true,
    targetRevision: requiredNonBlank(targetRevision, "target_revision"),
  };
}

function sourceLocaleFence(
  event: ContentUpdatedEvent,
  documentRevision: string,
): ContentUpdateFence {
  if (!event.documentStateChanged) {
    throw new Error(
      "Content updated source-locale mutation must advance the document revision",
    );
  }
  return { scope: "entity", documentRevision };
}

async function handleContentUpdated(
  server: Server,
  content: Uint8Array,
): Promise<void> {
  const event = deserializeProto<ContentUpdatedEvent>(
    ContentUpdatedEventSchema,
    content,
  );
  const documentType = collaborativeDocumentTypes.get(event.entityType);
  if (!documentType) {
    return;
  }
  const entityId = requiredNonBlank(event.entityId, "entity_id");
  const fence = externalContentUpdateFence(event);
  if (!fence) {
    return;
  }

  const invalidated =
    fence.scope === "locale"
      ? await invalidateCanonicalRoom(
          server,
          documentType,
          entityId,
          fence.locale,
        )
      : await invalidateCanonicalEntityRooms(server, documentType, entityId);
  const fields = {
    entityType: ContentEntityType[event.entityType],
    entityId,
    documentRevision: fence.documentRevision,
    ...(fence.scope === "locale"
      ? {
          locale: fence.locale,
          localeExists: fence.localeExists,
          targetRevision: fence.targetRevision,
        }
      : {}),
  };
  if (invalidated) {
    logger.info(
      "Invalidated locale-scoped collaboration rooms after authoritative update",
      fields,
    );
  } else {
    logger.debug("No resident locale room for authoritative update", fields);
  }
}

/** Fence every resident locale room after an out-of-room mutation. */
export async function startContentUpdatedSubscriber(
  server: Server,
): Promise<void> {
  await startSignalSubscriber(Signals.contentUpdated, (content) =>
    handleContentUpdated(server, content),
  );
}
