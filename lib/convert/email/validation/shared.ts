import type { LooseBlock } from "../../core.ts";

export type EmailBlocks = LooseBlock[];

export const emailBlockNodeNames = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "callout",
  "divider",
  "table",
  "codeBlock",
]);
export const emailInlineBlockNodeNames = new Set([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "callout",
  "codeBlock",
]);
export const emailAllowedMarks = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
  "textColor",
  "backgroundColor",
  "link",
]);

type EmailNodeAttributeValidator = (value: unknown) => boolean;

const isStringAttribute: EmailNodeAttributeValidator = (value) =>
  typeof value === "string";
const isPositiveSafeInteger: EmailNodeAttributeValidator = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
const emailNodeAttributeValidators: Record<
  string,
  EmailNodeAttributeValidator
> = {
  backgroundColor: isStringAttribute,
  textColor: isStringAttribute,
  icon: isStringAttribute,
  language: isStringAttribute,
  id: (value) => typeof value === "string" && value.length > 0,
  textAlignment: (value) =>
    typeof value === "string" &&
    ["left", "center", "right", "justify"].includes(value),
  level: (value) =>
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 6,
  checked: (value) => typeof value === "boolean",
  start: isPositiveSafeInteger,
  colspan: isPositiveSafeInteger,
  rowspan: isPositiveSafeInteger,
  colwidth: (value) =>
    value === null ||
    (Array.isArray(value) &&
      value.every(
        (width) =>
          width === undefined ||
          width === null ||
          (typeof width === "number" && Number.isFinite(width) && width > 0),
      )),
};

export function assertClosedAttributes(
  owner: string,
  attributes: Record<string, unknown>,
  allowedAttributes: ReadonlySet<string>,
): void {
  for (const attribute of Object.keys(attributes)) {
    if (!allowedAttributes.has(attribute)) {
      throw new Error(`Unsupported email Yjs ${owner} attribute: ${attribute}`);
    }
  }
}

export function assertClosedNodeAttributeValues(
  nodeName: string,
  attributes: Record<string, unknown>,
): void {
  for (const [attribute, value] of Object.entries(attributes)) {
    if (!emailNodeAttributeValidators[attribute]?.(value)) {
      throw new Error(
        `Invalid email Yjs node ${nodeName} attribute value: ${attribute}`,
      );
    }
  }
}
