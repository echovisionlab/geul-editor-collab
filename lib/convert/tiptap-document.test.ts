import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { renderGeulProseMirrorHtml } from "./tiptap-html.ts";
import {
  readGeulBlocks,
  renderGeulBlocks,
  writeGeulBlocks,
} from "./test-helpers.ts";
import {
  geulBlocksToProseMirrorDocument,
  prosemirrorJsonToGeulBlocks,
  sliceProseMirrorTopLevelBlocks,
  type ProseMirrorJsonNode,
  yXmlFragmentToGeulDocument,
} from "./tiptap-document.ts";

const defaultTextProps = {
  backgroundColor: "default",
  textColor: "default",
  textAlignment: "left",
} as const;

function documentWithSingleBlock(
  content: ProseMirrorJsonNode,
): ProseMirrorJsonNode {
  return {
    type: "doc",
    content: [
      {
        type: "blockGroup",
        content: [
          {
            type: "blockContainer",
            attrs: { id: "block-id" },
            content: [content],
          },
        ],
      },
    ],
  };
}

function documentWithBlocks(
  ...contents: ProseMirrorJsonNode[]
): ProseMirrorJsonNode {
  return {
    type: "doc",
    content: [
      {
        type: "blockGroup",
        content: contents.map((content, index) => ({
          type: "blockContainer",
          attrs: { id: `block-${index}` },
          content: [content],
        })),
      },
    ],
  };
}

function text(
  value: string,
  marks?: ProseMirrorJsonNode["marks"],
): ProseMirrorJsonNode {
  return { type: "text", text: value, ...(marks ? { marks } : {}) };
}

function tableCell(
  type: "tableCell" | "tableHeader",
  attrs: Record<string, unknown> = {},
  content: ProseMirrorJsonNode[] = [{ type: "tableParagraph", content: [] }],
): ProseMirrorJsonNode {
  return { type, attrs: { colspan: 1, rowspan: 1, ...attrs }, content };
}

