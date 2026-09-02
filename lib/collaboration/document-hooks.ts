import {
  CollaborativeDocumentType,
  parseDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import type {
  Connection,
  Document as HocuspocusDocument,
  ServerConfiguration,
  afterUnloadDocumentPayload,
  beforeUnloadDocumentPayload,
  onChangePayload,
  onLoadDocumentPayload,
  onStatelessPayload,
  onStoreDocumentPayload,
} from "@hocuspocus/server";
import * as Y from "yjs";
import { handlers } from "../../handlers/index.ts";
import { createCollaborationPrincipal } from "../api/collaboration.ts";
import { isCanonicalSession } from "./admission.ts";
import { sanitizeDurableMediaState } from "../durable-media-guard.ts";
import { logger } from "../logger.ts";
import { clearTransientDocumentState } from "../transient-document-state.ts";
import {
  EditSessionEntityDeletedError,
  type EditSessionDocumentLike,
} from "./edit-session-contributors.ts";
import type { MetadataAiReconnectGrace } from "./metadata-ai-reconnect-grace.ts";
import type { RevisionConflictGuard } from "./revision-conflict-guard.ts";
import {
  type ShutdownConnectionDrain,
  shutdownSocketAdmissionScopeFromContext,
} from "./shutdown-connection-drain.ts";
import { shutdownAdmissionFromContext } from "./connection-context.ts";
import { errorMessage } from "./error-message.ts";
import type { BlockRoomProtocol } from "./block-room-protocol.ts";
import type { CollabConnectionContext } from "./connection-context.ts";
import type { RoomEpochRegistry } from "./room-epoch.ts";
import type { RoomOwnership } from "./room-ownership.ts";
import {
  residentBlockDocumentType,
  type ResidentBlockRuntime,
} from "./resident-block-runtime.ts";

type TrackedDocument = Y.Doc & EditSessionDocumentLike;

type DocumentUnloadDeferralReason =
  "edit_session_active" | "metadata_ai_reconnect_grace";

class DocumentUnloadDeferredError extends Error {
  constructor(readonly reason: DocumentUnloadDeferralReason) {
    // Hocuspocus treats a rejected beforeUnloadDocument hook as an unload
    // veto, but logs every rejection with a truthy message to stderr. Keep
    // this expected control signal typed and message-less so it is not
    // reported as an application failure.
    super();
    this.name = "DocumentUnloadDeferredError";
  }
}

function applyLoadedState(document: Y.Doc, state: Uint8Array | null): void {
  if (!state) {
    return;
  }
  const sanitizedState = sanitizeDurableMediaState(state).state;
  if (sanitizedState.length > 0) {
    Y.applyUpdate(document, sanitizedState);
  }
}

function logDiscardedDeletedDocument(documentName: string): void {
  const scope = parseDocumentName(documentName);
  logger.info("Discarded deleted collaboration document", {
    reason: "entity_deleted",
    document_type: CollaborativeDocumentType[scope.type],
    entity_id: scope.entityId,
    locale: scope.locale,
  });
}

interface DocumentHookDependencies {
  editSessions(): {
    persist(documentName: string, document: TrackedDocument): Promise<unknown>;
    recordAcceptedChange(change: {
      documentName: string;
      connection?: unknown;
      context?: unknown;
      transactionOrigin?: unknown;
    }): boolean;
    preventsUnload(documentName: string): boolean;
    documentUnloaded(documentName: string): void;
  };
  metadataAiGrace: MetadataAiReconnectGrace;
  revisionConflicts: RevisionConflictGuard;
  shutdownConnections: ShutdownConnectionDrain<Connection>;
  roomEpochs: RoomEpochRegistry;
  residentBlocks: ResidentBlockRuntime;
  blockRooms: BlockRoomProtocol;
  roomOwnership: RoomOwnership;
  ownedDocuments: Map<string, TrackedDocument>;
  clearPendingRoomInvalidation(documentName: string): void;
}

function requireLoadPrincipal(context: unknown) {
  const sessionId =
    typeof context === "object" && context !== null
      ? (context as CollabConnectionContext).sessionId
      : undefined;
  if (!isCanonicalSession(sessionId)) {
    throw new Error("collaboration_session_required");
  }
  return createCollaborationPrincipal(sessionId);
}

function requestIdFromPayload(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { requestId?: unknown };
    return typeof parsed.requestId === "string" ? parsed.requestId : "";
  } catch {
    return "";
  }
}

