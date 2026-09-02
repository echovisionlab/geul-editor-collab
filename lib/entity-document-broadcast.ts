import {
  createDocumentName,
  parseDocumentName,
  type CollaborativeDocumentType,
} from "@echovisionlab/geul-common/collaboration/document";
import type { Document as HocuspocusDocument } from "@hocuspocus/server";

interface ConnectedDocumentRegistry {
  entries(): IterableIterator<[string, HocuspocusDocument]>;
}

export function broadcastStatelessToLocaleDocument({
  documents,
  type,
  entityId,
  locale,
  payload,
}: {
  documents: ConnectedDocumentRegistry;
  type: CollaborativeDocumentType;
  entityId: string;
  locale: string;
  payload: string;
}): number {
  const baseName = createDocumentName(type, entityId, locale);
  let broadcastCount = 0;

  for (const [documentName, document] of documents.entries()) {
    if (documentName !== baseName) {
      continue;
    }

    if (document.getConnectionsCount() === 0) {
      continue;
    }

    document.broadcastStateless(payload);
    broadcastCount += 1;
  }

  return broadcastCount;
}

export function broadcastStatelessToEntityDocuments({
  documents,
  type,
  entityId,
  payload,
}: {
  documents: ConnectedDocumentRegistry;
  type: CollaborativeDocumentType;
  entityId: string;
  payload: string;
}): number {
  let broadcastCount = 0;
  for (const [documentName, document] of documents.entries()) {
    let scope;
    try {
      scope = parseDocumentName(documentName);
    } catch {
      continue;
    }
    if (scope.type !== type || scope.entityId !== entityId) {
      continue;
    }
    if (document.getConnectionsCount() === 0) {
      continue;
    }
    document.broadcastStateless(payload);
    broadcastCount += 1;
  }
  return broadcastCount;
}

export function broadcastStatelessToDocumentType({
  documents,
  type,
  payload,
}: {
  documents: ConnectedDocumentRegistry;
  type: CollaborativeDocumentType;
  payload: string;
}): number {
  let broadcastCount = 0;

  for (const [documentName, document] of documents.entries()) {
    let documentType: CollaborativeDocumentType;
    try {
      documentType = parseDocumentName(documentName).type;
    } catch {
      continue;
    }
    if (documentType !== type) {
      continue;
    }

    if (document.getConnectionsCount() === 0) {
      continue;
    }

    document.broadcastStateless(payload);
    broadcastCount += 1;
  }

  return broadcastCount;
}
