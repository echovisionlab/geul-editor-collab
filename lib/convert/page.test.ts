import {
  createPageBlockFixtureSections,
  PAGE_BLOCK_TYPES,
  type Block,
  type PageBlockFixtureBlock,
  type PageBlockFixtureSection,
  type SectionSettings,
} from "@echovisionlab/geul-common/page";
import type { Section } from "@echovisionlab/geul-common/page";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { convertPageContent } from "./page.ts";
import { pageRichTextSchema } from "./schema.ts";
import { writeGeulBlocks } from "./test-helpers.ts";

function normalizeBlock(block: PageBlockFixtureBlock): PageBlockFixtureBlock {
  return {
    id: block.id,
    type: block.type,
    props: block.props,
    content: block.content ?? [],
    children: (block.children ?? []).map(normalizeBlock),
  };
}

interface RenderedSectionNode {
  type: string;
  columns?: Array<{ sections: RenderedSectionNode[] }>;
}

interface SectionSummary {
  id: string;
  type: string;
  settings: SectionSettings;
  props?: Record<string, unknown>;
  text?: string;
  columns?: Array<{ id: string; sections: SectionSummary[] }>;
}

function buildSectionMeta(
  section: PageBlockFixtureSection,
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    id: section.id,
    type: section.type,
    settings: section.settings,
  };

  if (section.props) {
    meta.props = section.props;
  }

  if (section.type === "columns" && section.columns) {
    meta.columns = section.columns.map((column) => ({
      id: column.id,
      sections: column.sections.map(buildSectionMeta),
    }));
  }

  return meta;
}

function encodeRichTextFragments(
  doc: Y.Doc,
  sections: PageBlockFixtureSection[],
): void {
  for (const section of sections) {
    if (section.type === "rich-text") {
      writeGeulBlocks(
        doc,
        `section-${section.id}`,
        (section.content ?? []).map(normalizeBlock),
        pageRichTextSchema,
      );
    }

    if (section.type === "columns" && section.columns) {
      for (const column of section.columns) {
        encodeRichTextFragments(doc, column.sections);
      }
    }
  }
}

function createFixturePageUpdate(): Uint8Array {
  const doc = new Y.Doc();
  const sections = createPageBlockFixtureSections();

  doc.transact(() => {
    doc.getArray("sections").push(sections.map(buildSectionMeta));
    encodeRichTextFragments(doc, sections);
  });
  const fields = doc.getMap("page-fields");
  fields.set("contentHeight", "viewport");
  fields.set("pageChrome", "flow");
  fields.set("footer", "pinned");

  return Y.encodeStateAsUpdate(doc);
}

function createExternalVideoLinkLayoutPageUpdate(): Uint8Array {
  const standaloneLinkParagraph = (input: {
    id: string;
    url: string;
    label: string;
    previewWidth: string;
    textAlignment: "left" | "center" | "right";
    aspectRatio: "auto" | "16:9" | "4:3" | "1:1" | "9:16";
  }) =>
    ({
      id: input.id,
      type: "paragraph",
      props: {
        backgroundColor: "default",
        textColor: "default",
        textAlignment: input.textAlignment,
        previewWidth: input.previewWidth,
        aspectRatio: input.aspectRatio,
      },
      content: [
        {
          type: "link",
          href: input.url,
          content: [{ type: "text", text: input.label, styles: {} }],
        },
      ],
      children: [],
    }) as unknown as PageBlockFixtureBlock;

  const sections: PageBlockFixtureSection[] = [
    {
      id: "top-level-rich-text",
      type: "rich-text",
      settings: {},
      content: [
        standaloneLinkParagraph({
          id: "top-level-link",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          label: "Top-level field recording",
          previewWidth: "72",
          textAlignment: "center",
          aspectRatio: "16:9",
        }),
      ],
    },
    {
      id: "columns",
      type: "columns",
      settings: {},
      columns: [
        {
          id: "column-1",
          sections: [
            {
              id: "nested-rich-text",
              type: "rich-text",
              settings: {},
              content: [
                standaloneLinkParagraph({
                  id: "nested-link",
                  url: "https://vimeo.com/76979871",
                  label: "Nested Vimeo field recording",
                  previewWidth: "48",
                  textAlignment: "right",
                  aspectRatio: "4:3",
                }),
              ],
            },
          ],
        },
      ],
    },
  ];
  const document = new Y.Doc();

  document.transact(() => {
    document.getArray("sections").push(sections.map(buildSectionMeta));
    encodeRichTextFragments(document, sections);
  });

  return Y.encodeStateAsUpdate(document);
}

