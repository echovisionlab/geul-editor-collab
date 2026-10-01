import {
  CollaborativeDocumentType,
  type DocumentHandler,
} from "@echovisionlab/geul-common/collaboration/document";
import {
  extractMenuCanonicalSnapshot,
  hydrateMenuCanonicalRoom,
  type MenuCanonicalSnapshot,
} from "@echovisionlab/geul-common/collaboration/menu";
import * as Y from "yjs";
import { loadMenuDocument, saveMenuDocument } from "../lib/api/menu.ts";
import { handlerDocumentIdentity } from "../lib/collaboration/handler-document-identity.ts";
import {
  projectDocumentRoomSnapshot,
  type DocumentRoomSnapshot,
} from "../lib/collaboration/document-room-snapshot.ts";
import { requireSaveContributorMemberIds } from "../lib/collaboration/mutation-contributors.ts";
import { TransientDocumentStateMap } from "../lib/transient-document-state.ts";

type MenuRevisionTuple = DocumentRoomSnapshot;

const sourceLocaleByDocument = new TransientDocumentStateMap<string>();
const revisionByDocument = new TransientDocumentStateMap<MenuRevisionTuple>();
const lastSnapshotByDocument =
  new TransientDocumentStateMap<MenuCanonicalSnapshot>();

export const menuHandler: DocumentHandler = {
  supportsVersionCheckpoints: false,

  async load(id) {
    const identity = handlerDocumentIdentity(
      id,
      CollaborativeDocumentType.MENU,
    );
    const response = await loadMenuDocument({
      menuId: identity.entityId,
      locale: identity.locale,
    });
    if (!response.sourceLocale || response.locale !== identity.locale) {
      throw new Error("Invalid Menu collaboration load response");
    }
    const revision = requireRevisionTuple(
      response.locale,
      response.sourceLocale,
      response.localeExists,
      response.documentRevision,
      response.targetRevision,
      identity.stateKey,
    );
    const document = hydrateMenuCanonicalRoom({
      sourceLocale: response.sourceLocale,
      locale: response.locale,
      localeExists: response.localeExists,
      name: response.name,
      items: response.items,
      sourceLabels: response.sourceLabels,
      requestedLabels: response.requestedLabels,
    });
    sourceLocaleByDocument.set(identity.stateKey, response.sourceLocale);
    revisionByDocument.set(identity.stateKey, revision);
    lastSnapshotByDocument.set(
      identity.stateKey,
      extractMenuCanonicalSnapshot(document),
    );
    projectDocumentRoomSnapshot(document, revision);
    return Buffer.from(Y.encodeStateAsUpdate(document));
  },

  async store(id, rawDocument, options = {}) {
    const identity = handlerDocumentIdentity(
      id,
      CollaborativeDocumentType.MENU,
    );
    const sourceLocale = sourceLocaleByDocument.get(identity.stateKey);
    const revision = revisionByDocument.get(identity.stateKey);
    if (!sourceLocale || !revision?.documentRevision) {
      throw new Error("Menu document was not loaded; reload before saving");
    }
    const snapshot = extractMenuCanonicalSnapshot(rawDocument as Y.Doc);
    if (sameSnapshot(lastSnapshotByDocument.get(identity.stateKey), snapshot)) {
      return;
    }
    const response = await saveMenuDocument({
      menuId: identity.entityId,
      locale: identity.locale,
      name: snapshot.name,
      items: snapshot.items,
      requestedLabels: snapshot.requestedLabels,
      contributorMemberIds: requireSaveContributorMemberIds(options),
      expectedDocumentRevision: revision.documentRevision,
      ...(identity.locale === sourceLocale
        ? {}
        : { expectedTargetRevision: revision.targetRevision }),
    });
    if (response.locale !== identity.locale || !response.documentRevision) {
      throw new Error("Invalid Menu collaboration save response");
    }
    const nextRevision = requireRevisionTuple(
      response.locale,
      sourceLocale,
      true,
      response.documentRevision,
      response.targetRevision,
      identity.stateKey,
    );
    revisionByDocument.set(identity.stateKey, nextRevision);
    lastSnapshotByDocument.set(identity.stateKey, snapshot);
    projectDocumentRoomSnapshot(rawDocument as Y.Doc, nextRevision);
  },
};

function requireRevisionTuple(
  locale: string,
  sourceLocale: string,
  localeExists: boolean,
  documentRevision: string,
  targetRevision: string | undefined,
  documentName: string,
): MenuRevisionTuple {
  if (!documentRevision) throw new Error("Menu document revision is missing");
  if (locale === sourceLocale && targetRevision !== undefined) {
    throw new Error("Menu source returned a target revision");
  }
  if (locale !== sourceLocale && localeExists && !targetRevision) {
    throw new Error("Menu target revision is missing");
  }
  return {
    documentName,
    documentRevision,
    sourceLocale,
    locale,
    localeExists,
    ...(targetRevision === undefined ? {} : { targetRevision }),
  };
}

function sameSnapshot(
  left: MenuCanonicalSnapshot | undefined,
  right: MenuCanonicalSnapshot,
): boolean {
  return left !== undefined && JSON.stringify(left) === JSON.stringify(right);
}
