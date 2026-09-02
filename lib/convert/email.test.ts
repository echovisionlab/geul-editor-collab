import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  convertEmailDocumentToContent,
  convertEmailToHtml,
  createEmailDocumentState,
  normalizeEmailDocumentState,
} from "./email.ts";
import type { LooseBlock } from "./core.ts";
import {
  replaceGeulBlocksInYXmlFragment,
  yXmlFragmentToGeulDocument,
} from "./tiptap-document.ts";

type EmailTestBlock = LooseBlock;
type EmailParagraphBlock = EmailTestBlock & { type: "paragraph" };

function paragraph(id: string, text?: string): EmailParagraphBlock {
  return {
    id,
    type: "paragraph",
    props: {
      backgroundColor: "default",
      textColor: "default",
      textAlignment: "left",
    },
    content: text ? [{ type: "text", text, styles: {} }] : [],
    children: [],
  };
}

function createEmailUpdate(blocks: EmailTestBlock[]): Uint8Array {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("document-store");
  replaceGeulBlocksInYXmlFragment(fragment, blocks, "email");

  return Y.encodeStateAsUpdate(doc);
}

function createWideEditorUpdate(blocks: unknown[]): Uint8Array {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("document-store");
  replaceGeulBlocksInYXmlFragment(fragment, blocks, "post");

  return Y.encodeStateAsUpdate(doc);
}

function mutateEmailUpdate(
  yjsState: Uint8Array,
  mutate: (fragment: Y.XmlFragment) => void,
): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, yjsState);
  mutate(doc.getXmlFragment("document-store"));
  return Y.encodeStateAsUpdate(doc);
}

function createRawEmailUpdate(
  mutate: (fragment: Y.XmlFragment) => void,
): Uint8Array {
  const doc = new Y.Doc();
  mutate(doc.getXmlFragment("document-store"));
  return Y.encodeStateAsUpdate(doc);
}

function createRawUnsupportedBlockUpdate(
  type: "image" | "audio" | "video" | "file" | "attachment",
  props: Record<string, string>,
): Uint8Array {
  return createRawEmailUpdate((fragment) => {
    const root = new Y.XmlElement("blockGroup");
    const container = new Y.XmlElement("blockContainer");
    const content = new Y.XmlElement(type);
    fragment.insert(0, [root]);
    root.insert(0, [container]);
    container.setAttribute("id", `unsupported-${type}`);
    container.insert(0, [content]);
    for (const [key, value] of Object.entries(props)) {
      content.setAttribute(key, value);
    }
  });
}

function getFirstEmailContent(fragment: Y.XmlFragment): Y.XmlElement {
  const root = fragment.get(0) as Y.XmlElement;
  const container = root.get(0) as Y.XmlElement;
  return container.get(0) as Y.XmlElement;
}

interface RawTableCell {
  type?: "tableCell" | "tableHeader";
  colspan?: unknown;
  rowspan?: unknown;
  colwidth?: unknown;
}

function createRawTableUpdate(rows: RawTableCell[][]): Uint8Array {
  return createRawEmailUpdate((fragment) => {
    const root = new Y.XmlElement("blockGroup");
    const container = new Y.XmlElement("blockContainer");
    const table = new Y.XmlElement("table");
    fragment.insert(0, [root]);
    root.insert(0, [container]);
    container.setAttribute("id", "raw-table");
    container.insert(0, [table]);
    table.setAttribute("textColor", "default");

    for (const rowCells of rows) {
      const row = new Y.XmlElement("tableRow");
      table.insert(table.length, [row]);
      for (const input of rowCells) {
        const cell = new Y.XmlElement(input.type ?? "tableCell");
        row.insert(row.length, [cell]);
        cell.setAttribute("backgroundColor", "default");
        cell.setAttribute("textColor", "default");
        cell.setAttribute("textAlignment", "left");
        cell.setAttribute("colspan", (input.colspan ?? 1) as never);
        cell.setAttribute("rowspan", (input.rowspan ?? 1) as never);
        if (input.colwidth !== undefined) {
          cell.setAttribute("colwidth", input.colwidth as never);
        }
        const paragraph = new Y.XmlElement("tableParagraph");
        cell.insert(0, [paragraph]);
        const text = new Y.XmlText();
        paragraph.insert(0, [text]);
        text.insert(0, "cell");
      }
    }
  });
}

async function expectEmailStateRejected(
  yjsState: Uint8Array,
  expectedMessage: string,
): Promise<void> {
  await expect(convertEmailDocumentToContent(yjsState)).rejects.toThrow(
    expectedMessage,
  );
  await expect(normalizeEmailDocumentState(yjsState)).rejects.toThrow(
    expectedMessage,
  );
}

async function readStoredBlocks(
  yjsState: Uint8Array,
): Promise<EmailTestBlock[]> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, yjsState);
  return yXmlFragmentToGeulDocument(
    doc.getXmlFragment("document-store"),
    "email",
  ).blocks;
}

async function readStoredBlockIds(yjsState: Uint8Array): Promise<string[]> {
  const blocks = await readStoredBlocks(yjsState);
  return blocks.map((block) => block.id);
}

function decodeStoredBlockIds(json: Uint8Array): string[] {
  const blocks = JSON.parse(new TextDecoder().decode(json)) as Array<{
    id: string;
  }>;
  return blocks.map((block) => block.id);
}

function encodeEmailContentJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("convertEmailToHtml", () => {
  it("exposes only the durable text email schema", () => {
    const state = createEmailUpdate([paragraph("schema", "Text")]);
    expect(() => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, state);
      return yXmlFragmentToGeulDocument(
        doc.getXmlFragment("document-store"),
        "email",
      );
    }).not.toThrow();
  });

  it("round-trips every supported text structure without media authority", async () => {
    const expectedBlocks = [
      {
        ...paragraph("paragraph", "Paragraph "),
        content: [
          { type: "text", text: "Paragraph\n", styles: { bold: true } },
          {
            type: "link",
            href: "https://studio.example.com",
            content: [{ type: "text", text: "link", styles: {} }],
          },
        ],
      },
      {
        id: "heading",
        type: "heading",
        props: {
          backgroundColor: "default",
          textColor: "default",
          textAlignment: "left",
          level: 2,
        },
        content: [{ type: "text", text: "Heading", styles: {} }],
        children: [],
      },
      {
        id: "bullet",
        type: "bulletListItem",
        props: {
          backgroundColor: "default",
          textColor: "default",
          textAlignment: "left",
        },
        content: [{ type: "text", text: "Bullet", styles: {} }],
        children: [],
      },
      {
        id: "numbered",
        type: "numberedListItem",
        props: {
          backgroundColor: "default",
          textColor: "default",
          textAlignment: "left",
          start: 3,
        },
        content: [{ type: "text", text: "Numbered", styles: {} }],
        children: [],
      },
      {
        id: "checked",
        type: "checkListItem",
        props: {
          backgroundColor: "default",
          textColor: "default",
          textAlignment: "left",
          checked: true,
        },
        content: [{ type: "text", text: "Checked", styles: {} }],
        children: [],
      },
      {
        id: "quote",
        type: "quote",
        props: { backgroundColor: "default", textColor: "default" },
        content: [{ type: "text", text: "Quote", styles: { italic: true } }],
        children: [],
      },
      {
        id: "callout",
        type: "callout",
        props: {
          icon: "ℹ️",
          backgroundColor: "blue",
          textColor: "default",
        },
        content: [{ type: "text", text: "Email note", styles: {} }],
        children: [],
      },
      {
        id: "divider",
        type: "divider",
        props: {},
        content: undefined,
        children: [],
      },
      {
        id: "table",
        type: "table",
        props: { textColor: "default" },
        content: {
          type: "tableContent",
          columnWidths: [120, 180],
          headerRows: 1,
          headerCols: 2,
          rows: [
            {
              cells: [
                {
                  type: "tableCell",
                  props: {
                    colspan: 1,
                    rowspan: 1,
                    backgroundColor: "default",
                    textColor: "default",
                    textAlignment: "left",
                  },
                  content: [
                    { type: "text", text: "Header", styles: { bold: true } },
                  ],
                },
                {
                  type: "tableCell",
                  props: {
                    colspan: 1,
                    rowspan: 1,
                    backgroundColor: "default",
                    textColor: "default",
                    textAlignment: "left",
                  },
                  content: [
                    {
                      type: "link",
                      href: "https://studio.example.com/table-cell",
                      content: [
                        { type: "text", text: "Linked cell", styles: {} },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
        children: [],
      },
      {
        id: "code",
        type: "codeBlock",
        props: { language: "text" },
        content: [
          { type: "text", text: 'const relationship = \"typed\";', styles: {} },
        ],
        children: [],
      },
    ] satisfies EmailTestBlock[];

    const converted = await convertEmailDocumentToContent(
      createEmailUpdate(expectedBlocks),
    );
    const decoded = JSON.parse(
      new TextDecoder().decode(converted.json),
    ) as EmailTestBlock[];
    const expectedStoredBlocks = JSON.parse(
      JSON.stringify(expectedBlocks),
    ) as EmailTestBlock[];
    expect(decoded).toEqual(expectedStoredBlocks);
    expect(JSON.stringify(decoded)).not.toMatch(/"(?:image|audio|video|file)"/);
    expect(converted.html).toContain('href="https://studio.example.com"');
    expect(converted.html).toContain(">link</a>");
    expect(converted.html).toContain(
      'href="https://studio.example.com/table-cell"',
    );
    expect(converted.html).toContain(">Linked cell</a>");
    expect(converted.html).toContain(
      '<aside data-callout="" data-bg-color="blue" data-text-color="default"><span data-callout-icon="" aria-hidden="true">ℹ️</span><div data-callout-content=""><div data-callout-copy="">Email note</div></div></aside>',
    );

    const restored = await createEmailDocumentState({
      contentJson: converted.json,
    });
    const restoredContent = await convertEmailDocumentToContent(restored);
    expect(JSON.parse(new TextDecoder().decode(restoredContent.json))).toEqual(
      expectedStoredBlocks,
    );
  });

  it("round-trips every supported style and non-default table geometry exactly", async () => {
    const advancedBlocks = [
      {
        id: "styled",
        type: "paragraph",
        props: {
          backgroundColor: "yellow",
          textColor: "purple",
          textAlignment: "center",
        },
        content: [
          {
            type: "text",
            text: "line1\nline2",
            styles: {
              bold: true,
              italic: true,
              underline: true,
              strike: true,
              code: true,
              textColor: "red",
              backgroundColor: "blue",
            },
          },
          {
            type: "link",
            href: "https://example.com/path?q=1#x",
            content: [
              {
                type: "text",
                text: " link",
                styles: { underline: true, textColor: "green" },
              },
            ],
          },
        ],
        children: [],
      },
      {
        id: "advanced-heading",
        type: "heading",
        props: {
          backgroundColor: "gray",
          textColor: "orange",
          textAlignment: "right",
          level: 3,
        },
        content: [{ type: "text", text: "Advanced heading", styles: {} }],
        children: [],
      },
      {
        id: "advanced-numbered",
        type: "numberedListItem",
        props: {
          backgroundColor: "default",
          textColor: "default",
          textAlignment: "justify",
          start: 9,
        },
        content: [{ type: "text", text: "Ninth item", styles: {} }],
        children: [],
      },
      {
        id: "advanced-quote",
        type: "quote",
        props: { backgroundColor: "pink", textColor: "black" },
        content: [{ type: "text", text: "Colored quote", styles: {} }],
        children: [],
      },
      {
        id: "advanced-table",
        type: "table",
        props: { textColor: "purple" },
        content: {
          type: "tableContent",
          columnWidths: [120, 140, 160],
          headerRows: 2,
          headerCols: 1,
          rows: [
            {
              cells: [
                {
                  type: "tableCell",
                  props: {
                    colspan: 1,
                    rowspan: 2,
                    backgroundColor: "yellow",
                    textColor: "blue",
                    textAlignment: "center",
                  },
                  content: [
                    {
                      type: "text",
                      text: "Spans two",
                      styles: { underline: true, backgroundColor: "gray" },
                    },
                  ],
                },
                {
                  type: "tableCell",
                  props: {
                    colspan: 2,
                    rowspan: 1,
                    backgroundColor: "pink",
                    textColor: "green",
                    textAlignment: "right",
                  },
                  content: [
                    {
                      type: "link",
                      href: "https://example.com/table",
                      content: [
                        {
                          type: "text",
                          text: "Tall link",
                          styles: { strike: true },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              cells: [
                {
                  type: "tableCell",
                  props: {
                    colspan: 2,
                    rowspan: 1,
                    backgroundColor: "orange",
                    textColor: "black",
                    textAlignment: "left",
                  },
                  content: [{ type: "text", text: "Bottom span", styles: {} }],
                },
              ],
            },
          ],
        },
        children: [],
      },
    ] satisfies EmailTestBlock[];

    const yjsState = createEmailUpdate(advancedBlocks);
    const converted = await convertEmailDocumentToContent(yjsState);
    const expectedStoredBlocks = JSON.parse(
      JSON.stringify(advancedBlocks),
    ) as EmailTestBlock[];

    expect(JSON.parse(new TextDecoder().decode(converted.json))).toEqual(
      expectedStoredBlocks,
    );
    expect(converted.html).toContain('href="https://example.com/path?q=1#x"');
    expect(converted.html).toContain('href="https://example.com/table"');
    await expect(normalizeEmailDocumentState(yjsState)).resolves.toEqual(
      yjsState,
    );

    const defaultedTableState = mutateEmailUpdate(
      createRawTableUpdate([[{ type: "tableCell" }]]),
      (fragment) => {
        const table = getFirstEmailContent(fragment);
        const row = table.get(0) as Y.XmlElement;
        const cell = row.get(0) as Y.XmlElement;
        cell.removeAttribute("colspan");
        cell.removeAttribute("rowspan");
        cell.setAttribute("colwidth", null as never);
      },
    );
    await expect(
      convertEmailDocumentToContent(defaultedTableState),
    ).resolves.toMatchObject({
      html: expect.stringContaining("<table>"),
    });
    await expect(
      normalizeEmailDocumentState(defaultedTableState),
    ).resolves.toEqual(defaultedTableState);
  });

  it.each(["image", "audio", "video", "file", "attachment"] as const)(
    "rejects unsupported %s blocks from persisted email JSON",
    async (type) => {
      const contentJson = new TextEncoder().encode(
        JSON.stringify([
          {
            id: `unsupported-${type}`,
            type,
            props: {},
            children: [],
          },
        ]),
      );

      await expect(createEmailDocumentState({ contentJson })).rejects.toThrow();
    },
  );

  it.each([
    [
      "block relationship",
      [
        {
          ...paragraph("json-block-relationship", "Closed"),
          fileId: "file-at-block",
        },
      ],
    ],
    [
      "block prop relationship",
      [
        {
          ...paragraph("json-prop-relationship", "Closed"),
          props: {
            ...paragraph("unused").props,
            fileId: "file-in-props",
          },
        },
      ],
    ],
    [
      "text relationship",
      [
        {
          ...paragraph("json-text-relationship"),
          content: [
            {
              type: "text",
              text: "Closed",
              styles: {},
              fileId: "file-on-text",
            },
          ],
        },
      ],
    ],
    [
      "style relationship",
      [
        {
          ...paragraph("json-style-relationship"),
          content: [
            {
              type: "text",
              text: "Closed",
              styles: { fileId: "file-in-style" },
            },
          ],
        },
      ],
    ],
    [
      "link relationship",
      [
        {
          ...paragraph("json-link-relationship"),
          content: [
            {
              type: "link",
              href: "https://studio.example.com",
              fileId: "file-on-link",
              content: [{ type: "text", text: "Closed", styles: {} }],
            },
          ],
        },
      ],
    ],
    [
      "link text relationship",
      [
        {
          ...paragraph("json-link-text-relationship"),
          content: [
            {
              type: "link",
              href: "https://studio.example.com",
              content: [
                {
                  type: "text",
                  text: "Closed",
                  styles: {},
                  fileId: "file-on-link-text",
                },
              ],
            },
          ],
        },
      ],
    ],
    [
      "nested block relationship",
      [
        {
          ...paragraph("json-parent", "Parent"),
          children: [
            {
              ...paragraph("json-child", "Child"),
              props: {
                ...paragraph("unused").props,
                fileId: "file-in-child",
              },
            },
          ],
        },
      ],
    ],
    [
      "table cell relationship",
      [
        {
          id: "json-table-relationship",
          type: "table",
          props: { textColor: "default" },
          content: {
            type: "tableContent",
            columnWidths: [120],
            headerRows: 0,
            headerCols: 0,
            rows: [
              {
                cells: [
                  {
                    type: "tableCell",
                    props: {
                      backgroundColor: "default",
                      textColor: "default",
                      textAlignment: "left",
                      colspan: 1,
                      rowspan: 1,
                      fileId: "file-in-cell",
                    },
                    content: [],
                  },
                ],
              },
            ],
          },
          children: [],
        },
      ],
    ],
  ] as const)(
    "rejects %s in parsed email JSON instead of falling back",
    async (_label, value) => {
      await expect(
        createEmailDocumentState({
          contentJson: encodeEmailContentJson(value),
          contentHtml: "<p>must not be used</p>",
          contentText: "must not be used",
        }),
      ).rejects.toThrow("Invalid email content JSON");
    },
  );

  it("recursively accepts only supported nested email JSON blocks", async () => {
    const contentJson = encodeEmailContentJson([
      {
        ...paragraph("json-parent", "Parent"),
        children: [paragraph("json-child", "Child")],
      },
    ]);

    const state = await createEmailDocumentState({ contentJson });
    const converted = await convertEmailDocumentToContent(state);

    expect(JSON.parse(new TextDecoder().decode(converted.json))).toEqual(
      JSON.parse(new TextDecoder().decode(contentJson)),
    );
  });

  it("validates persisted email JSON table geometry without expanding spans", async () => {
    const tableJson = (input: {
      columnWidths: Array<number | null>;
      headerRows?: number;
      headerCols?: number;
      cells: Array<{
        colspan?: number;
        rowspan?: number;
      }>;
    }) => [
      {
        id: "json-table",
        type: "table",
        props: { textColor: "default" },
        content: {
          type: "tableContent",
          columnWidths: input.columnWidths,
          headerRows: input.headerRows,
          headerCols: input.headerCols,
          rows: [
            {
              cells: input.cells.map((cell) => ({
                type: "tableCell",
                props: {
                  backgroundColor: "default",
                  textColor: "default",
                  textAlignment: "left",
                  ...cell,
                },
                content: [],
              })),
            },
          ],
        },
        children: [],
      },
    ];

    await expect(
      createEmailDocumentState({
        contentJson: encodeEmailContentJson(
          tableJson({ columnWidths: [120], cells: [{}] }),
        ),
      }),
    ).resolves.toEqual(expect.any(Uint8Array));

    for (const invalidGeometry of [
      tableJson({ columnWidths: [], cells: [{}] }),
      tableJson({ columnWidths: [120], headerRows: 2, cells: [{}] }),
      tableJson({ columnWidths: [120], headerCols: 2, cells: [{}] }),
    ]) {
      await expect(
        createEmailDocumentState({
          contentJson: encodeEmailContentJson(invalidGeometry),
        }),
      ).rejects.toThrow("Invalid email content JSON table geometry");
    }

    const overflowingGeometry = tableJson({
      columnWidths: [],
      cells: [{ colspan: Number.MAX_SAFE_INTEGER }, {}],
    });
    expect(encodeEmailContentJson(overflowingGeometry).byteLength).toBeLessThan(
      4096,
    );
    await expect(
      createEmailDocumentState({
        contentJson: encodeEmailContentJson(overflowingGeometry),
      }),
    ).rejects.toThrow("Invalid email content JSON table colspan");
  });

  it.each([
    [
      "image",
      {
        fileId: "file-image",
        name: "image.png",
        alt: "",
        caption: "",
        width: "0",
        height: "0",
        previewWidth: "100",
        textAlignment: "left",
      },
    ],
    [
      "audio",
      {
        fileId: "file-audio",
        name: "audio.wav",
        caption: "",
        previewWidth: "100",
        textAlignment: "left",
      },
    ],
    [
      "video",
      {
        fileId: "file-video",
        name: "video.mp4",
        caption: "",
        previewWidth: "100",
        textAlignment: "left",
      },
    ],
    [
      "file",
      {
        backgroundColor: "default",
        name: "document.pdf",
        url: "https://cdn.example.com/document.pdf",
        caption: "",
      },
    ],
    [
      "attachment",
      {
        fileId: "file-attachment",
        name: "document.pdf",
        caption: "",
        previewWidth: "100",
        textAlignment: "left",
      },
    ],
  ] as const)(
    "rejects unsupported %s relationships from raw email Yjs",
    async (type, props) => {
      const yjsState = createRawUnsupportedBlockUpdate(type, props);

      await expect(convertEmailDocumentToContent(yjsState)).rejects.toThrow(
        `Unsupported email Yjs node: ${type}`,
      );
      await expect(normalizeEmailDocumentState(yjsState)).rejects.toThrow(
        `Unsupported email Yjs node: ${type}`,
      );
    },
  );

  it("validates every persisted Yjs root before returning an unchanged update", async () => {
    const baseState = createEmailUpdate([paragraph("closed-root", "Closed")]);
    const mutateDocument = (mutate: (document: Y.Doc) => void): Uint8Array => {
      const document = new Y.Doc();
      Y.applyUpdate(document, baseState);
      mutate(document);
      return Y.encodeStateAsUpdate(document);
    };

    const validMetadata = mutateDocument((document) => {
      const metadata = document.getMap<string>("translation-meta");
      metadata.set("title", "Subject");
      metadata.set("summary", "Preview");
    });
    await expect(normalizeEmailDocumentState(validMetadata)).resolves.toEqual(
      validMetadata,
    );
    await expect(
      convertEmailDocumentToContent(validMetadata),
    ).resolves.toMatchObject({
      yjsState: validMetadata,
    });

    const relationshipMetadata = mutateDocument((document) => {
      document.getMap("translation-meta").set("fileId", "file-in-metadata");
    });
    await expectEmailStateRejected(
      relationshipMetadata,
      "Unsupported email Yjs translation-meta key: fileId",
    );

    const structuredMetadata = mutateDocument((document) => {
      document
        .getMap("translation-meta")
        .set("title", { fileId: "file-in-title" });
    });
    await expectEmailStateRejected(
      structuredMetadata,
      "Invalid email Yjs translation-meta value: title",
    );

    const campaignFieldsRoot = mutateDocument((document) => {
      document.getMap("campaign-fields").set("audienceId", "audience-in-root");
    });
    await expectEmailStateRejected(
      campaignFieldsRoot,
      "Unsupported email Yjs root: campaign-fields",
    );

    const htmlContentRoot = mutateDocument((document) => {
      document.getText("html-content").insert(0, "<p>hidden</p>");
    });
    await expectEmailStateRejected(
      htmlContentRoot,
      "Unsupported email Yjs root: html-content",
    );

    const mapDocumentRoot = new Y.Doc();
    mapDocumentRoot.getMap("document-store").set("fileId", "file-in-map-root");
    await expectEmailStateRejected(
      Y.encodeStateAsUpdate(mapDocumentRoot),
      "Invalid email Yjs root type: document-store",
    );

    const arrayDocumentRoot = new Y.Doc();
    arrayDocumentRoot.getArray("document-store").insert(0, ["hidden"]);
    await expectEmailStateRejected(
      Y.encodeStateAsUpdate(arrayDocumentRoot),
      "Invalid email Yjs root type: document-store",
    );

    const xmlMetadataRoot = mutateDocument((document) => {
      const metadata = document.getXmlFragment("translation-meta");
      const element = new Y.XmlElement("title");
      metadata.insert(0, [element]);
      element.insert(0, [new Y.XmlText()]);
    });
    await expectEmailStateRejected(
      xmlMetadataRoot,
      "Invalid email Yjs root type: translation-meta",
    );
  });

  it("rejects relationship attributes and lossy raw Yjs structures", async () => {
    const baseState = createEmailUpdate([
      paragraph("closed-paragraph", "Closed"),
    ]);
    const nodeRelationship = mutateEmailUpdate(baseState, (fragment) => {
      getFirstEmailContent(fragment).setAttribute("fileId", "file-in-json");
    });
    const structuredNodeAttribute = mutateEmailUpdate(baseState, (fragment) => {
      getFirstEmailContent(fragment).setAttribute("backgroundColor", {
        fileId: "file-hidden-in-prop",
      } as never);
    });
    const invalidArrayNodeAttribute = mutateEmailUpdate(
      baseState,
      (fragment) => {
        getFirstEmailContent(fragment).setAttribute("backgroundColor", [
          "file-in-array",
        ] as never);
      },
    );
    const invalidAlignment = mutateEmailUpdate(baseState, (fragment) => {
      getFirstEmailContent(fragment).setAttribute("textAlignment", "diagonal");
    });
    const invalidHeadingLevel = createEmailUpdate([
      {
        id: "heading-to-corrupt",
        type: "heading",
        props: {
          backgroundColor: "default",
          textColor: "default",
          textAlignment: "left",
          level: 2,
        },
        content: [{ type: "text", text: "Heading", styles: {} }],
        children: [],
      },
    ]);
    const corruptedHeadingLevel = mutateEmailUpdate(
      invalidHeadingLevel,
      (fragment) => {
        getFirstEmailContent(fragment).setAttribute("level", "file-hidden");
      },
    );
    const invalidCheckedValue = createEmailUpdate([
      {
        id: "check-to-corrupt",
        type: "checkListItem",
        props: {
          backgroundColor: "default",
          textColor: "default",
          textAlignment: "left",
          checked: true,
        },
        content: [{ type: "text", text: "Check", styles: {} }],
        children: [],
      },
    ]);
    const corruptedCheckedValue = mutateEmailUpdate(
      invalidCheckedValue,
      (fragment) => {
        getFirstEmailContent(fragment).setAttribute("checked", "file-hidden");
      },
    );
    const invalidListStart = createEmailUpdate([
      {
        id: "list-to-corrupt",
        type: "numberedListItem",
        props: {
          backgroundColor: "default",
          textColor: "default",
          textAlignment: "left",
          start: 3,
        },
        content: [{ type: "text", text: "List", styles: {} }],
        children: [],
      },
    ]);
    const corruptedListStart = mutateEmailUpdate(
      invalidListStart,
      (fragment) => {
        getFirstEmailContent(fragment).setAttribute("start", 0 as never);
      },
    );
    const inlineEmbed = mutateEmailUpdate(baseState, (fragment) => {
      const text = getFirstEmailContent(fragment).get(0) as Y.XmlText;
      text.delete(0, text.length);
      text.insertEmbed(0, { fileId: "file-inline" });
    });
    const textRelationshipAttribute = mutateEmailUpdate(
      baseState,
      (fragment) => {
        const text = getFirstEmailContent(fragment).get(0) as Y.XmlText;
        text.setAttribute("fileId", "file-on-text" as never);
      },
    );
    const unknownMark = mutateEmailUpdate(baseState, (fragment) => {
      const text = getFirstEmailContent(fragment).get(0) as Y.XmlText;
      text.format(0, text.length, { media: {} });
    });
    const internalMark = mutateEmailUpdate(baseState, (fragment) => {
      const text = getFirstEmailContent(fragment).get(0) as Y.XmlText;
      text.format(0, text.length, { insertion: { id: 1 } });
    });
    const invalidMarkAttributes = mutateEmailUpdate(baseState, (fragment) => {
      const text = getFirstEmailContent(fragment).get(0) as Y.XmlText;
      text.format(0, text.length, { bold: true });
    });
    const relationshipMarkAttribute = mutateEmailUpdate(
      baseState,
      (fragment) => {
        const text = getFirstEmailContent(fragment).get(0) as Y.XmlText;
        text.format(0, text.length, {
          link: {
            href: "https://studio.example.com",
            fileId: "file-in-link-mark",
          },
        });
      },
    );
    const relationshipStyleValue = mutateEmailUpdate(baseState, (fragment) => {
      const text = getFirstEmailContent(fragment).get(0) as Y.XmlText;
      text.format(0, text.length, {
        textColor: {
          stringValue: { fileId: "file-in-style" },
        },
      });
    });
    const relationshipLinkValue = mutateEmailUpdate(baseState, (fragment) => {
      const text = getFirstEmailContent(fragment).get(0) as Y.XmlText;
      text.format(0, text.length, {
        link: {
          href: { fileId: "file-in-href" },
        },
      });
    });
    const unsupportedChild = mutateEmailUpdate(baseState, (fragment) => {
      const content = getFirstEmailContent(fragment);
      content.insert(content.length, [new Y.XmlHook("media") as never]);
    });
    const multipleRoots = createRawEmailUpdate((fragment) => {
      fragment.insert(0, [
        new Y.XmlElement("blockGroup"),
        new Y.XmlElement("blockGroup"),
      ]);
    });
    const textRoot = createRawEmailUpdate((fragment) => {
      const text = new Y.XmlText();
      fragment.insert(0, [text]);
      text.insert(0, "not-a-document");
    });
    const wrongElementRoot = createRawEmailUpdate((fragment) => {
      fragment.insert(0, [new Y.XmlElement("paragraph")]);
    });
    const directBlockWithoutContainer = createRawEmailUpdate((fragment) => {
      const root = new Y.XmlElement("blockGroup");
      fragment.insert(0, [root]);
      root.insert(0, [new Y.XmlElement("paragraph")]);
    });
    const emptyBlockContainer = createRawEmailUpdate((fragment) => {
      const root = new Y.XmlElement("blockGroup");
      const container = new Y.XmlElement("blockContainer");
      fragment.insert(0, [root]);
      root.insert(0, [container]);
    });
    const duplicateBlockContent = mutateEmailUpdate(baseState, (fragment) => {
      const root = fragment.get(0) as Y.XmlElement;
      const container = root.get(0) as Y.XmlElement;
      container.insert(1, [new Y.XmlElement("paragraph")]);
    });
    const textUnderBlockGroup = createRawEmailUpdate((fragment) => {
      const root = new Y.XmlElement("blockGroup");
      const text = new Y.XmlText();
      fragment.insert(0, [root]);
      root.insert(0, [text]);
      text.insert(0, "hidden");
    });
    const emptyTable = createWideEditorUpdate([
      {
        id: "table-to-corrupt",
        type: "table",
        props: { textColor: "default" },
        content: {
          type: "tableContent",
          columnWidths: [120],
          headerRows: 0,
          headerCols: 0,
          rows: [
            {
              cells: [
                {
                  type: "tableCell",
                  props: {
                    colspan: 1,
                    rowspan: 1,
                    backgroundColor: "default",
                    textColor: "default",
                    textAlignment: "left",
                  },
                  content: [{ type: "text", text: "Cell", styles: {} }],
                },
              ],
            },
          ],
        },
        children: [],
      },
    ]);
    const tableWithoutRows = mutateEmailUpdate(emptyTable, (fragment) => {
      const table = getFirstEmailContent(fragment);
      table.delete(0, table.length);
    });
    const tableRowWithoutCells = mutateEmailUpdate(emptyTable, (fragment) => {
      const table = getFirstEmailContent(fragment);
      const row = table.get(0) as Y.XmlElement;
      row.delete(0, row.length);
    });
    const tableCellWithoutParagraph = mutateEmailUpdate(
      emptyTable,
      (fragment) => {
        const table = getFirstEmailContent(fragment);
        const row = table.get(0) as Y.XmlElement;
        const cell = row.get(0) as Y.XmlElement;
        cell.delete(0, cell.length);
      },
    );
    const nonCanonicalHeaders = createRawTableUpdate([
      [{ type: "tableCell" }, { type: "tableHeader" }],
      [{ type: "tableCell" }, { type: "tableCell" }],
    ]);
    const raggedTable = createRawTableUpdate([
      [{ type: "tableCell" }],
      [{ type: "tableCell" }, { type: "tableCell" }],
    ]);
    const oversizedRowspan = createRawTableUpdate([
      [{ rowspan: 3 }, { type: "tableCell" }],
      [{ type: "tableCell" }],
    ]);
    const overlappingTableCells = createRawTableUpdate([
      [{ type: "tableCell" }, { rowspan: 2 }],
      [{ colspan: 2, colwidth: [120, 120] }],
    ]);
    const mismatchedColwidth = createRawTableUpdate([
      [{ colspan: 2, colwidth: [120] }],
    ]);
    const invalidColwidthValue = createRawTableUpdate([
      [{ colwidth: [Number.NaN] }],
    ]);
    const invalidColspan = createRawTableUpdate([[{ colspan: 0 }]]);
    const hugeColspan = createRawTableUpdate([[{ colspan: 100_000 }]]);
    const unsafeColspan = createRawTableUpdate([
      [{ colspan: Number.MAX_SAFE_INTEGER + 1 }],
    ]);
    const unsafeRowspan = createRawTableUpdate([
      [{ rowspan: Number.MAX_SAFE_INTEGER + 1 }],
    ]);
    const nullMultiColumnWidth = createRawTableUpdate([
      [{ colspan: 2, colwidth: null }],
    ]);
    const validRowspanIntervals = createRawTableUpdate([
      [{ rowspan: 2 }, { type: "tableCell" }],
      [{ type: "tableCell" }],
    ]);
    const gappedRowspanIntervals = createRawTableUpdate([
      [{ type: "tableCell" }, { type: "tableCell" }, { rowspan: 2 }],
      [{ type: "tableCell" }],
    ]);

    await expect(
      convertEmailDocumentToContent(nodeRelationship),
    ).rejects.toThrow("Unsupported email Yjs node paragraph attribute: fileId");
    await expect(
      convertEmailDocumentToContent(structuredNodeAttribute),
    ).rejects.toThrow(
      "Invalid email Yjs node paragraph attribute value: backgroundColor",
    );
    await expect(
      convertEmailDocumentToContent(invalidArrayNodeAttribute),
    ).rejects.toThrow(
      "Invalid email Yjs node paragraph attribute value: backgroundColor",
    );
    await expectEmailStateRejected(
      invalidAlignment,
      "Invalid email Yjs node paragraph attribute value: textAlignment",
    );
    await expectEmailStateRejected(
      corruptedHeadingLevel,
      "Invalid email Yjs node heading attribute value: level",
    );
    await expectEmailStateRejected(
      corruptedCheckedValue,
      "Invalid email Yjs node checkListItem attribute value: checked",
    );
    await expectEmailStateRejected(
      corruptedListStart,
      "Invalid email Yjs node numberedListItem attribute value: start",
    );
    await expect(convertEmailDocumentToContent(inlineEmbed)).rejects.toThrow(
      "Unsupported email Yjs inline embed",
    );
    await expect(
      convertEmailDocumentToContent(textRelationshipAttribute),
    ).rejects.toThrow("Unsupported email Yjs text attribute: fileId");
    await expect(
      normalizeEmailDocumentState(textRelationshipAttribute),
    ).rejects.toThrow("Unsupported email Yjs text attribute: fileId");
    await expect(convertEmailDocumentToContent(unknownMark)).rejects.toThrow(
      "Unsupported email Yjs inline mark: media",
    );
    await expect(convertEmailDocumentToContent(internalMark)).rejects.toThrow(
      "Unsupported email Yjs inline mark: insertion",
    );
    await expect(
      convertEmailDocumentToContent(invalidMarkAttributes),
    ).rejects.toThrow("Invalid email Yjs inline mark attributes: bold");
    await expect(
      convertEmailDocumentToContent(relationshipMarkAttribute),
    ).rejects.toThrow(
      "Unsupported email Yjs inline mark link attribute: fileId",
    );
    await expect(
      convertEmailDocumentToContent(relationshipStyleValue),
    ).rejects.toThrow(
      "Invalid email Yjs inline mark attribute value: textColor",
    );
    await expect(
      normalizeEmailDocumentState(relationshipStyleValue),
    ).rejects.toThrow(
      "Invalid email Yjs inline mark attribute value: textColor",
    );
    await expect(
      convertEmailDocumentToContent(relationshipLinkValue),
    ).rejects.toThrow("Invalid email Yjs inline mark attribute value: link");
    await expect(
      normalizeEmailDocumentState(relationshipLinkValue),
    ).rejects.toThrow("Invalid email Yjs inline mark attribute value: link");
    await expect(
      convertEmailDocumentToContent(unsupportedChild),
    ).rejects.toThrow("Unsupported email Yjs child in node: paragraph");
    await expect(convertEmailDocumentToContent(multipleRoots)).rejects.toThrow(
      "Invalid email Yjs document root",
    );
    await expect(convertEmailDocumentToContent(textRoot)).rejects.toThrow(
      "Invalid email Yjs document root",
    );
    await expect(
      convertEmailDocumentToContent(wrongElementRoot),
    ).rejects.toThrow("Invalid email Yjs document root");
    await expect(
      convertEmailDocumentToContent(directBlockWithoutContainer),
    ).rejects.toThrow("Invalid email Yjs child paragraph under blockGroup");
    await expect(
      convertEmailDocumentToContent(emptyBlockContainer),
    ).rejects.toThrow("Invalid email Yjs blockContainer structure");
    await expect(
      convertEmailDocumentToContent(duplicateBlockContent),
    ).rejects.toThrow("Invalid email Yjs blockContainer structure");
    await expect(
      convertEmailDocumentToContent(textUnderBlockGroup),
    ).rejects.toThrow("Invalid email Yjs text under blockGroup");
    await expect(
      convertEmailDocumentToContent(tableWithoutRows),
    ).rejects.toThrow("Invalid email Yjs table structure");
    await expect(
      convertEmailDocumentToContent(tableRowWithoutCells),
    ).rejects.toThrow("Invalid email Yjs tableRow structure");
    await expect(
      convertEmailDocumentToContent(tableCellWithoutParagraph),
    ).rejects.toThrow("Invalid email Yjs tableCell structure");
    await expectEmailStateRejected(
      nonCanonicalHeaders,
      "Invalid email Yjs non-canonical table headers",
    );
    await expectEmailStateRejected(
      raggedTable,
      "Invalid email Yjs non-rectangular table",
    );
    await expectEmailStateRejected(
      oversizedRowspan,
      "Invalid email Yjs table rowspan",
    );
    await expectEmailStateRejected(
      overlappingTableCells,
      "Invalid email Yjs overlapping table cells",
    );
    await expectEmailStateRejected(
      mismatchedColwidth,
      "Invalid email Yjs table colwidth",
    );
    await expectEmailStateRejected(
      invalidColwidthValue,
      "Invalid email Yjs node tableCell attribute value: colwidth",
    );
    await expectEmailStateRejected(
      invalidColspan,
      "Invalid email Yjs node tableCell attribute value: colspan",
    );
    expect(hugeColspan.byteLength).toBeLessThan(4096);
    await expectEmailStateRejected(
      hugeColspan,
      "Invalid email Yjs table colwidth",
    );
    await expectEmailStateRejected(
      unsafeColspan,
      "Invalid email Yjs node tableCell attribute value: colspan",
    );
    await expectEmailStateRejected(
      unsafeRowspan,
      "Invalid email Yjs node tableCell attribute value: rowspan",
    );
    await expectEmailStateRejected(
      nullMultiColumnWidth,
      "Invalid email Yjs table colwidth",
    );
    await expect(
      convertEmailDocumentToContent(validRowspanIntervals),
    ).resolves.toMatchObject({
      html: expect.stringContaining("<table>"),
    });
    await expect(
      normalizeEmailDocumentState(validRowspanIntervals),
    ).resolves.toEqual(validRowspanIntervals);
    await expectEmailStateRejected(
      gappedRowspanIntervals,
      "Invalid email Yjs non-rectangular table",
    );

    const emptyState = createRawEmailUpdate(() => undefined);
    await expect(
      convertEmailDocumentToContent(emptyState),
    ).resolves.toMatchObject({
      html: "",
      text: "",
    });
    await expect(normalizeEmailDocumentState(emptyState)).resolves.toEqual(
      emptyState,
    );
  });

  it("keeps empty paragraphs clean in stored html", async () => {
    const html = await convertEmailToHtml(
      createEmailUpdate([
        paragraph("p1", "first line"),
        paragraph("p2"),
        paragraph("p3", "second line"),
      ]),
    );

    expect(html).toContain("<p>first line</p>");
    expect(html).toContain("<p></p>");
    expect(html).toContain("<p>second line</p>");
    expect(html).not.toContain("&nbsp;");
  });

  it("normalizes malformed placeholder hrefs in stored html", async () => {
    const html = await convertEmailToHtml(
      createEmailUpdate([
        {
          id: "p1",
          type: "paragraph",
          props: {
            backgroundColor: "default",
            textColor: "default",
            textAlignment: "left",
          },
          content: [
            {
              type: "link",
              href: "https://{{verification_url}}",
              content: [
                { type: "text", text: "{{verification_url}}", styles: {} },
              ],
            },
          ],
          children: [],
        },
      ]),
    );

    expect(html).toContain('href="{{verification_url}}"');
    expect(html).not.toContain('href="https://{{verification_url}}"');
  });

  it("removes trailing empty paragraphs from stored html, json, and yjs state", async () => {
    const converted = await convertEmailDocumentToContent(
      createEmailUpdate([
        paragraph("p1", "Only line"),
        paragraph("p2"),
        paragraph("p3"),
      ]),
    );

    expect(converted.html).toContain("<p>Only line</p>");
    expect(converted.html).not.toContain("<p></p>");
    expect(decodeStoredBlockIds(converted.json)).toEqual(["p1"]);
    await expect(readStoredBlockIds(converted.yjsState)).resolves.toEqual([
      "p1",
    ]);
  });

  it("normalizes trailing empty paragraphs while preserving translation metadata", async () => {
    const state = createEmailUpdate([
      paragraph("p1", "Metadata body"),
      paragraph("p2"),
    ]);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, state);
    doc.getMap<string>("translation-meta").set("title", "Subject");

    const normalizedState = await normalizeEmailDocumentState(
      Y.encodeStateAsUpdate(doc),
    );
    const normalizedDoc = new Y.Doc();
    Y.applyUpdate(normalizedDoc, normalizedState);

    expect(normalizedDoc.getMap<string>("translation-meta").get("title")).toBe(
      "Subject",
    );
    await expect(readStoredBlockIds(normalizedState)).resolves.toEqual(["p1"]);
  });

  it("trims parsed trailing empty paragraphs when creating email document state", async () => {
    const contentJson = new TextEncoder().encode(
      JSON.stringify([paragraph("p1", "Loaded body"), paragraph("p2")]),
    );

    const state = await createEmailDocumentState({ contentJson });

    await expect(readStoredBlockIds(state)).resolves.toEqual(["p1"]);
  });

  it("treats a valid empty JSON array as the authoritative empty body", async () => {
    const state = await createEmailDocumentState({
      contentJson: encodeEmailContentJson([]),
      contentHtml: "<p>stale HTML must not return</p>",
      contentText: "stale text must not return",
    });
    const converted = await convertEmailDocumentToContent(state);
    const document = new Y.Doc();
    Y.applyUpdate(document, converted.yjsState);

    expect(JSON.parse(new TextDecoder().decode(converted.json))).toEqual([]);
    expect(converted.html).toBe("");
    expect(converted.text).toBe("");
    await expect(readStoredBlocks(converted.yjsState)).resolves.toEqual([]);
    expect(document.getXmlFragment("document-store").toString()).not.toContain(
      "stale",
    );
  });

  it("falls back deterministically across malformed JSON, HTML failures, text, and empty input", async () => {
    const malformed = await createEmailDocumentState({
      contentJson: new TextEncoder().encode("{"),
      contentText: "Fallback text",
    });
    const objectJson = await createEmailDocumentState({
      contentJson: new TextEncoder().encode("{}"),
      contentText: "Fallback text",
    });
    expect(await readStoredBlockIds(malformed)).toEqual(
      await readStoredBlockIds(objectJson),
    );

    const html = await createEmailDocumentState({
      contentHtml: "<p>HTML fallback</p>",
      contentText: "stale text",
    });
    await expect(convertEmailDocumentToContent(html)).resolves.toMatchObject({
      text: "HTML fallback",
    });

    await expect(
      createEmailDocumentState({
        contentHtml: "<broken>",
        contentText: "Fallback",
      }),
    ).rejects.toThrow("Unsupported email HTML block element: broken");

    await expect(createEmailDocumentState({})).resolves.toEqual(
      expect.any(Uint8Array),
    );
  });
});
