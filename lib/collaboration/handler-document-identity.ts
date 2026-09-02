import {
  type CollaborativeDocumentType,
  parseDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";

export function handlerDocumentIdentity(
  value: string,
  expectedType: CollaborativeDocumentType,
): {
  entityId: string;
  stateKey: string;
  locale: string;
} {
  const { entityId, locale, type } = parseDocumentName(value);
  if (type !== expectedType) {
    throw new Error("collaboration_document_type_mismatch");
  }
  return { entityId, stateKey: value, locale };
}
