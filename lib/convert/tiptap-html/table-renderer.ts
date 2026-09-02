import {
  attribute,
  childrenToString,
  legacyTableCellAttributes,
} from "./html-attributes.ts";
import type { ProseMirrorJsonNode, RenderedChildren } from "./types.ts";

export function renderTable(
  node: ProseMirrorJsonNode,
  children?: RenderedChildren,
): string {
  const firstRow = node.content?.[0];
  const columns =
    firstRow?.content
      ?.flatMap((cell) => {
        const widths = Array.isArray(cell.attrs?.colwidth)
          ? cell.attrs.colwidth
          : [];
        const colspan =
          typeof cell.attrs?.colspan === "number" ? cell.attrs.colspan : 1;
        return Array.from({ length: colspan }, (_, index) => {
          const width = widths[index];
          return typeof width === "number"
            ? `<col style="width: ${width}px;">`
            : "<col>";
        });
      })
      .join("") ?? "";
  return `<table${nonDefaultTextColor(node.attrs?.textColor)}>${
    columns ? `<colgroup>${columns}</colgroup>` : ""
  }${childrenToString(children)}</table>`;
}

export function renderTableCell(
  tag: "td" | "th",
  node: ProseMirrorJsonNode,
  children?: RenderedChildren,
): string {
  const attrs = node.attrs ?? {};
  const colwidth = Array.isArray(attrs.colwidth)
    ? attrs.colwidth.join(",")
    : undefined;
  return `<${tag}${legacyTableCellAttributes(attrs)}${attribute("colspan", attrs.colspan ?? 1)}${attribute("rowspan", attrs.rowspan ?? 1)}${attribute("colwidth", colwidth)}>${childrenToString(children)}</${tag}>`;
}

function nonDefaultTextColor(value: unknown): string {
  return typeof value === "string" && value !== "default"
    ? attribute("data-text-color", value)
    : "";
}
