import * as Y from "yjs";
import {
  isForbiddenField,
  isJsonStringField,
  isMediaRecord,
} from "./constants.ts";
import { materializeDocumentRootTypes } from "./materialize.ts";
import type { DurableMediaSanitization } from "./types.ts";

function sanitizePlainArray(
  value: unknown[],
  inheritedMediaRecord: boolean,
): { value: unknown; changed: boolean; removedFields: number } {
  let changed = false;
  let removedFields = 0;
  const next = value.map((item) => {
    const result = sanitizePlainValue(item, inheritedMediaRecord);
    changed ||= result.changed;
    removedFields += result.removedFields;
    return result.value;
  });
  return { value: changed ? next : value, changed, removedFields };
}

function sanitizePlainJsonField(
  field: string,
  value: unknown,
  mediaRecord: boolean,
): {
  handled: boolean;
  value?: unknown;
  changed: boolean;
  removedFields: number;
} {
  if (typeof value !== "string" || !isJsonStringField(field) || !value.trim()) {
    return { handled: false, changed: false, removedFields: 0 };
  }
  try {
    const result = sanitizePlainValue(JSON.parse(value), mediaRecord);
    return {
      handled: true,
      value: result.changed ? JSON.stringify(result.value) : value,
      changed: result.changed,
      removedFields: result.removedFields,
    };
  } catch {
    return { handled: false, changed: false, removedFields: 0 };
  }
}

function sanitizePlainRecord(
  record: Record<string, unknown>,
  inheritedMediaRecord: boolean,
): { value: unknown; changed: boolean; removedFields: number } {
  const mediaRecord = isMediaRecord(record, inheritedMediaRecord);
  const next: Record<string, unknown> = {};
  let changed = false;
  let removedFields = 0;

  for (const [field, fieldValue] of Object.entries(record)) {
    const encodedJson = sanitizePlainJsonField(field, fieldValue, mediaRecord);
    if (encodedJson.handled) {
      next[field] = encodedJson.value;
      changed ||= encodedJson.changed;
      removedFields += encodedJson.removedFields;
      continue;
    }

    if (isForbiddenField(field, fieldValue, mediaRecord)) {
      changed = true;
      removedFields += 1;
      continue;
    }

    const result = sanitizePlainValue(fieldValue, mediaRecord);
    next[field] = result.value;
    changed ||= result.changed;
    removedFields += result.removedFields;
  }

  return { value: changed ? next : record, changed, removedFields };
}

function sanitizePlainValue(
  value: unknown,
  inheritedMediaRecord: boolean,
): { value: unknown; changed: boolean; removedFields: number } {
  if (Array.isArray(value)) {
    return sanitizePlainArray(value, inheritedMediaRecord);
  }
  if (!value || typeof value !== "object" || value instanceof Y.AbstractType) {
    return { value, changed: false, removedFields: 0 };
  }
  return sanitizePlainRecord(
    value as Record<string, unknown>,
    inheritedMediaRecord,
  );
}

function sanitizeYMap(
  map: Y.Map<unknown>,
  inheritedMediaRecord: boolean,
): number {
  const mediaRecord = isMediaRecord(
    Object.fromEntries(map.entries()),
    inheritedMediaRecord,
  );
  let removedFields = 0;

  for (const [field, value] of [...map.entries()]) {
    const encodedJson = sanitizeEncodedJsonMapField(
      map,
      field,
      value,
      mediaRecord,
    );
    if (encodedJson.handled) {
      removedFields += encodedJson.removedFields;
      continue;
    }

    if (isForbiddenField(field, value, mediaRecord)) {
      map.delete(field);
      removedFields += 1;
      continue;
    }

    if (value instanceof Y.AbstractType) {
      removedFields += sanitizeYType(
        value as Y.AbstractType<unknown>,
        mediaRecord,
      );
      continue;
    }

    const result = sanitizePlainValue(value, mediaRecord);
    if (result.changed) {
      map.set(field, result.value);
    }
    removedFields += result.removedFields;
  }

  return removedFields;
}

