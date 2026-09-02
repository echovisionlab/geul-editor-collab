import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHighlighter: vi.fn(),
  codeToHtml: vi.fn(),
  renderToString: vi.fn(),
}));

vi.mock("shiki", () => ({ createHighlighter: mocks.createHighlighter }));
vi.mock("katex", () => ({ default: { renderToString: mocks.renderToString } }));

import {
  addHeadingIds,
  applyCodeHighlighting,
  applyMathRendering,
  extractHeadings,
  extractText,
  type LooseBlock,
} from "./core.ts";

function block(overrides: Partial<LooseBlock> = {}): LooseBlock {
  return {
    id: "block-1",
    type: "paragraph",
    props: {},
    children: [],
    ...overrides,
  };
}

describe("conversion core", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createHighlighter.mockResolvedValue({ codeToHtml: mocks.codeToHtml });
    mocks.codeToHtml.mockImplementation(
      (code: string) => `<pre class="shiki"><code>${code}</code></pre>`,
    );
    mocks.renderToString.mockImplementation(
      (latex: string) => `<span>${latex}</span>`,
    );
  });

  it("returns HTML without code blocks unchanged", async () => {
    await expect(applyCodeHighlighting("<p>plain</p>")).resolves.toBe(
      "<p>plain</p>",
    );
    expect(mocks.createHighlighter).not.toHaveBeenCalled();
  });

  it("highlights code blocks, decodes entities, reuses the singleton, and preserves failures", async () => {
    const source =
      '<pre data-language="typescript"><code>&lt;x&gt;&amp;&quot;&#39;<br>line</code></pre>';
    const highlighted = await applyCodeHighlighting(source);
    expect(highlighted).toContain('data-language="typescript"');
    expect(mocks.codeToHtml).toHaveBeenCalledWith("<x>&\"'\nline", {
      lang: "typescript",
      theme: "github-dark",
    });

    mocks.codeToHtml.mockImplementationOnce(() => {
      throw new Error("unsupported");
    });
    await expect(
      applyCodeHighlighting(
        '<pre data-language="unknown"><code>code</code></pre>',
      ),
    ).resolves.toContain('data-language="unknown"');
    expect(mocks.createHighlighter).toHaveBeenCalledOnce();
  });

  it("renders inline and block math while preserving empty and failed formulas", () => {
    mocks.renderToString
      .mockImplementationOnce((latex: string) => `<i>${latex}</i>`)
      .mockImplementationOnce(() => {
        throw new Error("inline failed");
      })
      .mockImplementationOnce((latex: string) => `<b>${latex}</b>`)
      .mockImplementationOnce(() => {
        throw new Error("block failed");
      });
    const html = [
      '<span class="math-inline" data-latex="x"></span>',
      '<span class="math-inline" data-latex="y"></span>',
      '<span class="math-inline" data-latex=""></span>',
      '<div class="math-block" data-latex="z"></div>',
      '<div class="math-block" data-latex="w"></div>',
      '<div class="math-block" data-latex=""></div>',
    ].join("");
    const rendered = applyMathRendering(html);
    expect(rendered).toContain("<i>x</i>");
    expect(rendered).toContain('data-latex="y"></span>');
    expect(rendered).toContain("<b>z</b>");
    expect(rendered).toContain('data-latex="w"></div>');
  });

  it("extracts nested headings and adds IDs without replacing existing IDs", () => {
    const headings = extractHeadings([
      block({
        id: "heading-1",
        type: "heading",
        props: { level: 2 },
        children: [block({ id: "heading-2", type: "heading", props: {} })],
      }),
      block(),
    ]);
    expect(headings).toEqual([
      { id: "heading-1", level: 2 },
      { id: "heading-2", level: 1 },
    ]);
    expect(
      addHeadingIds(
        '<h2>First</h2><h1 class="x">Second</h1><h3 id="keep">Third</h3>',
        [...headings, { id: "heading-3", level: 3 }],
      ),
    ).toBe(
      '<h2 id="heading-1">First</h2><h1 id="heading-2" class="x">Second</h1><h3 id="keep">Third</h3>',
    );
    expect(addHeadingIds("<h1>Extra</h1>", [])).toBe("<h1>Extra</h1>");
  });

  it("extracts authored text, formulas, code, map names, and child content", () => {
    const blocks = [
      block({
        content: [
          null,
          "ignored",
          { type: "text", text: 42 },
          { type: "text", text: "Body" },
          [{ type: "text", text: "Nested" }],
        ],
      }),
      block({ type: "mathInline", props: { latex: "x+y" } }),
      block({ type: "mathBlock", props: { latex: "" } }),
      block({ type: "codeBlock", props: { code: "const x = 1" } }),
      block({ type: "codeBlock", props: { code: 42 } }),
      block({
        type: "map",
        props: {
          places: [
            null,
            "invalid",
            {},
            { name: "" },
            { name: 42 },
            { name: "Seoul" },
          ],
        },
        children: [block({ content: [{ type: "text", text: "Child" }] })],
      }),
      block({ type: "map", props: { places: "invalid" } }),
    ];
    expect(extractText(blocks)).toBe("Body Nested x+y const x = 1 Seoul Child");
  });
});
