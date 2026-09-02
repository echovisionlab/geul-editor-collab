import * as Y from "yjs";
import {
  assertClosedAttributes,
  assertClosedNodeAttributeValues,
  emailAllowedMarks,
  emailBlockNodeNames,
  emailInlineBlockNodeNames,
} from "./shared.ts";
import {
  assertIntervalTableGeometry,
  type TableGeometryCell,
} from "./table-geometry.ts";

const emailNodeNames = new Set([
  "blockGroup",
  "blockContainer",
  ...emailBlockNodeNames,
  "tableRow",
  "tableHeader",
  "tableCell",
  "tableParagraph",
  "hardBreak",
]);

const emailTextBlockAttributes = new Set([
  "backgroundColor",
  "textColor",
  "textAlignment",
]);
const emailDefaultTextBlockNodeNames = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
]);

function emailTextBlockAttributesFor(nodeName: string): ReadonlySet<string> {
  if (nodeName === "heading") {
    return new Set([...emailTextBlockAttributes, "level"]);
  }
  if (nodeName === "numberedListItem") {
    return new Set([...emailTextBlockAttributes, "start"]);
  }
  if (nodeName === "checkListItem") {
    return new Set([...emailTextBlockAttributes, "checked"]);
  }
  return emailTextBlockAttributes;
}

function emailNodeAttributes(nodeName: string): ReadonlySet<string> {
  if (nodeName === "blockContainer") return new Set(["id"]);
  if (nodeName === "codeBlock") return new Set(["language"]);
  if (emailDefaultTextBlockNodeNames.has(nodeName)) {
    return emailTextBlockAttributesFor(nodeName);
  }
  if (nodeName === "quote") return new Set(["backgroundColor", "textColor"]);
  if (nodeName === "callout") {
    return new Set(["icon", "backgroundColor", "textColor"]);
  }
  if (nodeName === "table") return new Set(["textColor"]);
  if (nodeName === "tableHeader" || nodeName === "tableCell")
    return new Set([
      "colspan",
      "rowspan",
      "colwidth",
      "backgroundColor",
      "textColor",
      "textAlignment",
    ]);
  return new Set();
}

function canonicalEmailTableRows(table: Y.XmlElement): {
  headerMatrix: boolean[][];
  geometryRows: TableGeometryCell[][];
} {
  const rows = table.toArray() as Y.XmlElement[];
  const headerMatrix: boolean[][] = [];
  const geometryRows: TableGeometryCell[][] = [];

  for (const [rowIndex, row] of rows.entries()) {
    headerMatrix[rowIndex] = [];
    geometryRows[rowIndex] = [];
    for (const [cellIndex, cell] of (
      row.toArray() as Y.XmlElement[]
    ).entries()) {
      const colspan = Number(cell.getAttribute("colspan") ?? 1);
      const rowspan = Number(cell.getAttribute("rowspan") ?? 1);
      const colwidth = cell.getAttribute("colwidth");
      if (!isCanonicalColumnWidth(colspan, colwidth)) {
        throw new Error("Invalid email Yjs table colwidth");
      }

      geometryRows[rowIndex].push({ colspan, rowspan });
      headerMatrix[rowIndex][cellIndex] = cell.nodeName === "tableHeader";
    }
  }

  return { headerMatrix, geometryRows };
}

function isCanonicalColumnWidth(colspan: number, colwidth: unknown): boolean {
  if (colspan > 1) {
    return Array.isArray(colwidth) && colwidth.length === colspan;
  }
  return (
    colwidth === undefined ||
    colwidth === null ||
    (Array.isArray(colwidth) && colwidth.length === 1)
  );
}

function assertCanonicalEmailTableHeaders(
  headerMatrix: readonly (readonly boolean[])[],
): void {
  const headerRows = headerMatrix.filter(
    (row) => row.length > 0 && row.every(Boolean),
  ).length;
  const headerCols = Array.from(
    { length: headerMatrix[0].length },
    (_, columnIndex) => headerMatrix.every((row) => row[columnIndex] === true),
  ).filter(Boolean).length;

  for (const [rowIndex, row] of headerMatrix.entries()) {
    for (const [cellIndex, isHeader] of row.entries()) {
      if (isHeader !== (rowIndex < headerRows || cellIndex < headerCols)) {
        throw new Error("Invalid email Yjs non-canonical table headers");
      }
    }
  }
}

function assertCanonicalEmailTableGeometry(table: Y.XmlElement): void {
  const { headerMatrix, geometryRows } = canonicalEmailTableRows(table);
  assertIntervalTableGeometry(geometryRows, "Yjs");
  assertCanonicalEmailTableHeaders(headerMatrix);
}

