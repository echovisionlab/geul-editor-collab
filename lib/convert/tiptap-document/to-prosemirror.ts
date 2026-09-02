import {
  allowedBlockType,
  EXECUTABLE_SOURCE_BLOCK_TYPES,
  INLINE_CONTENT_BLOCK_TYPES,
  isRecord,
  selectWritableProps,
  shaderChannels,
  SHADER_STAGES,
} from "./schema.ts";
import {
  codeBlockContentToProseMirror,
  executableSourceContentToProseMirror,
  inlineContentToProseMirror,
} from "./inline-content.ts";
import { tableContentToProseMirror } from "./table-content.ts";
import type { LooseBlock } from "../core.ts";
import type {
  BlockType,
  GeulRichTextSchema,
  ProseMirrorJsonNode,
} from "./schema.ts";

export function geulBlocksToProseMirrorDocument(
  blocks: readonly unknown[],
  schema: GeulRichTextSchema,
): ProseMirrorJsonNode {
  return {
    type: "doc",
    content: [
      {
        type: "blockGroup",
        content: blocks.map((block) =>
          blockToContainer(block as LooseBlock, schema),
        ),
      },
    ],
  };
}

function blockToContainer(
  block: LooseBlock,
  schema: GeulRichTextSchema,
): ProseMirrorJsonNode {
  if (
    !isRecord(block) ||
    typeof block.id !== "string" ||
    block.id.length === 0
  ) {
    throw new Error("Rich-text block is missing its durable id");
  }
  const content = blockToProseMirrorNode(block, schema);
  const children = Array.isArray(block.children) ? block.children : [];
  return {
    type: "blockContainer",
    attrs: { id: block.id },
    content: [
      content,
      ...(children.length > 0
        ? [
            {
              type: "blockGroup",
              content: children.map((child) => blockToContainer(child, schema)),
            },
          ]
        : []),
    ],
  };
}

function blockToProseMirrorNode(
  block: LooseBlock,
  schema: GeulRichTextSchema,
): ProseMirrorJsonNode {
  const type = allowedBlockType(block.type, schema);
  const props = isRecord(block.props) ? block.props : {};
  const attrs = selectWritableProps(type, props, schema);
  if (INLINE_CONTENT_BLOCK_TYPES.has(type)) {
    return {
      type,
      attrs,
      content: inlineContentToProseMirror(block.content, schema),
    };
  }
  if (type === "codeBlock") {
    return {
      type,
      attrs,
      content: codeBlockContentToProseMirror(block.content),
    };
  }
  if (EXECUTABLE_SOURCE_BLOCK_TYPES.has(type)) {
    const legacySource =
      typeof props.source === "string" ? props.source : undefined;
    return {
      type,
      attrs,
      content: executableSourceContentToProseMirror(
        block.content,
        legacySource,
        type,
      ),
    };
  }
  return terminalBlockToProseMirrorNode(type, block, attrs, schema);
}

function terminalBlockToProseMirrorNode(
  type: BlockType,
  block: LooseBlock,
  attrs: Record<string, unknown>,
  schema: GeulRichTextSchema,
): ProseMirrorJsonNode {
  if (type === "shader") return shaderToProseMirrorNode(block, attrs);
  if (type === "table")
    return {
      type,
      attrs,
      content: tableContentToProseMirror(block.content, schema),
    };
  return { type, attrs };
}

function shaderToProseMirrorNode(
  block: LooseBlock,
  attrs: Record<string, unknown>,
): ProseMirrorJsonNode {
  if (
    !Array.isArray(block.content) ||
    block.content.length !== SHADER_STAGES.length
  ) {
    throw new Error("Invalid rich-text shader stage content");
  }
  return {
    type: "shader",
    attrs,
    content: block.content.map((value, index) =>
      shaderStageToProseMirror(value, index),
    ),
  };
}

function shaderStageToProseMirror(
  value: unknown,
  index: number,
): ProseMirrorJsonNode {
  if (
    !isRecord(value) ||
    value.type !== SHADER_STAGES[index] ||
    !Array.isArray(value.content)
  ) {
    throw new Error("Invalid rich-text shader stage content");
  }
  const props = isRecord(value.props) ? value.props : {};
  return {
    type: SHADER_STAGES[index]!,
    ...shaderStageAttrs(props, index),
    content: executableSourceContentToProseMirror(
      value.content,
      undefined,
      "shader",
    ),
  };
}

function shaderStageAttrs(
  props: Record<string, unknown>,
  index: number,
): { attrs?: Record<string, unknown> } {
  if (index < 2) {
    assertShaderStageWithoutChannels(props);
    return {};
  }
  if (
    Object.keys(props).some((key) => key !== "channels") ||
    !shaderChannels(props.channels)
  ) {
    throw new Error("Invalid rich-text shader stage attributes");
  }
  return { attrs: { channels: props.channels } };
}

function assertShaderStageWithoutChannels(
  props: Record<string, unknown>,
): void {
  if (Object.keys(props).length > 0) {
    throw new Error("Invalid rich-text shader stage attributes");
  }
}
