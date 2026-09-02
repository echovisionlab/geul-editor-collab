import { isRecord, TABLE_CELL_ATTRIBUTE_VALIDATORS } from "./schema.ts";
import {
  assertAttributes,
  assertNoAttributes,
  assertNodeType,
  nodeAttributes,
  nodeChildren,
} from "./node-validation.ts";
import {
  inlineContentFromNode,
  inlineContentToProseMirror,
} from "./inline-content.ts";
import type { InlineContent } from "./inline-content.ts";
import type { GeulRichTextSchema, ProseMirrorJsonNode } from "./schema.ts";

type TableInterval = {
  start: number;
  end: number;
  endRow: number;
  header: boolean;
};
type TableLayout = {
  columnWidths: Array<number | undefined>;
  headerRows: number | undefined;
  headerCols: number | undefined;
};

export function tableContentFromNode(
  node: ProseMirrorJsonNode,
  schema: GeulRichTextSchema,
) {
  const layout = assertTableLayout(node, schema);
  const rows = nodeChildren(node).map((row) => ({
    cells: nodeChildren(row).map((cell) => readTableCell(cell, schema)),
  }));
  return {
    type: "tableContent" as const,
    columnWidths: layout.columnWidths,
    headerRows: layout.headerRows,
    headerCols: layout.headerCols,
    rows,
  };
}

export function assertTableLayout(
  node: ProseMirrorJsonNode,
  schema: GeulRichTextSchema,
): TableLayout {
  const rows = nodeChildren(node);
  if (rows.length === 0) throw new Error("Invalid rich-text table structure");
  let activeIntervals: TableInterval[] = [];
  let tableWidth: number | undefined;
  for (const [rowIndex, row] of rows.entries()) {
    const rowLayout = validateTableRow(
      row,
      rows.length,
      rowIndex,
      activeIntervals,
      schema,
    );
    if (
      rowLayout.width === 0 ||
      (tableWidth !== undefined && rowLayout.width !== tableWidth)
    ) {
      throw new Error("Invalid rich-text non-rectangular table");
    }
    tableWidth = rowLayout.width;
    activeIntervals = rowLayout.nextActiveIntervals;
  }
  return {
    columnWidths: rowColumnWidths(rows[0]!),
    ...tableHeaderLayout(rows),
  };
}

export function tableContentToProseMirror(
  content: unknown,
  schema: GeulRichTextSchema,
): ProseMirrorJsonNode[] {
  if (
    !isRecord(content) ||
    content.type !== "tableContent" ||
    !Array.isArray(content.rows)
  ) {
    throw new Error("Invalid rich-text table content");
  }
  const headerRows =
    typeof content.headerRows === "number" ? content.headerRows : 0;
  const headerCols =
    typeof content.headerCols === "number" ? content.headerCols : 0;
  return content.rows.map((row, rowIndex) =>
    tableRowToProseMirror(
      row,
      schema,
      rowIndex,
      headerRows,
      headerCols,
      content.columnWidths,
    ),
  );
}

function tableRowToProseMirror(
  row: unknown,
  schema: GeulRichTextSchema,
  rowIndex: number,
  headerRows: number,
  headerCols: number,
  columnWidths: unknown,
): ProseMirrorJsonNode {
  if (!isRecord(row) || !Array.isArray(row.cells))
    throw new Error("Invalid rich-text table row");
  return {
    type: "tableRow",
    content: row.cells.map((cell, columnIndex) =>
      tableCellToProseMirror(
        cell,
        schema,
        rowIndex < headerRows || columnIndex < headerCols,
        columnWidths,
        columnIndex,
      ),
    ),
  };
}

function readTableCell(cell: ProseMirrorJsonNode, schema: GeulRichTextSchema) {
  assertTableCellType(cell);
  const attrs = nodeAttributes(cell, "tableCell");
  return {
    type: "tableCell" as const,
    content: tableCellContent(cell, schema),
    props: {
      colspan: attrs.colspan ?? 1,
      rowspan: attrs.rowspan ?? 1,
      backgroundColor: attrs.backgroundColor ?? "default",
      textColor: attrs.textColor ?? "default",
      textAlignment: attrs.textAlignment ?? "left",
    },
  };
}

function tableCellContent(
  cell: ProseMirrorJsonNode,
  schema: GeulRichTextSchema,
): InlineContent[] {
  return nodeChildren(cell).reduce<InlineContent[]>(
    (output, paragraph, index) => {
      assertNodeType(paragraph, "tableParagraph");
      const content = inlineContentFromNode(paragraph, schema);
      if (!mergeTableParagraphBoundary(output, content, index))
        output.push(...content);
      return output;
    },
    [],
  );
}

