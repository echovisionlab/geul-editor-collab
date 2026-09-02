import {
  escapeHTML,
  escapeHTMLAttribute,
  serializeChildrenToHTMLString,
} from "@tiptap/static-renderer/json/html-string";
import type { ProseMirrorJsonNode, RenderedChildren } from "./types.ts";

const COLORS = {
  gray: { text: "rgb(155, 154, 151)", background: "rgb(235, 236, 237)" },
  brown: { text: "rgb(100, 71, 58)", background: "rgb(233, 229, 227)" },
  red: { text: "rgb(224, 62, 62)", background: "rgb(251, 228, 228)" },
  orange: { text: "rgb(217, 115, 13)", background: "rgb(246, 233, 217)" },
  yellow: { text: "rgb(223, 171, 1)", background: "rgb(251, 243, 219)" },
  green: { text: "rgb(77, 100, 97)", background: "rgb(221, 237, 234)" },
  blue: { text: "rgb(11, 110, 153)", background: "rgb(221, 235, 241)" },
  purple: { text: "rgb(105, 64, 165)", background: "rgb(234, 228, 242)" },
  pink: { text: "rgb(173, 26, 114)", background: "rgb(244, 223, 235)" },
} as const;

const BLOCK_ATTRIBUTE_DEFAULTS: Record<string, unknown> = {
  fileId: "",
  fileName: "",
  name: "",
  alt: "",
  caption: "",
  width: "0",
  height: "0",
  previewWidth: "100",
  textAlignment: "left",
};

export function attribute(name: string, value: unknown): string {
  return value === undefined || value === null
    ? ""
    : ` ${name}="${escapeHTMLAttribute(String(value))}"`;
}

export function childrenToString(children?: RenderedChildren): string {
  return serializeChildrenToHTMLString(children);
}

export function dataAttributes(
  attributes: Record<string, unknown>,
  excluded: ReadonlySet<string> = new Set(),
): string {
  return Object.entries(attributes)
    .filter(
      ([name, value]) =>
        !excluded.has(name) &&
        value !== "" &&
        value !== undefined &&
        value !== null &&
        value !== BLOCK_ATTRIBUTE_DEFAULTS[name],
    )
    .map(([name, value]) => attribute(`data-${kebabCase(name)}`, value))
    .join("");
}

export function escapeText(value: string): string {
  return escapeHTML(value);
}

export function escapeAttribute(value: string): string {
  return escapeHTMLAttribute(value);
}

export function containerStyle(
  attributes: Record<string, unknown> | undefined,
): string {
  const parsed = Number.parseInt(String(attributes?.previewWidth ?? "100"), 10);
  const width = Math.max(
    10,
    Math.min(100, Number.isFinite(parsed) ? parsed : 100),
  );
  if (width >= 100) {
    return "";
  }
  const declarations = [`width: ${width}%`];
  if (attributes?.textAlignment === "center") {
    declarations.push("margin: 0px auto");
  } else if (attributes?.textAlignment === "right") {
    declarations.push("margin-left: auto");
  }
  return attribute("style", `${declarations.join("; ")};`);
}

export function legacyDefaultBlockAttributes(
  attributes: Record<string, unknown> | undefined,
  includeAlignment: boolean,
): string {
  return `${defaultBlockStyle(attributes)}${nonDefaultDataAttribute(
    "data-background-color",
    attributes?.backgroundColor,
  )}${nonDefaultDataAttribute("data-text-color", attributes?.textColor)}${
    includeAlignment
      ? nonDefaultDataAttribute(
          "data-text-alignment",
          attributes?.textAlignment,
          "left",
        )
      : ""
  }`;
}

export function legacyTableCellAttributes(
  attributes: Record<string, unknown>,
): string {
  return `${nonDefaultDataAttribute("data-text-color", attributes.textColor)}${nonDefaultDataAttribute(
    "data-background-color",
    attributes.backgroundColor,
  )}${nonDefaultDataAttribute("data-text-alignment", attributes.textAlignment, "left")}`;
}

export function mathInlineSource(node: ProseMirrorJsonNode): string {
  const source = node.content
    ?.map((child) => (child.type === "text" ? (child.text ?? "") : ""))
    .join("");
  return (
    source || (typeof node.attrs?.latex === "string" ? node.attrs.latex : "")
  );
}

export function nestingAttribute(
  attributes: Record<string, unknown> | undefined,
): string {
  const nestingLevel = attributes?._nestingLevel;
  return typeof nestingLevel === "number" && nestingLevel > 0
    ? attribute("data-nesting-level", nestingLevel)
    : "";
}

export function renderCaption(className: string, caption: unknown): string {
  return typeof caption === "string" && caption.trim()
    ? `<div class="${className}">${escapeHTML(caption)}</div>`
    : "";
}

export function renderColorMark(
  type: "backgroundColor" | "textColor",
  value: unknown,
  children?: RenderedChildren,
): string {
  const color = cssColor(value, type === "textColor" ? "text" : "background");
  const property = type === "textColor" ? "color" : "background-color";
  const style = color ? attribute("style", `${property}: ${color};`) : "";
  return `<span${style} data-style-type="${type}"${attribute("data-value", value)} data-editable="">${childrenToString(children)}</span>`;
}

export function resolveName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function cssColor(
  value: unknown,
  role: "background" | "text",
): string | undefined {
  if (typeof value !== "string" || value === "default" || value.length === 0) {
    return undefined;
  }
  const palette = COLORS[value as keyof typeof COLORS];
  return palette?.[role] ?? value;
}

function defaultBlockStyle(
  attributes: Record<string, unknown> | undefined,
): string {
  const declarations: string[] = [];
  const background = cssColor(attributes?.backgroundColor, "background");
  const text = cssColor(attributes?.textColor, "text");
  if (background) {
    declarations.push(`background-color: ${background}`);
  }
  if (text) {
    declarations.push(`color: ${text}`);
  }
  if (attributes?.textAlignment && attributes.textAlignment !== "left") {
    declarations.push(`text-align: ${attributes.textAlignment}`);
  }
  return declarations.length > 0
    ? attribute("style", `${declarations.join("; ")};`)
    : "";
}

function kebabCase(value: string): string {
  return value.replaceAll(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function nonDefaultDataAttribute(
  name: string,
  value: unknown,
  defaultValue = "default",
): string {
  return typeof value === "string" && value !== defaultValue
    ? attribute(name, value)
    : "";
}
