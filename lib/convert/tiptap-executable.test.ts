import { describe, expect, it } from "vitest";
import {
  geulBlocksToProseMirrorDocument,
  prosemirrorJsonToGeulBlocks,
  type ProseMirrorJsonNode,
} from "./tiptap-document.ts";
import { renderGeulProseMirrorHtml } from "./tiptap-html.ts";
import { convertPostDocumentToHtml } from "./post.ts";
import { encodeGeulBlocks } from "./test-helpers.ts";

function executableDocument(
  type: "p5Sketch" | "threeScene" | "shader",
  attrs: Record<string, unknown> = {},
): ProseMirrorJsonNode {
  const noneChannels = () =>
    Array.from({ length: 4 }, () => ({ kind: "none" }));
  const shaderStages: ProseMirrorJsonNode[] = [
    "shaderCommon",
    "shaderVertex",
    "shaderBufferA",
    "shaderBufferB",
    "shaderBufferC",
    "shaderBufferD",
    "shaderCubemap",
    "shaderSound",
    "shaderImage",
  ].map((stage, index) => ({
    type: stage,
    ...(index >= 2 ? { attrs: { channels: noneChannels() } } : {}),
    content:
      index === 8 ? [{ type: "text", text: 'const marker = "<script>";' }] : [],
  }));
  return {
    type: "doc",
    content: [
      {
        type: "blockGroup",
        content: [
          {
            type: "blockContainer",
            attrs: { id: type },
            content: [
              {
                type,
                attrs,
                content:
                  type === "shader"
                    ? shaderStages
                    : [{ type: "text", text: 'const marker = "<script>";' }],
              },
            ],
          },
        ],
      },
    ],
  } satisfies ProseMirrorJsonNode;
}

function shaderBlock(): Record<string, unknown> {
  return {
    id: "shader-block",
    type: "shader",
    props: {
      mode: "preview",
      previewHeight: 360,
      previewWidth: "100",
      textAlignment: "left",
    },
    content: executableDocument(
      "shader",
    ).content![0]!.content![0]!.content![0]!.content!.map((stage) => ({
      type: stage.type,
      ...(stage.attrs ? { props: stage.attrs } : { props: {} }),
      content: (stage.content ?? []).map((source) => ({
        type: "text",
        text: source.text ?? "",
        styles: {},
      })),
    })),
    children: [],
  };
}

