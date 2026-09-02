import * as Y from "yjs";
import type { LooseBlock } from "./core.ts";
import { renderGeulProseMirrorHtml } from "./tiptap-html.ts";
import {
  geulBlocksToProseMirrorDocument,
  replaceGeulBlocksInYXmlFragment,
  yXmlFragmentToGeulDocument,
  type GeulRichTextSchema,
} from "./tiptap-document.ts";

/** Test-only access to the strict durable Tiptap/Yjs wire. */
export function writeGeulBlocks(
  document: Y.Doc,
  fragmentName: string,
  blocks: readonly unknown[],
  schema: GeulRichTextSchema,
): void {
  replaceGeulBlocksInYXmlFragment(
    document.getXmlFragment(fragmentName),
    blocks,
    schema,
  );
}

export function encodeGeulBlocks(
  blocks: readonly unknown[],
  schema: GeulRichTextSchema,
  fragmentName = "document-store",
): Uint8Array {
  const document = new Y.Doc();
  writeGeulBlocks(document, fragmentName, blocks, schema);
  return Y.encodeStateAsUpdate(document);
}

export function readGeulBlocks(
  document: Y.Doc,
  fragmentName: string,
  schema: GeulRichTextSchema,
): LooseBlock[] {
  return yXmlFragmentToGeulDocument(
    document.getXmlFragment(fragmentName),
    schema,
  ).blocks;
}

export function renderGeulBlocks(
  blocks: readonly unknown[],
  schema: GeulRichTextSchema,
): string {
  return renderGeulProseMirrorHtml(
    geulBlocksToProseMirrorDocument(blocks, schema),
  );
}
