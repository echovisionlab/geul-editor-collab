import * as Y from "yjs";

export const DOCUMENT_ROOM_SNAPSHOT_MAP_NAME = "collaboration-revision";
export const DOCUMENT_ROOM_SNAPSHOT_KEYS = {
  documentName: "documentName",
  documentRevision: "documentRevision",
  sourceLocale: "sourceLocale",
  locale: "locale",
  localeExists: "localeExists",
  targetRevision: "targetRevision",
} as const;

export interface DocumentRoomSnapshot {
  documentName: string;
  documentRevision: string;
  sourceLocale: string;
  locale: string;
  localeExists: boolean;
  targetRevision?: string;
}

const DOCUMENT_ROOM_SNAPSHOT_ORIGIN = Symbol("document-room-snapshot");

/**
 * Publish the handler's newly loaded or acknowledged baseline to connected
 * clients. Persistence handlers must keep using their private cached tuple;
 * this map is only an observed-revision projection for editor commands.
 */
export function projectDocumentRoomSnapshot(
  document: Y.Doc,
  snapshot: DocumentRoomSnapshot,
): void {
  const metadata = document.getMap<string | boolean>(
    DOCUMENT_ROOM_SNAPSHOT_MAP_NAME,
  );
  document.transact(() => {
    metadata.set(
      DOCUMENT_ROOM_SNAPSHOT_KEYS.documentName,
      snapshot.documentName,
    );
    metadata.set(
      DOCUMENT_ROOM_SNAPSHOT_KEYS.documentRevision,
      snapshot.documentRevision,
    );
    metadata.set(
      DOCUMENT_ROOM_SNAPSHOT_KEYS.sourceLocale,
      snapshot.sourceLocale,
    );
    metadata.set(DOCUMENT_ROOM_SNAPSHOT_KEYS.locale, snapshot.locale);
    metadata.set(
      DOCUMENT_ROOM_SNAPSHOT_KEYS.localeExists,
      snapshot.localeExists,
    );
    if (snapshot.targetRevision === undefined) {
      metadata.delete(DOCUMENT_ROOM_SNAPSHOT_KEYS.targetRevision);
    } else {
      metadata.set(
        DOCUMENT_ROOM_SNAPSHOT_KEYS.targetRevision,
        snapshot.targetRevision,
      );
    }
  }, DOCUMENT_ROOM_SNAPSHOT_ORIGIN);
}
