import { formRootTitleTarget } from "@echovisionlab/geul-proto/intra/form_locale_catalog.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  CollaborativeDocumentType,
  createDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import type { FormCollabFields } from "@echovisionlab/geul-common/collaboration/form";
import { clearTransientDocumentState } from "../lib/transient-document-state.ts";
import { formHandler } from "./form.ts";

vi.mock("../lib/api/form.ts", () => ({
  loadFormDocument: vi.fn(),
  saveFormDocument: vi.fn(),
}));
vi.mock("../lib/logger.ts", () => ({ logger: { error: vi.fn() } }));

const revision = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;

function source(title = "Contact"): FormCollabFields {
  return {
    title,
    schema: { id: "schema_A", steps: [] },
  };
}

function decode(state: Buffer): Y.Doc {
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  return document;
}

describe("formHandler canonical collaboration persistence", () => {
  let sequence = 0;

  beforeEach(async () => {
    sequence += 1;
    vi.clearAllMocks();
    const { saveFormDocument } = await import("../lib/api/form.ts");
    vi.mocked(saveFormDocument).mockImplementation(async (request) => ({
      success: true,
      locale: request.locale,
      documentRevision: revision(sequence + 100),
      ...(request.locale === "en" ? {} : { targetRevision: revision(200) }),
    }));
  });

  function room(locale = "en"): string {
    return createDocumentName(
      CollaborativeDocumentType.FORM,
      revision(sequence + 1),
      locale,
    );
  }

  async function load(
    locale = "en",
    overrides: Partial<{
      source: FormCollabFields;
      requested: FormCollabFields;
      sourceLocale: string;
      localeExists: boolean;
      presentLocaleValues: ReturnType<typeof formRootTitleTarget>[];
      documentRevision: string;
      targetRevision: string;
    }> = {},
  ): Promise<Buffer> {
    const { loadFormDocument } = await import("../lib/api/form.ts");
    const sourceFields = overrides.source ?? source();
    vi.mocked(loadFormDocument).mockResolvedValueOnce({
      source: sourceFields,
      requested: overrides.requested ?? sourceFields,
      sourceLocale: overrides.sourceLocale ?? "en",
      locale,
      localeExists: overrides.localeExists ?? true,
      presentLocaleValues: overrides.presentLocaleValues ?? [
        formRootTitleTarget(),
      ],
      documentRevision: overrides.documentRevision ?? revision(1),
      ...(overrides.targetRevision === undefined
        ? locale === "en"
          ? {}
          : { targetRevision: revision(2) }
        : { targetRevision: overrides.targetRevision }),
    });
    return (await formHandler.load(room(locale)))!;
  }

  it("hydrates source canonical state and saves canonical post-state without Yjs bytes", async () => {
    const { saveFormDocument } = await import("../lib/api/form.ts");
    const document = decode(await load());
    document.getMap("form-fields").set("title", "Updated");

    await formHandler.store(room(), document, {
      contributorMemberIds: ["member-1"],
    });

    expect(saveFormDocument).toHaveBeenCalledWith({
      formId: revision(sequence + 1),
      locale: "en",
      fields: source("Updated"),
      presentLocaleValues: [formRootTitleTarget()],
      contributorMemberIds: ["member-1"],
      expectedDocumentRevision: revision(1),
    });
    expect(vi.mocked(saveFormDocument).mock.calls[0]?.[0]).not.toHaveProperty(
      "yjsState",
    );
  });

  it("does not persist the first transient hydration or require an actor for it", async () => {
    const { saveFormDocument } = await import("../lib/api/form.ts");
    const document = decode(await load());

    await expect(formHandler.store(room(), document)).resolves.toBeUndefined();
    expect(saveFormDocument).not.toHaveBeenCalled();
  });

  it("keeps target canonical fields over source fallback and fences target saves", async () => {
    const { saveFormDocument } = await import("../lib/api/form.ts");
    const document = decode(
      await load("ko", {
        requested: source("연락처"),
        targetRevision: revision(9),
      }),
    );
    expect(document.getMap("form-fields").get("title")).toBe("연락처");

    await formHandler.store(room("ko"), document);
    expect(saveFormDocument).not.toHaveBeenCalled();

    document.getMap("form-fields").set("title", "수정됨");
    await formHandler.store(room("ko"), document, {
      contributorMemberIds: ["member-1"],
    });
    expect(saveFormDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: "ko",
        fields: source("수정됨"),
        expectedDocumentRevision: revision(1),
        expectedTargetRevision: revision(9),
      }),
    );
  });

  it("fails closed when the requested target locale does not exist", async () => {
    await expect(
      load("ko", {
        requested: {},
        localeExists: false,
        presentLocaleValues: [],
        targetRevision: revision(9),
      }),
    ).rejects.toThrow("form_collaboration:target_missing");
  });

  it("rejects invalid transient Form schema before making a save request", async () => {
    const { saveFormDocument } = await import("../lib/api/form.ts");
    const document = decode(await load());
    document.getMap("form-fields").set("schema", "{broken");

    await expect(
      formHandler.store(room(), document, {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow('Failed to parse JSON for form field "schema"');
    expect(saveFormDocument).not.toHaveBeenCalled();
  });

  it("retires cached canonical state and requires a fresh room load", async () => {
    const { saveFormDocument } = await import("../lib/api/form.ts");
    const documentName = room();
    const stale = decode(
      await load("en", {
        source: source("Before retire"),
        documentRevision: revision(31),
      }),
    );

    clearTransientDocumentState(documentName);
    stale.getMap("form-fields").set("title", "Stale edit");
    await expect(
      formHandler.store(documentName, stale, {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("reload before saving");
    expect(saveFormDocument).not.toHaveBeenCalled();

    const reloaded = decode(
      await load("en", {
        source: source("After retire"),
        documentRevision: revision(32),
      }),
    );
    reloaded.getMap("form-fields").set("title", "Fresh edit");
    await formHandler.store(documentName, reloaded, {
      contributorMemberIds: ["member-1"],
    });
    expect(saveFormDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDocumentRevision: revision(32),
        fields: source("Fresh edit"),
      }),
    );
  });

  it("rejects invalid canonical load authority tuples", async () => {
    const { loadFormDocument } = await import("../lib/api/form.ts");
    const canonical = {
      source: source(),
      requested: source(),
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      presentLocaleValues: [formRootTitleTarget()],
      documentRevision: revision(1),
    };
    vi.mocked(loadFormDocument)
      .mockResolvedValueOnce({ ...canonical, sourceLocale: "" })
      .mockResolvedValueOnce({ ...canonical, locale: "ko" })
      .mockResolvedValueOnce({ ...canonical, documentRevision: "" })
      .mockResolvedValueOnce({ ...canonical, targetRevision: revision(2) })
      .mockResolvedValueOnce({
        ...canonical,
        requested: source("연락처"),
        locale: "ko",
      });

    await expect(formHandler.load(room())).rejects.toThrow(
      "source locale is missing",
    );
    await expect(formHandler.load(room())).rejects.toThrow(
      "response locale mismatch",
    );
    await expect(formHandler.load(room())).rejects.toThrow(
      "document revision is missing",
    );
    await expect(formHandler.load(room())).rejects.toThrow(
      "source collaboration returned target revision",
    );
    await expect(formHandler.load(room("ko"))).rejects.toThrow(
      "target revision missing",
    );
  });

  it("logs and rethrows invalid save acknowledgements and non-Error failures", async () => {
    const { saveFormDocument } = await import("../lib/api/form.ts");
    const document = decode(await load());
    document.getMap("form-fields").set("title", "Changed");
    vi.mocked(saveFormDocument)
      .mockResolvedValueOnce({
        success: true,
        locale: "ko",
        documentRevision: revision(2),
        targetRevision: revision(3),
      })
      .mockRejectedValueOnce("provider unavailable");

    await expect(
      formHandler.store(room(), document, {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toThrow("response locale mismatch");
    await expect(
      formHandler.store(room(), document, {
        contributorMemberIds: ["member-1"],
      }),
    ).rejects.toBe("provider unavailable");
  });

  it("fails closed when independently cached source fields or revision are absent", async () => {
    const documentName = room();
    const document = decode(await load());
    document.getMap("form-fields").set("title", "Changed");
    const originalGet = Map.prototype.get;

    async function expectMissingRead(readToHide: number, message: string) {
      let reads = 0;
      const mapGet = vi.spyOn(Map.prototype, "get");
      mapGet.mockImplementation(function (
        this: Map<unknown, unknown>,
        key: unknown,
      ) {
        if (key !== documentName) return originalGet.call(this, key);
        reads += 1;
        return reads === readToHide ? undefined : originalGet.call(this, key);
      });
      try {
        await expect(
          formHandler.store(documentName, document, {
            contributorMemberIds: ["member-1"],
          }),
        ).rejects.toThrow(message);
      } finally {
        mapGet.mockRestore();
      }
    }

    await expectMissingRead(2, "source fields were not captured");
    await expectMissingRead(4, "document revision was not captured");
  });
});
