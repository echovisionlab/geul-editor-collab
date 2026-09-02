import { createHash } from "node:crypto";
import { JSDOM } from "jsdom";

type InlineStyles = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  textColor?: string;
  backgroundColor?: string;
};

type InlineContent =
  | { type: "text"; text: string; styles: InlineStyles }
  | {
      type: "link";
      href: string;
      content: Array<{ type: "text"; text: string; styles: InlineStyles }>;
    };

type BlockProps = {
  backgroundColor: string;
  textColor: string;
  textAlignment: "left" | "center" | "right" | "justify";
};

type LegacyEmailBlock = {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children: LegacyEmailBlock[];
};

const inlineTags = new Set([
  "SPAN",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "STRIKE",
  "DEL",
  "CODE",
]);

const defaultBlockProps: BlockProps = {
  backgroundColor: "default",
  textColor: "default",
  textAlignment: "left",
};

function blockId(index: number, source: string): string {
  return `email-html-${createHash("sha256")
    .update(`${index}\0${source}`)
    .digest("hex")
    .slice(0, 16)}`;
}

function textBlock(
  text: string,
  index: number,
  source: string,
): LegacyEmailBlock {
  return {
    id: blockId(index, source),
    type: "paragraph",
    props: { ...defaultBlockProps },
    content: [{ type: "text", text, styles: {} }],
    children: [],
  };
}

function childElement(node: ChildNode, parent: ParentNode): HTMLElement | null {
  return node instanceof parent.ownerDocument!.defaultView!.HTMLElement
    ? node
    : null;
}

function inlineText(
  node: ChildNode,
  styles: InlineStyles,
): InlineContent[] | null {
  if (node.nodeType !== node.TEXT_NODE) return null;
  return [{ type: "text", text: node.textContent!, styles }];
}

function inlineContent(
  parent: ParentNode,
  inherited: InlineStyles = {},
): InlineContent[] {
  const content: InlineContent[] = [];
  for (const node of parent.childNodes) {
    const text = inlineText(node, inherited);
    if (text) {
      content.push(...text);
      continue;
    }
    const element = childElement(node, parent);
    if (!element) continue;
    content.push(...inlineElementContent(element, inherited));
  }
  return content;
}

function inlineElementContent(
  element: HTMLElement,
  inherited: InlineStyles,
): InlineContent[] {
  if (element.tagName === "BR") {
    return [{ type: "text", text: "\n", styles: inherited }];
  }
  const styles = inlineStyles(element, inherited);
  if (element.tagName === "A") {
    return [linkContent(element, styles)];
  }
  if (!inlineTags.has(element.tagName)) {
    throw new Error(
      `Unsupported email HTML inline element: ${element.tagName.toLowerCase()}`,
    );
  }
  return inlineContent(element, styles);
}

function linkContent(
  element: HTMLElement,
  styles: InlineStyles,
): Extract<InlineContent, { type: "link" }> {
  const href = element.getAttribute("href");
  if (!href) throw new Error("Invalid email HTML link without href");
  const content = inlineContent(element, styles).flatMap((item) =>
    item.type === "text"
      ? [item]
      : /* v8 ignore next -- the HTML parser normalizes nested anchors into siblings */ item.content,
  );
  return { type: "link", href, content };
}

function inlineStyles(
  element: HTMLElement,
  inherited: InlineStyles,
): InlineStyles {
  const styles = { ...inherited };
  if (element.matches("strong, b")) styles.bold = true;
  if (element.matches("em, i")) styles.italic = true;
  if (element.matches("u")) styles.underline = true;
  if (element.matches("s, strike, del")) styles.strike = true;
  if (element.matches("code")) styles.code = true;
  if (element.style.color) styles.textColor = element.style.color;
  if (element.style.backgroundColor)
    styles.backgroundColor = element.style.backgroundColor;
  return styles;
}

function blockProps(element: HTMLElement): BlockProps {
  const alignment = element.style.textAlign;
  return {
    backgroundColor: element.style.backgroundColor || "default",
    textColor: element.style.color || "default",
    textAlignment:
      alignment === "center" || alignment === "right" || alignment === "justify"
        ? alignment
        : "left",
  };
}

function textElementBlock(
  element: HTMLElement,
  id: string,
  type: "paragraph" | "heading",
): LegacyEmailBlock {
  const props: Record<string, unknown> = blockProps(element);
  if (type === "heading") props.level = Number(element.tagName.slice(1));
  return { id, type, props, content: inlineContent(element), children: [] };
}

function quoteBlock(element: HTMLElement, id: string): LegacyEmailBlock {
  const props = blockProps(element);
  return {
    id,
    type: "quote",
    props: {
      backgroundColor: props.backgroundColor,
      textColor: props.textColor,
    },
    content: inlineContent(element),
    children: [],
  };
}

function codeBlock(element: HTMLElement, id: string): LegacyEmailBlock {
  const code = element.querySelector(":scope > code") ?? element;
  const language =
    [...code.classList]
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length) || "plaintext";
  return {
    id,
    type: "codeBlock",
    props: { language },
    content: [{ type: "text", text: code.textContent!, styles: {} }],
    children: [],
  };
}

