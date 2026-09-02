import { escapeHTML } from "@tiptap/static-renderer/json/html-string";
import {
  attribute,
  dataAttributes,
  nestingAttribute,
} from "./html-attributes.ts";
import type { ProseMirrorJsonNode } from "./types.ts";

export function renderBlockGroup(
  node: ProseMirrorJsonNode,
  children: string[],
): string {
  const rendered = children;
  const containers = node.content!;
  let output = "";
  for (let index = 0; index < rendered.length; index += 1) {
    const kind = listKind(containers[index]);
    if (!kind) {
      output += rendered[index]!;
      continue;
    }
    const list = renderListRun(rendered, containers, index, kind);
    output += list.html;
    index = list.lastIndex;
  }
  return output;
}

export function renderBlockContainer(
  node: ProseMirrorJsonNode,
  children: string[],
): string {
  const rendered = children;
  const blockContent = node.content![0]!;
  const listRenderer = blockContent
    ? LIST_ITEM_RENDERERS[blockContent.type]
    : undefined;
  if (blockContent?.type === "callout") {
    return renderCallout(blockContent, rendered.join(""));
  }
  return listRenderer
    ? listRenderer(blockContent, rendered)
    : rendered.join("");
}

function renderCallout(node: ProseMirrorJsonNode, children: string): string {
  const props = node.attrs ?? {};
  const icon = typeof props.icon === "string" && props.icon ? props.icon : "💡";
  const backgroundColor =
    typeof props.backgroundColor === "string" && props.backgroundColor
      ? props.backgroundColor
      : "gray";
  const textColor =
    typeof props.textColor === "string" && props.textColor
      ? props.textColor
      : "default";
  return `<aside data-callout=""${attribute("data-bg-color", backgroundColor)}${attribute("data-text-color", textColor)}${dataAttributes(props, new Set(["icon", "backgroundColor", "textColor", "_nestingLevel"]))}><span data-callout-icon="" aria-hidden="true">${escapeHTML(icon)}</span><div data-callout-content="">${children}</div></aside>`;
}

function listKind(
  container: ProseMirrorJsonNode | undefined,
): "ol" | "ul" | undefined {
  const type = container?.content?.[0]?.type;
  if (type === "numberedListItem") {
    return "ol";
  }
  return type === "bulletListItem" || type === "checkListItem"
    ? "ul"
    : undefined;
}

function renderListRun(
  rendered: string[],
  containers: ProseMirrorJsonNode[],
  firstIndex: number,
  kind: "ol" | "ul",
): { html: string; lastIndex: number } {
  const items: string[] = [];
  let index = firstIndex;
  while (index < rendered.length && listKind(containers[index]) === kind) {
    items.push(rendered[index]!);
    index += 1;
  }
  return {
    html: `<${kind}${orderedListStart(containers[firstIndex], kind)}>${items.join("")}</${kind}>`,
    lastIndex: index - 1,
  };
}

function orderedListStart(
  container: ProseMirrorJsonNode | undefined,
  kind: "ol" | "ul",
): string {
  const start = container?.content?.[0]?.attrs?.start;
  return kind === "ol" && typeof start === "number"
    ? attribute("start", start)
    : "";
}

type ListItemRenderer = (
  node: ProseMirrorJsonNode,
  rendered: string[],
) => string;

const LIST_ITEM_RENDERERS: Partial<Record<string, ListItemRenderer>> = {
  bulletListItem: (node, rendered) =>
    `<li${nestingAttribute(node.attrs)}>${rendered.join("")}</li>`,
  numberedListItem: (node, rendered) =>
    `<li${numberedListItemStart(node)}${nestingAttribute(node.attrs)}>${rendered.join("")}</li>`,
  checkListItem: (node, rendered) => {
    const checked = node.attrs?.checked === true;
    return `<li data-checked="${checked}"${nestingAttribute(node.attrs)}><input type="checkbox"${checked ? ' checked=""' : ""}>${rendered.join("")}</li>`;
  },
};

function numberedListItemStart(node: ProseMirrorJsonNode): string {
  const start = node.attrs?.start;
  return typeof start === "number" ? attribute("data-start", start) : "";
}