function collectSectionTypes(sections: RenderedSectionNode[]): string[] {
  const types: string[] = [];

  const visit = (items: RenderedSectionNode[]) => {
    for (const section of items) {
      types.push(section.type);
      if (section.columns) {
        for (const column of section.columns) {
          visit(column.sections);
        }
      }
    }
  };

  visit(sections);
  return types;
}

function extractFixtureText(
  blocks: PageBlockFixtureBlock[] | undefined,
): string {
  return (blocks ?? [])
    .map((block) => {
      const inlineText = (block.content ?? [])
        .map((item) => item.text ?? "")
        .join("");
      const childText = extractFixtureText(block.children);
      return `${inlineText}${childText}`;
    })
    .join("");
}

function extractRenderedBlockText(block: Block): string {
  const inlineText = (block.content ?? [])
    .map((item: { text?: string }) => item.text ?? "")
    .join("");
  const childText = (block.children ?? [])
    .map(extractRenderedBlockText)
    .join("");
  return `${inlineText}${childText}`;
}

function extractRenderedText(section: Section): string {
  return (section.content ?? []).map(extractRenderedBlockText).join("");
}

function summarizeFixtureSections(
  sections: PageBlockFixtureSection[],
): SectionSummary[] {
  return sections.map((section) => ({
    id: section.id,
    type: section.type,
    settings: section.settings,
    props: section.props,
    text:
      section.type === "rich-text"
        ? extractFixtureText(section.content)
        : undefined,
    columns: section.columns?.map((column) => ({
      id: column.id,
      sections: summarizeFixtureSections(column.sections),
    })),
  }));
}

function summarizeRenderedSections(sections: Section[]): SectionSummary[] {
  return sections.map((section) => ({
    id: section.id,
    type: section.type,
    settings: section.settings,
    props: section.props,
    text:
      section.type === "rich-text" ? extractRenderedText(section) : undefined,
    columns: section.columns?.map((column) => ({
      id: column.id,
      sections: summarizeRenderedSections(column.sections),
    })),
  }));
}