function listBlocks(
  element: HTMLElement,
  index: number,
  source: string,
): LegacyEmailBlock[] {
  const ordered = element.tagName === "OL";
  return [...element.children].map((child, childIndex) => {
    const listItem = child as HTMLElement;
    const clone = listItem.cloneNode(true) as HTMLElement;
    for (const nested of clone.querySelectorAll(":scope > ul, :scope > ol"))
      nested.remove();
    const props: Record<string, unknown> = blockProps(listItem);
    if (ordered)
      props.start = Number(element.getAttribute("start") ?? 1) + childIndex;
    return {
      id: blockId(index + childIndex, `${source}\0${listItem.outerHTML}`),
      type: ordered ? "numberedListItem" : "bulletListItem",
      props,
      content: inlineContent(clone),
      children: [],
    };
  });
}

function tableRows(element: HTMLElement): HTMLElement[] {
  return [
    ...element.querySelectorAll(
      ":scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr, :scope > tr",
    ),
  ] as HTMLElement[];
}

function tableBlock(element: HTMLElement, id: string): LegacyEmailBlock {
  const rowElements = tableRows(element);
  if (rowElements.length === 0)
    throw new Error("Invalid email HTML table without rows");
  const rows = rowElements.map((row) => ({
    cells: [...row.children].map((cell) => tableCell(cell as HTMLElement)),
  }));
  const width = Math.max(
    ...rows.map((row) =>
      row.cells.reduce((sum, cell) => sum + Number(cell.props.colspan), 0),
    ),
  );
  return {
    id,
    type: "table",
    props: { textColor: element.style.color || "default" },
    content: {
      type: "tableContent",
      columnWidths: Array.from({ length: width }, () => null),
      headerRows: headerRowCount(rowElements),
      headerCols: headerColumnCount(rowElements),
      rows,
    },
    children: [],
  };
}

function tableCell(cell: HTMLElement): {
  type: "tableCell";
  props: Record<string, unknown>;
  content: InlineContent[];
} {
  const props = blockProps(cell);
  return {
    type: "tableCell",
    props: {
      backgroundColor: props.backgroundColor,
      textColor: props.textColor,
      textAlignment: props.textAlignment,
      colspan: Number(cell.getAttribute("colspan") ?? 1),
      rowspan: Number(cell.getAttribute("rowspan") ?? 1),
    },
    content: inlineContent(cell),
  };
}

function headerRowCount(rows: HTMLElement[]): number {
  const firstBodyRow = rows.findIndex((row) =>
    [...row.children].some((cell) => cell.tagName !== "TH"),
  );
  return firstBodyRow === -1 ? rows.length : firstBodyRow;
}

function headerColumnCount(rows: HTMLElement[]): number {
  return Math.min(
    ...rows.map((row) => {
      const cells = [...row.children];
      const firstBodyCell = cells.findIndex((cell) => cell.tagName !== "TH");
      return firstBodyCell === -1 ? cells.length : firstBodyCell;
    }),
  );
}

type BlockFactory = (element: HTMLElement, id: string) => LegacyEmailBlock;

const blockFactories: Record<string, BlockFactory> = {
  P: (element, id) => textElementBlock(element, id, "paragraph"),
  H1: (element, id) => textElementBlock(element, id, "heading"),
  H2: (element, id) => textElementBlock(element, id, "heading"),
  H3: (element, id) => textElementBlock(element, id, "heading"),
  H4: (element, id) => textElementBlock(element, id, "heading"),
  H5: (element, id) => textElementBlock(element, id, "heading"),
  H6: (element, id) => textElementBlock(element, id, "heading"),
  BLOCKQUOTE: quoteBlock,
  HR: (_element, id) => ({ id, type: "divider", props: {}, children: [] }),
  PRE: codeBlock,
  TABLE: tableBlock,
};

function elementBlocks(
  element: HTMLElement,
  index: number,
  source: string,
): LegacyEmailBlock[] {
  const id = blockId(index, `${source}\0${element.outerHTML}`);
  if (element.matches("ul, ol")) return listBlocks(element, index, source);
  const factory = blockFactories[element.tagName];
  if (!factory) {
    throw new Error(
      `Unsupported email HTML block element: ${element.tagName.toLowerCase()}`,
    );
  }
  return [factory(element, id)];
}

function appendLegacyEmailNode(
  node: ChildNode,
  document: Document,
  blocks: LegacyEmailBlock[],
  html: string,
): void {
  if (node.nodeType === node.TEXT_NODE) {
    appendLegacyEmailText(node, blocks, html);
    return;
  }
  if (!(node instanceof document.defaultView!.HTMLElement)) return;
  blocks.push(...elementBlocks(node, blocks.length, html));
}

function appendLegacyEmailText(
  node: ChildNode,
  blocks: LegacyEmailBlock[],
  html: string,
): void {
  const text = node.textContent;
  if (!text?.trim()) return;
  blocks.push(textBlock(text, blocks.length, html));
}

export function parseLegacyEmailHtmlBlocks(html: string): LegacyEmailBlock[] {
  const document = new JSDOM(`<!doctype html><body>${html}</body>`).window
    .document;
  const blocks: LegacyEmailBlock[] = [];
  for (const node of document.body.childNodes) {
    appendLegacyEmailNode(node, document, blocks, html);
  }
  return blocks;
}
