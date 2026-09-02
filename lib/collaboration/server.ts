import { parseDocumentName } from "@echovisionlab/geul-common/collaboration/document";
import { type Connection, Server } from "@hocuspocus/server";
import * as Y from "yjs";
import { env } from "../../env.ts";
import { withShutdownTimeout } from "./shutdown-timeout.ts";
import { handlers } from "../../handlers/index.ts";
import {
  CollaborationConflictError,
  CollaborationResourceNotFoundError,
} from "../api/transport.ts";
import { createAuthenticationHook } from "./authentication.ts";
import { type CollabConnectionContext } from "./connection-context.ts";
import {
  loadCollaborativeDocument,
  persistCollaborativeDocument,
  withCollaborativeDocumentPersistenceQueue,
} from "./document-persistence.ts";
import { logger } from "../logger.ts";
import { emitTerminalCollaborationCheckpointFailure } from "../system-logging.ts";
import { MetadataAiReconnectGrace } from "./metadata-ai-reconnect-grace.ts";
import {
  EditSessionContributorTracker,
  type EditSessionDocumentLike,
} from "./edit-session-contributors.ts";
import type { EditSessionContributorTrackerOptions } from "./edit-session-contributor-types.ts";
import {
  bindShutdownAdmissionsToHocuspocus,
  ShutdownConnectionDrain,
} from "./shutdown-connection-drain.ts";
import { RevisionConflictGuard } from "./revision-conflict-guard.ts";
import {
  createConnectionHooks,
  signalPermissionRevoked,
} from "./connection-hooks.ts";
import { createDocumentHooks } from "./document-hooks.ts";
import { RoomEpochRegistry } from "./room-epoch.ts";
import {
  residentBlockDocumentType,
  ResidentBlockRuntime,
} from "./resident-block-runtime.ts";
import { BlockRoomProtocol } from "./block-room-protocol.ts";
import { PostgresRoomOwnership, type RoomOwnership } from "./room-ownership.ts";
import {
  createRoomInvalidation,
  registerRoomInvalidation,
  type RoomInvalidation,
} from "./room-invalidation.ts";
import { registerInteractiveMutationRuntime } from "./interactive-mutation-server.ts";

export {
  invalidateCanonicalEntityRooms,
  invalidateCanonicalRoom,
} from "./room-invalidation.ts";

type TrackedCollabDocument = Y.Doc & EditSessionDocumentLike;

const editSessionTrackers = new WeakMap<
  Server,
  EditSessionContributorTracker<TrackedCollabDocument>
>();
const shutdownConnectionDrains = new WeakMap<
  Server,
  ShutdownConnectionDrain<Connection>
>();
const metadataAiReconnectGrace = new WeakMap<
  Server,
  MetadataAiReconnectGrace
>();
const roomOwnerships = new WeakMap<Server, RoomOwnership>();

function fenceCheckpointConflict(
  guard: RevisionConflictGuard,
  tracker: EditSessionContributorTracker<TrackedCollabDocument>,
  entityDocumentName: string,
  error: unknown,
): void {
  guard.handleEntity(
    error,
    entityDocumentName,
    tracker.documentsForEntity(entityDocumentName),
  );
}

export interface CollabServerOptions {
  roomEpochs?: RoomEpochRegistry;
  residentBlocks?: ResidentBlockRuntime;
  roomOwnership?: RoomOwnership;
  metadataAiGrace?: MetadataAiReconnectGrace;
}

function residentPersistenceOptions(
  residentBlocks: ResidentBlockRuntime,
  revisionConflicts: RevisionConflictGuard,
): Pick<
  EditSessionContributorTrackerOptions<TrackedCollabDocument>,
  "persistDocument" | "withPersistenceQueue"
> {
  const assertWritable = (
    documentName: string,
    document: TrackedCollabDocument,
  ) => {
    if (
      revisionConflicts.isStale(document) ||
      revisionConflicts.fencedDocumentNames.has(documentName)
    ) {
      throw new CollaborationConflictError(
        "document_revision_changed",
        "room_ownership_lost",
      );
    }
  };
  return {
    persistDocument: async (documentName, document, options, queueKey) => {
      assertWritable(documentName, document);
      return await (residentBlockDocumentType(
        parseDocumentName(documentName).type,
      )
        ? residentBlocks.persistEditSession(documentName, document, options)
        : persistCollaborativeDocument(
            documentName,
            document,
            options,
            queueKey,
          ));
    },
    withPersistenceQueue: (queueKey, operation) => {
      const type = residentBlockDocumentType(parseDocumentName(queueKey).type);
      const guardedOperation = (
        persistDocument: Parameters<typeof operation>[0],
      ) =>
        operation(async (documentName, document, options) => {
          assertWritable(documentName, document);
          return await persistDocument(documentName, document, options);
        });
      return type
        ? residentBlocks.withPersistenceQueue(queueKey, guardedOperation)
        : withCollaborativeDocumentPersistenceQueue(queueKey, guardedOperation);
    },
  };
}

