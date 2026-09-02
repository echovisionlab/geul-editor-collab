import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateResidentBlockMetadata } from "./resident-block-metadata.ts";
import { updatePageLocaleMetadata } from "../api/page.ts";
import {
  updatePostDocumentMetadata,
  updatePostLocaleMetadata,
} from "../api/post.ts";
import { updateResidentRichTextMetadata } from "../api/resident-block-domain.ts";
import { updateResidentRichTextDocumentMetadata } from "../api/resident-document-metadata.ts";
import { updateWorkLocaleMetadata } from "../api/work.ts";

vi.mock("../api/page.ts", () => ({ updatePageLocaleMetadata: vi.fn() }));
vi.mock("../api/post.ts", () => ({
  updatePostDocumentMetadata: vi.fn(),
  updatePostLocaleMetadata: vi.fn(),
}));
vi.mock("../api/resident-block-domain.ts", () => ({
  updateResidentRichTextMetadata: vi.fn(),
}));
vi.mock("../api/resident-document-metadata.ts", () => ({
  updateResidentRichTextDocumentMetadata: vi.fn(),
}));
vi.mock("../api/work.ts", () => ({ updateWorkLocaleMetadata: vi.fn() }));

const ack = {
  documentRevision: "revision-2",
  changed: true,
  sourceChanged: true,
  changedLocales: ["ko"],
  locale: "ko",
};

describe("resident block metadata routing", () => {
  beforeEach(() => {
    for (const mock of [
      updatePageLocaleMetadata,
      updatePostDocumentMetadata,
      updatePostLocaleMetadata,
      updateResidentRichTextMetadata,
      updateResidentRichTextDocumentMetadata,
      updateWorkLocaleMetadata,
    ])
      vi.mocked(mock)
        .mockReset()
        .mockResolvedValue(ack as never);
  });

  it("routes Post document and source updates without scanning Blocks", async () => {
    await expect(
      updateResidentBlockMetadata(
        "post-1",
        "ko",
        {
          type: "post",
          scope: "document",
          categoryIds: ["category-1"],
          tagIds: ["tag-1"],
        },
        "revision-1",
        undefined,
        ["member-1"],
      ),
    ).resolves.toMatchObject({ changed: true, changedLocales: [] });
    expect(updatePostDocumentMetadata).toHaveBeenCalledOnce();

    await updateResidentBlockMetadata(
      "post-1",
      "ko",
      {
        type: "post",
        scope: "document",
        categoryIds: undefined,
        tagIds: undefined,
      },
      "revision-1",
      undefined,
      [],
    );

    for (const value of [undefined, null, "Text"] as const) {
      await updateResidentBlockMetadata(
        "post-1",
        "ko",
        {
          type: "post",
          scope: "locale",
          title: value,
          summary: value,
        },
        "revision-1",
        undefined,
        ["member-1"],
      );
    }
    expect(updatePostLocaleMetadata).toHaveBeenCalledTimes(3);
  });

  it("routes Page and Work source updates with set, clear, and omitted summary", async () => {
    for (const summary of [undefined, null, "Summary"] as const) {
      await updateResidentBlockMetadata(
        "page-1",
        "ko",
        {
          type: "page",
          title: "Page",
          summary,
        },
        "revision-1",
        undefined,
        ["member-1"],
      );
      await updateResidentBlockMetadata(
        "work-1",
        "ko",
        {
          type: "work",
          sourceTitle: "Work",
          summary,
        },
        "revision-1",
        undefined,
        ["member-1"],
      );
    }
    expect(updatePageLocaleMetadata).toHaveBeenCalledTimes(3);
    expect(updateWorkLocaleMetadata).toHaveBeenCalledTimes(3);
  });

  it("separates Artist and Label document metadata from source metadata", async () => {
    await expect(
      updateResidentBlockMetadata(
        "artist-1",
        "ko",
        {
          type: "artist",
          scope: "document",
          slug: "artist",
        },
        "revision-1",
        undefined,
        ["member-1"],
      ),
    ).resolves.toMatchObject({ changed: true });
    await updateResidentBlockMetadata(
      "label-1",
      "ko",
      {
        type: "label",
        scope: "document",
        slug: "label",
      },
      "revision-1",
      undefined,
      ["member-1"],
    );
    expect(updateResidentRichTextDocumentMetadata).toHaveBeenCalledTimes(2);

    await expect(
      updateResidentBlockMetadata(
        "artist-1",
        "ko",
        {
          type: "artist",
          title: "Artist",
        },
        "revision-1",
        undefined,
        ["member-1"],
      ),
    ).resolves.toMatchObject({
      sourceChanged: true,
      changedLocales: ["ko"],
    });
    expect(updateResidentRichTextMetadata).toHaveBeenCalledOnce();
  });

  it("preserves exact target revisions from every locale metadata gateway", async () => {
    const targetAck = {
      ...ack,
      documentRevision: "revision-1",
      sourceChanged: false,
      locale: "en",
      targetRevision: "tr1_target_2",
    };
    for (const mock of [
      updatePostLocaleMetadata,
      updatePageLocaleMetadata,
      updateWorkLocaleMetadata,
      updateResidentRichTextMetadata,
    ]) {
      vi.mocked(mock).mockResolvedValueOnce(targetAck as never);
    }

    await expect(
      updateResidentBlockMetadata(
        "post-1",
        "en",
        { type: "post", scope: "locale", title: "Post" },
        "revision-1",
        "tr1_target_1",
        ["member-1"],
      ),
    ).resolves.toMatchObject({ targetRevision: "tr1_target_2" });
    await expect(
      updateResidentBlockMetadata(
        "page-1",
        "en",
        { type: "page", title: "Page" },
        "revision-1",
        "tr1_target_1",
        ["member-1"],
      ),
    ).resolves.toMatchObject({ targetRevision: "tr1_target_2" });
    await expect(
      updateResidentBlockMetadata(
        "work-1",
        "en",
        { type: "work", sourceTitle: "Work" },
        "revision-1",
        "tr1_target_1",
        ["member-1"],
      ),
    ).resolves.toMatchObject({ targetRevision: "tr1_target_2" });
    await expect(
      updateResidentBlockMetadata(
        "artist-1",
        "en",
        { type: "artist", title: "Artist" },
        "revision-1",
        "tr1_target_1",
        ["member-1"],
      ),
    ).resolves.toMatchObject({ targetRevision: "tr1_target_2" });
  });
});
