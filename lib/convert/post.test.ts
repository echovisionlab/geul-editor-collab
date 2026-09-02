import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { convertDocumentToHtml, convertPostDocumentToHtml } from "./post.ts";
import { postEditorSchema } from "./schema.ts";
import { writeGeulBlocks } from "./test-helpers.ts";

describe("convertDocumentToHtml", () => {
  it("materializes empty documents deterministically", async () => {
    const state = Buffer.from(
      "AgbTsLX1CwBHlJ+05ggCAwpibG9ja0dyb3VwBwDTsLX1CwADDmJsb2NrQ29udGFpbmVyBwDTsLX1CwEDCXBhcmFncmFwaCgA07C19QsCD2JhY2tncm91bmRDb2xvcgF3B2RlZmF1bHQoANOwtfULAgl0ZXh0Q29sb3IBdwdkZWZhdWx0KADTsLX1CwINdGV4dEFsaWdubWVudAF3BGxlZnQDlJ+05ggAKAEQdHJhbnNsYXRpb24tbWV0YQV0aXRsZQF3ACgBEHRyYW5zbGF0aW9uLW1ldGEHc3VtbWFyeQF3AAEBDmRvY3VtZW50LXN0b3JlAQGUn7TmCAECAQ==",
      "base64",
    );

    const first = await convertDocumentToHtml(state);
    const second = await convertDocumentToHtml(state);

    expect(second).toEqual(first);
    expect(JSON.parse(new TextDecoder().decode(first.json))).toEqual([
      expect.objectContaining({ id: "00000000-0000-4000-8000-000000000000" }),
    ]);
  });

  it("keeps truly empty Yjs documents empty", async () => {
    const document = new Y.Doc();
    const converted = await convertDocumentToHtml(
      Y.encodeStateAsUpdate(document),
    );
    expect(JSON.parse(new TextDecoder().decode(converted.json))).toEqual([]);
  });

  it("materializes posts into a bare block array", async () => {
    const contentDocument = new Y.Doc();
    const converted = await convertPostDocumentToHtml(
      Y.encodeStateAsUpdate(contentDocument),
    );

    expect(JSON.parse(new TextDecoder().decode(converted.json))).toEqual([]);
  });

  it("preserves standalone external-video link layout and link content in Post JSON and HTML", async () => {
    const contentDocument = new Y.Doc();
    writeGeulBlocks(
      contentDocument,
      "document-store",
      [
        {
          id: "post-external-video-link",
          type: "paragraph",
          props: {
            backgroundColor: "default",
            textColor: "default",
            textAlignment: "center",
            previewWidth: "68",
            aspectRatio: "9:16",
          },
          content: [
            {
              type: "link",
              href: "https://www.youtube.com/shorts/dQw4w9WgXcQ",
              content: [
                { type: "text", text: "Vertical field recording", styles: {} },
              ],
            },
          ],
          children: [],
        },
      ],
      postEditorSchema,
    );

    const converted = await convertPostDocumentToHtml(
      Y.encodeStateAsUpdate(contentDocument),
    );
    const blocks = JSON.parse(
      new TextDecoder().decode(converted.json),
    ) as Array<{
      props: Record<string, unknown>;
      content: unknown[];
    }>;

    expect(blocks[0]).toMatchObject({
      type: "paragraph",
      props: {
        previewWidth: "68",
        textAlignment: "center",
        aspectRatio: "9:16",
      },
      content: [
        {
          type: "link",
          href: "https://www.youtube.com/shorts/dQw4w9WgXcQ",
          content: [
            expect.objectContaining({ text: "Vertical field recording" }),
          ],
        },
      ],
    });
    expect(converted.html).toContain('data-preview-width="68"');
    expect(converted.html).toContain('data-aspect-ratio="9:16"');
    expect(converted.html).toContain("text-align: center");
    expect(converted.html).toContain(
      'href="https://www.youtube.com/shorts/dQw4w9WgXcQ"',
    );
    expect(converted.html).toContain(">Vertical field recording</a>");
  });

  it("rejects misplaced layout fields before Post conversion", async () => {
    const contentDocument = new Y.Doc();
    contentDocument.getMap("retired-settings").set("footer", "pinned");

    await expect(
      convertPostDocumentToHtml(Y.encodeStateAsUpdate(contentDocument)),
    ).rejects.toThrow(
      "Locale post Yjs must not contain document layout fields",
    );
  });
});
