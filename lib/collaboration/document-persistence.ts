import {
  CollaborativeDocumentType,
  parseDocumentName,
  residentBlockDocumentType,
  type DocumentSaveOptions,
} from "@echovisionlab/geul-common/collaboration/document";
import * as Y from "yjs";
import { handlers } from "../../handlers/index.ts";
import {
  assertDurableMediaState,
  sanitizeDurableMediaState,
} from "../durable-media-guard.ts";

type PersistResult = { contributorMemberIds: string[] };

export type UnqueuedCollaborativeDocumentPersist = (
  documentName: string,
  document: Y.Doc,
  options?: DocumentSaveOptions,
) => Promise<PersistResult>;

interface PreparedPersist {
  document: Y.Doc;
  documentName: string;
  options: DocumentSaveOptions & { contributorMemberIds: string[] };
  type: ReturnType<typeof parseDocumentName>["type"];
}

const persistQueues = new Map<string, Promise<unknown>>();

function assertGenericYjsDocumentType(type: CollaborativeDocumentType): void {
  if (residentBlockDocumentType(type)) {
    throw new Error("resident_block_runtime_required");
  }
}

function enqueuePersistence<T>(
  queueKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = persistQueues.get(queueKey);
  const ready = previous
    ? previous.then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
  const queued = ready.then(operation);

  persistQueues.set(queueKey, queued);
  const cleanup = () => {
    if (persistQueues.get(queueKey) === queued) {
      persistQueues.delete(queueKey);
    }
  };
  queued.then(cleanup, cleanup);

  return queued;
}

export function listConnectedMemberIds(document: Y.Doc): string[] {
  const getConnections = (
    document as unknown as {
      getConnections?: () => Iterable<{
        context?: { member?: { id?: unknown } };
      }>;
    }
  ).getConnections;
  if (!getConnections) {
    return [];
  }

  const connectedMemberIds = new Set<string>();
  for (const connection of getConnections.call(document)) {
    const memberId = connection.context?.member?.id;
    if (typeof memberId === "string" && memberId !== "") {
      connectedMemberIds.add(memberId);
    }
  }

  return [...connectedMemberIds];
}

export async function loadCollaborativeDocument(
  documentName: string,
): Promise<Y.Doc | null> {
  const { type } = parseDocumentName(documentName);
  assertGenericYjsDocumentType(type);
  const yjsState = await handlers[type].load(documentName);
  if (!yjsState || yjsState.length === 0) {
    return null;
  }

  const document = new Y.Doc();
  Y.applyUpdate(document, yjsState);
  return document;
}

export async function persistCollaborativeDocument(
  documentName: string,
  document: Y.Doc,
  options: DocumentSaveOptions = {},
  queueKey = documentName,
): Promise<PersistResult> {
  // Capture the Yjs state and actor snapshot together at hook time. Queueing a
  // live Y.Doc would allow a later mutation to enter this save with the wrong
  // contributor set.
  const prepared = preparePersist(documentName, document, options);
  return enqueuePersistence(queueKey, () =>
    persistCollaborativeDocumentNow(prepared),
  );
}

/**
 * Holds one persistence queue across a multi-document edit-session flush.
 * Calls made through the supplied function are intentionally unqueued: the
 * outer queue owns exclusivity until the full sequence returns.
 */
export function withCollaborativeDocumentPersistenceQueue<T>(
  queueKey: string,
  operation: (persist: UnqueuedCollaborativeDocumentPersist) => Promise<T>,
): Promise<T> {
  return enqueuePersistence(queueKey, () =>
    operation((documentName, document, options = {}) =>
      persistCollaborativeDocumentNow(
        preparePersist(documentName, document, options),
      ),
    ),
  );
}

function preparePersist(
  documentName: string,
  document: Y.Doc,
  options: DocumentSaveOptions,
): PreparedPersist {
  const { type } = parseDocumentName(documentName);
  assertGenericYjsDocumentType(type);
  const liveState = Buffer.from(Y.encodeStateAsUpdate(document));
  const sanitized = sanitizeDurableMediaState(liveState);
  if (sanitized.changed) {
    Y.applyUpdate(document, sanitized.state);
  }
  assertDurableMediaState(documentName, document);
  const state = Buffer.from(Y.encodeStateAsUpdate(document));
  const durableDocument = new Y.Doc();
  Y.applyUpdate(durableDocument, state);
  const contributorMemberIds = [
    ...new Set(options.contributorMemberIds ?? []),
  ].sort();

  return {
    document: durableDocument,
    documentName,
    options: { ...options, contributorMemberIds },
    type,
  };
}

async function persistCollaborativeDocumentNow(
  prepared: PreparedPersist,
): Promise<PersistResult> {
  const { document, documentName, options, type } = prepared;
  const handler = handlers[type];

  await handler.store(documentName, document, options);

  return { contributorMemberIds: options.contributorMemberIds };
}