describe("convertPageContent", () => {
  it("preserves every supported page block type and nested rich-text content", async () => {
    const expectedSections = createPageBlockFixtureSections();
    const result = await convertPageContent(createFixturePageUpdate());
    const actualTypes = collectSectionTypes(result.json.sections);

    expect(Object.keys(result.json)).toEqual(["sections"]);
    expect(result.json.sections.map((section) => section.type)).toEqual([
      ...PAGE_BLOCK_TYPES,
    ]);
    expect(actualTypes).toContain("columns");
    expect(actualTypes).toContain("rich-text");
    expect(actualTypes).toContain("post-list");
    expect(summarizeRenderedSections(result.json.sections)).toEqual(
      summarizeFixtureSections(expectedSections),
    );
    expect(result.text).toContain("Fixture intro\nFixture intro copy.");
    expect(result.text).toContain("Fixture focus\nFixture focus copy.");
  });

  it("round-trips unified file names, MIME types, and captions", async () => {
    const result = await convertPageContent(createFixturePageUpdate());
    const topLevel = result.json.sections.find(
      (section) => section.id === "fixture-section-rich-text",
    )?.content;
    const nested = result.json.sections
      .find((section) => section.id === "fixture-section-columns")
      ?.columns?.[0]?.sections.find(
        (section) => section.id === "fixture-column-rich-text",
      )?.content;

    for (const [blocks, prefix] of [
      [topLevel, "fixture"],
      [nested, "fixture-nested"],
    ] as const) {
      for (const [name, caption] of [
        [
          `${prefix}-audio.wav`,
          `${prefix === "fixture" ? "Fixture" : "Fixture nested"} audio caption`,
        ],
        [
          `${prefix}-video.mp4`,
          `${prefix === "fixture" ? "Fixture" : "Fixture nested"} video caption`,
        ],
        [
          `${prefix}-score.pdf`,
          `${prefix === "fixture" ? "Fixture" : "Fixture nested"} attachment caption`,
        ],
        [
          `${prefix}-archive.zip`,
          `${prefix === "fixture" ? "Fixture" : "Fixture nested"} file caption`,
        ],
      ] as const) {
        const block = blocks?.find(
          (candidate) =>
            candidate.type === "file" && candidate.props.name === name,
        );
        expect(block?.type).toBe("file");
        expect(block?.props).toMatchObject({ name, caption });
        expect(block?.props).not.toHaveProperty("mimeType");
        expect(block?.props).not.toHaveProperty("title");
        expect(block?.props).not.toHaveProperty("allowOriginalDownload");
      }
    }
  });

  it("round-trips top-level and Columns-nested external video props generically", async () => {
    const result = await convertPageContent(createFixturePageUpdate());
    const topLevel = result.json.sections.find(
      (section) => section.type === "external-video",
    );
    const columns = result.json.sections.find(
      (section) => section.type === "columns",
    );
    const nested = columns?.columns
      ?.flatMap((column) => column.sections)
      .find((section) => section.type === "external-video");

    expect(topLevel?.props).toEqual({
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      caption: "Fixture external video",
      aspectRatio: "auto",
    });
    expect(nested?.props).toEqual({
      url: "https://vimeo.com/76979871",
      caption: "Fixture nested external video",
      aspectRatio: "16:9",
    });
  });

  it("round-trips top-level and Columns-nested standalone-link layout and link content", async () => {
    const result = await convertPageContent(
      createExternalVideoLinkLayoutPageUpdate(),
    );
    const topLevel = result.json.sections.find(
      (section) => section.id === "top-level-rich-text",
    )?.content?.[0];
    const nested = result.json.sections
      .find((section) => section.id === "columns")
      ?.columns?.flatMap((column) => column.sections)
      .find((section) => section.id === "nested-rich-text")?.content?.[0];

    expect(topLevel).toMatchObject({
      type: "paragraph",
      props: {
        previewWidth: "72",
        textAlignment: "center",
        aspectRatio: "16:9",
      },
      content: [
        {
          type: "link",
          href: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          content: [
            expect.objectContaining({ text: "Top-level field recording" }),
          ],
        },
      ],
    });
    expect(nested).toMatchObject({
      type: "paragraph",
      props: {
        previewWidth: "48",
        textAlignment: "right",
        aspectRatio: "4:3",
      },
      content: [
        {
          type: "link",
          href: "https://vimeo.com/76979871",
          content: [
            expect.objectContaining({ text: "Nested Vimeo field recording" }),
          ],
        },
      ],
    });
  });

  it("fails closed with the page section id when a non-empty rich-text fragment is malformed", async () => {
    const document = new Y.Doc();
    document.getArray("sections").push([
      { id: "broken", type: "rich-text", settings: {} },
      { id: "empty", type: "rich-text", settings: {} },
    ]);
    const fragment = document.getXmlFragment("section-broken");
    fragment.insert(0, [new Y.XmlElement("broken")]);
    await expect(
      convertPageContent(Y.encodeStateAsUpdate(document)),
    ).rejects.toThrow("Failed to materialize page rich-text section broken:");
  });
});
