import * as Y from "yjs";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import { prosemirrorJsonToGeulBlocks } from "./tiptap-document/from-prosemirror.ts";
import { geulBlocksToProseMirrorDocument as encodeGeulBlocks } from "./tiptap-document/to-prosemirror.ts";
import { xmlElementFromNode } from "./tiptap-document/yjs-wire.ts";
import type { LooseBlock } from "./core.ts";
import type {
  GeulRichTextSchema,
  ProseMirrorJsonNode,
} from "./tiptap-document/schema.ts";

export type {
  GeulRichTextSchema,
  ProseMirrorJsonNode,
} from "./tiptap-document/schema.ts";
export { prosemirrorJsonToGeulBlocks } from "./tiptap-document/from-prosemirror.ts";

export function yXmlFragmentToGeulDocument(
  fragment: Y.XmlFragment,
  schema: GeulRichTextSchema,
): { document: ProseMirrorJsonNode; blocks: LooseBlock[] } {
  const document = yXmlFragmentToProsemirrorJSON(
    fragment,
  ) as ProseMirrorJsonNode;
  return { document, blocks: prosemirrorJsonToGeulBlocks(document, schema) };
}

export function sliceProseMirrorTopLevelBlocks(
  document: ProseMirrorJsonNode,
  count: number,
): ProseMirrorJsonNode {
  const group = document.content?.[0];
  if (!group || group.type !== "blockGroup") return document;
  return {
    ...document,
    content: [{ ...group, content: (group.content ?? []).slice(0, count) }],
  };
}

/**
 * Write the durable legacy ProseMirror/Yjs wire without loading an editor. The
 * wire node names are intentionally retained as a persisted collaboration
 * protocol, not as a server dependency.
 */
export function replaceGeulBlocksInYXmlFragment(
  fragment: Y.XmlFragment,
  blocks: readonly unknown[],
  schema: GeulRichTextSchema,
): void {
  const document = geulBlocksToProseMirrorDocument(blocks, schema);
  prosemirrorJsonToGeulBlocks(document, schema);
  const group = document.content![0]!;
  fragment.delete(0, fragment.length);
  fragment.insert(0, [xmlElementFromNode(group)]);
}

export function geulBlocksToProseMirrorDocument(
  blocks: readonly unknown[],
  schema: GeulRichTextSchema,
): ProseMirrorJsonNode {
  const document = encodeGeulBlocks(blocks, schema);
  prosemirrorJsonToGeulBlocks(document, schema);
  return document;
}