function assertPersistAllowed(connection: Connection): void {
  const context = connection.context as CollabConnectionContext | undefined;
  if (!context || context.canEdit === false) {
    throw new Error("permission_denied");
  }
  if (
    context?.blockRoomAdmissionState &&
    context.blockRoomAdmissionState !== "accepted"
  ) {
    throw new Error("reload_required");
  }
}

function assertLoadedRoomOwned(
  dependencies: DocumentHookDependencies,
  documentName: string,
  document: Y.Doc,
): void {
  if (
    !dependencies.roomOwnership.isOwned(documentName) ||
    dependencies.revisionConflicts.isStale(document) ||
    dependencies.revisionConflicts.fencedDocumentNames.has(documentName)
  ) {
    throw new Error("room_ownership_lost");
  }
}

async function handleStateless(
  dependencies: DocumentHookDependencies,
  { connection, documentName, document, payload }: onStatelessPayload,
): Promise<void> {
  try {
    if (
      await dependencies.blockRooms.handleStateless({
        connection,
        documentName,
        document,
        payload,
      })
    ) {
      return;
    }
    const parsed = JSON.parse(payload) as { kind?: string; requestId?: string };
    if (parsed.kind === "persist.now.request" && parsed.requestId) {
      assertPersistAllowed(connection);
      await dependencies
        .editSessions()
        .persist(documentName, document as TrackedDocument);
      connection.sendStateless(
        JSON.stringify({
          kind: "persist.now.ack",
          requestId: parsed.requestId,
          ok: true,
        }),
      );
    }
  } catch (error) {
    if (
      dependencies.revisionConflicts.handle(
        error,
        documentName,
        document as Y.Doc & { getConnections(): Iterable<Connection> },
      )
    ) {
      return;
    }
    logger.error("Failed to process stateless collab command", {
      documentName,
      error: errorMessage(error),
    });
    connection.sendStateless(
      JSON.stringify({
        kind: "persist.now.ack",
        requestId: requestIdFromPayload(payload),
        ok: false,
        error: errorMessage(error),
      }),
    );
  }
}

async function handleChange(
  dependencies: DocumentHookDependencies,
  { documentName, connection, context, transactionOrigin }: onChangePayload,
): Promise<void> {
  const collaborationContext = context as CollabConnectionContext | undefined;
  if (collaborationContext?.canEdit === false) {
    return;
  }
  dependencies.editSessions().recordAcceptedChange({
    documentName,
    connection,
    context,
    transactionOrigin,
  });
}

