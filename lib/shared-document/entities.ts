import {
  ARTIST_SOURCE_OWNED_FIELD_KEYS,
  ARTIST_SHARED_FIELD_KEYS,
  type ArtistSourceOwnedFieldKey,
} from "@echovisionlab/geul-common/collaboration/artist";
import { LABEL_SHARED_FIELD_KEYS } from "@echovisionlab/geul-common/collaboration/label";
import {
  RELEASE_SOURCE_OWNED_FIELD_KEYS,
  type ReleaseSourceOwnedFieldKey,
} from "@echovisionlab/geul-common/collaboration/release";
import {
  WORK_SOURCE_OWNED_FIELD_KEYS,
  type WorkSourceOwnedFieldKey,
} from "@echovisionlab/geul-common/collaboration/work";
import * as Y from "yjs";
import { sanitizeDurableMediaState } from "../durable-media-guard.ts";
import {
  clearSharedFragment,
  decodeSharedDocument,
  deleteSharedMapKeys,
  getSharedFragment,
  getSharedMap,
  sanitizeNeutralDocumentStore,
} from "./core.ts";

export function sanitizePostSharedDocumentState(
  state: Buffer | Uint8Array | null,
): Buffer | null {
  if (!state || state.length === 0) {
    return null;
  }

  const sharedDoc = decodeSharedDocument(
    sanitizeDurableMediaState(state).state,
  );
  sanitizeNeutralDocumentStore(sharedDoc);
  const durableDocument = new Y.Doc();
  durableDocument.clientID = 1;
  const sourceFragment = getSharedFragment(sharedDoc, "document-store");
  if (sourceFragment && sourceFragment.length > 0) {
    durableDocument.getXmlFragment("document-store").insert(
      0,
      sourceFragment
        .toArray()
        .filter(
          (node): node is Y.XmlElement | Y.XmlText =>
            node instanceof Y.XmlElement || node instanceof Y.XmlText,
        )
        .map((node) => node.clone()),
    );
  }

  return Buffer.from(Y.encodeStateAsUpdate(durableDocument));
}

export function sanitizeWorkSharedDocumentState(
  state: Buffer | Uint8Array | null,
): Buffer | null {
  if (!state || state.length === 0) {
    return null;
  }

  const sharedDoc = decodeSharedDocument(
    sanitizeDurableMediaState(state).state,
  );
  const sharedMap = getSharedMap(sharedDoc, "work-meta");
  const localizedKeySet = new Set(
    WORK_SOURCE_OWNED_FIELD_KEYS satisfies readonly WorkSourceOwnedFieldKey[],
  );
  if (sharedMap) {
    localizedKeySet.forEach((key) => sharedMap.delete(key));
    sharedMap.delete("status");
  }

  sanitizeNeutralDocumentStore(sharedDoc);
  return Buffer.from(Y.encodeStateAsUpdate(sharedDoc));
}

export function sanitizeProgramEventSharedDocumentState(
  state: Buffer | Uint8Array | null,
): Buffer | null {
  if (!state || state.length === 0) {
    return null;
  }

  const sharedDoc = decodeSharedDocument(
    sanitizeDurableMediaState(state).state,
  );
  sanitizeNeutralDocumentStore(sharedDoc);
  return Buffer.from(Y.encodeStateAsUpdate(sharedDoc));
}

export function sanitizeArtistSharedDocumentState(
  state: Buffer | Uint8Array | null,
): Buffer | null {
  if (!state || state.length === 0) {
    return null;
  }

  const sharedDoc = decodeSharedDocument(state);
  const sharedMap = getSharedMap(sharedDoc, "artist-fields");
  const localizedKeySet = new Set(
    ARTIST_SOURCE_OWNED_FIELD_KEYS satisfies readonly ArtistSourceOwnedFieldKey[],
  );
  const allowed = new Set<string>(ARTIST_SHARED_FIELD_KEYS);
  deleteSharedMapKeys(
    sharedMap,
    (key) =>
      localizedKeySet.has(key as ArtistSourceOwnedFieldKey) ||
      !allowed.has(key),
  );

  clearSharedFragment(sharedDoc, "artist-bio", "document-store");
  return Buffer.from(Y.encodeStateAsUpdate(sharedDoc));
}

export function sanitizeLabelSharedDocumentState(
  state: Buffer | Uint8Array | null,
): Buffer | null {
  if (!state || state.length === 0) {
    return null;
  }

  const sharedDoc = decodeSharedDocument(state);
  const sharedMap = getSharedMap(sharedDoc, "label-fields");
  const allowed = new Set<string>(LABEL_SHARED_FIELD_KEYS);
  deleteSharedMapKeys(sharedMap, (key) => !allowed.has(key));

  clearSharedFragment(sharedDoc, "label-description", "document-store");
  return Buffer.from(Y.encodeStateAsUpdate(sharedDoc));
}

export function sanitizeReleaseSharedDocumentState(
  state: Buffer | Uint8Array | null,
): Buffer | null {
  if (!state || state.length === 0) {
    return null;
  }

  const sharedDoc = decodeSharedDocument(
    sanitizeDurableMediaState(state).state,
  );
  const sharedMap = getSharedMap(sharedDoc, "release-fields");
  const localizedKeySet = new Set(
    RELEASE_SOURCE_OWNED_FIELD_KEYS satisfies readonly ReleaseSourceOwnedFieldKey[],
  );
  if (sharedMap) {
    localizedKeySet.forEach((key) => sharedMap.delete(key));
  }

  clearSharedFragment(sharedDoc, "release-description", "document-store");
  return Buffer.from(Y.encodeStateAsUpdate(sharedDoc));
}