function mergeTableParagraphBoundary(
  output: InlineContent[],
  content: InlineContent[],
  index: number,
): boolean {
  if (index === 0) return false;
  const previous = output.at(-1);
  const next = content[0];
  if (
    previous?.type !== "text" ||
    next?.type !== "text" ||
    JSON.stringify(previous.styles) !== JSON.stringify(next.styles)
  )
    return false;
  previous.text += `\n${next.text}`;
  output.push(...content.slice(1));
  return true;
}

function validateTableRow(
  row: ProseMirrorJsonNode,
  rowCount: number,
  rowIndex: number,
  activeIntervals: readonly TableInterval[],
  schema: GeulRichTextSchema,
): { width: number; nextActiveIntervals: TableInterval[] } {
  assertNodeType(row, "tableRow");
  assertNoAttributes(row, "tableRow");
  if (row.marks !== undefined)
    throw new Error("Invalid rich-text tableRow marks");
  const cells = nodeChildren(row);
  if (cells.length === 0)
    throw new Error("Invalid rich-text tableRow structure");
  const currentIntervals = tableRowIntervals(
    cells,
    rowCount,
    rowIndex,
    activeIntervals,
    schema,
  );
  const intervals = mergeTableIntervals(activeIntervals, currentIntervals);
  const width = rectangularRowWidth(intervals);
  return {
    width,
    nextActiveIntervals: mergeTableIntervals(
      activeIntervals.filter((interval) => interval.endRow > rowIndex + 1),
      currentIntervals.filter((interval) => interval.endRow > rowIndex + 1),
    ),
  };
}

function tableRowIntervals(
  cells: readonly ProseMirrorJsonNode[],
  rowCount: number,
  rowIndex: number,
  activeIntervals: readonly TableInterval[],
  schema: GeulRichTextSchema,
): TableInterval[] {
  const current: TableInterval[] = [];
  let activeIndex = 0;
  let column = 0;
  for (const cell of cells) {
    assertTableCellType(cell);
    assertTableCellContent(cell, schema);
    const attrs = nodeAttributes(cell, "tableCell");
    const colspan = tableSpan(attrs, "colspan");
    const rowspan = tableSpan(attrs, "rowspan");
    assertTableColumnWidths(attrs, colspan);
    if (rowspan > rowCount - rowIndex)
      throw new Error("Invalid rich-text table rowspan");
    ({ activeIndex, column } = skipActiveIntervals(
      activeIntervals,
      activeIndex,
      column,
    ));
    const end = column + colspan;
    if (activeIntervals[activeIndex]?.start < end)
      throw new Error("Invalid rich-text overlapping table cells");
    current.push({
      start: column,
      end,
      endRow: rowIndex + rowspan,
      header: cell.type === "tableHeader",
    });
    column = end;
  }
  return current;
}

function skipActiveIntervals(
  intervals: readonly TableInterval[],
  activeIndex: number,
  column: number,
): { activeIndex: number; column: number } {
  while (
    activeIndex < intervals.length &&
    intervals[activeIndex]!.start <= column
  ) {
    column = intervals[activeIndex]!.end;
    activeIndex += 1;
  }
  return { activeIndex, column };
}

function assertTableCellType(cell: ProseMirrorJsonNode): void {
  if (cell.type !== "tableCell" && cell.type !== "tableHeader")
    throw new Error(`Unsupported table cell: ${cell.type}`);
  assertAttributes(
    "tableCell",
    nodeAttributes(cell, "tableCell"),
    TABLE_CELL_ATTRIBUTE_VALIDATORS,
  );
  if (cell.marks !== undefined)
    throw new Error("Invalid rich-text tableCell marks");
}

function assertTableCellContent(
  cell: ProseMirrorJsonNode,
  schema: GeulRichTextSchema,
): void {
  const paragraphs = nodeChildren(cell);
  if (paragraphs.length === 0)
    throw new Error("Invalid rich-text tableCell structure");
  for (const paragraph of paragraphs) {
    assertNodeType(paragraph, "tableParagraph");
    assertNoAttributes(paragraph, "tableParagraph");
    if (paragraph.marks !== undefined)
      throw new Error("Invalid rich-text tableParagraph marks");
    inlineContentFromNode(paragraph, schema);
  }
}

