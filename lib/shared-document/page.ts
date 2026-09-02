import { stripPageLocaleSectionProps } from "@echovisionlab/geul-common/collaboration/page";
import * as Y from "yjs";
import { sanitizeDurableMediaState } from "../durable-media-guard.ts";
import {
  decodeSharedDocument,
  getSharedArray,
  getSharedFragment,
  sanitizeNeutralRichTextFragment,
} from "./core.ts";

export function sanitizePageSharedDocumentState(
  state: Buffer | Uint8Array,
): Buffer;
export function sanitizePageSharedDocumentState(state: null): null;
export function sanitizePageSharedDocumentState(
  state: Buffer | Uint8Array | null,
): Buffer | null;
export function sanitizePageSharedDocumentState(
  state: Buffer | Uint8Array | null,
): Buffer | null {
  if (!state || state.length === 0) {
    return null;
  }

  const sharedDoc = decodeSharedDocument(
    sanitizeDurableMediaState(state).state,
  );
  const sections = getSharedArray(sharedDoc, "sections");
  const currentSections = sections?.toArray() ?? [];
  const sanitizedSections = sanitizeSharedPageSections(
    currentSections,
    new Set<string>(),
  );

  const durableDocument = new Y.Doc();
  durableDocument.clientID = 1;
  if (sanitizedSections.length > 0) {
    durableDocument.getArray("sections").push(sanitizedSections);
  }
  for (const sectionID of collectSharedRichTextSectionIDs(sanitizedSections)) {
    const source = getSharedFragment(sharedDoc, `section-${sectionID}`);
    if (!source) {
      continue;
    }
    sanitizeNeutralRichTextFragment(source);
    const nodes = source
      .toArray()
      .filter(
        (node): node is Y.XmlElement | Y.XmlText =>
          node instanceof Y.XmlElement || node instanceof Y.XmlText,
      )
      .map((node) => node.clone());
    if (nodes.length > 0) {
      durableDocument.getXmlFragment(`section-${sectionID}`).insert(0, nodes);
    }
  }

  return Buffer.from(Y.encodeStateAsUpdate(durableDocument));
}

function collectSharedRichTextSectionIDs(
  sections: unknown[],
  ids: Set<string> = new Set<string>(),
): ReadonlySet<string> {
  for (const section of sections) {
    const record = sharedSectionRecord(section);
    if (!record) {
      continue;
    }
    addSharedRichTextSectionID(record, ids);
    collectSharedColumnRichTextSectionIDs(record, ids);
  }
  return ids;
}

function sharedSectionRecord(section: unknown): Record<string, unknown> | null {
  return section && typeof section === "object" && !Array.isArray(section)
    ? (section as Record<string, unknown>)
    : null;
}

function addSharedRichTextSectionID(
  section: Record<string, unknown>,
  ids: Set<string>,
): void {
  if (section.type === "rich-text" && typeof section.id === "string") {
    ids.add(section.id);
  }
}

function collectSharedColumnRichTextSectionIDs(
  section: Record<string, unknown>,
  ids: Set<string>,
): void {
  if (section.type !== "columns" || !Array.isArray(section.columns)) {
    return;
  }
  for (const column of section.columns) {
    const record = sharedSectionRecord(column);
    if (!record || !Array.isArray(record.sections)) {
      continue;
    }
    collectSharedRichTextSectionIDs(record.sections, ids);
  }
}

function stripLocalizedPageSectionProps(
  section: unknown,
  seenSectionIDs: Set<string>,
): unknown | null {
  const candidate = sharedSectionRecord(section);
  if (!candidate) {
    return section;
  }

  const sectionID = typeof candidate.id === "string" ? candidate.id : "";
  if (sectionID && seenSectionIDs.has(sectionID)) {
    return null;
  }
  if (sectionID) {
    seenSectionIDs.add(sectionID);
  }
  const next: Record<string, unknown> = { ...candidate };

  if (candidate.type === "rich-text") {
    delete next.content;
  }

  const props = sanitizedSectionProps(candidate.props);
  if (props) {
    next.props = props;
  }

  const columns = sanitizedSectionColumns(candidate, seenSectionIDs);
  if (columns) {
    next.columns = columns;
  }

  return next;
}

function sanitizedSectionProps(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return stripPageLocaleSectionProps(value as Record<string, unknown>);
}

function sanitizedSectionColumn(
  column: unknown,
  seenSectionIDs: Set<string>,
): unknown {
  const columnRecord = sharedSectionRecord(column);
  if (!columnRecord) {
    return column;
  }
  const columnNext: Record<string, unknown> = { ...columnRecord };
  if (Array.isArray(columnRecord.sections)) {
    columnNext.sections = sanitizeSharedPageSections(
      columnRecord.sections,
      seenSectionIDs,
    );
  }
  return columnNext;
}

function sanitizedSectionColumns(
  section: Record<string, unknown>,
  seenSectionIDs: Set<string>,
): unknown[] | undefined {
  if (section.type !== "columns" || !Array.isArray(section.columns)) {
    return undefined;
  }
  return section.columns.map((column) =>
    sanitizedSectionColumn(column, seenSectionIDs),
  );
}

function sanitizeSharedPageSections(
  sections: unknown[],
  seenSectionIDs: Set<string>,
): unknown[] {
  const sanitized: unknown[] = [];

  for (const section of sections) {
    const nextSection = stripLocalizedPageSectionProps(section, seenSectionIDs);
    if (nextSection !== null) {
      sanitized.push(nextSection);
    }
  }

  return sanitized;
}
