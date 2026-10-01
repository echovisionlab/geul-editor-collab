import {
  CollaborativeDocumentType,
  type DocumentHandler,
} from "@echovisionlab/geul-common/collaboration/document";
import {
  extractEmailLayoutLocaleValues,
  hydrateEmailLayoutCanonicalRoom,
} from "@echovisionlab/geul-common/collaboration/email-layout";
import * as Y from "yjs";
import {
  loadEmailLayoutDocument,
  saveEmailLayoutDocument,
} from "../lib/api/email-layout.ts";
import { TransientDocumentStateMap } from "../lib/transient-document-state.ts";
import { handlerDocumentIdentity } from "../lib/collaboration/handler-document-identity.ts";
import {
  projectDocumentRoomSnapshot,
  type DocumentRoomSnapshot,
} from "../lib/collaboration/document-room-snapshot.ts";
import { requireSaveContributorMemberIds } from "../lib/collaboration/mutation-contributors.ts";

export const emailLayoutHandler: DocumentHandler = {
  supportsVersionCheckpoints: false,

  async store(id, document, options = {}) {
    const identity = handlerDocumentIdentity(
      id,
      CollaborativeDocumentType.EMAIL_LAYOUT,
    );
    const doc = document as Y.Doc;
    const contributorMemberIds = requireSaveContributorMemberIds(options);
    const expectedRevision = requireEmailLayoutRevision(identity.stateKey);
    const sourceLocale = expectedRevision.sourceLocale;

    const response = await saveEmailLayoutDocument({
      emailLayoutId: identity.entityId,
      locale: identity.locale,
      contributorMemberIds,
      expectedDocumentRevision: expectedRevision.documentRevision,
      ...(identity.locale === sourceLocale
        ? { contentHtml: doc.getText("html-content").toString() }
        : {
            expectedTargetRevision: expectedRevision.targetRevision,
            localeValues: Object.entries(
              extractEmailLayoutLocaleValues(doc),
            ).map(([handle, value]) => ({ handle, value })),
          }),
    });
    if (response.locale !== identity.locale) {
      throw new Error("Email Layout collaboration response locale mismatch");
    }
    const revision = requireEmailLayoutRevisionTuple(
      identity.stateKey,
      sourceLocale,
      identity.locale,
      true,
      response.documentRevision,
      response.targetRevision,
    );
    lastLoadedEmailLayoutRevision.set(identity.stateKey, revision);
    projectDocumentRoomSnapshot(doc, revision);
  },

  async load(id) {
    const identity = handlerDocumentIdentity(
      id,
      CollaborativeDocumentType.EMAIL_LAYOUT,
    );
    const response = await loadEmailLayoutDocument({
      emailLayoutId: identity.entityId,
      locale: identity.locale,
    });
    if (!response.sourceLocale) {
      throw new Error(
        "Email Layout source locale is missing from the source document load response",
      );
    }
    if (response.locale !== identity.locale) {
      throw new Error("Email Layout collaboration response locale mismatch");
    }
    if (!response.documentRevision) {
      throw new Error(
        "Email Layout collaboration document revision is missing",
      );
    }
    const localeExists =
      response.locale === response.sourceLocale ||
      response.targetRevision !== undefined;
    const revision = requireEmailLayoutRevisionTuple(
      identity.stateKey,
      response.sourceLocale,
      response.locale,
      localeExists,
      response.documentRevision,
      response.targetRevision,
    );
    lastLoadedEmailLayoutRevision.set(identity.stateKey, revision);

    const document = hydrateEmailLayoutCanonicalRoom({
      sourceLocale: response.sourceLocale,
      locale: response.locale,
      localeExists:
        response.locale === response.sourceLocale ||
        response.targetRevision !== undefined,
      contentHtml: response.contentHtml ?? "",
      units: response.units,
      localeValues: Object.fromEntries(
        response.localeValues.map(({ handle, value }) => [handle, value]),
      ),
    });
    projectDocumentRoomSnapshot(document, revision);
    return Buffer.from(Y.encodeStateAsUpdate(document));
  },
};

type EmailLayoutRevisionTuple = DocumentRoomSnapshot;

const lastLoadedEmailLayoutRevision =
  new TransientDocumentStateMap<EmailLayoutRevisionTuple>();

function requireEmailLayoutRevision(
  documentId: string,
): EmailLayoutRevisionTuple {
  const revision = lastLoadedEmailLayoutRevision.get(documentId);
  if (!revision?.documentRevision) {
    throw new Error(
      "Email Layout document revision was not captured during load; reload before saving",
    );
  }
  return revision;
}

function requireEmailLayoutRevisionTuple(
  documentName: string,
  sourceLocale: string,
  locale: string,
  localeExists: boolean,
  documentRevision: string,
  targetRevision: string | undefined,
): EmailLayoutRevisionTuple {
  if (!documentRevision) {
    throw new Error("Email Layout document revision missing");
  }
  if (locale === sourceLocale && targetRevision !== undefined) {
    throw new Error(
      "Email Layout source collaboration returned target revision",
    );
  }
  if (locale !== sourceLocale && !targetRevision) {
    throw new Error("Email Layout target revision missing");
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
