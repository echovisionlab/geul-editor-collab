import { externalVideoLinkLayoutPropSchema } from "@echovisionlab/geul-common/media/block-schemas";
import {
  allowedBlockType,
  blockAttributeValidators,
  EXECUTABLE_SOURCE_BLOCK_TYPES,
  INLINE_CONTENT_BLOCK_TYPES,
  isRecord,
  NO_CONTENT_BLOCK_TYPES,
  selectAdditionalProps,
  selectProps,
  shaderChannels,
  SHADER_STAGES,
} from "./schema.ts";
import {
  assertAttributes,
  assertNoAttributes,
  assertNodeType,
  nodeAttributes,
  nodeChildren,
} from "./node-validation.ts";
import {
  assertUnmarkedTextContent,
  inlineContentFromNode,
} from "./inline-content.ts";
import { assertTableLayout, tableContentFromNode } from "./table-content.ts";
import type { InlineContent } from "./inline-content.ts";
import type { LooseBlock } from "../core.ts";
import type {
  BlockType,
  GeulRichTextSchema,
  ProseMirrorJsonNode,
} from "./schema.ts";

export function prosemirrorJsonToGeulBlocks(
  document: ProseMirrorJsonNode,
  schema: GeulRichTextSchema,
): LooseBlock[] {
  assertNodeType(document, "doc");
  assertNoAttributes(document, "doc");
  if (document.marks !== undefined)
    throw new Error("Invalid rich-text doc marks");
  const content = nodeChildren(document);
  if (content.length === 0) return [];
  if (content.length !== 1 || content[0]?.type !== "blockGroup") {
    throw new Error("Rich-text document must contain exactly one blockGroup");
  }
  return blocksFromGroup(content[0], schema);
}

function blocksFromGroup(
  group: ProseMirrorJsonNode,
  schema: GeulRichTextSchema,
  path: readonly number[] = [],
): LooseBlock[] {
  assertNodeType(group, "blockGroup");
  assertNoAttributes(group, "blockGroup");
  if (group.marks !== undefined)
    throw new Error("Invalid rich-text blockGroup marks");
  return nodeChildren(group).map((container, index) =>
    blockFromContainer(container, schema, [...path, index]),
  );
}

function blockFromContainer(
  container: ProseMirrorJsonNode,
  schema: GeulRichTextSchema,
  path: readonly number[],
): LooseBlock {
  const { blockType, childGroup, contentNode, id } = readContainerParts(
    container,
    schema,
    path,
  );
  return {
    id,
    type: blockType,
    props: {
      ...selectProps(blockType, contentNode.attrs),
      ...paragraphLayoutProps(blockType, schema, contentNode.attrs),
    },
    content: blockContentFromNode(blockType, contentNode, schema),
    children: childGroup ? blocksFromGroup(childGroup, schema, path) : [],
  };
}

function readContainerParts(
  container: ProseMirrorJsonNode,
  schema: GeulRichTextSchema,
  path: readonly number[],
) {
  assertNodeType(container, "blockContainer");
  assertAttributes(
    "blockContainer",
    nodeAttributes(container, "blockContainer"),
    { id: (value) => typeof value === "string" },
  );
  if (container.marks !== undefined)
    throw new Error("Invalid rich-text blockContainer marks");
  const [contentNode, childGroup] = validatedContainerChildren(container);
  const blockType = allowedBlockType(contentNode.type, schema);
  assertBlockNode(contentNode, blockType, schema);
  return {
    blockType,
    childGroup,
    contentNode,
    id: durableBlockId(container, blockType, contentNode, childGroup, path),
  };
}

function validatedContainerChildren(
  container: ProseMirrorJsonNode,
): [ProseMirrorJsonNode, ProseMirrorJsonNode | undefined] {
  const [contentNode, childGroup, ...unexpected] = nodeChildren(container);
  if (
    !contentNode ||
    unexpected.length > 0 ||
    (childGroup && childGroup.type !== "blockGroup")
  ) {
    throw new Error("Invalid blockContainer content");
  }
  return [contentNode, childGroup];
}

function assertBlockNode(
  node: ProseMirrorJsonNode,
  blockType: BlockType,
  schema: GeulRichTextSchema,
): void {
  assertAttributes(
    blockType,
    nodeAttributes(node, blockType),
    blockAttributeValidators(blockType, schema),
  );
  if (node.marks !== undefined)
    throw new Error(`Invalid rich-text ${blockType} marks`);
  if (INLINE_CONTENT_BLOCK_TYPES.has(blockType)) {
    inlineContentFromNode(node, schema);
    return;
  }
  if (
    blockType === "codeBlock" ||
    blockType === "mermaid" ||
    EXECUTABLE_SOURCE_BLOCK_TYPES.has(blockType)
  ) {
    assertUnmarkedTextContent(node, blockType);
    return;
  }
  if (blockType === "shader") {
    assertShaderContent(node);
    return;
  }
  if (blockType === "table") {
    assertTableLayout(node, schema);
    return;
  }
  if (NO_CONTENT_BLOCK_TYPES.has(blockType) && nodeChildren(node).length > 0) {
    throw new Error(`Invalid rich-text ${blockType} content`);
  }
}

