import {
  DEFAULT_DOCUMENT_LAYOUT,
  DOCUMENT_LAYOUT_FIELD_KEYS,
  documentLayoutSchema,
  hasExplicitDocumentLayout,
  readDocumentLayout,
  writeDocumentLayout,
  type DocumentLayout,
} from "@echovisionlab/geul-common/collaboration/document-layout";
import * as Y from "yjs";
import { computeHash } from "./hash.ts";
import {
  findDocumentLayoutRootViolations,
  type DocumentLayoutRootViolation,
} from "./legacy-document-layout-root.ts";

const DOCUMENT_SETTINGS_MAP_NAMES = {
  page: "page-fields",
  post: "post-meta",
} as const;

const textEncoder = new TextEncoder();
export type DocumentLayoutOwner = keyof typeof DOCUMENT_SETTINGS_MAP_NAMES;
type DocumentLayoutBoundary = "shared" | "locale";

function decodeDocument(state?: Uint8Array | null): Y.Doc {
  const document = new Y.Doc();
  if (state && state.length > 0) {
    Y.applyUpdate(document, state);
  }
  return document;
}

export function documentSettingsMapName(owner: DocumentLayoutOwner): string {
  return DOCUMENT_SETTINGS_MAP_NAMES[owner];
}

function settingsMap(
  document: Y.Doc,
  owner: DocumentLayoutOwner,
): Y.Map<unknown> {
  return document.getMap(documentSettingsMapName(owner));
}

function existingSettingsMap(
  document: Y.Doc,
  owner: DocumentLayoutOwner,
): Y.Map<unknown> | null {
  const name = documentSettingsMapName(owner);
  return document.share.has(name) ? document.getMap(name) : null;
}

function hasAnyLayoutField(map: Y.Map<unknown>): boolean {
  return DOCUMENT_LAYOUT_FIELD_KEYS.some((key) => map.has(key));
}

function readLayoutIfPresent(map: Y.Map<unknown>): DocumentLayout | null {
  return hasAnyLayoutField(map) ? readDocumentLayout(map) : null;
}

function findDocumentLayoutBoundaryViolations(
  owner: DocumentLayoutOwner,
  boundary: DocumentLayoutBoundary,
  state?: Uint8Array | null,
): DocumentLayoutRootViolation[] {
  return findDocumentLayoutRootViolations(
    state,
    boundary === "shared" ? documentSettingsMapName(owner) : null,
  );
}

function assertNoDocumentLayoutBoundaryViolation(
  owner: DocumentLayoutOwner,
  boundary: DocumentLayoutBoundary,
  state?: Uint8Array | null,
): void {
  const violation = findDocumentLayoutBoundaryViolations(
    owner,
    boundary,
    state,
  )[0];
  if (!violation) {
    return;
  }
  const scope = boundary === "shared" ? "Shared" : "Locale";
  if (violation.reason === "legacy-root") {
    throw new Error(
      `${scope} ${owner} Yjs contains forbidden legacy root: ${violation.rootName}`,
    );
  }
  if (boundary === "shared") {
    throw new Error(
      `Shared ${owner} Yjs contains document layout fields outside ${documentSettingsMapName(owner)}: ${violation.rootName}`,
    );
  }
  throw new Error(
    `Locale ${owner} Yjs must not contain document layout fields: ${violation.rootName}`,
  );
}

export function assertSharedDocumentLayoutBoundary(
  owner: DocumentLayoutOwner,
  state?: Uint8Array | null,
): void {
  assertNoDocumentLayoutBoundaryViolation(owner, "shared", state);
  if (!state || state.length === 0) {
    return;
  }
  const document = decodeDocument(state);
  const existingMap = existingSettingsMap(document, owner);
  if (existingMap && hasAnyLayoutField(existingMap)) {
    readDocumentLayout(existingMap);
  }
}

export function assertLocaleDocumentLayoutAbsent(
  owner: DocumentLayoutOwner,
  state?: Uint8Array | null,
): void {
  assertNoDocumentLayoutBoundaryViolation(owner, "locale", state);
}

export function readSharedDocumentLayoutFromState(
  owner: DocumentLayoutOwner,
  state?: Uint8Array | null,
): DocumentLayout {
  assertSharedDocumentLayoutBoundary(owner, state);
  return readDocumentLayout(settingsMap(decodeDocument(state), owner));
}

export function hasCanonicalSharedDocumentLayout(
  owner: DocumentLayoutOwner,
  state?: Uint8Array | null,
): boolean {
  if (!state || state.length === 0) {
    return false;
  }
  try {
    assertSharedDocumentLayoutBoundary(owner, state);
  } catch {
    return false;
  }
  const existingMap = existingSettingsMap(decodeDocument(state), owner);
  return Boolean(existingMap && hasExplicitDocumentLayout(existingMap));
}

export function normalizeSharedDocumentLayoutState(
  owner: DocumentLayoutOwner,
  state?: Uint8Array | null,
): Buffer {
  assertSharedDocumentLayoutBoundary(owner, state);
  const document = decodeDocument(state);
  const targetMap = settingsMap(document, owner);
  const layout = documentLayoutSchema.parse(
    readLayoutIfPresent(targetMap) ?? DEFAULT_DOCUMENT_LAYOUT,
  );

  if (
    hasExplicitDocumentLayout(targetMap) &&
    targetMap.get("contentHeight") === layout.contentHeight &&
    targetMap.get("pageChrome") === layout.pageChrome &&
    targetMap.get("footer") === layout.footer &&
    state &&
    state.length > 0
  ) {
    return Buffer.from(state);
  }

  writeDocumentLayout(targetMap, layout);
  return Buffer.from(Y.encodeStateAsUpdate(document));
}

function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalValue).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function computePageStructureHash(state?: Uint8Array | null): string {
  const document = decodeDocument(state);
  const sections = document.getArray<unknown>("sections").toJSON();
  return computeHash(Buffer.from(textEncoder.encode(canonicalValue(sections))));
}
