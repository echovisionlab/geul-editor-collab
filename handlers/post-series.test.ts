import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  CollaborativeDocumentType,
  createDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import {
  materializePostSeriesLocaleFields,
  setPostSeriesLocaleField,
} from "@echovisionlab/geul-common/collaboration/post-series";
import { postSeriesHandler } from "./post-series.ts";

vi.mock("../lib/api/post-series.ts", () => ({
  loadPostSeriesDocument: vi.fn(),
  savePostSeriesDocument: vi.fn(),
}));

const seriesId = "30000000-0000-4000-8000-000000000001";
const revision = (suffix: number) =>
  `30000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const room = (locale: string) =>
  createDocumentName(CollaborativeDocumentType.POST_SERIES, seriesId, locale);

describe("postSeriesHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hydrates sparse target values and stores exact revision fences", async () => {
    const { loadPostSeriesDocument, savePostSeriesDocument } =
      await import("../lib/api/post-series.ts");
    vi.mocked(loadPostSeriesDocument).mockResolvedValueOnce({
      sourceLocale: "en",
      locale: "ko",
      localeExists: true,
      source: { title: "Series", summary: "Source summary" },
      requested: { title: "시리즈" },
      documentRevision: revision(1),
      targetRevision: revision(2),
    });
    vi.mocked(savePostSeriesDocument).mockResolvedValueOnce({
      locale: "ko",
      documentRevision: revision(1),
      targetRevision: revision(3),
    } as never);

    const update = await postSeriesHandler.load(room("ko"));
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(update ?? new Uint8Array()));
    expect(materializePostSeriesLocaleFields(document)).toEqual({
      title: "시리즈",
      summary: "Source summary",
    });
    setPostSeriesLocaleField(document, "summary", "번역 요약");

    await postSeriesHandler.store(room("ko"), document, {
      contributorMemberIds: ["member-1"],
    });

    expect(savePostSeriesDocument).toHaveBeenCalledWith({
      seriesId,
      locale: "ko",
      requested: { title: "시리즈", summary: "번역 요약" },
      contributorMemberIds: ["member-1"],
      expectedDocumentRevision: revision(1),
      expectedTargetRevision: revision(2),
    });
  });

  it("does not persist an unchanged canonical room", async () => {
    const { loadPostSeriesDocument, savePostSeriesDocument } =
      await import("../lib/api/post-series.ts");
    vi.mocked(loadPostSeriesDocument).mockResolvedValueOnce({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      source: { title: "Series" },
      requested: { title: "Series" },
      documentRevision: revision(4),
    });
    const update = await postSeriesHandler.load(room("en"));
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(update ?? new Uint8Array()));

    await postSeriesHandler.store(room("en"), document, {
      contributorMemberIds: ["member-1"],
    });

    expect(savePostSeriesDocument).not.toHaveBeenCalled();
  });

  it("stores a changed source room without a target fence", async () => {
    const { loadPostSeriesDocument, savePostSeriesDocument } =
      await import("../lib/api/post-series.ts");
    vi.mocked(loadPostSeriesDocument).mockResolvedValueOnce({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      source: { title: "Series" },
      requested: { title: "Series" },
      documentRevision: revision(5),
    });
    vi.mocked(savePostSeriesDocument).mockResolvedValueOnce({
      locale: "en",
      documentRevision: revision(6),
    } as never);
    const update = await postSeriesHandler.load(room("en"));
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(update ?? new Uint8Array()));
    setPostSeriesLocaleField(document, "title", "New series");

    await postSeriesHandler.store(room("en"), document, {
      contributorMemberIds: ["member-1"],
    });

    expect(savePostSeriesDocument).toHaveBeenCalledWith(
      expect.not.objectContaining({
        expectedTargetRevision: expect.anything(),
      }),
    );
  });

  it("rejects malformed load responses and revision tuples", async () => {
    const { loadPostSeriesDocument } =
      await import("../lib/api/post-series.ts");
    const base = {
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      source: { title: "Series" },
      requested: { title: "Series" },
      documentRevision: revision(7),
    };
    vi.mocked(loadPostSeriesDocument)
      .mockResolvedValueOnce({ ...base, sourceLocale: "" })
      .mockResolvedValueOnce({ ...base, locale: "ko" })
      .mockResolvedValueOnce({ ...base, documentRevision: "" })
      .mockResolvedValueOnce({ ...base, targetRevision: revision(8) })
      .mockResolvedValueOnce({
        ...base,
        locale: "ko",
        localeExists: true,
      });

    await expect(postSeriesHandler.load(room("en"))).rejects.toThrow(
      "Invalid Post Series collaboration load response",
    );
    await expect(postSeriesHandler.load(room("en"))).rejects.toThrow(
      "Invalid Post Series collaboration load response",
    );
    await expect(postSeriesHandler.load(room("en"))).rejects.toThrow(
      "Post Series document revision is missing",
    );
    await expect(postSeriesHandler.load(room("en"))).rejects.toThrow(
      "Post Series source returned a target revision",
    );
    await expect(postSeriesHandler.load(room("ko"))).rejects.toThrow(
      "Post Series target revision is missing",
    );
  });

  it("requires prior load authority and validates save acknowledgements", async () => {
    const { loadPostSeriesDocument, savePostSeriesDocument } =
      await import("../lib/api/post-series.ts");
    await expect(
      postSeriesHandler.store(room("fr"), new Y.Doc(), {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("Post Series document was not loaded");

    const loadResponse = {
      sourceLocale: "en",
      locale: "ko",
      localeExists: false,
      source: { title: "Series" },
      requested: {},
      documentRevision: revision(9),
    };
    vi.mocked(loadPostSeriesDocument).mockResolvedValueOnce(loadResponse);
    vi.mocked(savePostSeriesDocument).mockResolvedValueOnce({
      locale: "en",
      documentRevision: revision(10),
    } as never);
    const update = await postSeriesHandler.load(room("ko"));
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(update ?? new Uint8Array()));
    setPostSeriesLocaleField(document, "title", "시리즈");
    await expect(
      postSeriesHandler.store(room("ko"), document, {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("Invalid Post Series collaboration save response");

    vi.mocked(loadPostSeriesDocument).mockResolvedValueOnce(loadResponse);
    vi.mocked(savePostSeriesDocument).mockResolvedValueOnce({
      locale: "ko",
      documentRevision: "",
    } as never);
    const secondUpdate = await postSeriesHandler.load(room("ko"));
    const secondDocument = new Y.Doc();
    Y.applyUpdate(
      secondDocument,
      new Uint8Array(secondUpdate ?? new Uint8Array()),
    );
    setPostSeriesLocaleField(secondDocument, "title", "글 모음");
    await expect(
      postSeriesHandler.store(room("ko"), secondDocument, {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("Invalid Post Series collaboration save response");
  });
});
