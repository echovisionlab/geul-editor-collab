/**
 * Core conversion utilities for Collab server
 * Converts Yjs state to HTML with KaTeX math and Shiki code highlighting
 */
import katex from "katex";
import { createHighlighter, type Highlighter } from "shiki";

// Loose block type for data processing
export interface LooseBlock {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: unknown;
  children: LooseBlock[];
}

interface HeadingInfo {
  id: string;
  level: number;
}

// Singleton highlighter
let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-light", "github-dark"],
      langs: [
        "javascript",
        "typescript",
        "jsx",
        "tsx",
        "python",
        "java",
        "c",
        "cpp",
        "csharp",
        "go",
        "rust",
        "ruby",
        "php",
        "swift",
        "kotlin",
        "html",
        "css",
        "scss",
        "json",
        "yaml",
        "xml",
        "sql",
        "shellscript",
        "markdown",
        "glsl",
      ],
    });
  }
  return highlighterPromise;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>/gi, "\n");
}

export async function applyCodeHighlighting(html: string): Promise<string> {
  const codeBlockRegex =
    /<pre\s+data-language="([^"]+)"[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi;

  const matches = [...html.matchAll(codeBlockRegex)];
  if (matches.length === 0) {
    return html;
  }

  const highlighter = await getHighlighter();
  let result = html;

  for (const match of matches) {
    const [fullMatch, language, encodedCode] = match;
    const code = decodeHtmlEntities(encodedCode);

    try {
      const highlighted = highlighter.codeToHtml(code, {
        lang: language,
        theme: "github-dark",
      });

      const highlightedWithLang = highlighted.replace(
        /<pre\s+/,
        `<pre data-language="${language}" `,
      );

      result = result.replace(fullMatch, highlightedWithLang);
    } catch {
      // Language not supported, keep original
    }
  }

  return result;
}

export function applyMathRendering(html: string): string {
  const mathInlineRegex =
    /<span[^>]*class="math-inline"[^>]*data-latex="([^"]*)"[^>]*><\/span>/gi;
  const mathBlockRegex =
    /<div[^>]*class="math-block"[^>]*data-latex="([^"]*)"[^>]*><\/div>/gi;

  let result = html;

  // Process inline math
  result = result.replace(mathInlineRegex, (match, latex) => {
    if (!latex) {
      return match;
    }
    try {
      const rendered = katex.renderToString(latex, {
        displayMode: false,
        throwOnError: false,
      });
      return `<span class="math-inline" data-latex="${latex}">${rendered}</span>`;
    } catch {
      return match;
    }
  });

  // Process block math
  result = result.replace(mathBlockRegex, (match, latex) => {
    if (!latex) {
      return match;
    }
    try {
      const rendered = katex.renderToString(latex, {
        displayMode: true,
        throwOnError: false,
      });
      return `<div class="math-block" data-latex="${latex}">${rendered}</div>`;
    } catch {
      return match;
    }
  });

  return result;
}

export function extractHeadings(blocks: LooseBlock[]): HeadingInfo[] {
  const headings: HeadingInfo[] = [];

  function traverse(items: LooseBlock[]): void {
    for (const block of items) {
      if (block.type === "heading") {
        const level =
          typeof block.props.level === "number" ? block.props.level : 1;
        headings.push({ id: block.id, level });
      }

      if (block.children && block.children.length > 0) {
        traverse(block.children);
      }
    }
  }

  traverse(blocks);
  return headings;
}

export function addHeadingIds(html: string, headings: HeadingInfo[]): string {
  let result = html;
  let headingIndex = 0;

  const headingRegex =
    /<(h[1-6])(\s[^>]*)?>([^<]*(?:<[^/h][^>]*>[^<]*)*)<\/h[1-6]>/gi;

  result = result.replace(headingRegex, (match, tag, attrs, content) => {
    if (headingIndex >= headings.length) {
      return match;
    }

    const heading = headings[headingIndex];
    headingIndex++;

    if (attrs && /\sid=/.test(attrs)) {
      return match;
    }

    const newAttrs = attrs
      ? ` id="${heading.id}"${attrs}`
      : ` id="${heading.id}"`;
    return `<${tag}${newAttrs}>${content}</${tag}>`;
  });

  return result;
}

export function extractText(blocks: LooseBlock[]): string {
  const texts: string[] = [];

  function appendString(value: unknown): void {
    if (typeof value === "string" && value) {
      texts.push(value);
    }
  }

  function traverseContent(content: unknown): void {
    if (!content || typeof content !== "object") {
      return;
    }

    if (Array.isArray(content)) {
      for (const item of content) {
        traverseContent(item);
      }
      return;
    }

    const record = content as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      texts.push(record.text);
      return;
    }
    if ("content" in record) {
      traverseContent(record.content);
    }
  }

  function appendMapPlaceNames(places: unknown): void {
    if (!Array.isArray(places)) {
      return;
    }
    for (const place of places) {
      if (!place || typeof place !== "object" || !("name" in place)) {
        continue;
      }
      appendString((place as { name?: string }).name);
    }
  }

  function appendBlockSpecificText(block: LooseBlock): void {
    if (block.type === "mathInline" || block.type === "mathBlock") {
      appendString(block.props?.latex);
    }
    if (block.type === "codeBlock") {
      appendString(block.props?.code);
    }
    if (block.type === "map") {
      appendMapPlaceNames(block.props?.places);
    }
  }

  function traverseBlocks(items: LooseBlock[]): void {
    for (const block of items) {
      if (block.content) {
        traverseContent(block.content);
      }
      appendBlockSpecificText(block);
      if (block.children && block.children.length > 0) {
        traverseBlocks(block.children);
      }
    }
  }

  traverseBlocks(blocks);
  return texts.join(" ");
}
