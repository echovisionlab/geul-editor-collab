import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  CollaborativeDocumentType,
  createDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import {
  materializeEmailLayoutUnits,
  setEmailLayoutLocaleValue,
} from "@echovisionlab/geul-common/collaboration/email-layout";
import { emailLayoutHandler } from "./email-layout.ts";

vi.mock("../lib/api/email-layout.ts", () => ({
  loadEmailLayoutDocument: vi.fn(),
  saveEmailLayoutDocument: vi.fn().mockResolvedValue({
    success: true,
    locale: "en",
    documentRevision: "20000000-0000-4000-8000-000000000002",
  }),
}));

describe("emailLayoutHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  const ids = new Map<string, string>();
  const revision = (suffix: number) =>
    `20000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
  function entityId(key: string): string {
    let value = ids.get(key);
    if (!value) {
      value = revision(ids.size + 100);
      ids.set(key, value);
    }
    return value;
  }
  function room(key: string, locale = "en"): string {
    return createDocumentName(
      CollaborativeDocumentType.EMAIL_LAYOUT,
      entityId(key),
      locale,
    );
  }
  async function load(
    key: string,
    locale = "en",
    sourceLocale = "en",
    documentRevision = revision(1),
    targetRevision?: string,
    contentHtml = "<main>source</main>",
    localeValues: Array<{ handle: string; value: string }> = [],
  ) {
    const { loadEmailLayoutDocument } =
      await import("../lib/api/email-layout.ts");
    vi.mocked(loadEmailLayoutDocument).mockResolvedValueOnce({
      contentHtml,
      contentText: "source",
      sourceLocale,
      locale,
      documentRevision,
      ...(targetRevision === undefined ? {} : { targetRevision }),
      units:
        locale === sourceLocale
          ? []
          : [
              {
                handle: "title-unit",
                kind: "text" as const,
                element: "h1",
                attribute: "",
                order: 0,
                sourceValue: "Source title",
              },
            ],
      localeValues,
    });
    return emailLayoutHandler.load(room(key, locale));
  }

  it("materializes canonical HTML into transient Yjs state", async () => {
    const state = await load("layout-1");
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(state ?? new Uint8Array()));
    expect(document.getText("html-content").toString()).toBe(
      "<main>source</main>",
    );
  });

  it("stores source HTML under the loaded document revision", async () => {
    const { saveEmailLayoutDocument } =
      await import("../lib/api/email-layout.ts");
    await load("source");
    const document = new Y.Doc();
    document.getText("html-content").insert(0, "<main>{{content}}</main>");

    await emailLayoutHandler.store(room("source"), document, {
      contributorMemberIds: ["member-1"],
    });

    expect(saveEmailLayoutDocument).toHaveBeenCalledWith({
      emailLayoutId: entityId("source"),
      locale: "en",
      contentHtml: "<main>{{content}}</main>",
      contributorMemberIds: ["member-1"],
      expectedDocumentRevision: revision(1),
    });
  });

  it("stores an exact target with both revision fences and advances the tuple", async () => {
    const { saveEmailLayoutDocument } =
      await import("../lib/api/email-layout.ts");
    const state = await load("target", "ko", "en", revision(1), revision(10));
    vi.mocked(saveEmailLayoutDocument)
      .mockResolvedValueOnce({
        success: true,
        locale: "ko",
        documentRevision: revision(1),
        targetRevision: revision(11),
      })
      .mockResolvedValueOnce({
        success: true,
        locale: "ko",
        documentRevision: revision(1),
        targetRevision: revision(12),
      });
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(state ?? new Uint8Array()));
    setEmailLayoutLocaleValue(document, "title-unit", "번역 제목");

    await emailLayoutHandler.store(room("target", "ko"), document, {
      contributorMemberIds: ["member-1"],
    });
    await emailLayoutHandler.store(room("target", "ko"), document, {
      contributorMemberIds: ["member-1"],
    });

    expect(saveEmailLayoutDocument).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        expectedDocumentRevision: revision(1),
        expectedTargetRevision: revision(10),
        localeValues: [{ handle: "title-unit", value: "번역 제목" }],
      }),
    );
    expect(saveEmailLayoutDocument).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        expectedDocumentRevision: revision(1),
        expectedTargetRevision: revision(11),
      }),
    );
  });

  it("hydrates target units without materializing shared HTML", async () => {
    const state = await load(
      "target-units",
      "ko",
      "en",
      revision(1),
      revision(10),
      "",
    );
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(state ?? new Uint8Array()));

    expect(document.getText("html-content").toString()).toBe("");
    expect(materializeEmailLayoutUnits(document)).toEqual([
      expect.objectContaining({
        handle: "title-unit",
        sourceValue: "Source title",
        value: "Source title",
        localeValuePresent: false,
      }),
    ]);
  });

  it("hydrates explicitly present target values", async () => {
    const state = await load(
      "target-values",
      "ko",
      "en",
      revision(1),
      revision(10),
      "",
      [{ handle: "title-unit", value: "" }],
    );
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(state ?? new Uint8Array()));

    expect(materializeEmailLayoutUnits(document)).toEqual([
      expect.objectContaining({
        handle: "title-unit",
        value: "",
        localeValuePresent: true,
      }),
    ]);
  });

  it("hydrates explicitly empty canonical HTML", async () => {
    const state = await load("empty", "en", "en", revision(1), undefined, "");
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(state ?? new Uint8Array()));
    expect(document.getText("html-content").toString()).toBe("");
  });

  it("fails closed without exact load authority", async () => {
    const { loadEmailLayoutDocument } =
      await import("../lib/api/email-layout.ts");
    vi.mocked(loadEmailLayoutDocument)
      .mockResolvedValueOnce({
        sourceLocale: "",
        locale: "en",
        documentRevision: revision(1),
        units: [],
        localeValues: [],
      })
      .mockResolvedValueOnce({
        sourceLocale: "en",
        locale: "en",
        documentRevision: "",
        units: [],
        localeValues: [],
      });
    await expect(
      emailLayoutHandler.load(room("missing-source")),
    ).rejects.toThrow("source locale is missing");
    await expect(
      emailLayoutHandler.load(room("missing-revision")),
    ).rejects.toThrow("document revision is missing");
    await expect(
      emailLayoutHandler.store(room("never-loaded"), new Y.Doc(), {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("reload before saving");
  });

  it("rejects mismatched or incomplete save acknowledgements", async () => {
    const { saveEmailLayoutDocument } =
      await import("../lib/api/email-layout.ts");
    await load("bad-source");
    vi.mocked(saveEmailLayoutDocument).mockResolvedValueOnce({
      success: true,
      locale: "ko",
      documentRevision: revision(2),
    });
    await expect(
      emailLayoutHandler.store(room("bad-source"), new Y.Doc(), {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("response locale mismatch");

    await load("bad-target", "ko", "en", revision(1), revision(10));
    vi.mocked(saveEmailLayoutDocument).mockResolvedValueOnce({
      success: true,
      locale: "ko",
      documentRevision: revision(1),
    });
    await expect(
      emailLayoutHandler.store(room("bad-target", "ko"), new Y.Doc(), {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("target revision missing");
  });

  it("rejects missing revisions and source acknowledgements with target state", async () => {
    const { saveEmailLayoutDocument } =
      await import("../lib/api/email-layout.ts");
    await load("missing-save-revision");
    vi.mocked(saveEmailLayoutDocument).mockResolvedValueOnce({
      success: true,
      locale: "en",
      documentRevision: "",
    });
    await expect(
      emailLayoutHandler.store(room("missing-save-revision"), new Y.Doc(), {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("document revision missing");

    await load("source-target-revision");
    vi.mocked(saveEmailLayoutDocument).mockResolvedValueOnce({
      success: true,
      locale: "en",
      documentRevision: revision(2),
      targetRevision: revision(3),
    });
    await expect(
      emailLayoutHandler.store(room("source-target-revision"), new Y.Doc(), {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("source collaboration returned target revision");
  });

  it("rejects a load locale mismatch and materializes missing HTML as empty", async () => {
    const { loadEmailLayoutDocument } =
      await import("../lib/api/email-layout.ts");
    vi.mocked(loadEmailLayoutDocument)
      .mockResolvedValueOnce({
        sourceLocale: "en",
        locale: "ko",
        documentRevision: revision(1),
        units: [],
        localeValues: [],
      })
      .mockResolvedValueOnce({
        sourceLocale: "en",
        locale: "en",
        documentRevision: revision(1),
        units: [],
        localeValues: [],
      });

    await expect(
      emailLayoutHandler.load(room("locale-mismatch")),
    ).rejects.toThrow("response locale mismatch");
    const state = await emailLayoutHandler.load(room("missing-html"));
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(state ?? new Uint8Array()));
    expect(document.getText("html-content").toString()).toBe("");
  });

  it("fails closed when its independently cached revision is absent", async () => {
    const documentName = room("missing-cached-revision");
    await load("missing-cached-revision");
    const originalGet = Map.prototype.get;
    let reads = 0;
    const mapGet = vi.spyOn(Map.prototype, "get");
    mapGet.mockImplementation(function (
      this: Map<unknown, unknown>,
      key: unknown,
    ) {
      if (key !== documentName) return originalGet.call(this, key);
      reads += 1;
      return reads === 2 ? undefined : originalGet.call(this, key);
    });

    try {
      await expect(
        emailLayoutHandler.store(documentName, new Y.Doc(), {
          contributorMemberIds: ["member-1"],
        }),
      ).rejects.toThrow("document revision was not captured");
    } finally {
      mapGet.mockRestore();
    }
  });

  it("rejects missing and mixed mutation actors before issuing a request", async () => {
    const { saveEmailLayoutDocument } =
      await import("../lib/api/email-layout.ts");
    await load("actors");
    const documentName = room("actors");
    await expect(
      emailLayoutHandler.store(documentName, new Y.Doc()),
    ).rejects.toThrow("collaboration_mutation_actor_required");
    await expect(
      emailLayoutHandler.store(documentName, new Y.Doc(), {
        contributorMemberIds: ["member-1", "member-2"],
      }),
    ).rejects.toThrow("collaboration_mutation_actor_mixed");
    expect(saveEmailLayoutDocument).not.toHaveBeenCalled();
  });
});
