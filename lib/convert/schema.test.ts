import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  editorSchema,
  pageRichTextSchema,
  postEditorSchema,
} from "./schema.ts";
import {
  readGeulBlocks,
  renderGeulBlocks,
  writeGeulBlocks,
} from "./test-helpers.ts";
import type { GeulRichTextSchema } from "./tiptap-document.ts";

const textProps = {
  backgroundColor: "default",
  textColor: "default",
  textAlignment: "left",
};

function block(
  type: string,
  props: Record<string, unknown>,
  content: unknown = [],
  children: unknown[] = [],
) {
  return { id: `${type}-test`, type, props, content, children };
}

function exportBlock(type: string, props: Record<string, unknown>): string {
  return renderGeulBlocks([block(type, props)], editorSchema);
}

function roundTrip(
  blocks: readonly unknown[],
  schema: GeulRichTextSchema = editorSchema,
) {
  const document = new Y.Doc();
  writeGeulBlocks(document, "document-store", blocks, schema);
  return {
    blocks: readGeulBlocks(document, "document-store", schema),
    html: renderGeulBlocks(blocks, schema),
  };
}

describe("strict Tiptap/Yjs schema conversion", () => {
  it.each([
    ["generic Work/Event", editorSchema],
    ["Post", postEditorSchema],
    ["Page rich text", pageRichTextSchema],
  ] as const)(
    "hard-cuts legacy media node types in the %s schema",
    (_label, schema) => {
      for (const type of ["image", "audio", "video", "attachment"]) {
        expect(() =>
          roundTrip([block(type, { fileId: `${type}-file` })], schema),
        ).toThrow(`Unsupported ${schema} block type: ${type}`);
      }
    },
  );

  it("round-trips external-video link layout in Post and Page rich-text schemas", () => {
    for (const [schema, id, url, previewWidth, textAlignment, aspectRatio] of [
      [
        postEditorSchema,
        "post-link",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "64",
        "center",
        "4:3",
      ],
      [
        pageRichTextSchema,
        "page-link",
        "https://vimeo.com/76979871",
        "42",
        "right",
        "1:1",
      ],
    ] as const) {
      const input = block(
        "paragraph",
        { ...textProps, previewWidth, textAlignment, aspectRatio },
        [
          {
            type: "link",
            href: url,
            content: [{ type: "text", text: "Field recording", styles: {} }],
          },
        ],
      );
      input.id = id;
      const result = roundTrip([input], schema);
      expect(result.blocks[0]).toMatchObject({
        id,
        props: { previewWidth, textAlignment, aspectRatio },
        content: [{ type: "link", href: url }],
      });
      expect(result.html).toContain(`data-preview-width="${previewWidth}"`);
      expect(result.html).toContain(`data-aspect-ratio="${aspectRatio}"`);
      expect(result.html).toContain(`href="${url}"`);
    }
  });

  it("does not add external-video layout props to generic Work/Event paragraphs", () => {
    const result = roundTrip([
      block(
        "paragraph",
        {
          ...textProps,
          textAlignment: "right",
          previewWidth: "37",
          aspectRatio: "1:1",
        },
        [
          {
            type: "link",
            href: "https://vimeo.com/76979871",
            content: [{ type: "text", text: "Ordinary link", styles: {} }],
          },
        ],
      ),
    ]);
    expect(result.blocks[0]).toMatchObject({
      type: "paragraph",
      props: { textAlignment: "right" },
    });
    expect(result.blocks[0]?.props).not.toHaveProperty("previewWidth");
    expect(result.blocks[0]?.props).not.toHaveProperty("aspectRatio");
  });

  it("fails closed for unsupported paragraph layout attributes", () => {
    expect(() =>
      roundTrip(
        [block("paragraph", { ...textProps, aspectRatio: "21:9" })],
        postEditorSchema,
      ),
    ).toThrow("Invalid rich-text paragraph attribute value: aspectRatio");
    expect(() =>
      roundTrip(
        [block("paragraph", { ...textProps, injected: true })],
        postEditorSchema,
      ),
    ).not.toThrow();
    const result = roundTrip(
      [block("paragraph", { ...textProps, injected: true })],
      postEditorSchema,
    );
    expect(result.blocks[0]?.props).not.toHaveProperty("injected");
  });

  it("renders every durable custom block and rejects unsupported nodes", () => {
    const cases: Array<[string, Record<string, unknown>, string]> = [
      ["math", { latex: "x+y" }, 'data-latex="x+y"'],
      [
        "map",
        {
          mapPlaceIds: "place-1",
          previewWidth: "60",
          textAlignment: "right",
          caption: "Map",
        },
        "map-block",
      ],
      ["file", { fileId: "file-1", name: "File" }, "file-block-html"],
    ];
    for (const [type, props, expected] of cases)
      expect(exportBlock(type, props)).toContain(expected);
    for (const type of ["image", "audio", "video", "attachment"]) {
      expect(() => exportBlock(type, { fileId: `${type}-1` })).toThrow(
        `Unsupported editor block type: ${type}`,
      );
    }
    expect(() => exportBlock("unhandled", {})).toThrow(
      "Unsupported editor block type: unhandled",
    );
  });

  it("exports the unified file block with stable identity and optional caption", () => {
    expect(
      exportBlock("file", { fileId: "", caption: "", name: "" }),
    ).toContain("file-block-html--empty");
    const attached = exportBlock("file", {
      fileId: "file-1",
      caption: "Field recording",
      name: "Session master.wav",
      previewWidth: "64",
      textAlignment: "center",
    });
    expect(attached).toContain('data-file-id="file-1"');
    expect(attached).toContain("Session master.wav");
    expect(attached).toContain("Field recording");
    expect(attached).toContain("width: 64%; margin: 0px auto;");
    expect(attached).not.toContain("data-playback-url");
    expect(attached).not.toContain("data-original-url");
    expect(attached).not.toContain("data-hls-src");
    expect(exportBlock("file", { fileId: "file-2", name: "" })).toContain(
      "Untitled file",
    );
  });

  it("renders math block and inline HTML while preserving formulas for renderer failures", () => {
    const html = renderGeulBlocks(
      [
        block("math", { latex: "x^2" }),
        block("paragraph", textProps, [
          { type: "mathInline", props: { latex: "y^2" } },
        ]),
        block("math", { latex: "broken" }),
        block("paragraph", textProps, [
          { type: "mathInline", props: { latex: "inline-broken" } },
        ]),
      ],
      editorSchema,
    );
    for (const formula of ["x^2", "y^2", "broken", "inline-broken"])
      expect(html).toContain(formula);
  });

  it("exports map alignment, captions, legacy inputs, malformed input, and empty variants", () => {
    const aligned = exportBlock("map", {
      mapPlaceIds: "place-1",
      previewWidth: "60",
      textAlignment: "right",
      areaLabelsMode: "show",
      poiLabelsMode: "hide",
      caption: "Right aligned map",
    });
    const dom = new JSDOM(`<body>${aligned}</body>`).window.document;
    expect(
      dom.querySelector("figure.map-block-figure")?.getAttribute("style"),
    ).toContain("width: 60%");
    expect(aligned).toContain('data-block-alignment="right"');
    expect(aligned).toContain('data-area-labels-mode="show"');
    expect(aligned).toContain('data-poi-labels-mode="hide"');
    expect(aligned).toContain("Right aligned map");
    expect(
      exportBlock("map", {
        mapPlaceIds: "one,two, ",
        previewWidth: "5",
        textAlignment: "center",
      }),
    ).toContain("[Map: 2 places]");
    expect(exportBlock("map", { mapPlaceId: "legacy-place" })).toContain(
      "[Map: 1 place]",
    );
    expect(exportBlock("map", { location: "{" })).toContain(
      'data-location="{"',
    );
    expect(
      exportBlock("map", { location: "", previewWidth: "invalid" }),
    ).not.toContain("data-location=");
  });

  it("keeps durable media props and drops legacy runtime projection props from Yjs", () => {
    const result = roundTrip(
      [
        block("file", {
          fileId: "file-pending-1",
          pendingUploadFileId: "file-pending-1",
          mediaSlotId: "slot-1",
          mediaAttemptId: "attempt-1",
          title: "Legacy title",
          caption: "Caption",
          name: "large-file.txt",
          processingStatus: "uploading",
          previewWidth: "38",
          textAlignment: "left",
        }),
      ],
      pageRichTextSchema,
    );
    expect(result.blocks[0]?.props).toMatchObject({
      fileId: "file-pending-1",
      name: "large-file.txt",
      caption: "Caption",
      previewWidth: "38",
    });
    expect(result.blocks[0]?.props).toMatchObject({
      pendingUploadFileId: "file-pending-1",
      mediaAttemptId: "attempt-1",
    });
    for (const key of ["title", "mediaSlotId", "processingStatus"]) {
      expect(result.blocks[0]?.props).not.toHaveProperty(key);
    }
  });
});
