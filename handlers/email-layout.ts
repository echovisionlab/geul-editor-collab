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
    const sourceLocale = requireEmailLayoutSourceLocale(identity.stateKey);
    const expectedRevision = requireEmailLayoutRevision(identity.stateKey);

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
    if (!response.documentRevision) {
      throw new Error(
        "Email Layout collaboration response document revision missing",
      );
    }
    if (
      identity.locale === sourceLocale &&
      response.targetRevision !== undefined
    ) {
      throw new Error(
        "Email Layout source collaboration returned target revision",
      );
    }
    if (identity.locale !== sourceLocale && !response.targetRevision) {
      throw new Error(
        "Email Layout target collaboration response target revision missing",
      );
    }
    lastLoadedEmailLayoutRevision.set(identity.stateKey, {
      documentRevision: response.documentRevision,
      ...(response.targetRevision === undefined
        ? {}
        : { targetRevision: response.targetRevision }),
    });
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
    lastLoadedEmailLayoutSourceLocale.set(
      identity.stateKey,
      response.sourceLocale,
    );
    if (!response.documentRevision) {
      throw new Error(
        "Email Layout collaboration document revision is missing",
      );
    }
    lastLoadedEmailLayoutRevision.set(identity.stateKey, {
      documentRevision: response.documentRevision,
      ...(response.targetRevision === undefined
        ? {}
        : { targetRevision: response.targetRevision }),
    });

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
    return Buffer.from(Y.encodeStateAsUpdate(document));
  },
};

type EmailLayoutRevisionTuple = {
  documentRevision: string;
  targetRevision?: string;
};

const lastLoadedEmailLayoutRevision =
  new TransientDocumentStateMap<EmailLayoutRevisionTuple>();
const lastLoadedEmailLayoutSourceLocale =
  new TransientDocumentStateMap<string>();

function requireEmailLayoutSourceLocale(documentId: string): string {
  const sourceLocale = lastLoadedEmailLayoutSourceLocale.get(documentId);
  if (!sourceLocale) {
    throw new Error(
      "Email Layout source locale was not captured during load; reload before saving",
    );
  }
  return sourceLocale;
}

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
