import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  CollaborativeDocumentType,
  createDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import {
  materializeMenuCanonicalItems,
  setMenuLocaleLabel,
} from "@echovisionlab/geul-common/collaboration/menu";
import { menuHandler } from "./menu.ts";

vi.mock("../lib/api/menu.ts", () => ({
  loadMenuDocument: vi.fn(),
  saveMenuDocument: vi.fn(),
}));

const menuId = "40000000-0000-4000-8000-000000000001";
const revision = (suffix: number) =>
  `40000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const room = (locale: string) =>
  createDocumentName(CollaborativeDocumentType.MENU, menuId, locale);
const items = [
  { id: "posts", linkType: "custom", url: "/posts" },
  {
    id: "korean-only",
    linkType: "custom",
    url: "/ko",
    localizationMode: "fixed_locale",
    fixedLocale: "ko",
  },
];

describe("menuHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hydrates locale-owned labels and stores structure with both fences", async () => {
    const { loadMenuDocument, saveMenuDocument } =
      await import("../lib/api/menu.ts");
    vi.mocked(loadMenuDocument).mockResolvedValueOnce({
      sourceLocale: "en",
      locale: "ko",
      localeExists: true,
      name: "Main",
      items,
      sourceLabels: { posts: "Posts" },
      requestedLabels: { "korean-only": "한국어" },
      documentRevision: revision(1),
      targetRevision: revision(2),
    });
    vi.mocked(saveMenuDocument).mockResolvedValueOnce({
      locale: "ko",
      documentRevision: revision(1),
      targetRevision: revision(3),
    } as never);

    const update = await menuHandler.load(room("ko"));
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(update ?? new Uint8Array()));
    expect(
      materializeMenuCanonicalItems(document).map((item) => item.label),
    ).toEqual(["Posts", "한국어"]);
    setMenuLocaleLabel(document, "posts", "게시물");

    await menuHandler.store(room("ko"), document, {
      contributorMemberIds: ["member-1"],
    });

    expect(saveMenuDocument).toHaveBeenCalledWith({
      menuId,
      locale: "ko",
      name: "Main",
      items,
      requestedLabels: { posts: "게시물", "korean-only": "한국어" },
      contributorMemberIds: ["member-1"],
      expectedDocumentRevision: revision(1),
      expectedTargetRevision: revision(2),
    });
  });

  it("does not persist an unchanged source room", async () => {
    const { loadMenuDocument, saveMenuDocument } =
      await import("../lib/api/menu.ts");
    vi.mocked(loadMenuDocument).mockResolvedValueOnce({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items: items.slice(0, 1),
      sourceLabels: { posts: "Posts" },
      requestedLabels: { posts: "Posts" },
      documentRevision: revision(4),
    });
    const update = await menuHandler.load(room("en"));
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(update ?? new Uint8Array()));

    await menuHandler.store(room("en"), document, {
      contributorMemberIds: ["member-1"],
    });

    expect(saveMenuDocument).not.toHaveBeenCalled();
  });

  it("stores a changed source room without a target fence", async () => {
    const { loadMenuDocument, saveMenuDocument } =
      await import("../lib/api/menu.ts");
    vi.mocked(loadMenuDocument).mockResolvedValueOnce({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items: items.slice(0, 1),
      sourceLabels: { posts: "Posts" },
      requestedLabels: { posts: "Posts" },
      documentRevision: revision(5),
    });
    vi.mocked(saveMenuDocument).mockResolvedValueOnce({
      locale: "en",
      documentRevision: revision(6),
    } as never);
    const update = await menuHandler.load(room("en"));
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(update ?? new Uint8Array()));
    setMenuLocaleLabel(document, "posts", "Articles");

    await menuHandler.store(room("en"), document, {
      contributorMemberIds: ["member-1"],
    });

    expect(saveMenuDocument).toHaveBeenCalledWith(
      expect.not.objectContaining({
        expectedTargetRevision: expect.anything(),
      }),
    );
  });

  it("rejects malformed load responses and revision tuples", async () => {
    const { loadMenuDocument } = await import("../lib/api/menu.ts");
    const base = {
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items: [],
      sourceLabels: {},
      requestedLabels: {},
      documentRevision: revision(7),
    };
    vi.mocked(loadMenuDocument)
      .mockResolvedValueOnce({ ...base, sourceLocale: "" })
      .mockResolvedValueOnce({ ...base, locale: "ko" })
      .mockResolvedValueOnce({ ...base, documentRevision: "" })
      .mockResolvedValueOnce({ ...base, targetRevision: revision(8) })
      .mockResolvedValueOnce({
        ...base,
        locale: "ko",
        localeExists: true,
      });

    await expect(menuHandler.load(room("en"))).rejects.toThrow(
      "Invalid Menu collaboration load response",
    );
    await expect(menuHandler.load(room("en"))).rejects.toThrow(
      "Invalid Menu collaboration load response",
    );
    await expect(menuHandler.load(room("en"))).rejects.toThrow(
      "Menu document revision is missing",
    );
    await expect(menuHandler.load(room("en"))).rejects.toThrow(
      "Menu source returned a target revision",
    );
    await expect(menuHandler.load(room("ko"))).rejects.toThrow(
      "Menu target revision is missing",
    );
  });

  it("requires prior load authority and validates save acknowledgements", async () => {
    const { loadMenuDocument, saveMenuDocument } =
      await import("../lib/api/menu.ts");
    await expect(
      menuHandler.store(room("fr"), new Y.Doc(), {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("Menu document was not loaded");

    const loadResponse = {
      sourceLocale: "en",
      locale: "ko",
      localeExists: false,
      name: "Main",
      items: items.slice(0, 1),
      sourceLabels: { posts: "Posts" },
      requestedLabels: {},
      documentRevision: revision(9),
    };
    vi.mocked(loadMenuDocument).mockResolvedValueOnce(loadResponse);
    vi.mocked(saveMenuDocument).mockResolvedValueOnce({
      locale: "en",
      documentRevision: revision(10),
    } as never);
    const update = await menuHandler.load(room("ko"));
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(update ?? new Uint8Array()));
    setMenuLocaleLabel(document, "posts", "게시물");
    await expect(
      menuHandler.store(room("ko"), document, {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("Invalid Menu collaboration save response");

    vi.mocked(loadMenuDocument).mockResolvedValueOnce(loadResponse);
    vi.mocked(saveMenuDocument).mockResolvedValueOnce({
      locale: "ko",
      documentRevision: "",
    } as never);
    const secondUpdate = await menuHandler.load(room("ko"));
    const secondDocument = new Y.Doc();
    Y.applyUpdate(
      secondDocument,
      new Uint8Array(secondUpdate ?? new Uint8Array()),
    );
    setMenuLocaleLabel(secondDocument, "posts", "글");
    await expect(
      menuHandler.store(room("ko"), secondDocument, {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("Invalid Menu collaboration save response");
  });
});