function tableCellToProseMirror(
  cell: unknown,
  schema: GeulRichTextSchema,
  header: boolean,
  columnWidths: unknown,
  columnIndex: number,
): ProseMirrorJsonNode {
  const { props, content } = validatedTableCell(cell);
  const colspan = typeof props.colspan === "number" ? props.colspan : 1;
  const rowspan = props.rowspan ?? 1;
  return {
    type: header ? "tableHeader" : "tableCell",
    attrs: tableCellAttrs(
      props,
      colspan,
      rowspan,
      tableCellWidths(columnWidths, columnIndex, colspan),
    ),
    content: [
      {
        type: "tableParagraph",
        content: inlineContentToProseMirror(content, schema),
      },
    ],
  };
}

function validatedTableCell(cell: unknown): {
  props: Record<string, unknown>;
  content: unknown[];
} {
  if (
    !isRecord(cell) ||
    cell.type !== "tableCell" ||
    !isRecord(cell.props) ||
    !Array.isArray(cell.content)
  )
    throw new Error("Invalid rich-text table cell");
  return { props: cell.props, content: cell.content };
}

function tableCellAttrs(
  props: Record<string, unknown>,
  colspan: unknown,
  rowspan: unknown,
  widths: unknown[] | undefined,
): Record<string, unknown> {
  const attrs: Record<string, unknown> = {
    backgroundColor: props.backgroundColor ?? "default",
    textColor: props.textColor ?? "default",
    textAlignment: props.textAlignment ?? "left",
    colspan,
    rowspan,
  };
  if (widths?.some((width) => width !== null && width !== undefined))
    attrs.colwidth = widths;
  return attrs;
}

function tableCellWidths(
  columnWidths: unknown,
  columnIndex: number,
  colspan: number,
): unknown[] | undefined {
  return Array.isArray(columnWidths)
    ? columnWidths.slice(columnIndex, columnIndex + colspan)
    : undefined;
}

function tableSpan(
  attributes: Record<string, unknown>,
  name: "colspan" | "rowspan",
): number {
  return typeof attributes[name] === "number" ? attributes[name] : 1;
}

function assertTableColumnWidths(
  attributes: Record<string, unknown>,
  colspan: number,
): void {
  const colwidth = attributes.colwidth;
  if (
    (colspan > 1 &&
      (!Array.isArray(colwidth) || colwidth.length !== colspan)) ||
    (colspan === 1 &&
      colwidth !== undefined &&
      colwidth !== null &&
      (!Array.isArray(colwidth) || colwidth.length !== 1))
  ) {
    throw new Error("Invalid rich-text table colwidth");
  }
}

function mergeTableIntervals(
  left: readonly TableInterval[],
  right: readonly TableInterval[],
): TableInterval[] {
  const merged: TableInterval[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    const leftValue = left[leftIndex];
    const rightValue = right[rightIndex];
    if (
      rightValue === undefined ||
      (leftValue !== undefined && leftValue.start <= rightValue.start)
    ) {
      merged.push(leftValue!);
      leftIndex += 1;
    } else {
      merged.push(rightValue);
      rightIndex += 1;
    }
  }
  return merged;
}

function rectangularRowWidth(intervals: readonly TableInterval[]): number {
  let width = 0;
  for (const interval of intervals) {
    if (interval.start > width)
      throw new Error("Invalid rich-text non-rectangular table");
    width = interval.end;
  }
  return width;
}

function rowColumnWidths(row: ProseMirrorJsonNode): Array<number | undefined> {
  return nodeChildren(row).flatMap((cell) => {
    const attrs = nodeAttributes(cell, "tableCell");
    const colspan = tableSpan(attrs, "colspan");
    const values = Array.isArray(attrs.colwidth) ? attrs.colwidth : [];
    return values.length > 0
      ? values.map((width) => (typeof width === "number" ? width : undefined))
      : new Array<number | undefined>(colspan).fill(undefined);
  });
}

function tableHeaderLayout(
  rows: readonly ProseMirrorJsonNode[],
): Pick<TableLayout, "headerRows" | "headerCols"> {
  const matrix = rows.map((row) =>
    nodeChildren(row).map((cell) => cell.type === "tableHeader"),
  );
  const headerRows = matrix.filter(
    (row) => row.length > 0 && row.every(Boolean),
  ).length;
  const headerCols = Array.from({ length: matrix[0]!.length }).filter(
    (_, column) => matrix.every((row) => row[column] === true),
  ).length;
  return {
    headerRows: headerRows || undefined,
    headerCols: headerCols || undefined,
  };
}
