import {
  allowsMathInline,
  BOOLEAN_STYLE_MARKS,
  isRecord,
  isString,
  STRING_STYLE_MARKS,
} from "./schema.ts";
import {
  assertAttributes,
  assertHardBreakNode,
  assertTextNode,
  nodeAttributes,
  nodeChildren,
  styleValues,
} from "./node-validation.ts";
import type {
  GeulRichTextSchema,
  ProseMirrorJsonMark,
  ProseMirrorJsonNode,
} from "./schema.ts";

type StyledText = {
  type: "text";
  text: string;
  styles: Record<string, boolean | string>;
};
type LinkContent = { type: "link"; href: string; content: StyledText[] };
export type InlineContent =
  | StyledText
  | LinkContent
  | {
      type: "mathInline";
      props: Record<string, unknown>;
      content?: InlineContent[];
    };

export function inlineContentFromNode(
  node: ProseMirrorJsonNode,
  schema: GeulRichTextSchema,
): InlineContent[] {
  const output: InlineContent[] = [];
  for (const child of nodeChildren(node)) {
    if (child.type === "hardBreak") {
      assertHardBreakNode(child);
      appendHardBreak(output);
      continue;
    }
    if (child.type === "text") {
      assertTextNode(child);
      const { href, styles } = styleValues(child.marks);
      appendTextContent(output, child.text!, styles, href);
      continue;
    }
    if (child.type === "mathInline" && allowsMathInline(schema)) {
      output.push({
        type: "mathInline",
        props: { latex: mathInlineSource(child) },
      });
      continue;
    }
    throw new Error(
      `Unsupported inline content node for ${schema}: ${child.type}`,
    );
  }
  return output;
}

export function inlineContentToProseMirror(
  content: unknown,
  schema: GeulRichTextSchema,
): ProseMirrorJsonNode[] {
  if (!Array.isArray(content))
    throw new Error("Invalid rich-text inline content");
  return content.flatMap((item) => inlineItemToProseMirror(item, schema));
}

export function executableSourceContentToProseMirror(
  content: unknown,
  legacySource: string | undefined,
  type: string,
): ProseMirrorJsonNode[] {
  if (
    (!Array.isArray(content) || content.length === 0) &&
    legacySource !== undefined
  ) {
    return legacySource ? [{ type: "text", text: legacySource }] : [];
  }
  if (!Array.isArray(content))
    throw new Error(`Invalid rich-text ${type} source content`);
  return content.flatMap((item) => executableSourceNode(item, type));
}

export function codeBlockContentToProseMirror(
  content: unknown,
): ProseMirrorJsonNode[] {
  if (!Array.isArray(content))
    throw new Error("Invalid rich-text codeBlock content");
  return content.flatMap(codeBlockNode);
}

export function assertUnmarkedTextContent(
  node: ProseMirrorJsonNode,
  owner: string,
): void {
  for (const child of nodeChildren(node)) {
    assertTextNode(child);
    if (child.marks !== undefined) {
      throw new Error(
        owner === "codeBlock"
          ? "Invalid rich-text codeBlock marks"
          : `Invalid rich-text ${owner} source marks`,
      );
    }
  }
}

function mathInlineSource(node: ProseMirrorJsonNode): string {
  assertAttributes("mathInline", nodeAttributes(node, "mathInline"), {
    latex: isString,
  });
  if (node.marks !== undefined) throw new Error("Invalid rich-text mathInline");
  const children = nodeChildren(node);
  if (!children.length)
    return typeof node.attrs?.latex === "string" ? node.attrs.latex : "";
  const source = children.map(mathInlineText).join("");
  const legacySource =
    typeof node.attrs?.latex === "string" ? node.attrs.latex : "";
  if (legacySource && legacySource !== source)
    throw new Error("Conflicting rich-text mathInline source");
  return source;
}

function mathInlineText(child: ProseMirrorJsonNode): string {
  assertTextNode(child);
  if (child.marks?.length)
    throw new Error("Invalid rich-text mathInline source marks");
  return child.text!;
}

function appendTextContent(
  output: InlineContent[],
  text: string,
  styles: Record<string, boolean | string>,
  href: string | undefined,
): void {
  const current = output.at(-1);
  if (href !== undefined) {
    appendLinkedTextContent(output, current, text, styles, href);
    return;
  }
  if (current?.type === "text" && equalStyles(current.styles, styles)) {
    current.text += text;
  } else {
    output.push({ type: "text", text, styles });
  }
}

