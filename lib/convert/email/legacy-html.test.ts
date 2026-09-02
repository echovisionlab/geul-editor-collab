import { describe, expect, it } from "vitest";
import { parseLegacyEmailHtmlBlocks } from "./legacy-html.ts";

describe("parseLegacyEmailHtmlBlocks", () => {
  it("converts the complete supported legacy email HTML surface deterministically", () => {
    const html = `root
      <!-- ignored -->
      <p style="text-align:center;color:red;background-color:blue">
        <strong>bold</strong><b>b</b><em>em</em><i>i</i><u>u</u>
        <s>s</s><strike>strike</strike><del>del</del><code>code</code>
        <span style="color:green;background-color:yellow">span</span><br>
        <a href="{{verification_url}}"><strong>verify</strong></a><!-- inline ignored -->
      </p>
      <p style="text-align:right">right</p><p style="text-align:justify">justify</p>
      <h1>h1</h1><h2>h2</h2><h3>h3</h3><h4>h4</h4><h5>h5</h5><h6>h6</h6>
      <blockquote style="color:purple;background-color:black">quote</blockquote>
      <hr>
      <pre><code class="decorative language-typescript">const value: number = 1;</code></pre>
      <pre>plain</pre>
      <ul><li>one<ul><li>nested omitted</li></ul></li></ul>
      <ol start="3"><li>three</li><li>four</li></ol>
      <ol><li>default start</li></ol>
      <table style="color:navy">
        <thead><tr><th style="text-align:right" colspan="2">Heading</th></tr></thead>
        <tbody><tr><th>Row</th><td rowspan="2">Value</td></tr><tr><th>Row 2</th><td>Tail</td></tr></tbody>
      </table>`;

    const first = parseLegacyEmailHtmlBlocks(html);
    const second = parseLegacyEmailHtmlBlocks(html);

    expect(second).toEqual(first);
    expect(first.map((block) => block.type)).toEqual([
      "paragraph",
      "paragraph",
      "paragraph",
      "paragraph",
      "heading",
      "heading",
      "heading",
      "heading",
      "heading",
      "heading",
      "quote",
      "divider",
      "codeBlock",
      "codeBlock",
      "bulletListItem",
      "numberedListItem",
      "numberedListItem",
      "numberedListItem",
      "table",
    ]);
    expect(first[1]).toMatchObject({
      props: {
        textAlignment: "center",
        textColor: "red",
        backgroundColor: "blue",
      },
    });
    expect(first[12]).toMatchObject({ props: { language: "typescript" } });
    expect(first[13]).toMatchObject({ props: { language: "plaintext" } });
    expect(first[15]).toMatchObject({ props: { start: 3 } });
    expect(first[16]).toMatchObject({ props: { start: 4 } });
    expect(first[17]).toMatchObject({ props: { start: 1 } });
    expect(first[18]).toMatchObject({
      props: { textColor: "navy" },
      content: { type: "tableContent", headerRows: 1, headerCols: 1 },
    });
  });

  it.each([
    [
      "unsupported block",
      "<section>body</section>",
      "Unsupported email HTML block element: section",
    ],
    [
      "unsupported inline",
      "<p><img></p>",
      "Unsupported email HTML inline element: img",
    ],
    [
      "link without href",
      "<p><a>label</a></p>",
      "Invalid email HTML link without href",
    ],
    [
      "table without rows",
      "<table></table>",
      "Invalid email HTML table without rows",
    ],
  ])("rejects %s", (_name, html, message) => {
    expect(() => parseLegacyEmailHtmlBlocks(html)).toThrow(message);
  });

  it("ignores empty text and non-element top-level nodes", () => {
    expect(parseLegacyEmailHtmlBlocks("  <!-- comment -->  ")).toEqual([]);
  });

  it("derives all-header table geometry", () => {
    expect(
      parseLegacyEmailHtmlBlocks(
        "<table><tr><th>A</th><th>B</th></tr></table>",
      )[0],
    ).toMatchObject({ content: { headerRows: 1, headerCols: 2 } });
  });
});