function assertShaderContent(node: ProseMirrorJsonNode): void {
  const stages = nodeChildren(node);
  if (stages.length !== SHADER_STAGES.length)
    throw new Error("Invalid rich-text shader stage content");
  for (const [index, stage] of stages.entries())
    assertShaderStage(stage, index);
  assertShaderBufferGraph(stages.slice(2, 6));
}

function assertShaderStage(stage: ProseMirrorJsonNode, index: number): void {
  const expected = SHADER_STAGES[index]!;
  assertNodeType(stage, expected);
  const hasChannels = index >= 2;
  const attrs = nodeAttributes(stage, expected);
  assertAttributes(
    expected,
    attrs,
    hasChannels ? { channels: shaderChannels } : {},
  );
  if (hasChannels && !("channels" in attrs))
    throw new Error(`Invalid rich-text ${expected} attribute value: channels`);
  if (stage.marks !== undefined || stage.text !== undefined)
    throw new Error("Invalid rich-text shader stage content");
  assertUnmarkedTextContent(stage, "shader");
}

function assertShaderBufferGraph(
  bufferStages: readonly ProseMirrorJsonNode[],
): void {
  const visit = (name: string, path: Set<string>): void => {
    if (path.has(name))
      throw new Error("Invalid rich-text shader buffer dependency cycle");
    const channels = bufferStages["ABCD".indexOf(name)]!.attrs!
      .channels as unknown[];
    const nextPath = new Set(path).add(name);
    for (const channel of channels) {
      if (
        isRecord(channel) &&
        channel.kind === "buffer" &&
        channel.buffer !== name
      )
        visit(String(channel.buffer), nextPath);
    }
  };
  for (const name of "ABCD") visit(name, new Set());
}

function blockContentFromNode(
  blockType: BlockType,
  contentNode: ProseMirrorJsonNode,
  schema: GeulRichTextSchema,
): unknown {
  if (INLINE_CONTENT_BLOCK_TYPES.has(blockType))
    return inlineContentFromNode(contentNode, schema);
  if (blockType === "codeBlock" || blockType === "mermaid")
    return plainTextContent(contentNode);
  if (EXECUTABLE_SOURCE_BLOCK_TYPES.has(blockType))
    return executableSourceContentFromNode(blockType, contentNode);
  if (blockType === "shader") return shaderContentFromNode(contentNode);
  if (blockType === "table") return tableContentFromNode(contentNode, schema);
  return undefined;
}

function plainTextContent(node: ProseMirrorJsonNode): InlineContent[] {
  const text = nodeChildren(node)
    .map((child) => child.text!)
    .join("");
  return text.length > 0 ? [{ type: "text", text, styles: {} }] : [];
}

function executableSourceContentFromNode(
  blockType: BlockType,
  node: ProseMirrorJsonNode,
): InlineContent[] {
  const text = nodeChildren(node)
    .map((child) => child.text!)
    .join("");
  const legacySource =
    (blockType === "p5Sketch" || blockType === "threeScene") &&
    typeof node.attrs?.source === "string"
      ? node.attrs.source
      : "";
  const source = text || legacySource;
  return source.length > 0 ? [{ type: "text", text: source, styles: {} }] : [];
}

function shaderContentFromNode(node: ProseMirrorJsonNode) {
  return nodeChildren(node).map((stage, index) => {
    const text = nodeChildren(stage)
      .map((child) => child.text!)
      .join("");
    return {
      type: SHADER_STAGES[index]!,
      ...(index >= 2 ? { props: { channels: stage.attrs!.channels } } : {}),
      content: text ? [{ type: "text", text, styles: {} }] : [],
    };
  });
}

function paragraphLayoutProps(
  blockType: BlockType,
  schema: GeulRichTextSchema,
  attrs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return blockType === "paragraph" && (schema === "post" || schema === "page")
    ? selectAdditionalProps(attrs, externalVideoLinkLayoutPropSchema)
    : {};
}

function durableBlockId(
  container: ProseMirrorJsonNode,
  type: BlockType,
  node: ProseMirrorJsonNode,
  childGroup: ProseMirrorJsonNode | undefined,
  path: readonly number[],
): string {
  const rawId = container.attrs?.id;
  const emptyParagraph =
    type === "paragraph" && nodeChildren(node).length === 0 && !childGroup;
  if ((typeof rawId !== "string" || rawId.length === 0) && !emptyParagraph)
    throw new Error("Rich-text block is missing its durable id");
  return typeof rawId === "string" && rawId.length > 0
    ? rawId
    : deterministicEmptyParagraphId(path);
}

function deterministicEmptyParagraphId(path: readonly number[]): string {
  if (path.length === 1)
    return `00000000-0000-4000-8000-${path[0]!.toString(16).padStart(12, "0")}`;
  let primary = 0x811c9dc5;
  let secondary = 0x9e3779b9;
  for (const index of path) {
    for (const character of `${index}/`) {
      primary = Math.imul(primary ^ character.charCodeAt(0), 0x01000193) >>> 0;
      secondary =
        Math.imul(secondary ^ character.charCodeAt(0), 0x85ebca6b) >>> 0;
    }
  }
  return `00000000-0000-4000-8000-${primary.toString(16).padStart(8, "0")}${(secondary & 0xffff).toString(16).padStart(4, "0")}`;
}
