import {
  BOOLEAN_STYLE_MARKS,
  isRecord,
  isString,
  STRING_STYLE_MARKS,
} from "./schema.ts";
import type {
  AttributeValidators,
  ProseMirrorJsonMark,
  ProseMirrorJsonNode,
} from "./schema.ts";

export function nodeAttributes(
  node: ProseMirrorJsonNode,
  owner: string,
): Record<string, unknown> {
  if (node.attrs === undefined) return {};
  if (!isRecord(node.attrs)) {
    throw new Error(`Invalid rich-text ${owner} attributes`);
  }
  return node.attrs;
}

export function assertAttributes(
  owner: string,
  attributes: Record<string, unknown>,
  validators: AttributeValidators,
): void {
  for (const [name, value] of Object.entries(attributes)) {
    const validator = validators[name];
    if (!validator) {
      throw new Error(`Unsupported rich-text ${owner} attribute: ${name}`);
    }
    if (!validator(value)) {
      throw new Error(`Invalid rich-text ${owner} attribute value: ${name}`);
    }
  }
}

export function assertNoAttributes(
  node: ProseMirrorJsonNode,
  owner: string,
): void {
  assertAttributes(owner, nodeAttributes(node, owner), {});
}

export function nodeChildren(node: ProseMirrorJsonNode): ProseMirrorJsonNode[] {
  if (node.content === undefined) return [];
  if (
    !Array.isArray(node.content) ||
    node.content.some((child) => !isRecord(child))
  ) {
    throw new Error(`Invalid rich-text ${node.type} content`);
  }
  return node.content;
}

export function assertNodeType(
  node: ProseMirrorJsonNode,
  expected: string,
): void {
  if (node.type !== expected) {
    throw new Error(`Expected ${expected} node, received ${node.type}`);
  }
}

export function assertTextNode(node: ProseMirrorJsonNode): void {
  assertNoAttributes(node, "text");
  if (typeof node.text !== "string")
    throw new Error("Invalid rich-text text node");
  if (node.content !== undefined)
    throw new Error("Invalid rich-text text content");
  validateMarks(node.marks);
}

export function assertHardBreakNode(node: ProseMirrorJsonNode): void {
  assertNoAttributes(node, "hardBreak");
  if (nodeChildren(node).length > 0 || node.marks !== undefined) {
    throw new Error("Invalid rich-text hardBreak");
  }
}

export function styleValues(marks: ProseMirrorJsonMark[] | undefined): {
  href: string | undefined;
  styles: Record<string, boolean | string>;
} {
  const styles: Record<string, boolean | string> = {};
  let href: string | undefined;
  for (const mark of marks ?? []) {
    validateMark(mark);
    if (mark.type === "link") {
      href = mark.attrs?.href as string;
    } else if (BOOLEAN_STYLE_MARKS.has(mark.type)) {
      styles[mark.type] = true;
    } else {
      styles[mark.type] = mark.attrs?.stringValue as string;
    }
  }
  return { href, styles };
}

function validateMarks(marks: ProseMirrorJsonMark[] | undefined): void {
  if (marks === undefined) return;
  if (!Array.isArray(marks)) throw new Error("Invalid rich-text inline marks");
  for (const mark of marks) validateMark(mark);
}

function validateMark(mark: ProseMirrorJsonMark): void {
  if (!isRecord(mark)) throw new Error("Invalid rich-text inline mark");
  if (mark.type === "link") {
    requiredMarkAttributes(mark, "link", { href: isString });
    return;
  }
  if (STRING_STYLE_MARKS.has(mark.type)) {
    requiredMarkAttributes(mark, mark.type, { stringValue: isString });
    return;
  }
  if (BOOLEAN_STYLE_MARKS.has(mark.type)) {
    validateBooleanMark(mark);
    return;
  }
  throw new Error(`Unsupported rich-text mark: ${mark.type}`);
}

function requiredMarkAttributes(
  mark: ProseMirrorJsonMark,
  owner: string,
  validators: AttributeValidators,
): Record<string, unknown> {
  if (!isRecord(mark.attrs)) {
    throw new Error(`Invalid rich-text inline mark attributes: ${owner}`);
  }
  assertAttributes(`inline mark ${owner}`, mark.attrs, validators);
  return mark.attrs;
}

function validateBooleanMark(mark: ProseMirrorJsonMark): void {
  if (mark.attrs === undefined) return;
  if (!isRecord(mark.attrs)) {
    throw new Error(`Invalid rich-text inline mark attributes: ${mark.type}`);
  }
  assertAttributes(`inline mark ${mark.type}`, mark.attrs, {});
}