function createRoomOwnership(
  configured: RoomOwnership | undefined,
  serverRef: { current?: Server },
  ownedDocuments: ReadonlyMap<string, TrackedCollabDocument>,
  revisionConflicts: RevisionConflictGuard,
): RoomOwnership {
  return (
    configured ??
    new PostgresRoomOwnership((documentNames) => {
      for (const documentName of documentNames) {
        try {
          const document =
            ownedDocuments.get(documentName) ??
            serverRef.current?.hocuspocus.documents.get(documentName);
          if (!document) continue;
          revisionConflicts.requireReload(
            "room_ownership_lost",
            documentName,
            document,
          );
        } catch (error) {
          logger.error(
            "Failed to fence collaboration room after ownership loss",
            {
              reason: "room_ownership_fence_failed",
              documentName,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
      }
    })
  );
}

function createBlockRoomProtocol(
  roomEpochs: RoomEpochRegistry,
  residentBlocks: ResidentBlockRuntime,
  revisionConflicts: RevisionConflictGuard,
  getEditSessions: () => EditSessionContributorTracker<TrackedCollabDocument>,
): BlockRoomProtocol {
  return new BlockRoomProtocol({
    roomEpochs,
    residentBlocks,
    isDocumentFenced: (documentName) =>
      revisionConflicts.fencedDocumentNames.has(documentName),
    fenceDocument: (error, documentName, document) => {
      revisionConflicts.handle(
        error,
        documentName,
        document as Parameters<RevisionConflictGuard["handle"]>[2],
      );
    },
    deleteEntity: (entityDocumentName) =>
      getEditSessions().resourceDeleted(entityDocumentName),
    recordAcceptedMetadataChange: (documentName, authenticatedMemberId) => {
      getEditSessions().recordAcceptedStatelessChange(
        documentName,
        authenticatedMemberId,
      );
    },
  });
}

function createEditSessionTracker(
  server: Server,
  residentBlocks: ResidentBlockRuntime,
  revisionConflicts: RevisionConflictGuard,
  getEditSessions: () => EditSessionContributorTracker<TrackedCollabDocument>,
): EditSessionContributorTracker<TrackedCollabDocument> {
  return new EditSessionContributorTracker<TrackedCollabDocument>({
    listDocuments: () =>
      server.hocuspocus.documents as unknown as Map<
        string,
        TrackedCollabDocument
      >,
    loadDocument: (documentName) =>
      loadCollaborativeDocument(
        documentName,
      ) as Promise<TrackedCollabDocument | null>,
    ...residentPersistenceOptions(residentBlocks, revisionConflicts),
    unloadDocument: (document) =>
      server.hocuspocus.unloadDocument(document as never),
    supportsVersionCheckpoints: (type) =>
      residentBlockDocumentType(type) !== undefined ||
      handlers[type]?.supportsVersionCheckpoints === true,
    isEntityDeleted: (entityDocumentName, error) => {
      const scope = parseDocumentName(entityDocumentName);
      return (
        error instanceof CollaborationResourceNotFoundError &&
        scope.type === error.documentType &&
        scope.entityId === error.resourceId
      );
    },
    onEntityDeleted: (entityDocumentName) => {
      const deletedScope = parseDocumentName(entityDocumentName);
      for (const [connectedDocumentName, document] of server.hocuspocus
        .documents) {
        const connectedScope = parseDocumentName(connectedDocumentName);
        if (
          connectedScope.type !== deletedScope.type ||
          connectedScope.entityId !== deletedScope.entityId
        ) {
          continue;
        }
        for (const connection of [...document.getConnections()]) {
          signalPermissionRevoked(
            connection,
            connection.context as CollabConnectionContext,
            connectedDocumentName,
          );
        }
      }
    },
    onCheckpointConflict: (entityDocumentName, error) =>
      fenceCheckpointConflict(
        revisionConflicts,
        getEditSessions(),
        entityDocumentName,
        error,
      ),
    logFailure: (fields) =>
      logger.error("Collaboration edit session finalization failed", fields),
    logTerminalCheckpointFailure: emitTerminalCollaborationCheckpointFailure,
  });
}

export function createCollabServer(options: CollabServerOptions = {}): Server {
  // Hocuspocus callbacks close over the tracker, which itself needs the server.
  // eslint-disable-next-line prefer-const
  let editSessions: EditSessionContributorTracker<TrackedCollabDocument>;
  const getEditSessions = () => editSessions;
  const roomInvalidation: { current?: RoomInvalidation } = {};
  const shutdownConnections = new ShutdownConnectionDrain<Connection>();
  const metadataAiGrace =
    options.metadataAiGrace ?? new MetadataAiReconnectGrace();
  const revisionConflicts = new RevisionConflictGuard();
  const roomEpochs = options.roomEpochs ?? new RoomEpochRegistry();
  const residentBlocks = options.residentBlocks ?? new ResidentBlockRuntime();
  const serverRef: { current?: Server } = {};
  const ownedDocuments = new Map<string, TrackedCollabDocument>();
  const roomOwnership = createRoomOwnership(
    options.roomOwnership,
    serverRef,
    ownedDocuments,
    revisionConflicts,
  );
  const blockRooms = createBlockRoomProtocol(
    roomEpochs,
    residentBlocks,
    revisionConflicts,
    getEditSessions,
  );
  const server = new Server({
    port: env.PORT,
    name: "geul-collab",
    debounce: 2000,
    maxDebounce: 10000,
    quiet: true,

    onAuthenticate: createAuthenticationHook(
      shutdownConnections,
      revisionConflicts.fencedDocumentNames,
      roomEpochs,
    ),
    ...createConnectionHooks({
      shutdownConnections,
      metadataAiGrace,
      editSessions: getEditSessions,
      blockRooms,
      isDocumentFenced: (documentName) =>
        revisionConflicts.fencedDocumentNames.has(documentName),
      settlePendingRoomInvalidation: (documentName, document) =>
        roomInvalidation.current!.settleConnected(
          documentName,
          document as TrackedCollabDocument,
        ),
    }),
    ...createDocumentHooks({
      editSessions: getEditSessions,
      metadataAiGrace,
      revisionConflicts,
      shutdownConnections,
      roomEpochs,
      residentBlocks,
      blockRooms,
      roomOwnership,
      ownedDocuments,
      clearPendingRoomInvalidation: (documentName) =>
        roomInvalidation.current!.clearPending(documentName),
    }),
  });
  serverRef.current = server;
  editSessions = createEditSessionTracker(
    server,
    residentBlocks,
    revisionConflicts,
    getEditSessions,
  );
  roomInvalidation.current = createRoomInvalidation(
    server,
    ownedDocuments,
    revisionConflicts,
    metadataAiGrace,
    editSessions,
  );
  editSessionTrackers.set(server, editSessions);
  shutdownConnectionDrains.set(server, shutdownConnections);
  metadataAiReconnectGrace.set(server, metadataAiGrace);
  roomOwnerships.set(server, roomOwnership);
  registerRoomInvalidation(server, roomInvalidation.current);
  registerInteractiveMutationRuntime(server, residentBlocks);
  bindShutdownAdmissionsToHocuspocus(server.hocuspocus, shutdownConnections);
  return server;
}

export async function shutdownCollabServer(server: Server): Promise<void> {
  const editSessions = editSessionTrackers.get(server);
  const shutdownConnections = shutdownConnectionDrains.get(server);
  const metadataAiGrace = metadataAiReconnectGrace.get(server);
  const roomOwnership = roomOwnerships.get(server);
  if (
    !editSessions ||
    !shutdownConnections ||
    !metadataAiGrace ||
    !roomOwnership
  ) {
    await server.destroy();
    return;
  }

  // The drain already includes authentication admissions that began before
  // shutdown. Each successful admission transfers to established-connection
  // tracking before it is released, and onDisconnect runs only after queued
  // client frames, making this the safe boundary before finalization.
  editSessions.beginShutdown();
  metadataAiGrace.beginShutdown();
  const disconnected = shutdownConnections.begin(
    server.hocuspocus.documents.values(),
  );
  const destroyPromise = server.destroy();
  let shutdownError: unknown;
  try {
    await withShutdownTimeout(
      disconnected,
      "Collaboration pending client-frame drain",
    );
    await withShutdownTimeout(
      editSessions.drainForShutdown(),
      "Collaboration edit-session shutdown drain",
    );
  } catch (error) {
    shutdownError = error;
  } finally {
    editSessions.release();
    await Promise.allSettled(
      [...server.hocuspocus.documents.values()].map((document) =>
        server.hocuspocus.unloadDocument(document),
      ),
    );
  }

  await withShutdownTimeout(destroyPromise, "Hocuspocus shutdown");
  await roomOwnership.close();
  if (shutdownError) {
    throw shutdownError;
  }
}