describe("Tiptap executable materialization", () => {
  it.each([
    ["p5Sketch", { title: "Localized sketch" }, "javascript"],
    [
      "threeScene",
      { title: "Localized scene", language: "typescript" },
      "typescript",
    ],
    ["shader", { title: "Localized shader" }, "glsl"],
  ] as const)(
    "preserves %s identity, text source, and safe public HTML",
    (type, attrs, language) => {
      const document = executableDocument(type, attrs);
      const blocks = prosemirrorJsonToGeulBlocks(document, "post");
      const html = renderGeulProseMirrorHtml(document);

      expect(blocks[0]).toMatchObject(
        type === "shader"
          ? {
              type,
              props: expect.objectContaining({ title: attrs.title }),
              content: expect.arrayContaining([
                expect.objectContaining({ type: "shaderImage" }),
              ]),
            }
          : {
              type,
              props: expect.objectContaining({ title: attrs.title }),
              content: [
                {
                  type: "text",
                  text: 'const marker = "<script>";',
                  styles: {},
                },
              ],
            },
      );
      expect(html).toContain(`data-content-type="${type}"`);
      expect(html).toContain(`data-language="${language}"`);
      expect(html).toContain(`<figcaption>${attrs.title}</figcaption>`);
      expect(html).toContain("&lt;script&gt;");
      expect(html).not.toContain("<script>");
    },
  );

  it("uses stable public labels when executable titles are empty", () => {
    expect(renderGeulProseMirrorHtml(executableDocument("p5Sketch"))).toContain(
      "<figcaption>p5.js sketch</figcaption>",
    );
    expect(
      renderGeulProseMirrorHtml(executableDocument("threeScene")),
    ).toContain("<figcaption>Three.js scene</figcaption>");
    expect(renderGeulProseMirrorHtml(executableDocument("shader"))).toContain(
      "<figcaption>Shader</figcaption>",
    );
  });

  it("normalizes legacy p5/Three source attrs into text content without writing the attr again", () => {
    const legacy = executableDocument("threeScene", {
      source: "legacyThree();",
      language: "javascript",
    });
    legacy.content![0]!.content![0]!.content![0]!.content = [];

    const [block] = prosemirrorJsonToGeulBlocks(legacy, "post");
    expect(block?.content).toEqual([
      { type: "text", text: "legacyThree();", styles: {} },
    ]);
    expect(block?.props).not.toHaveProperty("source");
    expect(renderGeulProseMirrorHtml(legacy)).toContain("legacyThree();");

    const rewritten = geulBlocksToProseMirrorDocument([block], "post");
    const node = rewritten.content?.[0]?.content?.[0]?.content?.[0];
    expect(node?.attrs).not.toHaveProperty("source");
    expect(node?.content).toEqual([{ type: "text", text: "legacyThree();" }]);
  });

  it("rejects shader source attrs, styled source, and executable nodes from restricted schemas", () => {
    expect(() =>
      prosemirrorJsonToGeulBlocks(
        executableDocument("shader", { source: "not durable" }),
        "post",
      ),
    ).toThrow("Unsupported rich-text shader attribute: source");

    const marked = executableDocument("p5Sketch");
    const sourceNode = marked.content![0]!.content![0]!.content![0]!
      .content![0]! as ProseMirrorJsonNode;
    sourceNode.marks = [{ type: "bold" }];
    expect(() => prosemirrorJsonToGeulBlocks(marked, "post")).toThrow(
      "Invalid rich-text p5Sketch source marks",
    );

    expect(() =>
      prosemirrorJsonToGeulBlocks(executableDocument("shader"), "email"),
    ).toThrow("Unsupported email block type: shader");

    const obsolete = executableDocument("shader");
    obsolete.content![0]!.content![0]!.content![0]!.content![8]!.attrs = {
      channels: [
        {
          kind: "soundFFT",
          sampler: { filter: "linear", wrap: "clamp", vflip: false },
        },
        { kind: "none" },
        { kind: "none" },
        { kind: "none" },
      ],
    };
    expect(() => prosemirrorJsonToGeulBlocks(obsolete, "post")).toThrow(
      "Invalid rich-text shaderImage attribute value: channels",
    );
  });

  it("rejects malformed shader stage trees on the ProseMirror boundary", () => {
    const missing = executableDocument("shader");
    missing.content![0]!.content![0]!.content![0]!.content!.pop();
    expect(() => prosemirrorJsonToGeulBlocks(missing, "post")).toThrow(
      "Invalid rich-text shader stage content",
    );

    const markedStage = executableDocument("shader");
    markedStage.content![0]!.content![0]!.content![0]!.content![2]!.marks = [
      { type: "bold" },
    ];
    expect(() => prosemirrorJsonToGeulBlocks(markedStage, "post")).toThrow(
      "Invalid rich-text shader stage content",
    );
  });

  it("keeps fenced-code imports as ordinary codeBlock nodes", () => {
    const ordinaryCode = {
      type: "doc",
      content: [
        {
          type: "blockGroup",
          content: [
            {
              type: "blockContainer",
              attrs: { id: "glsl-code" },
              content: [
                {
                  type: "codeBlock",
                  attrs: { language: "glsl" },
                  content: [{ type: "text", text: "void main() {}" }],
                },
              ],
            },
          ],
        },
      ],
    } satisfies ProseMirrorJsonNode;

    expect(prosemirrorJsonToGeulBlocks(ordinaryCode, "post")[0]).toMatchObject({
      type: "codeBlock",
      props: { language: "glsl" },
    });
  });

  it("materializes executable JSON, escaped HTML, and searchable source through the Post pipeline", async () => {
    const converted = await convertPostDocumentToHtml(
      encodeGeulBlocks(
        [
          {
            id: "shader",
            type: "shader",
            props: {
              title: "Localized shader",
              mode: "preview",
              previewHeight: 360,
              previewWidth: "100",
              textAlignment: "left",
            },
            content: executableDocument(
              "shader",
            ).content![0]!.content![0]!.content![0]!.content!.map((stage) => ({
              type: stage.type,
              ...(stage.attrs ? { props: stage.attrs } : {}),
              content:
                stage.type === "shaderImage"
                  ? [
                      {
                        type: "text",
                        text: "void mainImage() { /* <script> */ }",
                        styles: {},
                      },
                    ]
                  : [],
            })),
            children: [],
          },
        ],
        "post",
      ),
    );

    expect(JSON.parse(new TextDecoder().decode(converted.json))).toEqual([
      expect.objectContaining({ type: "shader" }),
    ]);
    expect(converted.html).toContain('data-content-type="shader"');
    expect(converted.html).toContain(
      "<figcaption>Localized shader</figcaption>",
    );
    expect(converted.html).not.toContain("<script>");
    expect(converted.text).toContain("void mainImage()");
  });

  it("round-trips every supported shader channel and self-feedback while rejecting mutual cycles", () => {
    const block = shaderBlock();
    const stages = block.content as Array<Record<string, unknown>>;
    const sampler = { filter: "nearest", wrap: "repeat", vflip: true };
    stages[2]!.props = {
      channels: [
        { kind: "buffer", buffer: "A" },
        { kind: "textureFile", fileId: "texture", sampler },
        { kind: "videoFile", fileId: "video", sampler },
        {
          kind: "cubemapFiles",
          fileIds: ["1", "2", "3", "4", "5", "6"],
          sampler,
        },
      ],
    };
    stages[8]!.props = {
      channels: [
        {
          kind: "cubemapPass",
          sampler: { filter: "linear", wrap: "clamp", vflip: false },
        },
        { kind: "none" },
        { kind: "none" },
        { kind: "none" },
      ],
    };

    expect(geulBlocksToProseMirrorDocument([block], "post")).toMatchObject({
      type: "doc",
    });

    const cyclic = structuredClone(block);
    const cyclicStages = cyclic.content as Array<Record<string, unknown>>;
    cyclicStages[2]!.props = {
      channels: [
        { kind: "buffer", buffer: "B" },
        ...Array.from({ length: 3 }, () => ({ kind: "none" })),
      ],
    };
    cyclicStages[3]!.props = {
      channels: [
        { kind: "buffer", buffer: "A" },
        ...Array.from({ length: 3 }, () => ({ kind: "none" })),
      ],
    };
    expect(() => geulBlocksToProseMirrorDocument([cyclic], "post")).toThrow(
      "Invalid rich-text shader buffer dependency cycle",
    );
  });

  it.each([
    ["missing block id", { ...shaderBlock(), id: "" }],
    ["non-array stages", { ...shaderBlock(), content: null }],
    [
      "missing stage",
      {
        ...shaderBlock(),
        content: (shaderBlock().content as unknown[]).slice(1),
      },
    ],
    [
      "invalid stage",
      (() => {
        const block = shaderBlock();
        (block.content as Array<Record<string, unknown>>)[0] = {
          type: "wrong",
          props: {},
          content: [],
        };
        return block;
      })(),
    ],
    [
      "common attrs",
      (() => {
        const block = shaderBlock();
        (block.content as Array<Record<string, unknown>>)[0]!.props = {
          channels: [],
        };
        return block;
      })(),
    ],
    [
      "missing channel attrs",
      (() => {
        const block = shaderBlock();
        (block.content as Array<Record<string, unknown>>)[2]!.props = {};
        return block;
      })(),
    ],
    [
      "inline is not an array",
      {
        id: "paragraph",
        type: "paragraph",
        props: {},
        content: null,
        children: [],
      },
    ],
    [
      "inline item is invalid",
      {
        id: "paragraph",
        type: "paragraph",
        props: {},
        content: [null],
        children: [],
      },
    ],
    [
      "inline type is unsupported",
      {
        id: "paragraph",
        type: "paragraph",
        props: {},
        content: [{ type: "unknown" }],
        children: [],
      },
    ],
    [
      "link is invalid",
      {
        id: "paragraph",
        type: "paragraph",
        props: {},
        content: [{ type: "link", href: 1, content: [] }],
        children: [],
      },
    ],
    [
      "link content is invalid",
      {
        id: "paragraph",
        type: "paragraph",
        props: {},
        content: [{ type: "link", href: "/verify", content: null }],
        children: [],
      },
    ],
    [
      "text is invalid",
      {
        id: "paragraph",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: 1 }],
        children: [],
      },
    ],
    [
      "style is invalid",
      {
        id: "paragraph",
        type: "paragraph",
        props: {},
        content: [{ type: "text", text: "x", styles: { mystery: true } }],
        children: [],
      },
    ],
    [
      "code content is invalid",
      {
        id: "code",
        type: "codeBlock",
        props: { language: "html" },
        content: null,
        children: [],
      },
    ],
    [
      "code item is styled",
      {
        id: "code",
        type: "codeBlock",
        props: { language: "html" },
        content: [{ type: "text", text: "x", styles: { bold: true } }],
        children: [],
      },
    ],
    [
      "source content is invalid",
      { id: "p5", type: "p5Sketch", props: {}, content: null, children: [] },
    ],
    [
      "source item is styled",
      {
        id: "p5",
        type: "p5Sketch",
        props: {},
        content: [{ type: "text", text: "x", styles: { bold: true } }],
        children: [],
      },
    ],
    [
      "table content is invalid",
      { id: "table", type: "table", props: {}, content: null, children: [] },
    ],
    [
      "table row is invalid",
      {
        id: "table",
        type: "table",
        props: {},
        content: { type: "tableContent", rows: [null] },
        children: [],
      },
    ],
    [
      "table cell is invalid",
      {
        id: "table",
        type: "table",
        props: {},
        content: { type: "tableContent", rows: [{ cells: [null] }] },
        children: [],
      },
    ],
  ])("rejects malformed durable executable input: %s", (_name, block) => {
    expect(() => geulBlocksToProseMirrorDocument([block], "post")).toThrow();
  });

  it("normalizes an empty legacy executable source to empty text content", () => {
    const legacy = {
      id: "legacy-p5",
      type: "p5Sketch",
      props: { source: "" },
      content: [],
      children: [],
    };
    expect(geulBlocksToProseMirrorDocument([legacy], "post")).toMatchObject({
      content: [{ content: [{ content: [{ content: [] }] }] }],
    });

    expect(
      geulBlocksToProseMirrorDocument(
        [
          {
            id: "empty-p5",
            type: "p5Sketch",
            content: [{ type: "text", text: "", styles: {} }],
          },
        ],
        "post",
      ),
    ).toMatchObject({
      content: [{ content: [{ content: [{ content: [] }] }] }],
    });
  });

  it("rejects shader buffer stages without required channel state", () => {
    const document = executableDocument("shader");
    for (const stage of document.content![0]!.content![0]!.content![0]!.content!.slice(
      2,
      6,
    )) {
      delete stage.attrs;
    }

    expect(() => prosemirrorJsonToGeulBlocks(document, "post")).toThrow(
      "Invalid rich-text shaderBufferA attribute value: channels",
    );
  });

  it("rejects non-object shader channel values", () => {
    const document = executableDocument("shader");
    document.content![0]!.content![0]!.content![0]!.content![2]!.attrs!.channels =
      [null, { kind: "none" }, { kind: "none" }, { kind: "none" }];

    expect(() => prosemirrorJsonToGeulBlocks(document, "post")).toThrow(
      "Invalid rich-text shaderBufferA attribute value: channels",
    );
  });

  it("imports a non-empty legacy durable source without explicit content", () => {
    expect(
      geulBlocksToProseMirrorDocument(
        [
          {
            id: "legacy-three",
            type: "threeScene",
            props: { source: "legacyThree();" },
          },
        ],
        "post",
      ),
    ).toMatchObject({
      content: [
        { content: [{ content: [{ content: [{ text: "legacyThree();" }] }] }] },
      ],
    });
  });
});
