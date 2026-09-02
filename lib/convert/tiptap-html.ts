import { hasAttachedFileId } from "@echovisionlab/geul-common/media/block-schemas";
import {
  escapeHTML,
  escapeHTMLAttribute,
  renderJSONContentToString,
} from "@tiptap/static-renderer/json/html-string";
import {
  renderBlockContainer,
  renderBlockGroup,
} from "./tiptap-html/block-structure.ts";
import {
  renderExecutable,
  renderShader,
  SHADER_STAGE_TYPES,
} from "./tiptap-html/executable-renderer.ts";
import {
  attribute,
  childrenToString,
  containerStyle,
  dataAttributes,
  legacyDefaultBlockAttributes,
  mathInlineSource,
  nestingAttribute,
  renderCaption,
  renderColorMark,
  resolveName,
} from "./tiptap-html/html-attributes.ts";
import { renderMap } from "./tiptap-html/map-renderer.ts";
import { prepareDocumentForStaticRender } from "./tiptap-html/static-document.ts";
import { renderTable, renderTableCell } from "./tiptap-html/table-renderer.ts";
import type { ProseMirrorJsonNode } from "./tiptap-html/types.ts";

function renderFile(attributes: Record<string, unknown> | undefined): string {
  const props = attributes ?? {};
  const attachedFileId = props.fileId;
  if (!hasAttachedFileId(attachedFileId)) {
    return '<div class="file-block-html file-block-html--empty"></div>';
  }
  const fileId = attachedFileId.trim();
  const name = resolveName(props.name, "Untitled file");
  return `<div class="file-block-html file-block"${containerStyle(props)}${attribute("data-file-id", fileId)}${dataAttributes(props, new Set(["fileId", "_nestingLevel"]))}${nestingAttribute(props)}><a class="file-block__link"${attribute("data-file-id", fileId)}>${escapeHTML(name)}</a>${renderCaption("file-block__caption", props.caption)}</div>`;
}

const renderDocument = renderJSONContentToString({
  nodeMapping: {
    doc: ({ children }) => childrenToString(children),
    blockGroup: ({ node, children }) =>
      renderBlockGroup(node as ProseMirrorJsonNode, children as string[]),
    blockContainer: ({ node, children }) =>
      renderBlockContainer(node as ProseMirrorJsonNode, children as string[]),
    paragraph: ({ node, children }) => {
      const attrs = (node as ProseMirrorJsonNode).attrs;
      const externalVideoAttributes = `${attrs?.previewWidth && attrs.previewWidth !== "100" ? attribute("data-preview-width", attrs.previewWidth) : ""}${attrs?.aspectRatio && attrs.aspectRatio !== "auto" ? attribute("data-aspect-ratio", attrs.aspectRatio) : ""}`;
      return `<p${legacyDefaultBlockAttributes(attrs, true)}${externalVideoAttributes}>${childrenToString(children)}</p>`;
    },
    heading: ({ node, children }) => {
      const attrs = (node as ProseMirrorJsonNode).attrs;
      const level = Math.max(1, Math.min(6, Number(attrs?.level) || 1));
      return `<h${level}${legacyDefaultBlockAttributes(attrs, true)}${attribute("data-level", level)}>${childrenToString(children)}</h${level}>`;
    },
    bulletListItem: ({ children }) =>
      `<p class="bn-inline-content">${childrenToString(children)}</p>`,
    numberedListItem: ({ children }) =>
      `<p class="bn-inline-content">${childrenToString(children)}</p>`,
    checkListItem: ({ children }) =>
      `<p class="bn-inline-content">${childrenToString(children)}</p>`,
    quote: ({ node, children }) =>
      `<blockquote${legacyDefaultBlockAttributes((node as ProseMirrorJsonNode).attrs, false)}>${childrenToString(children)}</blockquote>`,
    callout: ({ children }) =>
      `<div data-callout-copy="">${childrenToString(children)}</div>`,
    codeBlock: ({ node, children }) => {
      const language =
        (node as ProseMirrorJsonNode).attrs?.language ?? "javascript";
      return `<pre${attribute("data-language", language)}><code class="bn-inline-content language-${escapeHTMLAttribute(String(language))}"${attribute("data-language", language)}>${childrenToString(children)}</code></pre>`;
    },
    p5Sketch: ({ node, children }) =>
      renderExecutable(node as ProseMirrorJsonNode, children),
    threeScene: ({ node, children }) =>
      renderExecutable(node as ProseMirrorJsonNode, children),
    shader: ({ node, children }) =>
      renderShader(node as ProseMirrorJsonNode, children as string[]),
    ...Object.fromEntries(
      SHADER_STAGE_TYPES.map((type) => [
        type,
        ({ children }: { children?: string | string[] }) =>
          childrenToString(children),
      ]),
    ),
    divider: () => "<hr>",
    math: ({ node }) =>
      `<div class="math-block"${attribute("data-latex", (node as ProseMirrorJsonNode).attrs?.latex)}></div>`,
    map: ({ node }) => renderMap((node as ProseMirrorJsonNode).attrs),
    file: ({ node }) => renderFile((node as ProseMirrorJsonNode).attrs),
    table: ({ node, children }) =>
      renderTable(node as ProseMirrorJsonNode, children),
    tableRow: ({ children }) => `<tr>${childrenToString(children)}</tr>`,
    tableHeader: ({ node, children }) =>
      renderTableCell("th", node as ProseMirrorJsonNode, children),
    tableCell: ({ node, children }) =>
      renderTableCell("td", node as ProseMirrorJsonNode, children),
    tableParagraph: ({ children }) => `<p>${childrenToString(children)}</p>`,
    hardBreak: () => "<br>",
    mathInline: ({ node }) =>
      `<span class="math-inline" data-inline-content-type="mathInline"${attribute("data-latex", mathInlineSource(node as ProseMirrorJsonNode))}></span>`,
    text: ({ node }) => escapeHTML((node as ProseMirrorJsonNode).text ?? ""),
  },
  markMapping: {
    bold: ({ children }) => `<strong>${childrenToString(children)}</strong>`,
    italic: ({ children }) => `<em>${childrenToString(children)}</em>`,
    underline: ({ children }) => `<u>${childrenToString(children)}</u>`,
    strike: ({ children }) => `<s>${childrenToString(children)}</s>`,
    code: ({ children }) => `<code>${childrenToString(children)}</code>`,
    textColor: ({ mark, children }) =>
      renderColorMark(
        "textColor",
        (mark as { attrs?: Record<string, unknown> }).attrs?.stringValue,
        children,
      ),
    backgroundColor: ({ mark, children }) =>
      renderColorMark(
        "backgroundColor",
        (mark as { attrs?: Record<string, unknown> }).attrs?.stringValue,
        children,
      ),
    link: ({ mark, children }) => {
      const href =
        (mark as { attrs?: Record<string, unknown> }).attrs?.href ?? "";
      return `<a${attribute("href", href)} target="_blank" rel="noopener noreferrer nofollow" classname="bn-inline-content-section" data-inline-content-type="link">${childrenToString(children)}</a>`;
    },
  },
  unhandledNode: ({ node }) => {
    throw new Error(
      `Unhandled Tiptap server-render node: ${(node as ProseMirrorJsonNode).type}`,
    );
  },
  unhandledMark: ({ mark }) => {
    throw new Error(
      `Unhandled Tiptap server-render mark: ${(mark as { type?: string }).type}`,
    );
  },
});

export function renderGeulProseMirrorHtml(
  document: ProseMirrorJsonNode,
): string {
  return renderDocument({ content: prepareDocumentForStaticRender(document) });
}
