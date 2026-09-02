import {
  CollaborativeDocumentType,
  type DocumentHandler,
} from "@echovisionlab/geul-common/collaboration/document";
import {
  extractPostSeriesStoredLocaleFields,
  hydratePostSeriesCanonicalRoom,
  type PostSeriesStoredLocaleFields,
} from "@echovisionlab/geul-common/collaboration/post-series";
import * as Y from "yjs";
import {
  loadPostSeriesDocument,
  savePostSeriesDocument,
} from "../lib/api/post-series.ts";
import { handlerDocumentIdentity } from "../lib/collaboration/handler-document-identity.ts";
import { requireSaveContributorMemberIds } from "../lib/collaboration/mutation-contributors.ts";
import { TransientDocumentStateMap } from "../lib/transient-document-state.ts";

interface PostSeriesRevisionTuple {
  documentRevision: string;
  targetRevision?: string;
}

const sourceLocaleByDocument = new TransientDocumentStateMap<string>();
const revisionByDocument =
  new TransientDocumentStateMap<PostSeriesRevisionTuple>();
const lastSnapshotByDocument =
  new TransientDocumentStateMap<PostSeriesStoredLocaleFields>();

export const postSeriesHandler: DocumentHandler = {
  supportsVersionCheckpoints: false,

  async load(id) {
    const identity = handlerDocumentIdentity(
      id,
      CollaborativeDocumentType.POST_SERIES,
    );
    const response = await loadPostSeriesDocument({
      seriesId: identity.entityId,
      locale: identity.locale,
    });
    if (!response.sourceLocale || response.locale !== identity.locale) {
      throw new Error("Invalid Post Series collaboration load response");
    }
    const revision = requireRevisionTuple(
      response.locale,
      response.sourceLocale,
      response.documentRevision,
      response.targetRevision,
      response.localeExists,
    );
    const document = hydratePostSeriesCanonicalRoom({
      sourceLocale: response.sourceLocale,
      locale: response.locale,
      localeExists: response.localeExists,
      source: response.source,
      requested: response.requested,
    });
    const snapshot = extractPostSeriesStoredLocaleFields(document);
    sourceLocaleByDocument.set(identity.stateKey, response.sourceLocale);
    revisionByDocument.set(identity.stateKey, revision);
    lastSnapshotByDocument.set(identity.stateKey, snapshot);
    return Buffer.from(Y.encodeStateAsUpdate(document));
  },

  async store(id, rawDocument, options = {}) {
    const identity = handlerDocumentIdentity(
      id,
      CollaborativeDocumentType.POST_SERIES,
    );
    const sourceLocale = sourceLocaleByDocument.get(identity.stateKey);
    const revision = revisionByDocument.get(identity.stateKey);
    if (!sourceLocale || !revision?.documentRevision) {
      throw new Error(
        "Post Series document was not loaded; reload before saving",
      );
    }
    const snapshot = extractPostSeriesStoredLocaleFields(rawDocument as Y.Doc);
    if (sameFields(lastSnapshotByDocument.get(identity.stateKey), snapshot)) {
      return;
    }
    const response = await savePostSeriesDocument({
      seriesId: identity.entityId,
      locale: identity.locale,
      requested: snapshot,
      contributorMemberIds: requireSaveContributorMemberIds(options),
      expectedDocumentRevision: revision.documentRevision,
      ...(identity.locale === sourceLocale
        ? {}
        : { expectedTargetRevision: revision.targetRevision }),
    });
    if (response.locale !== identity.locale || !response.documentRevision) {
      throw new Error("Invalid Post Series collaboration save response");
    }
    revisionByDocument.set(
      identity.stateKey,
      requireRevisionTuple(
        response.locale,
        sourceLocale,
        response.documentRevision,
        response.targetRevision,
        true,
      ),
    );
    lastSnapshotByDocument.set(identity.stateKey, snapshot);
  },
};

function requireRevisionTuple(
  locale: string,
  sourceLocale: string,
  documentRevision: string,
  targetRevision: string | undefined,
  localeExists: boolean,
): PostSeriesRevisionTuple {
  if (!documentRevision) {
    throw new Error("Post Series document revision is missing");
  }
  if (locale === sourceLocale && targetRevision !== undefined) {
    throw new Error("Post Series source returned a target revision");
  }
  if (locale !== sourceLocale && localeExists && !targetRevision) {
    throw new Error("Post Series target revision is missing");
  }
  return {
    documentRevision,
    ...(targetRevision === undefined ? {} : { targetRevision }),
  };
}

function sameFields(
  left: PostSeriesStoredLocaleFields | undefined,
  right: PostSeriesStoredLocaleFields,
): boolean {
  return left?.title === right.title && left?.summary === right.summary;
}