describe("Tiptap server materialization", () => {
  it.each(["editor", "page", "post", "email"] as const)(
    "round-trips a nested Callout through the %s schema",
    (schema) => {
      const blocks = [
        {
          id: "callout",
          type: "callout",
          props: {
            icon: "⚠️",
            backgroundColor: "yellow",
            textColor: "default",
          },
          content: [
            { type: "text", text: "Clear the rights first.", styles: {} },
          ],
          children: [
            {
              id: "callout-copy",
              type: "paragraph",
              props: defaultTextProps,
              content: [{ type: "text", text: "Nested details.", styles: {} }],
              children: [],
            },
          ],
        },
      ];

      const document = geulBlocksToProseMirrorDocument(blocks, schema);
      const [roundTripped] = prosemirrorJsonToGeulBlocks(document, schema);
      expect(roundTripped).toMatchObject({
        ...blocks[0],
        children: [
          {
            id: "callout-copy",
            type: "paragraph",
            content: [{ type: "text", text: "Nested details.", styles: {} }],
          },
        ],
      });
      expect(roundTripped?.content).toEqual(blocks[0]?.content);
      expect(renderGeulProseMirrorHtml(document)).toBe(
        '<aside data-callout="" data-bg-color="yellow" data-text-color="default"><span data-callout-icon="" aria-hidden="true">⚠️</span><div data-callout-content=""><div data-callout-copy="">Clear the rights first.</div><p>Nested details.</p></div></aside>',
      );
    },
  );

  it("stores inline math as plain-text content and still reads the legacy latex attribute", () => {
    const durableDocument = geulBlocksToProseMirrorDocument(
      [
        {
          id: "inline-math",
          type: "paragraph",
          props: defaultTextProps,
          content: [
            { type: "text", text: "Before ", styles: {} },
            { type: "mathInline", props: { latex: "E=mc^2" } },
            { type: "text", text: " after", styles: {} },
          ],
          children: [],
        },
      ],
      "editor",
    );
    const durableInlineMath =
      durableDocument.content?.[0]?.content?.[0]?.content?.[0]?.content?.[1];

    expect(durableInlineMath).toEqual({
      type: "mathInline",
      attrs: { latex: "" },
      content: [{ type: "text", text: "E=mc^2" }],
    });

    const contentSource = documentWithSingleBlock({
      type: "paragraph",
      attrs: defaultTextProps,
      content: [
        text("Before "),
        {
          type: "mathInline",
          attrs: { latex: "" },
          content: [text("E=mc^2")],
        },
        text(" after"),
      ],
    });
    const legacySource = documentWithSingleBlock({
      type: "paragraph",
      attrs: defaultTextProps,
      content: [{ type: "mathInline", attrs: { latex: "x^2" } }],
    });

    expect(
      prosemirrorJsonToGeulBlocks(contentSource, "editor")[0]?.content,
    ).toEqual([
      { type: "text", text: "Before ", styles: {} },
      { type: "mathInline", props: { latex: "E=mc^2" } },
      { type: "text", text: " after", styles: {} },
    ]);
    expect(
      prosemirrorJsonToGeulBlocks(legacySource, "editor")[0]?.content,
    ).toEqual([{ type: "mathInline", props: { latex: "x^2" } }]);
    const contentSourceWithoutLegacyAttribute = documentWithSingleBlock({
      type: "paragraph",
      attrs: defaultTextProps,
      content: [{ type: "mathInline", content: [text("y^2")] }],
    });
    const emptySourceWithoutLegacyAttribute = documentWithSingleBlock({
      type: "paragraph",
      attrs: defaultTextProps,
      content: [{ type: "mathInline" }],
    });
    expect(
      prosemirrorJsonToGeulBlocks(
        contentSourceWithoutLegacyAttribute,
        "editor",
      )[0]?.content,
    ).toEqual([{ type: "mathInline", props: { latex: "y^2" } }]);
    expect(
      prosemirrorJsonToGeulBlocks(
        emptySourceWithoutLegacyAttribute,
        "editor",
      )[0]?.content,
    ).toEqual([{ type: "mathInline", props: { latex: "" } }]);
    expect(renderGeulProseMirrorHtml(contentSource)).toContain(
      'class="math-inline" data-inline-content-type="mathInline" data-latex="E=mc^2"',
    );
    expect(renderGeulProseMirrorHtml(legacySource)).toContain(
      'class="math-inline" data-inline-content-type="mathInline" data-latex="x^2"',
    );
    expect(
      renderGeulProseMirrorHtml(emptySourceWithoutLegacyAttribute),
    ).toContain(
      'class="math-inline" data-inline-content-type="mathInline" data-latex=""',
    );
    expect(
      renderGeulProseMirrorHtml(
        documentWithSingleBlock({
          type: "paragraph",
          attrs: defaultTextProps,
          content: [{ type: "mathInline", content: [{ type: "text" }] }],
        }),
      ),
    ).toContain('data-latex=""');
    expect(
      renderGeulProseMirrorHtml(
        documentWithSingleBlock({
          type: "paragraph",
          attrs: defaultTextProps,
          content: [{ type: "mathInline", content: [{ type: "hardBreak" }] }],
        }),
      ),
    ).toContain('data-latex=""');

    const emptyDurableDocument = geulBlocksToProseMirrorDocument(
      [
        {
          id: "empty-inline-math",
          type: "paragraph",
          props: defaultTextProps,
          content: [{ type: "mathInline", props: { latex: "" } }],
          children: [],
        },
      ],
      "editor",
    );
    expect(
      emptyDurableDocument.content?.[0]?.content?.[0]?.content?.[0]
        ?.content?.[0],
    ).toEqual({
      type: "mathInline",
      attrs: { latex: "" },
    });

    const invalidMathInline = (props: unknown) => ({
      id: "invalid-inline-math",
      type: "paragraph",
      props: defaultTextProps,
      content: [{ type: "mathInline", props }],
      children: [],
    });
    expect(() =>
      geulBlocksToProseMirrorDocument(
        [invalidMathInline(undefined)] as never,
        "editor",
      ),
    ).toThrow("Unsupported inline content node for editor: mathInline");
    expect(() =>
      geulBlocksToProseMirrorDocument(
        [invalidMathInline({ latex: 1 })] as never,
        "editor",
      ),
    ).toThrow("Invalid rich-text mathInline source");
    expect(() =>
      geulBlocksToProseMirrorDocument(
        [invalidMathInline({ latex: "x" })] as never,
        "bio",
      ),
    ).toThrow("Unsupported inline content node for bio: mathInline");
  });

  it("normalizes omitted optional legacy styles as unmarked durable text", () => {
    const document = new Y.Doc();
    const blocks = [
      {
        id: "legacy-paragraph",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "Legacy text" }],
        children: [],
      },
      {
        id: "legacy-code",
        type: "codeBlock",
        props: { language: "text" },
        content: [{ type: "text", text: "legacy code" }],
        children: [],
      },
    ];

    writeGeulBlocks(document, "document-store", blocks, "editor");

    expect(readGeulBlocks(document, "document-store", "editor")).toEqual([
      {
        ...blocks[0],
        props: defaultTextProps,
        content: [{ type: "text", text: "Legacy text", styles: {} }],
      },
      {
        ...blocks[1],
        content: [{ type: "text", text: "legacy code", styles: {} }],
      },
    ]);
  });

  it("round-trips marked, linked, nested file content through the strict durable wire", () => {
    const document = new Y.Doc();
    const fragment = document.getXmlFragment("document-store");
    const blocks = [
      {
        id: "paragraph-one",
        type: "paragraph",
        props: defaultTextProps,
        content: [
          { type: "text", text: "Before ", styles: { bold: true } },
          {
            type: "link",
            href: "https://example.com",
            content: [
              { type: "text", text: "Tiptap", styles: { italic: true } },
            ],
          },
        ],
        children: [
          {
            id: "file-one",
            type: "file",
            props: {
              fileId: "file-id",
              fileName: "field-recording.wav",
              name: "Field recording",
              alt: "",
              caption: "Original WAV",
              width: "0",
              height: "0",
              previewWidth: "100",
              textAlignment: "left",
            },
            children: [],
          },
        ],
      },
    ];
    writeGeulBlocks(document, "document-store", blocks, "editor");

    const durableBlocks = readGeulBlocks(document, "document-store", "editor");
    const durableHtml = renderGeulBlocks(blocks, "editor");
    const converted = yXmlFragmentToGeulDocument(fragment, "editor");

    expect(converted.blocks).toEqual(durableBlocks);
    expect(renderGeulProseMirrorHtml(converted.document)).toBe(durableHtml);
  });

  it("matches block projection for lists, table, math, map, and every durable media type", () => {
    const document = new Y.Doc();
    const fragment = document.getXmlFragment("document-store");
    const text = (value: string) => [
      { type: "text" as const, text: value, styles: {} },
    ];
    const mediaProps = {
      fileId: "file-id",
      name: "Field asset",
      caption: "Caption",
      previewWidth: "75",
      textAlignment: "center" as const,
    };
    const blocks = [
      {
        id: "bullet",
        type: "bulletListItem",
        props: defaultTextProps,
        content: text("Bullet"),
        children: [
          {
            id: "numbered",
            type: "numberedListItem",
            props: { ...defaultTextProps, start: 3 },
            content: text("Nested"),
            children: [],
          },
        ],
      },
      {
        id: "math",
        type: "math",
        props: { latex: "x^2" },
        children: [],
      },
      {
        id: "map",
        type: "map",
        props: {
          mapPlaceIds: "one,two",
          previewWidth: "70",
          textAlignment: "center",
          caption: "Route",
        },
        children: [],
      },
      {
        id: "file",
        type: "file",
        props: {
          ...mediaProps,
          fileName: "recording.wav",
          alt: "",
          width: "0",
          height: "0",
        },
        children: [],
      },
      {
        id: "table",
        type: "table",
        props: { textColor: "default" },
        content: {
          type: "tableContent",
          columnWidths: [120, undefined],
          headerRows: 1,
          rows: [
            {
              cells: [
                { type: "tableCell", content: text("Name"), props: {} },
                { type: "tableCell", content: text("Type"), props: {} },
              ],
            },
            {
              cells: [
                {
                  type: "tableCell",
                  content: [{ type: "mathInline", props: { latex: "a+b" } }],
                  props: {},
                },
                { type: "tableCell", content: text("Audio"), props: {} },
              ],
            },
          ],
        },
        children: [],
      },
    ];
    writeGeulBlocks(document, "document-store", blocks, "editor");

    const converted = yXmlFragmentToGeulDocument(fragment, "editor");
    expect(converted.blocks).toEqual(
      readGeulBlocks(document, "document-store", "editor"),
    );

    const html = renderGeulProseMirrorHtml(converted.document);
    expect(html).toContain(
      '<ul><li><p class="bn-inline-content">Bullet</p><ol start="3">',
    );
    expect(html).toContain('class="math-block" data-latex="x^2"');
    expect(html).toContain('data-map-place-ids="one,two"');
    expect(html).toContain('class="file-block-html file-block"');

    const defaultsDocument = new Y.Doc();
    writeGeulBlocks(
      defaultsDocument,
      "document-store",
      [
        {
          id: "defaults-paragraph",
          type: "paragraph",
          content: [],
        },
        {
          id: "defaults-table",
          type: "table",
          content: {
            type: "tableContent",
            rows: [{ cells: [{ type: "tableCell", props: {}, content: [] }] }],
          },
        },
      ] as never,
      "editor",
    );
    expect(
      yXmlFragmentToGeulDocument(
        defaultsDocument.getXmlFragment("document-store"),
        "editor",
      ).blocks,
    ).toHaveLength(2);
    expect(html).toContain(
      '<table><colgroup><col style="width: 120px;"><col></colgroup>',
    );
  });

  it("keeps external HTML attributes and table geometry byte-for-byte", () => {
    const document = new Y.Doc();
    const fragment = document.getXmlFragment("document-store");
    const text = (value: string) => [
      { type: "text" as const, text: value, styles: {} },
    ];
    const blocks = [
      {
        id: "paragraph",
        type: "paragraph",
        props: {
          backgroundColor: "red",
          textColor: "blue",
          textAlignment: "center",
        },
        content: text("Styled paragraph"),
        children: [],
      },
      {
        id: "heading",
        type: "heading",
        props: {
          backgroundColor: "green",
          textColor: "purple",
          textAlignment: "right",
          level: 2,
        },
        content: text("Styled heading"),
        children: [],
      },
      {
        id: "quote",
        type: "quote",
        props: { backgroundColor: "yellow", textColor: "red" },
        content: text("Styled quote"),
        children: [],
      },
      {
        id: "table",
        type: "table",
        props: { textColor: "blue" },
        content: {
          type: "tableContent",
          columnWidths: [120, 140],
          headerRows: 1,
          headerCols: 1,
          rows: [
            {
              cells: [
                {
                  type: "tableCell",
                  props: {
                    backgroundColor: "yellow",
                    textColor: "red",
                    textAlignment: "center",
                  },
                  content: text("Header"),
                },
                {
                  type: "tableCell",
                  props: { textColor: "blue" },
                  content: text("Column"),
                },
              ],
            },
            {
              cells: [
                {
                  type: "tableCell",
                  props: {
                    backgroundColor: "green",
                    textColor: "purple",
                    textAlignment: "right",
                  },
                  content: text("Row"),
                },
                { type: "tableCell", props: {}, content: text("Body") },
              ],
            },
          ],
        },
        children: [],
      },
    ];
    writeGeulBlocks(document, "document-store", blocks, "editor");

    const converted = yXmlFragmentToGeulDocument(fragment, "editor");
    const html = renderGeulProseMirrorHtml(converted.document);

    expect(html).toBe(renderGeulBlocks(blocks, "editor"));
    expect(html).toContain(
      'data-background-color="red" data-text-color="blue" data-text-alignment="center"',
    );
    expect(html).toContain(
      'data-text-color="blue"><colgroup><col style="width: 120px;"><col style="width: 140px;"></colgroup>',
    );
    expect(html).toContain(
      'data-text-color="red" data-background-color="yellow" data-text-alignment="center" colspan="1" rowspan="1" colwidth="120"',
    );
  });

  it("rejects malformed allowed attrs, inline marks, and table geometry before projection", () => {
    const invalidParagraphAttribute = documentWithSingleBlock({
      type: "paragraph",
      attrs: { ...defaultTextProps, textAlignment: "diagonal" },
      content: [],
    });
    const unexpectedParagraphAttribute = documentWithSingleBlock({
      type: "paragraph",
      attrs: { ...defaultTextProps, injected: "value" },
      content: [],
    });
    const invalidLink = documentWithSingleBlock({
      type: "paragraph",
      attrs: defaultTextProps,
      content: [
        {
          type: "text",
          text: "Link",
          marks: [{ type: "link", attrs: { href: 42 } }],
        },
      ],
    });
    const invalidColor = documentWithSingleBlock({
      type: "paragraph",
      attrs: defaultTextProps,
      content: [
        {
          type: "text",
          text: "Color",
          marks: [{ type: "textColor", attrs: { stringValue: 42 } }],
        },
      ],
    });
    const invalidTable = documentWithSingleBlock({
      type: "table",
      attrs: { textColor: "default" },
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: {
                colspan: 1,
                rowspan: 1,
                colwidth: [120],
                ...defaultTextProps,
              },
              content: [{ type: "tableParagraph", content: [] }],
            },
            {
              type: "tableCell",
              attrs: {
                colspan: 1,
                rowspan: 1,
                colwidth: [120],
                ...defaultTextProps,
              },
              content: [{ type: "tableParagraph", content: [] }],
            },
          ],
        },
        {
          type: "tableRow",
          content: [
            {
              type: "tableCell",
              attrs: {
                colspan: 1,
                rowspan: 1,
                colwidth: [120],
                ...defaultTextProps,
              },
              content: [{ type: "tableParagraph", content: [] }],
            },
          ],
        },
      ],
    });

    expect(() =>
      prosemirrorJsonToGeulBlocks(invalidParagraphAttribute, "editor"),
    ).toThrow("Invalid rich-text paragraph attribute value: textAlignment");
    expect(() =>
      prosemirrorJsonToGeulBlocks(unexpectedParagraphAttribute, "editor"),
    ).toThrow("Unsupported rich-text paragraph attribute: injected");
    expect(() => prosemirrorJsonToGeulBlocks(invalidLink, "editor")).toThrow(
      "Invalid rich-text inline mark link attribute value: href",
    );
    expect(() => prosemirrorJsonToGeulBlocks(invalidColor, "editor")).toThrow(
      "Invalid rich-text inline mark textColor attribute value: stringValue",
    );
    expect(() => prosemirrorJsonToGeulBlocks(invalidTable, "editor")).toThrow(
      "Invalid rich-text non-rectangular table",
    );
  });

  it.each(["bio", "editor", "email", "page", "post"] as const)(
    "stabilizes legacy empty paragraph IDs from traversal paths for %s",
    (schema) => {
      const document: ProseMirrorJsonNode = {
        type: "doc",
        content: [
          {
            type: "blockGroup",
            content: [
              {
                type: "blockContainer",
                content: [{ type: "paragraph", attrs: defaultTextProps }],
              },
              {
                type: "blockContainer",
                attrs: { id: "parent" },
                content: [
                  { type: "paragraph", attrs: defaultTextProps },
                  {
                    type: "blockGroup",
                    content: [
                      {
                        type: "blockContainer",
                        content: [
                          { type: "paragraph", attrs: defaultTextProps },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };

      const first = prosemirrorJsonToGeulBlocks(document, schema);
      const second = prosemirrorJsonToGeulBlocks(document, schema);

      expect(first).toEqual(second);
      expect(first[0]?.id).toBe("00000000-0000-4000-8000-000000000000");
      expect(first[1]?.children[0]?.id).toMatch(/^00000000-0000-4000-8000-/);
      expect(first[1]?.children[0]?.id).not.toBe(first[0]?.id);
    },
  );

  it("rejects nodes outside the document-specific schema before projection", () => {
    expect(() =>
      prosemirrorJsonToGeulBlocks(
        {
          type: "doc",
          content: [
            {
              type: "blockGroup",
              content: [
                {
                  type: "blockContainer",
                  attrs: { id: "media" },
                  content: [{ type: "file", attrs: { fileId: "file-id" } }],
                },
              ],
            },
          ],
        },
        "bio",
      ),
    ).toThrow("Unsupported bio block type: file");
  });

  it("projects every supported inline, block, and table compatibility shape", () => {
    const document = documentWithBlocks(
      {
        type: "paragraph",
        attrs: { ...defaultTextProps, previewWidth: "75", aspectRatio: "4:3" },
        content: [
          { type: "hardBreak" },
          text("plain"),
          text(" text"),
          text(" bold", [{ type: "bold" }]),
          text(" and code", [{ type: "bold" }, { type: "code", attrs: {} }]),
          text(" linked", [
            { type: "link", attrs: { href: "https://example.com/a" } },
          ]),
          text(" text", [
            { type: "link", attrs: { href: "https://example.com/a" } },
          ]),
          text(" colored", [
            { type: "textColor", attrs: { stringValue: "red" } },
          ]),
          { type: "mathInline", attrs: { latex: "x^2" } },
        ],
      },
      {
        type: "heading",
        attrs: { ...defaultTextProps, level: 6 },
        content: [text("Heading")],
      },
      {
        type: "bulletListItem",
        attrs: defaultTextProps,
        content: [text("Bullet")],
      },
      {
        type: "numberedListItem",
        attrs: { ...defaultTextProps, start: 4 },
        content: [text("Numbered")],
      },
      {
        type: "checkListItem",
        attrs: { ...defaultTextProps, checked: true },
        content: [text("Checked")],
      },
      {
        type: "quote",
        attrs: { backgroundColor: "yellow", textColor: "red" },
        content: [text("Quote")],
      },
      {
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [text("const value = 1;"), text("\n")],
      },
      { type: "divider" },
      { type: "math", attrs: { latex: "a+b" } },
      {
        type: "table",
        attrs: { textColor: "blue" },
        content: [
          {
            type: "tableRow",
            content: [
              tableCell(
                "tableHeader",
                { colwidth: [120], backgroundColor: "yellow" },
                [
                  { type: "tableParagraph", content: [text("One")] },
                  { type: "tableParagraph", content: [text("Two")] },
                ],
              ),
              tableCell(
                "tableHeader",
                { colwidth: [140], textAlignment: "right" },
                [{ type: "tableParagraph", content: [text("Header")] }],
              ),
            ],
          },
          {
            type: "tableRow",
            content: [
              tableCell("tableCell", { colwidth: [120] }, [
                { type: "tableParagraph", content: [text("Body")] },
              ]),
              tableCell("tableCell", { colwidth: [140] }, [
                { type: "tableParagraph", content: [text("Cell")] },
              ]),
            ],
          },
        ],
      },
      {
        type: "map",
        attrs: {
          mapPlaceIds: "one,two",
          mapPlaceId: "",
          location: "",
          aspectRatio: "1:1",
          previewWidth: "75",
          textAlignment: "right",
          zoom: "12",
          url: "map",
          showPreview: "false",
          draggable: "false",
          zoomable: "false",
          rotatable: "true",
          tiltable: "true",
          pinClickable: "false",
          centerLat: "37.5",
          centerLng: "127",
          pitch: "10",
          bearing: "20",
          show3DBuildings: "true",
          autoRotate: "true",
          autoRotateSpeed: "2",
          showDirections: "false",
          variant: "default",
          themeId: "theme",
          preferredScheme: "dark",
          areaLabelsMode: "show",
          poiLabelsMode: "hide",
          caption: "Map",
        },
      },
      {
        type: "file",
        attrs: {
          fileId: "file",
          fileName: "file.txt",
          name: "File",
          alt: "",
          caption: "Caption",
          width: "0",
          height: "0",
          previewWidth: "50",
          textAlignment: "center",
        },
      },
    );

    const blocks = prosemirrorJsonToGeulBlocks(document, "post");
    expect(blocks).toHaveLength(12);
    expect(blocks[0]?.props).toMatchObject({
      previewWidth: "75",
      aspectRatio: "4:3",
    });
    expect(blocks[0]?.content).toEqual(
      expect.arrayContaining([
        { type: "text", text: "\nplain text", styles: {} },
        { type: "text", text: " bold", styles: { bold: true } },
        { type: "text", text: " and code", styles: { bold: true, code: true } },
        {
          type: "link",
          href: "https://example.com/a",
          content: [{ type: "text", text: " linked text", styles: {} }],
        },
        { type: "text", text: " colored", styles: { textColor: "red" } },
        { type: "mathInline", props: { latex: "x^2" } },
      ]),
    );
    expect(blocks[8]).toMatchObject({ type: "math", content: undefined });
    expect(blocks[9]).toMatchObject({
      type: "table",
      content: {
        columnWidths: [120, 140],
        headerRows: 1,
        headerCols: undefined,
      },
    });
    expect(renderGeulProseMirrorHtml(document)).toContain('<ol start="4">');
  });

  it("fails closed for every structural boundary before materialization", () => {
    const validParagraph = {
      type: "paragraph",
      attrs: defaultTextProps,
      content: [],
    };
    const validTable = {
      type: "table",
      attrs: { textColor: "default" },
      content: [{ type: "tableRow", content: [tableCell("tableCell")] }],
    };
    const cases: Array<[string, ProseMirrorJsonNode, string]> = [
      [
        "document attributes",
        { ...documentWithSingleBlock(validParagraph), attrs: null as never },
        "Invalid rich-text doc attributes",
      ],
      [
        "document marks",
        { ...documentWithSingleBlock(validParagraph), marks: [] },
        "Invalid rich-text doc marks",
      ],
      [
        "document content",
        { type: "doc", content: {} as never },
        "Invalid rich-text doc content",
      ],
      [
        "document child",
        { type: "doc", content: [null as never] },
        "Invalid rich-text doc content",
      ],
      [
        "document shape",
        { type: "doc", content: [{ type: "paragraph" }] },
        "Rich-text document must contain exactly one blockGroup",
      ],
      [
        "group attributes",
        {
          type: "doc",
          content: [
            { type: "blockGroup", attrs: { extra: true }, content: [] },
          ],
        },
        "Unsupported rich-text blockGroup attribute: extra",
      ],
      [
        "group marks",
        {
          type: "doc",
          content: [{ type: "blockGroup", marks: [], content: [] }],
        },
        "Invalid rich-text blockGroup marks",
      ],
      [
        "container type",
        {
          type: "doc",
          content: [
            { type: "blockGroup", content: [{ type: "notContainer" }] },
          ],
        },
        "Expected blockContainer node, received notContainer",
      ],
      [
        "container marks",
        {
          type: "doc",
          content: [
            {
              type: "blockGroup",
              content: [
                {
                  type: "blockContainer",
                  attrs: { id: "x" },
                  marks: [],
                  content: [validParagraph],
                },
              ],
            },
          ],
        },
        "Invalid rich-text blockContainer marks",
      ],
      [
        "container children",
        {
          type: "doc",
          content: [
            {
              type: "blockGroup",
              content: [
                {
                  type: "blockContainer",
                  attrs: { id: "x" },
                  content: [
                    validParagraph,
                    { type: "blockGroup", content: [] },
                    validParagraph,
                  ],
                },
              ],
            },
          ],
        },
        "Invalid blockContainer content",
      ],
      [
        "missing durable id",
        {
          type: "doc",
          content: [
            {
              type: "blockGroup",
              content: [
                {
                  type: "blockContainer",
                  content: [
                    {
                      type: "heading",
                      attrs: { ...defaultTextProps, level: 1 },
                      content: [],
                    },
                  ],
                },
              ],
            },
          ],
        },
        "Rich-text block is missing its durable id",
      ],
      [
        "block marks",
        documentWithSingleBlock({ ...validParagraph, marks: [] }),
        "Invalid rich-text paragraph marks",
      ],
      [
        "no-content block children",
        documentWithSingleBlock({ type: "divider", content: [text("no")] }),
        "Invalid rich-text divider content",
      ],
      [
        "code block marks",
        documentWithSingleBlock({
          type: "codeBlock",
          attrs: { language: "ts" },
          content: [text("no", [{ type: "bold" }])],
        }),
        "Invalid rich-text codeBlock marks",
      ],
      [
        "text node attributes",
        documentWithSingleBlock({
          ...validParagraph,
          content: [{ type: "text", attrs: { extra: true }, text: "x" }],
        }),
        "Unsupported rich-text text attribute: extra",
      ],
      [
        "text node text",
        documentWithSingleBlock({
          ...validParagraph,
          content: [{ type: "text" }],
        }),
        "Invalid rich-text text node",
      ],
      [
        "text node content",
        documentWithSingleBlock({
          ...validParagraph,
          content: [{ type: "text", text: "x", content: [] }],
        }),
        "Invalid rich-text text content",
      ],
      [
        "hard break",
        documentWithSingleBlock({
          ...validParagraph,
          content: [{ type: "hardBreak", marks: [] }],
        }),
        "Invalid rich-text hardBreak",
      ],
      [
        "math inline attribute",
        documentWithSingleBlock({
          ...validParagraph,
          content: [{ type: "mathInline", attrs: { latex: 1 } }],
        }),
        "Invalid rich-text mathInline attribute value: latex",
      ],
      [
        "math inline marks",
        documentWithSingleBlock({
          ...validParagraph,
          content: [{ type: "mathInline", marks: [] }],
        }),
        "Invalid rich-text mathInline",
      ],
      [
        "math inline source mark",
        documentWithSingleBlock({
          ...validParagraph,
          content: [
            {
              type: "mathInline",
              attrs: { latex: "" },
              content: [text("x", [{ type: "bold" }])],
            },
          ],
        }),
        "Invalid rich-text mathInline source marks",
      ],
      [
        "conflicting math inline sources",
        documentWithSingleBlock({
          ...validParagraph,
          content: [
            {
              type: "mathInline",
              attrs: { latex: "legacy" },
              content: [text("content")],
            },
          ],
        }),
        "Conflicting rich-text mathInline source",
      ],
      [
        "non-array marks",
        documentWithSingleBlock({
          ...validParagraph,
          content: [{ type: "text", text: "x", marks: {} as never }],
        }),
        "Invalid rich-text inline marks",
      ],
      [
        "invalid mark",
        documentWithSingleBlock({
          ...validParagraph,
          content: [{ type: "text", text: "x", marks: [null as never] }],
        }),
        "Invalid rich-text inline mark",
      ],
      [
        "unsupported mark",
        documentWithSingleBlock({
          ...validParagraph,
          content: [{ type: "text", text: "x", marks: [{ type: "unknown" }] }],
        }),
        "Unsupported rich-text mark: unknown",
      ],
      [
        "invalid boolean mark attrs",
        documentWithSingleBlock({
          ...validParagraph,
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "bold", attrs: [] as never }],
            },
          ],
        }),
        "Invalid rich-text inline mark attributes: bold",
      ],
      [
        "unexpected boolean mark attrs",
        documentWithSingleBlock({
          ...validParagraph,
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "bold", attrs: { extra: true } }],
            },
          ],
        }),
        "Unsupported rich-text inline mark bold attribute: extra",
      ],
      [
        "missing link attrs",
        documentWithSingleBlock({
          ...validParagraph,
          content: [{ type: "text", text: "x", marks: [{ type: "link" }] }],
        }),
        "Invalid rich-text inline mark attributes: link",
      ],
      [
        "unexpected link attrs",
        documentWithSingleBlock({
          ...validParagraph,
          content: [
            {
              type: "text",
              text: "x",
              marks: [{ type: "link", attrs: { href: "x", extra: true } }],
            },
          ],
        }),
        "Unsupported rich-text inline mark link attribute: extra",
      ],
      [
        "missing color attrs",
        documentWithSingleBlock({
          ...validParagraph,
          content: [
            { type: "text", text: "x", marks: [{ type: "textColor" }] },
          ],
        }),
        "Invalid rich-text inline mark attributes: textColor",
      ],
      [
        "unexpected color attrs",
        documentWithSingleBlock({
          ...validParagraph,
          content: [
            {
              type: "text",
              text: "x",
              marks: [
                {
                  type: "backgroundColor",
                  attrs: { stringValue: "red", extra: true },
                },
              ],
            },
          ],
        }),
        "Unsupported rich-text inline mark backgroundColor attribute: extra",
      ],
      [
        "empty table",
        documentWithSingleBlock({ ...validTable, content: [] }),
        "Invalid rich-text table structure",
      ],
      [
        "row marks",
        documentWithSingleBlock({
          ...validTable,
          content: [
            { type: "tableRow", marks: [], content: [tableCell("tableCell")] },
          ],
        }),
        "Invalid rich-text tableRow marks",
      ],
      [
        "empty row",
        documentWithSingleBlock({
          ...validTable,
          content: [{ type: "tableRow", content: [] }],
        }),
        "Invalid rich-text tableRow structure",
      ],
      [
        "cell type",
        documentWithSingleBlock({
          ...validTable,
          content: [{ type: "tableRow", content: [{ type: "paragraph" }] }],
        }),
        "Unsupported table cell: paragraph",
      ],
      [
        "cell marks",
        documentWithSingleBlock({
          ...validTable,
          content: [
            {
              type: "tableRow",
              content: [{ ...tableCell("tableCell"), marks: [] }],
            },
          ],
        }),
        "Invalid rich-text tableCell marks",
      ],
      [
        "empty cell",
        documentWithSingleBlock({
          ...validTable,
          content: [
            { type: "tableRow", content: [tableCell("tableCell", {}, [])] },
          ],
        }),
        "Invalid rich-text tableCell structure",
      ],
      [
        "cell paragraph type",
        documentWithSingleBlock({
          ...validTable,
          content: [
            {
              type: "tableRow",
              content: [tableCell("tableCell", {}, [{ type: "paragraph" }])],
            },
          ],
        }),
        "Expected tableParagraph node, received paragraph",
      ],
      [
        "cell paragraph attributes",
        documentWithSingleBlock({
          ...validTable,
          content: [
            {
              type: "tableRow",
              content: [
                tableCell("tableCell", {}, [
                  {
                    type: "tableParagraph",
                    attrs: { extra: true },
                    content: [],
                  },
                ]),
              ],
            },
          ],
        }),
        "Unsupported rich-text tableParagraph attribute: extra",
      ],
      [
        "cell paragraph marks",
        documentWithSingleBlock({
          ...validTable,
          content: [
            {
              type: "tableRow",
              content: [
                tableCell("tableCell", {}, [
                  { type: "tableParagraph", marks: [], content: [] },
                ]),
              ],
            },
          ],
        }),
        "Invalid rich-text tableParagraph marks",
      ],
      [
        "bad cell colwidth",
        documentWithSingleBlock({
          ...validTable,
          content: [
            {
              type: "tableRow",
              content: [tableCell("tableCell", { colwidth: [100, 120] })],
            },
          ],
        }),
        "Invalid rich-text table colwidth",
      ],
      [
        "rowspan past table",
        documentWithSingleBlock({
          ...validTable,
          content: [
            {
              type: "tableRow",
              content: [tableCell("tableCell", { rowspan: 2 })],
            },
          ],
        }),
        "Invalid rich-text table rowspan",
      ],
      [
        "invalid table cell attr",
        documentWithSingleBlock({
          ...validTable,
          content: [
            {
              type: "tableRow",
              content: [tableCell("tableCell", { colspan: 0 })],
            },
          ],
        }),
        "Invalid rich-text tableCell attribute value: colspan",
      ],
    ];

    for (const [label, document, message] of cases) {
      expect(
        () => prosemirrorJsonToGeulBlocks(document, "editor"),
        label,
      ).toThrow(message);
    }
    expect(() =>
      prosemirrorJsonToGeulBlocks(
        documentWithSingleBlock({
          ...validParagraph,
          content: [{ type: "mathInline", attrs: { latex: "x" } }],
        }),
        "bio",
      ),
    ).toThrow("Unsupported inline content node for bio: mathInline");
  });

  it("slices only canonical top-level block groups", () => {
    const document = documentWithBlocks(
      { type: "paragraph", attrs: defaultTextProps, content: [] },
      { type: "paragraph", attrs: defaultTextProps, content: [] },
    );
    expect(
      sliceProseMirrorTopLevelBlocks(document, 1).content?.[0]?.content,
    ).toHaveLength(1);
    expect(
      sliceProseMirrorTopLevelBlocks(
        { type: "doc", content: [{ type: "paragraph" }] },
        1,
      ),
    ).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("retains empty defaults, separated link styles, and table paragraph boundaries", () => {
    expect(prosemirrorJsonToGeulBlocks({ type: "doc" }, "editor")).toEqual([]);

    const document = documentWithBlocks(
      {
        type: "paragraph",
        content: [
          text("first", [
            { type: "link", attrs: { href: "https://example.com" } },
          ]),
          text("second", [
            { type: "link", attrs: { href: "https://example.com" } },
            { type: "italic" },
          ]),
          { type: "hardBreak" },
        ],
      },
      { type: "numberedListItem", attrs: defaultTextProps, content: [] },
      { type: "codeBlock", attrs: { language: "text" } },
      {
        type: "table",
        attrs: { textColor: "default" },
        content: [
          {
            type: "tableRow",
            content: [
              tableCell("tableCell", {}, [
                { type: "tableParagraph", content: [text("plain")] },
                {
                  type: "tableParagraph",
                  content: [text("styled", [{ type: "bold" }])],
                },
              ]),
            ],
          },
        ],
      },
    );
    const blocks = prosemirrorJsonToGeulBlocks(document, "editor");
    expect(blocks[0]?.content).toEqual([
      {
        type: "link",
        href: "https://example.com",
        content: [
          { type: "text", text: "first", styles: {} },
          { type: "text", text: "second\n", styles: { italic: true } },
        ],
      },
    ]);
    expect(blocks[1]?.props).not.toHaveProperty("start");
    expect(blocks[2]?.content).toEqual([]);
    expect(blocks[3]?.content).toMatchObject({
      columnWidths: [undefined],
      headerRows: undefined,
      headerCols: undefined,
      rows: [
        {
          cells: [
            {
              content: [
                { type: "text", text: "plain", styles: {} },
                { type: "text", text: "styled", styles: { bold: true } },
              ],
            },
          ],
        },
      ],
    });

    expect(
      prosemirrorJsonToGeulBlocks(
        documentWithSingleBlock({ type: "paragraph", content: [] }),
        "post",
      )[0]?.props,
    ).toMatchObject({ previewWidth: "100", aspectRatio: "auto" });
  });

  it("renders canonical fallbacks, grouped lists, and renderer rejection boundaries", () => {
    const emptyMedia = renderGeulProseMirrorHtml({
      type: "doc",
      content: [
        { type: "file" },
        { type: "map", attrs: {} },
        {
          type: "map",
          attrs: {
            mapPlaceId: "single",
            location: JSON.stringify({
              name: "Seoul",
              address: "Korea",
              lat: 37.5,
              lng: 127,
              placeId: "place",
            }),
          },
        },
        {
          type: "map",
          attrs: {
            location: JSON.stringify({
              name: "Seoul",
              address: "Korea",
              lat: 37.5,
              lng: 127,
              placeId: "place",
            }),
          },
        },
        { type: "map", attrs: { location: "not-json" } },
        {
          type: "paragraph",
          attrs: {
            backgroundColor: "default",
            textColor: "default",
            textAlignment: "left",
            previewWidth: "100",
            aspectRatio: "auto",
          },
          content: [text("Default")],
        },
        { type: "heading", attrs: { level: 0 }, content: [text("One")] },
        { type: "heading", attrs: { level: 8 }, content: [text("Six")] },
        { type: "codeBlock", content: [text("code")] },
        { type: "table", attrs: {}, content: [] },
      ],
    });
    expect(emptyMedia).toContain("file-block-html--empty");
    expect(emptyMedia).toContain("View on Google Maps");
    expect(emptyMedia).toContain("<h1");
    expect(emptyMedia).toContain("<h6");
    expect(emptyMedia).toContain("language-javascript");

    const whitespaceFileId = renderGeulProseMirrorHtml({
      type: "doc",
      content: [
        { type: "file", attrs: { fileId: "   ", name: "Draft upload" } },
      ],
    });
    expect(whitespaceFileId).toContain("file-block-html--empty");
    expect(whitespaceFileId).not.toContain("Draft upload");

    const groupedLists = renderGeulProseMirrorHtml({
      type: "doc",
      content: [
        {
          type: "blockGroup",
          content: [
            {
              type: "blockContainer",
              content: [
                {
                  type: "bulletListItem",
                  attrs: { _nestingLevel: 1 },
                  content: [text("One")],
                },
              ],
            },
            {
              type: "blockContainer",
              content: [{ type: "bulletListItem", content: [text("Two")] }],
            },
            {
              type: "blockContainer",
              content: [
                {
                  type: "numberedListItem",
                  attrs: { start: 3 },
                  content: [text("Three")],
                },
              ],
            },
            {
              type: "blockContainer",
              content: [
                { type: "numberedListItem", content: [text("No start")] },
              ],
            },
            {
              type: "blockContainer",
              content: [
                {
                  type: "checkListItem",
                  attrs: { checked: false },
                  content: [text("Four")],
                },
              ],
            },
            {
              type: "blockContainer",
              content: [
                {
                  type: "checkListItem",
                  attrs: { checked: true },
                  content: [text("Five")],
                },
              ],
            },
            {
              type: "blockContainer",
              content: [
                {
                  type: "paragraph",
                  attrs: {
                    previewWidth: "25",
                    aspectRatio: "1:1",
                    backgroundColor: "red",
                    textColor: "blue",
                    textAlignment: "center",
                  },
                  content: [
                    text("End", [
                      { type: "underline" },
                      { type: "strike" },
                      { type: "textColor", attrs: { stringValue: "custom" } },
                      {
                        type: "backgroundColor",
                        attrs: { stringValue: "yellow" },
                      },
                    ]),
                  ],
                },
              ],
            },
            {
              type: "blockContainer",
              content: [
                {
                  type: "paragraph",
                  content: [
                    text("Default color", [
                      { type: "textColor", attrs: { stringValue: "default" } },
                    ]),
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(groupedLists).toContain("<ul><li>");
    expect(groupedLists).toContain('<ol start="3">');
    expect(groupedLists).toContain('data-checked="false"');
    expect(groupedLists).toContain(' checked=""');
    expect(groupedLists).toContain('data-preview-width="25"');
    expect(groupedLists).toContain("background-color: rgb(251, 243, 219);");

    const rendererFallbacks = renderGeulProseMirrorHtml({
      type: "doc",
      content: [
        { type: "map" },
        { type: "map", attrs: { location: "{}" } },
        {
          type: "file",
          attrs: {
            fileId: "file",
            name: " ",
            caption: "",
            previewWidth: "not-a-number",
            textAlignment: "right",
          },
        },
        {
          type: "file",
          attrs: {
            fileId: "left-file",
            name: "File",
            previewWidth: "50",
            textAlignment: "left",
          },
        },
        {
          type: "file",
          attrs: {
            fileId: "right-file",
            name: "Right file",
            previewWidth: "50",
            textAlignment: "right",
          },
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    { type: "tableParagraph", content: [text("Cell")] },
                  ],
                },
              ],
            },
          ],
        },
        { type: "text" },
        text("Link", [{ type: "link" }]),
      ],
    });
    expect(rendererFallbacks).toContain("Untitled file");
    expect(rendererFallbacks).toContain("margin-left: auto");
    expect(rendererFallbacks).toContain('<td colspan="1" rowspan="1">');
    expect(rendererFallbacks).toContain('href=""');
    expect(
      renderGeulProseMirrorHtml({
        type: "doc",
        content: [{ type: "blockGroup" }],
      }),
    ).toBe("");
    expect(
      renderGeulProseMirrorHtml({
        type: "doc",
        content: [
          {
            type: "blockGroup",
            content: [{ type: "blockContainer" }],
          },
        ],
      }),
    ).toBe("");
    expect(
      renderGeulProseMirrorHtml({ type: "doc", content: [{ type: "shader" }] }),
    ).toContain("<figcaption>Shader</figcaption>");
    expect(
      renderGeulProseMirrorHtml({
        type: "doc",
        content: [
          {
            type: "shader",
            content: Array.from({ length: 10 }, () => ({
              type: "shaderImage",
            })),
          },
        ],
      }),
    ).toContain('data-shader-filename="unknown.glsl"');
    expect(() =>
      renderGeulProseMirrorHtml({
        type: "doc",
        content: [{ type: "unhandled" }],
      }),
    ).toThrow("Unhandled Tiptap server-render node: unhandled");
    for (const removedType of ["image", "video", "audio", "attachment"]) {
      expect(() =>
        renderGeulProseMirrorHtml({
          type: "doc",
          content: [{ type: removedType }],
        }),
      ).toThrow(`Unhandled Tiptap server-render node: ${removedType}`);
    }
    expect(() =>
      renderGeulProseMirrorHtml({
        type: "doc",
        content: [text("x", [{ type: "unhandled" }])],
      }),
    ).toThrow("Unhandled Tiptap server-render mark: unhandled");
  });

  it("preserves rowspan and sparse column geometry while rejecting impossible table layouts", () => {
    const rowspanTable = documentWithSingleBlock({
      type: "table",
      attrs: { textColor: "default" },
      content: [
        {
          type: "tableRow",
          content: [
            tableCell("tableHeader", { rowspan: 2, colwidth: [90] }),
            tableCell("tableHeader", { colwidth: [120] }),
          ],
        },
        {
          type: "tableRow",
          content: [tableCell("tableCell", { colwidth: [120] })],
        },
      ],
    });
    expect(
      prosemirrorJsonToGeulBlocks(rowspanTable, "editor")[0]?.content,
    ).toMatchObject({
      columnWidths: [90, 120],
      headerRows: 1,
      headerCols: undefined,
    });

    const overlapping = documentWithSingleBlock({
      type: "table",
      attrs: { textColor: "default" },
      content: [
        {
          type: "tableRow",
          content: [
            tableCell("tableCell", { colspan: 2, colwidth: [100, 100] }),
          ],
        },
        {
          type: "tableRow",
          content: [
            tableCell("tableCell"),
            tableCell("tableCell"),
            tableCell("tableCell"),
          ],
        },
      ],
    });
    expect(() => prosemirrorJsonToGeulBlocks(overlapping, "editor")).toThrow(
      "Invalid rich-text non-rectangular table",
    );

    const collidingRowspan = documentWithSingleBlock({
      type: "table",
      attrs: { textColor: "default" },
      content: [
        {
          type: "tableRow",
          content: [
            tableCell("tableCell"),
            tableCell("tableCell", { rowspan: 2 }),
          ],
        },
        {
          type: "tableRow",
          content: [
            tableCell("tableCell", { colspan: 2, colwidth: [100, 100] }),
          ],
        },
      ],
    });
    expect(() =>
      prosemirrorJsonToGeulBlocks(collidingRowspan, "editor"),
    ).toThrow("Invalid rich-text overlapping table cells");

    const gappedRowspan = documentWithSingleBlock({
      type: "table",
      attrs: { textColor: "default" },
      content: [
        {
          type: "tableRow",
          content: [
            tableCell("tableCell", { colspan: 2, colwidth: [100, 100] }),
            tableCell("tableCell", { rowspan: 2 }),
          ],
        },
        { type: "tableRow", content: [tableCell("tableCell")] },
      ],
    });
    expect(() => prosemirrorJsonToGeulBlocks(gappedRowspan, "editor")).toThrow(
      "Invalid rich-text non-rectangular table",
    );

    const nullableWidth = documentWithSingleBlock({
      type: "table",
      attrs: { textColor: "default" },
      content: [
        {
          type: "tableRow",
          content: [tableCell("tableCell", { colwidth: [null] })],
        },
      ],
    });
    expect(
      prosemirrorJsonToGeulBlocks(nullableWidth, "editor")[0]?.content,
    ).toMatchObject({
      columnWidths: [undefined],
    });
  });
});
