import * as Y from "yjs";
import { isManagedMediaReference } from "./durable-media/constants.ts";
import {
  findDurableMediaViolations as findViolations,
  formatDurableMediaViolations,
} from "./durable-media/scan.ts";
import { sanitizeDurableMediaState as sanitizeState } from "./durable-media/sanitize.ts";
import type {
  DurableMediaSanitization,
  DurableMediaViolation,
} from "./durable-media/types.ts";

export type {
  DurableMediaSanitization,
  DurableMediaViolation,
} from "./durable-media/types.ts";
export { materializeDocumentRootTypes } from "./durable-media/materialize.ts";

export function findDurableMediaViolations(
  document: Y.Doc,
): DurableMediaViolation[] {
  return findViolations(document);
}

export function sanitizeDurableMediaState(
  state: Uint8Array,
): DurableMediaSanitization {
  const sanitized: DurableMediaSanitization = sanitizeState(state);
  const document = new Y.Doc();
  if (sanitized.state.length > 0) {
    Y.applyUpdate(document, sanitized.state);
  }
  assertDurableMediaState("sanitized document", document);
  return sanitized;
}

export function assertNoManagedMediaReferences(
  name: string,
  value: unknown,
): void {
  let serialized: string | undefined;
  if (typeof value === "string") {
    serialized = value;
  } else if (value instanceof Uint8Array) {
    serialized = new TextDecoder().decode(value);
  } else {
    serialized = JSON.stringify(value);
  }
  if (serialized && isManagedMediaReference(serialized)) {
    throw new Error(`Refusing managed media reference in ${name}`);
  }
}

export function assertDurableMediaState(
  documentName: string,
  document: Y.Doc,
): void {
  const violations: DurableMediaViolation[] =
    findDurableMediaViolations(document);
  if (violations.length === 0) {
    return;
  }

  throw new Error(
    `Refusing managed media state in ${documentName}: ${formatDurableMediaViolations(violations)}`,
  );
}