function assertEmailMark(markName: string, rawMarkAttributes: unknown): void {
  if (!emailAllowedMarks.has(markName)) {
    throw new Error(`Unsupported email Yjs inline mark: ${markName}`);
  }
  if (
    rawMarkAttributes === null ||
    typeof rawMarkAttributes !== "object" ||
    Array.isArray(rawMarkAttributes)
  ) {
    throw new Error(`Invalid email Yjs inline mark attributes: ${markName}`);
  }
  const attributes = rawMarkAttributes as Record<string, unknown>;
  assertClosedAttributes(
    `inline mark ${markName}`,
    attributes,
    emailMarkAttributes(markName),
  );
  assertEmailMarkAttributeValues(markName, attributes);
}

function emailMarkAttributes(markName: string): ReadonlySet<string> {
  if (markName === "link") return new Set(["href"]);
  if (markName === "textColor" || markName === "backgroundColor") {
    return new Set(["stringValue"]);
  }
  return new Set();
}

function assertEmailMarkAttributeValues(
  markName: string,
  attributes: Record<string, unknown>,
): void {
  if (
    (markName === "textColor" || markName === "backgroundColor") &&
    typeof attributes.stringValue !== "string"
  ) {
    throw new Error(
      `Invalid email Yjs inline mark attribute value: ${markName}`,
    );
  }
  if (markName === "link" && typeof attributes.href !== "string") {
    throw new Error("Invalid email Yjs inline mark attribute value: link");
  }
}

function assertClosedEmailXmlText(text: Y.XmlText): void {
  assertClosedAttributes("text", text.getAttributes(), new Set());

  for (const delta of text.toDelta()) {
    if (typeof delta.insert !== "string") {
      throw new Error("Unsupported email Yjs inline embed");
    }

    for (const [markName, rawMarkAttributes] of Object.entries(
      delta.attributes ?? {},
    )) {
      assertEmailMark(markName, rawMarkAttributes);
    }
  }
}

function allowedEmailChildElementNames(nodeName: string): ReadonlySet<string> {
  if (nodeName === "blockGroup") {
    return new Set(["blockContainer"]);
  }
  if (nodeName === "blockContainer") {
    return new Set([...emailBlockNodeNames, "blockGroup"]);
  }
  if (
    emailInlineBlockNodeNames.has(nodeName) ||
    nodeName === "tableParagraph"
  ) {
    return new Set(["hardBreak"]);
  }
  if (nodeName === "table") {
    return new Set(["tableRow"]);
  }
  if (nodeName === "tableRow") {
    return new Set(["tableHeader", "tableCell"]);
  }
  if (nodeName === "tableHeader" || nodeName === "tableCell") {
    return new Set(["tableParagraph"]);
  }
  return new Set();
}

function emailNodeAllowsText(nodeName: string): boolean {
  return (
    emailInlineBlockNodeNames.has(nodeName) || nodeName === "tableParagraph"
  );
}

function isValidBlockContainerChildren(
  children: Array<Y.XmlElement | Y.XmlText | Y.XmlHook>,
): boolean {
  return (
    children.length >= 1 &&
    children.length <= 2 &&
    children[0] instanceof Y.XmlElement &&
    children[0].nodeName !== "blockGroup" &&
    (children.length !== 2 ||
      (children[1] instanceof Y.XmlElement &&
        children[1].nodeName === "blockGroup"))
  );
}

function assertEmailTableChildren(
  nodeName: string,
  children: Array<Y.XmlElement | Y.XmlText | Y.XmlHook>,
): void {
  if (
    (nodeName === "table" || nodeName === "tableRow") &&
    children.length === 0
  ) {
    throw new Error(`Invalid email Yjs ${nodeName} structure`);
  }
  if (nodeName !== "tableHeader" && nodeName !== "tableCell") {
    return;
  }
  const child = children[0];
  if (
    children.length !== 1 ||
    !(child instanceof Y.XmlElement) ||
    child.nodeName !== "tableParagraph"
  ) {
    throw new Error(`Invalid email Yjs ${nodeName} structure`);
  }
}

function assertEmailChildCardinality(
  nodeName: string,
  children: Array<Y.XmlElement | Y.XmlText | Y.XmlHook>,
): void {
  if (nodeName !== "blockContainer") {
    assertEmailTableChildren(nodeName, children);
    return;
  }
  if (isValidBlockContainerChildren(children)) {
    return;
  }
  throw new Error("Invalid email Yjs blockContainer structure");
}

