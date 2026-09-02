import * as Y from "yjs";
import {
  isForbiddenField,
  isJsonStringField,
  isMediaRecord,
} from "./constants.ts";
import { materializeDocumentRootTypes } from "./materialize.ts";
import type { DurableMediaViolation } from "./types.ts";

function scanRecord(
  record: Record<string, unknown>,
  path: string,
  inheritedMediaRecord: boolean,
  violations: DurableMediaViolation[],
): void {
  const mediaRecord = isMediaRecord(record, inheritedMediaRecord);

  for (const [field, value] of Object.entries(record)) {
    const fieldPath = `${path}.${field}`;
    if (typeof value === "string" && isJsonStringField(field) && value.trim()) {
      try {
        scanValue(JSON.parse(value), fieldPath, mediaRecord, violations);
        continue;
      } catch {
        // Fall through so a managed route in malformed JSON is still rejected.
      }
    }

    if (isForbiddenField(field, value, mediaRecord)) {
      violations.push({ path: fieldPath, field });
      continue;
    }

    scanValue(value, fieldPath, mediaRecord, violations);
  }
}

function scanYType(
  value: Y.AbstractType<unknown>,
  path: string,
  inheritedMediaRecord: boolean,
  violations: DurableMediaViolation[],
): void {
  if (value instanceof Y.Map) {
    scanRecord(
      Object.fromEntries(value.entries()),
      path,
      inheritedMediaRecord,
      violations,
    );
    return;
  }

  if (value instanceof Y.XmlElement) {
    const attributes = value.getAttributes();
    const mediaRecord = isMediaRecord(
      attributes,
      inheritedMediaRecord,
      value.nodeName,
    );
    scanRecord(
      attributes,
      `${path}<${value.nodeName}>`,
      mediaRecord,
      violations,
    );
    value.toArray().forEach((item, index) => {
      scanValue(
        item,
        `${path}<${value.nodeName}>[${index}]`,
        mediaRecord,
        violations,
      );
    });
    return;
  }

  if (value instanceof Y.Array || value instanceof Y.XmlFragment) {
    value.toArray().forEach((item, index) => {
      scanValue(item, `${path}[${index}]`, inheritedMediaRecord, violations);
    });
  }
}

function scanValue(
  value: unknown,
  path: string,
  inheritedMediaRecord: boolean,
  violations: DurableMediaViolation[],
): void {
  if (value instanceof Y.AbstractType) {
    scanYType(
      value as Y.AbstractType<unknown>,
      path,
      inheritedMediaRecord,
      violations,
    );
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      scanValue(item, `${path}[${index}]`, inheritedMediaRecord, violations);
    });
    return;
  }

  if (value && typeof value === "object") {
    scanRecord(
      value as Record<string, unknown>,
      path,
      inheritedMediaRecord,
      violations,
    );
  }
}

export function findDurableMediaViolations(
  document: Y.Doc,
): DurableMediaViolation[] {
  const violations: DurableMediaViolation[] = [];
  materializeDocumentRootTypes(document);
  const share = (
    document as Y.Doc & { share: Map<string, Y.AbstractType<unknown>> }
  ).share;

  for (const [name, value] of share) {
    scanYType(value, `$${name}`, false, violations);
  }

  return violations;
}

export function formatDurableMediaViolations(
  violations: DurableMediaViolation[],
): string {
  return violations
    .slice(0, 8)
    .map((violation) => `${violation.path} (${violation.field})`)
    .join(", ");
}
