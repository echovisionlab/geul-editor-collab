import {
  CollaborativeDocumentType,
  type DocumentHandler,
  type DocumentSaveOptions,
} from "@echovisionlab/geul-common/collaboration/document";
import {
  extractFormCanonicalRoom,
  hydrateFormCanonicalRoom,
  type FormCanonicalRoomOutput,
  type FormCollabFields,
} from "@echovisionlab/geul-common/collaboration/form";
import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import * as Y from "yjs";
import { loadFormDocument, saveFormDocument } from "../lib/api/form.ts";
import { handlerDocumentIdentity } from "../lib/collaboration/handler-document-identity.ts";
import { requireSaveContributorMemberIds } from "../lib/collaboration/mutation-contributors.ts";
import { logger } from "../lib/logger.ts";
import { TransientDocumentStateMap } from "../lib/transient-document-state.ts";

type FormRevisionTuple = {
  documentRevision: string;
  targetRevision?: string;
};

type FormCanonicalSnapshot = FormCanonicalRoomOutput;

const lastSavedFormSnapshotById =
  new TransientDocumentStateMap<FormCanonicalSnapshot>();
const sourceFormFieldsByDocumentId =
  new TransientDocumentStateMap<FormCollabFields>();
const expectedFormSourceLocaleByDocumentId =
  new TransientDocumentStateMap<string>();
const expectedFormRevisionByDocumentId =
  new TransientDocumentStateMap<FormRevisionTuple>();

function requireExpectedSourceLocale(documentId: string): string {
  const sourceLocale = expectedFormSourceLocaleByDocumentId.get(documentId);
  if (!sourceLocale) {
    throw new Error(
      "Form source locale was not captured during load; reload before saving",
    );
  }
  return sourceLocale;
}

function requireSourceFields(documentId: string): FormCollabFields {
  const fields = sourceFormFieldsByDocumentId.get(documentId);
  if (!fields) {
    throw new Error(
      "Form source fields were not captured during load; reload before saving",
    );
  }
  return fields;
}

function requireFormRevision(documentId: string): FormRevisionTuple {
  const revision = expectedFormRevisionByDocumentId.get(documentId);
  if (!revision?.documentRevision) {
    throw new Error(
      "Form document revision was not captured during load; reload before saving",
    );
  }
  return revision;
}

function requireFormRevisionTuple(
  locale: string,
  sourceLocale: string,
  documentRevision: string,
  targetRevision: string | undefined,
): FormRevisionTuple {
  if (!documentRevision) {
    throw new Error("Form collaboration document revision is missing");
  }
  if (locale === sourceLocale && targetRevision !== undefined) {
    throw new Error("Form source collaboration returned target revision");
  }
  if (locale !== sourceLocale && !targetRevision) {
    throw new Error(
      "Form target collaboration response target revision missing",
    );
  }
  return {
    documentRevision,
    ...(targetRevision === undefined ? {} : { targetRevision }),
  };
}

function targetKey(target: AIDocumentFieldTarget): string {
  return JSON.stringify(target);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameSnapshot(
  left: FormCanonicalSnapshot | undefined,
  right: FormCanonicalSnapshot,
): boolean {
  return (
    left !== undefined &&
    stableJson(left.fields) === stableJson(right.fields) &&
    left.presentLocaleValues.map(targetKey).join("\n") ===
      right.presentLocaleValues.map(targetKey).join("\n")
  );
}

async function storeFormCanonicalDocument(
  documentId: string,
  formId: string,
  locale: string,
  document: Y.Doc,
  options: DocumentSaveOptions,
): Promise<void> {
  const sourceLocale = requireExpectedSourceLocale(documentId);
  const source = requireSourceFields(documentId);
  const snapshot = extractFormCanonicalRoom(document, source);
  if (sameSnapshot(lastSavedFormSnapshotById.get(documentId), snapshot)) {
    return;
  }
  const expectedRevision = requireFormRevision(documentId);
  const contributorMemberIds = requireSaveContributorMemberIds(options);
  try {
    const response = await saveFormDocument({
      formId,
      locale,
      fields: snapshot.fields,
      presentLocaleValues: snapshot.presentLocaleValues,
      contributorMemberIds,
      expectedDocumentRevision: expectedRevision.documentRevision,
      ...(locale === sourceLocale
        ? {}
        : { expectedTargetRevision: expectedRevision.targetRevision }),
    });
    if (response.locale !== locale) {
      throw new Error("Form collaboration response locale mismatch");
    }
    expectedFormRevisionByDocumentId.set(
      documentId,
      requireFormRevisionTuple(
        locale,
        sourceLocale,
        response.documentRevision,
        response.targetRevision,
      ),
    );
  } catch (error) {
    logger.error("Failed to persist canonical Form document", {
      documentName: documentId,
      formId,
      locale,
      localeValueCount: snapshot.presentLocaleValues.length,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
  lastSavedFormSnapshotById.set(documentId, snapshot);
  if (locale === sourceLocale) {
    sourceFormFieldsByDocumentId.set(documentId, snapshot.fields);
  }
}

export const formHandler: DocumentHandler = {
  supportsVersionCheckpoints: false,

  async store(id, document, options = {}) {
    const identity = handlerDocumentIdentity(
      id,
      CollaborativeDocumentType.FORM,
    );
    return storeFormCanonicalDocument(
      identity.stateKey,
      identity.entityId,
      identity.locale,
      document,
      options,
    );
  },

  async load(id) {
    const identity = handlerDocumentIdentity(
      id,
      CollaborativeDocumentType.FORM,
    );
    const response = await loadFormDocument({
      formId: identity.entityId,
      locale: identity.locale,
    });
    if (!response.sourceLocale) {
      throw new Error(
        "Form source locale is missing from the source document load response",
      );
    }
    if (response.locale !== identity.locale) {
      throw new Error("Form collaboration response locale mismatch");
    }
    const revision = requireFormRevisionTuple(
      response.locale,
      response.sourceLocale,
      response.documentRevision,
      response.targetRevision,
    );
    const document = hydrateFormCanonicalRoom({
      sourceLocale: response.sourceLocale,
      locale: response.locale,
      source: response.source,
      requested: response.requested,
      requestedExists: response.localeExists,
      presentLocaleValues: response.presentLocaleValues,
    });
    const snapshot = extractFormCanonicalRoom(document, response.source);
    expectedFormSourceLocaleByDocumentId.set(
      identity.stateKey,
      response.sourceLocale,
    );
    sourceFormFieldsByDocumentId.set(identity.stateKey, response.source);
    expectedFormRevisionByDocumentId.set(identity.stateKey, revision);
    lastSavedFormSnapshotById.set(identity.stateKey, snapshot);
    return Buffer.from(Y.encodeStateAsUpdate(document));
  },
};