async function handleStore(
  dependencies: DocumentHookDependencies,
  { documentName, document }: onStoreDocumentPayload,
): Promise<void> {
  if (dependencies.revisionConflicts.isStale(document)) {
    return;
  }
  try {
    await dependencies
      .editSessions()
      .persist(documentName, document as TrackedDocument);
  } catch (error) {
    if (
      dependencies.revisionConflicts.handle(
        error,
        documentName,
        document as Y.Doc & { getConnections(): Iterable<Connection> },
      )
    ) {
      return;
    }
    if (error instanceof EditSessionEntityDeletedError) {
      logDiscardedDeletedDocument(documentName);
      return;
    }
    logger.error("Error in onStoreDocument", {
      documentName,
      error: errorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

async function handleLoad(
  dependencies: DocumentHookDependencies,
  { documentName, document, context }: onLoadDocumentPayload,
): Promise<HocuspocusDocument> {
  let ownsRoom = false;
  let releaseError: unknown;
  try {
    const { type, entityId, locale } = parseDocumentName(documentName);
    dependencies.ownedDocuments.set(documentName, document as TrackedDocument);
    await dependencies.roomOwnership.acquire(documentName);
    ownsRoom = true;
    if (residentBlockDocumentType(type)) {
      await dependencies.residentBlocks.load(
        documentName,
        document,
        requireLoadPrincipal(context),
      );
    } else {
      const yjsState = await handlers[type].load(documentName);
      applyLoadedState(document, yjsState);
      logger.debug("Loaded locale-scoped collaboration document", {
        document_type: CollaborativeDocumentType[type],
        entity_id: entityId,
        locale,
      });
    }
    assertLoadedRoomOwned(dependencies, documentName, document);
    dependencies.metadataAiGrace.loaded(document);
    return document;
  } catch (error) {
    if (ownsRoom) {
      try {
        await dependencies.roomOwnership.release(documentName);
      } catch (ownershipReleaseError) {
        releaseError = ownershipReleaseError;
      }
    }
    dependencies.ownedDocuments.delete(documentName);
    dependencies.residentBlocks.unload(documentName);
    dependencies.clearPendingRoomInvalidation(documentName);
    dependencies.roomEpochs.retire(documentName);
    clearTransientDocumentState(documentName);
    dependencies.revisionConflicts.unfence(documentName);
    const admission = shutdownAdmissionFromContext(context);
    const socketAdmission =
      shutdownSocketAdmissionScopeFromContext<Connection>(context);
    if (socketAdmission) {
      socketAdmission.releaseAdmission(admission);
    } else {
      dependencies.shutdownConnections.releaseAdmission(admission);
    }
    logger.error("Error in onLoadDocument", {
      documentName,
      error: errorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
      ownership_release_error: releaseError
        ? errorMessage(releaseError)
        : undefined,
    });
    throw error;
  }
}

async function handleBeforeUnload(
  dependencies: DocumentHookDependencies,
  { documentName, document }: beforeUnloadDocumentPayload,
): Promise<void> {
  if (dependencies.editSessions().preventsUnload(documentName)) {
    throw new DocumentUnloadDeferredError("edit_session_active");
  }
  if (dependencies.metadataAiGrace.preventsUnload(document)) {
    throw new DocumentUnloadDeferredError("metadata_ai_reconnect_grace");
  }
}

async function handleAfterUnload(
  dependencies: DocumentHookDependencies,
  { documentName }: afterUnloadDocumentPayload,
): Promise<void> {
  try {
    dependencies.editSessions().documentUnloaded(documentName);
    clearTransientDocumentState(documentName);
    dependencies.residentBlocks.unload(documentName);
    dependencies.roomEpochs.retire(documentName);
    await dependencies.roomOwnership.release(documentName);
  } finally {
    dependencies.ownedDocuments.delete(documentName);
    dependencies.revisionConflicts.unfence(documentName);
  }
}

export function createDocumentHooks(dependencies: DocumentHookDependencies) {
  return {
    onStateless: (payload: onStatelessPayload) =>
      handleStateless(dependencies, payload),
    onChange: (payload: onChangePayload) => handleChange(dependencies, payload),
    onStoreDocument: (payload: onStoreDocumentPayload) =>
      handleStore(dependencies, payload),
    onLoadDocument: (payload: onLoadDocumentPayload) =>
      handleLoad(dependencies, payload),
    beforeUnloadDocument: (payload: beforeUnloadDocumentPayload) =>
      handleBeforeUnload(dependencies, payload),
    afterUnloadDocument: (payload: afterUnloadDocumentPayload) =>
      handleAfterUnload(dependencies, payload),
  } satisfies Partial<ServerConfiguration>;
}
