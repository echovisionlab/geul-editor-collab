/**
 * Post content conversion - Yjs to HTML
 *
 * Converts post Yjs state to rendered HTML with:
 * - KaTeX math rendering
 * - Shiki code highlighting
 * - Heading IDs for TOC
 * - ID-only map blocks hydrated by the runtime delivery layer
 */
import { normalizeRichTextHtmlLinksFromBlocks } from "@echovisionlab/geul-common/editor/link-normalization";
import { postContentSchema } from "@echovisionlab/geul-common/post";
import * as Y from "yjs";
import { assertLocaleDocumentLayoutAbsent } from "../document-layout.ts";
import {
  addHeadingIds,
  applyCodeHighlighting,
  applyMathRendering,
  extractHeadings,
  extractText,
  type LooseBlock,
} from "./core.ts";
import { renderGeulProseMirrorHtml } from "./tiptap-html.ts";
import {
  yXmlFragmentToGeulDocument,
  type GeulRichTextSchema,
} from "./tiptap-document.ts";

interface ConvertedContent {
  json: Uint8Array;
  html: string;
  text: string;
}

function stabilizeEmptyDocumentBlocks<
  T extends {
    id: string;
    type: string;
    content?: unknown;
    children?: unknown[];
  },
>(blocks: T[]): T[] {
  const isEmptyDocument =
    blocks.length > 0 &&
    blocks.every(
      (block) =>
        block.type === "paragraph" &&
        (!Array.isArray(block.content) || block.content.length === 0) &&
        (!Array.isArray(block.children) || block.children.length === 0),
    );
  if (!isEmptyDocument) {
    return blocks;
  }
  return blocks.map((block, index) => ({
    ...block,
    id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
  }));
}

/**
 * Convert Yjs state to HTML for document view
 * Works for post, page, work, and any other document type using the durable editor wire
 *
 * @param yjsState - Yjs document state as Uint8Array
 * @returns Converted HTML and plain text
 */
async function convertDocumentToHtmlWithJson(
  yjsState: Uint8Array,
  createJson: (blocks: unknown[]) => unknown,
  schema: GeulRichTextSchema,
): Promise<ConvertedContent> {
  // Restore Y.Doc from state
  const doc = new Y.Doc();
  Y.applyUpdate(doc, yjsState);

  const fragment = doc.getXmlFragment("document-store");

  // Decode the existing durable ProseMirror/Yjs wire directly.
  const converted = yXmlFragmentToGeulDocument(fragment, schema);
  const blocks = stabilizeEmptyDocumentBlocks(converted.blocks);

  // Render the exact ProseMirror JSON through Tiptap's DOM-free static renderer.
  const rawHtml = normalizeRichTextHtmlLinksFromBlocks(
    blocks as never,
    renderGeulProseMirrorHtml(converted.document),
  );

  // Apply post-processing pipeline
  const headings = extractHeadings(blocks as LooseBlock[]);
  const htmlWithHeadingIds = addHeadingIds(rawHtml, headings);
  const htmlWithMath = applyMathRendering(htmlWithHeadingIds);
  const html = await applyCodeHighlighting(htmlWithMath);

  // Extract plain text for search
  const text = extractText(blocks as LooseBlock[]);

  // Serialize blocks to JSON
  const json = new TextEncoder().encode(JSON.stringify(createJson(blocks)));

  return { json, html, text };
}

export async function convertDocumentToHtml(
  yjsState: Uint8Array,
): Promise<ConvertedContent> {
  return convertDocumentToHtmlWithJson(yjsState, (blocks) => blocks, "editor");
}

export async function convertPostDocumentToHtml(
  yjsState: Uint8Array,
): Promise<ConvertedContent> {
  assertLocaleDocumentLayoutAbsent("post", yjsState);
  return convertDocumentToHtmlWithJson(
    yjsState,
    (blocks) => postContentSchema.parse(blocks),
    "post",
  );
}