function appendLinkedTextContent(
  output: InlineContent[],
  current: InlineContent | undefined,
  text: string,
  styles: Record<string, boolean | string>,
  href: string,
): void {
  if (current?.type !== "link" || current.href !== href) {
    output.push({
      type: "link",
      href,
      content: [{ type: "text", text, styles }],
    });
    return;
  }
  const previousText = current.content.at(-1);
  if (!previousText || !equalStyles(previousText.styles, styles)) {
    current.content.push({ type: "text", text, styles });
  } else {
    previousText.text += text;
  }
}

function appendHardBreak(output: InlineContent[]): void {
  const currentText = lastStyledText(output.at(-1));
  if (currentText) currentText.text += "\n";
  else output.push({ type: "text", text: "\n", styles: {} });
}

function lastStyledText(
  content: InlineContent | undefined,
): StyledText | undefined {
  if (content?.type === "text") return content;
  if (content?.type === "link") return content.content.at(-1);
  return undefined;
}

function equalStyles(
  left: Record<string, boolean | string>,
  right: Record<string, boolean | string>,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function inlineItemToProseMirror(
  item: unknown,
  schema: GeulRichTextSchema,
): ProseMirrorJsonNode[] {
  if (!isRecord(item) || typeof item.type !== "string")
    throw new Error("Invalid rich-text inline content");
  if (item.type === "text") return textToProseMirror(item, undefined);
  if (item.type === "link" && typeof item.href === "string")
    return linkToProseMirror(item);
  if (item.type === "mathInline") return mathInlineToProseMirror(item, schema);
  throw new Error(
    `Unsupported inline content node for ${schema}: ${item.type}`,
  );
}

function mathInlineToProseMirror(
  item: Record<string, unknown>,
  schema: GeulRichTextSchema,
): ProseMirrorJsonNode[] {
  if (!allowsMathInline(schema) || !isRecord(item.props))
    throw new Error(
      `Unsupported inline content node for ${schema}: mathInline`,
    );
  if (typeof item.props.latex !== "string")
    throw new Error("Invalid rich-text mathInline source");
  return [
    {
      type: "mathInline",
      attrs: { latex: "" },
      ...(item.props.latex
        ? { content: [{ type: "text", text: item.props.latex }] }
        : {}),
    },
  ];
}

function linkToProseMirror(
  item: Record<string, unknown>,
): ProseMirrorJsonNode[] {
  if (typeof item.href !== "string" || !Array.isArray(item.content))
    throw new Error("Invalid rich-text link content");
  return item.content.flatMap((child) =>
    textToProseMirror(child, item.href as string),
  );
}

function textToProseMirror(
  item: Record<string, unknown>,
  href: string | undefined,
): ProseMirrorJsonNode[] {
  if (
    item.type !== "text" ||
    typeof item.text !== "string" ||
    (item.styles !== undefined && !isRecord(item.styles))
  ) {
    throw new Error("Invalid rich-text text node");
  }
  const marks = styleMarks(item.styles ?? {}, href);
  return item.text
    .split("\n")
    .flatMap((text, index) => [
      ...(index > 0 ? [{ type: "hardBreak" }] : []),
      ...(text.length > 0
        ? [{ type: "text", text, ...(marks.length > 0 ? { marks } : {}) }]
        : []),
    ]);
}

function styleMarks(
  styles: Record<string, unknown>,
  href: string | undefined,
): ProseMirrorJsonMark[] {
  const marks: ProseMirrorJsonMark[] = [];
  for (const name of Object.keys(styles)) {
    const value = styles[name];
    if (BOOLEAN_STYLE_MARKS.has(name) && value === true)
      marks.push({ type: name });
    else if (STRING_STYLE_MARKS.has(name) && typeof value === "string")
      marks.push({ type: name, attrs: { stringValue: value } });
    else throw new Error(`Unsupported rich-text style: ${name}`);
  }
  if (href !== undefined) marks.push({ type: "link", attrs: { href } });
  return marks;
}

function codeBlockNode(item: unknown): ProseMirrorJsonNode[] {
  if (
    !isRecord(item) ||
    item.type !== "text" ||
    typeof item.text !== "string" ||
    (item.styles !== undefined &&
      (!isRecord(item.styles) || Object.keys(item.styles).length > 0))
  ) {
    throw new Error("Invalid rich-text codeBlock content");
  }
  return textToProseMirror(item, undefined);
}

function executableSourceNode(
  item: unknown,
  type: string,
): ProseMirrorJsonNode[] {
  if (
    !isRecord(item) ||
    item.type !== "text" ||
    typeof item.text !== "string" ||
    (item.styles !== undefined &&
      (!isRecord(item.styles) || Object.keys(item.styles).length > 0))
  ) {
    throw new Error(`Invalid rich-text ${type} source content`);
  }
  return item.text ? [{ type: "text", text: item.text }] : [];
}
