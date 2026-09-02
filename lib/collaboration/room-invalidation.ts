import {
  createDocumentName,
  parseDocumentName,
  type CollaborativeDocumentType,
} from "@echovisionlab/geul-common/collaboration/document";
import type { Server } from "@hocuspocus/server";
import type * as Y from "yjs";
import type {
  EditSessionContributorTracker,
  EditSessionDocumentLike,
} from "./edit-session-contributors.ts";
import type { MetadataAiReconnectGrace } from "./metadata-ai-reconnect-grace.ts";
import type { RevisionConflictGuard } from "./revision-conflict-guard.ts";

type TrackedCollabDocument = Y.Doc & EditSessionDocumentLike;

export interface RoomInvalidation {
  invalidate(
    type: CollaborativeDocumentType,
    entityId: string,
    locale: string,
  ): Promise<boolean>;
  invalidateEntity(
    type: CollaborativeDocumentType,
    entityId: string,
  ): Promise<boolean>;
  invalidateEntityExcept(
    type: CollaborativeDocumentType,
    entityId: string,
    preservedDocumentName: string,
  ): Promise<boolean>;
  settleConnected(
    documentName: string,
    document: TrackedCollabDocument,
  ): Promise<void>;
  clearPending(documentName: string): void;
}

const roomInvalidators = new WeakMap<Server, RoomInvalidation>();

export function registerRoomInvalidation(
  server: Server,
  invalidation: RoomInvalidation,
): void {
  roomInvalidators.set(server, invalidation);
}

export function roomInvalidationFor(
  server: Server,
): RoomInvalidation | undefined {
  return roomInvalidators.get(server);
}

export async function invalidateCanonicalRoom(
  server: Server,
  type: CollaborativeDocumentType,
  entityId: string,
  locale: string,
): Promise<boolean> {
  return (
    (await roomInvalidationFor(server)?.invalidate(type, entityId, locale)) ??
    false
  );
}

export async function invalidateCanonicalEntityRooms(
  server: Server,
  type: CollaborativeDocumentType,
  entityId: string,
): Promise<boolean> {
  return (
    (await roomInvalidationFor(server)?.invalidateEntity(type, entityId)) ??
    false
  );
}

export function createRoomInvalidation(
  server: Server,
  ownedDocuments: ReadonlyMap<string, TrackedCollabDocument>,
  revisionConflicts: RevisionConflictGuard,
  metadataAiGrace: MetadataAiReconnectGrace,
  editSessions: EditSessionContributorTracker<TrackedCollabDocument>,
): RoomInvalidation {
  const pendingLoads = new Set<string>();
  const invalidateDocument = async (documentName: string): Promise<boolean> => {
    if (server.hocuspocus.loadingDocuments.has(documentName)) {
      pendingLoads.add(documentName);
      revisionConflicts.fencePendingLoad(documentName);
      return true;
    }
    const document =
      server.hocuspocus.documents.get(documentName) ??
      ownedDocuments.get(documentName);
    if (!document) return false;
    revisionConflicts.requireReload(
      "authoritative_document_changed",
      documentName,
      document,
    );
    metadataAiGrace.invalidate(document);
    await editSessions.resourceInvalidated(documentName);
    return true;
  };
  const invalidateEntityExcept = async (
    type: CollaborativeDocumentType,
    entityId: string,
    preservedDocumentName?: string,
  ): Promise<boolean> => {
    const names = new Set([
      ...server.hocuspocus.loadingDocuments.keys(),
      ...server.hocuspocus.documents.keys(),
      ...ownedDocuments.keys(),
    ]);
    let invalidated = false;
    for (const documentName of names) {
      if (documentName === preservedDocumentName) continue;
      let scope;
      try {
        scope = parseDocumentName(documentName);
      } catch {
        continue;
      }
      if (scope.type !== type || scope.entityId !== entityId) continue;
      invalidated = (await invalidateDocument(documentName)) || invalidated;
    }
    return invalidated;
  };
  return {
    invalidate(type, entityId, locale) {
      return invalidateDocument(createDocumentName(type, entityId, locale));
    },
    invalidateEntity: (type, entityId) =>
      invalidateEntityExcept(type, entityId),
    invalidateEntityExcept,
    async settleConnected(documentName, document) {
      if (!pendingLoads.delete(documentName)) return;
      metadataAiGrace.invalidate(document);
      await editSessions.resourceInvalidated(documentName);
    },
    clearPending(documentName) {
      pendingLoads.delete(documentName);
    },
  };
}
