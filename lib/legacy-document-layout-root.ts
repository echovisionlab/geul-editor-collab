import { DOCUMENT_LAYOUT_FIELD_KEYS } from "@echovisionlab/geul-common/collaboration/document-layout";
import * as Y from "yjs";
import { materializeDocumentRootTypes } from "./durable-media-guard.ts";

const LEGACY_DOCUMENT_LAYOUT_ROOT_NAME = "document-layout";

export interface DocumentLayoutRootViolation {
  rootName: string;
  reason: "legacy-root" | "layout-fields";
}

function decodeDocument(state?: Uint8Array | null): Y.Doc | null {
  if (!state || state.length === 0) {
    return null;
  }

  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  return document;
}

export function findDocumentLayoutRootViolations(
  state: Uint8Array | null | undefined,
  canonicalRootName: string | null,
): DocumentLayoutRootViolation[] {
  const document = decodeDocument(state);
  if (!document) {
    return [];
  }

  const violations: DocumentLayoutRootViolation[] = [];
  if (document.share.has(LEGACY_DOCUMENT_LAYOUT_ROOT_NAME)) {
    violations.push({
      rootName: LEGACY_DOCUMENT_LAYOUT_ROOT_NAME,
      reason: "legacy-root",
    });
  }

  materializeDocumentRootTypes(document);
  for (const [rootName, value] of document.share.entries()) {
    if (
      rootName !== LEGACY_DOCUMENT_LAYOUT_ROOT_NAME &&
      rootName !== canonicalRootName &&
      value instanceof Y.Map &&
      DOCUMENT_LAYOUT_FIELD_KEYS.some((key) => value.has(key))
    ) {
      violations.push({ rootName, reason: "layout-fields" });
    }
  }
  return violations;
}
