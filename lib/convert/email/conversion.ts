import { stripTrailingEmptyParagraphBlocks } from "@echovisionlab/geul-common/editor/materialized-blocks";
import { normalizeRichTextHtmlLinksFromBlocks } from "@echovisionlab/geul-common/editor/link-normalization";
import * as Y from "yjs";
import { extractText, type LooseBlock } from "../core.ts";
import { renderGeulProseMirrorHtml } from "../tiptap-html.ts";
import {
  sliceProseMirrorTopLevelBlocks,
  replaceGeulBlocksInYXmlFragment,
  yXmlFragmentToGeulDocument,
} from "../tiptap-document.ts";
import { assertClosedEmailYjsDocument } from "./validation.ts";

export async function convertEmailToHtml(
  yjsState: Uint8Array,
): Promise<string> {
  const { html } = await convertEmailDocumentToContent(yjsState);
  return html;
}
interface ConvertedEmailContent {
  yjsState: Uint8Array;
  json: Uint8Array;
  html: string;
  text: string;
}

function normalizeEmptyParagraphPlaceholders(html: string): string {
  return html.replaceAll("<p>\uFFFC</p>", "<p></p>");
}

export async function normalizeEmailDocumentState(
  yjsState: Uint8Array,
): Promise<Uint8Array> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, yjsState);

  assertClosedEmailYjsDocument(doc);
  const fragment = doc.getXmlFragment("document-store");
  const originalBlocks = yXmlFragmentToGeulDocument(fragment, "email").blocks;
  const normalizedBlocks = stripTrailingEmptyParagraphBlocks(
    originalBlocks as never,
  );

  if (normalizedBlocks.length === originalBlocks.length) {
    return yjsState;
  }

  replaceGeulBlocksInYXmlFragment(fragment, normalizedBlocks, "email");
  return Y.encodeStateAsUpdate(doc);
}

export async function convertEmailDocumentToContent(
  yjsState: Uint8Array,
): Promise<ConvertedEmailContent> {
  // Restore Y.Doc from state
  const doc = new Y.Doc();
  Y.applyUpdate(doc, yjsState);

  assertClosedEmailYjsDocument(doc);
  const fragment = doc.getXmlFragment("document-store");

  // Convert Yjs fragment to blocks
  const converted = yXmlFragmentToGeulDocument(fragment, "email");
  const originalBlocks = converted.blocks;
  const blocks = stripTrailingEmptyParagraphBlocks(originalBlocks as never);
  const yjsStateChanged = blocks.length !== originalBlocks.length;
  if (yjsStateChanged) {
    replaceGeulBlocksInYXmlFragment(fragment, blocks, "email");
  }

  // Convert blocks to HTML and normalize malformed hrefs generated from editor links.
  const rawHtml = renderGeulProseMirrorHtml(
    sliceProseMirrorTopLevelBlocks(converted.document, blocks.length),
  );
  const html = normalizeEmptyParagraphPlaceholders(
    normalizeRichTextHtmlLinksFromBlocks(blocks as never, rawHtml),
  );
  const text = extractText(blocks as LooseBlock[]);
  const json = new TextEncoder().encode(JSON.stringify(blocks));
  return {
    yjsState: yjsStateChanged ? Y.encodeStateAsUpdate(doc) : yjsState,
    json,
    html,
    text,
  };
}