function sanitizeEncodedJsonMapField(
  map: Y.Map<unknown>,
  field: string,
  value: unknown,
  mediaRecord: boolean,
): { handled: boolean; removedFields: number } {
  if (typeof value !== "string" || !isJsonStringField(field) || !value.trim()) {
    return { handled: false, removedFields: 0 };
  }
  try {
    const result = sanitizePlainValue(JSON.parse(value), mediaRecord);
    if (result.changed) {
      map.set(field, JSON.stringify(result.value));
    }
    return { handled: true, removedFields: result.removedFields };
  } catch {
    // Fall through so malformed JSON carrying a managed route is removed.
    return { handled: false, removedFields: 0 };
  }
}

function sanitizeYArray(
  array: Y.Array<unknown>,
  inheritedMediaRecord: boolean,
): number {
  let removedFields = 0;
  const items = array.toArray();

  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item instanceof Y.AbstractType) {
      removedFields += sanitizeYType(
        item as Y.AbstractType<unknown>,
        inheritedMediaRecord,
      );
      continue;
    }

    const result = sanitizePlainValue(item, inheritedMediaRecord);
    if (result.changed) {
      array.delete(index, 1);
      array.insert(index, [result.value]);
    }
    removedFields += result.removedFields;
  }

  return removedFields;
}

function sanitizeYType(
  value: Y.AbstractType<unknown>,
  inheritedMediaRecord: boolean,
): number {
  if (value instanceof Y.Map) {
    return sanitizeYMap(value, inheritedMediaRecord);
  }

  if (value instanceof Y.XmlElement) {
    const attributes = value.getAttributes();
    const mediaRecord = isMediaRecord(
      attributes,
      inheritedMediaRecord,
      value.nodeName,
    );
    let removedFields = 0;

    removedFields += removeForbiddenXmlAttributes(
      value,
      attributes,
      mediaRecord,
    );

    for (const item of value.toArray()) {
      removedFields += sanitizeYType(
        item as unknown as Y.AbstractType<unknown>,
        mediaRecord,
      );
    }
    return removedFields;
  }

  if (value instanceof Y.Array) {
    return sanitizeYArray(value, inheritedMediaRecord);
  }

  if (value instanceof Y.XmlFragment) {
    let removedFields = 0;
    for (const item of value.toArray()) {
      removedFields += sanitizeYType(
        item as unknown as Y.AbstractType<unknown>,
        inheritedMediaRecord,
      );
    }
    return removedFields;
  }

  return 0;
}

function removeForbiddenXmlAttributes(
  element: Y.XmlElement,
  attributes: Record<string, unknown>,
  mediaRecord: boolean,
): number {
  let removedFields = 0;
  for (const [field, fieldValue] of Object.entries(attributes)) {
    if (isForbiddenField(field, fieldValue, mediaRecord)) {
      element.removeAttribute(field);
      removedFields += 1;
    }
  }
  return removedFields;
}

function deterministicSanitizerClientId(document: Y.Doc): number {
  const clients = [...document.store.clients.keys()].sort(
    (left, right) => left - right,
  );
  let candidate = 0;

  for (const clientId of clients) {
    if (clientId !== candidate) {
      return candidate;
    }
    candidate += 1;
  }

  return candidate;
}

export function sanitizeDurableMediaState(
  state: Uint8Array,
): DurableMediaSanitization {
  const document = new Y.Doc();
  if (state.length > 0) {
    Y.applyUpdate(document, state);
  }
  materializeDocumentRootTypes(document);
  document.clientID = deterministicSanitizerClientId(document);
  let removedFields = 0;
  let normalizedStateChanged = false;

  document.transact(() => {
    const share = (
      document as Y.Doc & { share: Map<string, Y.AbstractType<unknown>> }
    ).share;
    for (const value of share.values()) {
      const before = Y.encodeStateVector(document);
      removedFields += sanitizeYType(value as Y.AbstractType<unknown>, false);
      normalizedStateChanged ||= !Buffer.from(before).equals(
        Buffer.from(Y.encodeStateVector(document)),
      );
    }
  });

  return {
    state:
      removedFields > 0 || normalizedStateChanged
        ? Buffer.from(Y.encodeStateAsUpdate(document))
        : Buffer.from(state),
    changed: removedFields > 0 || normalizedStateChanged,
    removedFields,
  };
}