function assertClosedEmailXmlChild(
  child: Y.XmlElement | Y.XmlText | Y.XmlHook,
  nodeName: string,
  allowedChildElements: ReadonlySet<string>,
  allowsText: boolean,
): void {
  if (child instanceof Y.XmlElement) {
    assertClosedEmailXmlElementChild(child, nodeName, allowedChildElements);
    return;
  }
  if (child instanceof Y.XmlText && !allowsText) {
    throw new Error(`Invalid email Yjs text under ${nodeName}`);
  }
  if (child instanceof Y.XmlText) {
    assertClosedEmailXmlText(child);
    return;
  }
  throw new Error(`Unsupported email Yjs child in node: ${nodeName}`);
}

function assertClosedEmailXmlElementChild(
  child: Y.XmlElement,
  nodeName: string,
  allowedChildElements: ReadonlySet<string>,
): void {
  assertClosedEmailXmlElement(child);
  if (!allowedChildElements.has(child.nodeName)) {
    throw new Error(
      `Invalid email Yjs child ${child.nodeName} under ${nodeName}`,
    );
  }
}

function assertClosedEmailXmlElement(element: Y.XmlElement): void {
  const nodeName = element.nodeName;
  if (!emailNodeNames.has(nodeName)) {
    throw new Error(`Unsupported email Yjs node: ${nodeName}`);
  }

  assertClosedAttributes(
    `node ${nodeName}`,
    element.getAttributes(),
    emailNodeAttributes(nodeName),
  );
  assertClosedNodeAttributeValues(nodeName, element.getAttributes());

  const children = element.toArray();
  assertEmailChildCardinality(nodeName, children);
  const allowedChildElements = allowedEmailChildElementNames(nodeName);
  const allowsText = emailNodeAllowsText(nodeName);

  for (const child of children) {
    assertClosedEmailXmlChild(
      child,
      nodeName,
      allowedChildElements,
      allowsText,
    );
  }

  if (nodeName === "table") {
    assertCanonicalEmailTableGeometry(element);
  }
}

function assertClosedEmailYjsFragment(fragment: Y.XmlFragment): void {
  const roots = fragment.toArray();
  if (
    roots.length !== 1 ||
    !(roots[0] instanceof Y.XmlElement) ||
    roots[0].nodeName !== "blockGroup"
  ) {
    throw new Error("Invalid email Yjs document root");
  }

  assertClosedEmailXmlElement(roots[0]);
}

interface EmailSharedRoot {
  _start: {
    right: unknown;
    content: { getContent(): unknown[] };
  } | null;
  _map: Map<string, unknown>;
}

function assertEmailDocumentRoot(
  document: Y.Doc,
  documentRoot: EmailSharedRoot | undefined,
): void {
  if (!documentRoot) {
    return;
  }
  if (documentRoot._map.size > 0) {
    throw new Error("Invalid email Yjs root type: document-store");
  }
  let item = documentRoot._start;
  while (item) {
    const hasInvalidContent = item.content
      .getContent()
      .some(
        (content) =>
          !(content instanceof Y.XmlElement) &&
          !(content instanceof Y.XmlText) &&
          !(content instanceof Y.XmlHook),
      );
    if (hasInvalidContent) {
      throw new Error("Invalid email Yjs root type: document-store");
    }
    item = item.right as typeof item;
  }
  assertClosedEmailYjsFragment(document.getXmlFragment("document-store"));
}

function assertEmailTranslationRoot(
  document: Y.Doc,
  translationRoot: EmailSharedRoot | undefined,
): void {
  if (!translationRoot) {
    return;
  }
  if (translationRoot._start !== null) {
    throw new Error("Invalid email Yjs root type: translation-meta");
  }
  const translationMeta = document.getMap<unknown>("translation-meta");
  for (const [key, value] of translationMeta.entries()) {
    if (key !== "title" && key !== "summary") {
      throw new Error(`Unsupported email Yjs translation-meta key: ${key}`);
    }
    if (typeof value !== "string") {
      throw new Error(`Invalid email Yjs translation-meta value: ${key}`);
    }
  }
}

export function assertClosedEmailYjsDocument(document: Y.Doc): void {
  const sharedRoots = (
    document as Y.Doc & {
      share: Map<string, EmailSharedRoot>;
    }
  ).share;

  for (const name of sharedRoots.keys()) {
    if (name !== "document-store" && name !== "translation-meta") {
      throw new Error(`Unsupported email Yjs root: ${name}`);
    }
  }

  // Yjs does not encode named-root constructors. Inspect the decoded
  // AbstractType before binding it, otherwise an incompatible map/sequence can
  // become invisible while remaining in the original update.
  assertEmailDocumentRoot(document, sharedRoots.get("document-store"));
  assertEmailTranslationRoot(document, sharedRoots.get("translation-meta"));
}
