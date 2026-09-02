import { afterEach, describe, expect, it, vi } from "vitest";
import { formRootTitleTarget } from "@echovisionlab/geul-proto/intra/form_locale_catalog.ts";
import { loadFormDocument, saveFormDocument } from "./form.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Form canonical collaboration API", () => {
  it("sends canonical metadata and exact presence without a Yjs payload", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          locale: "en",
          documentRevision: "document-revision",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await saveFormDocument({
      formId: "form-1",
      locale: "en",
      fields: { title: "Contact", schema: { id: "schema_A", steps: [] } },
      presentLocaleValues: [formRootTitleTarget()],
      contributorMemberIds: ["member-1"],
      expectedDocumentRevision: "document-revision",
    });

    const request = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string) as {
      meta?: { title?: string; schema?: string };
      presentLocaleValues?: unknown[];
      yjsState?: unknown;
    };
    expect(request.meta).toEqual({
      title: "Contact",
      schema: JSON.stringify({ id: "schema_A", steps: [] }),
    });
    expect(request.presentLocaleValues).toHaveLength(1);
    expect(request).not.toHaveProperty("yjsState");
  });

  it("omits absent optional canonical metadata", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          locale: "en",
          documentRevision: "document-revision",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await saveFormDocument({
      formId: "form-1",
      locale: "en",
      fields: { title: "Contact" },
      presentLocaleValues: [formRootTitleTarget()],
      contributorMemberIds: ["member-1"],
      expectedDocumentRevision: "document-revision",
    });

    const request = JSON.parse(fetch.mock.calls[0]?.[1]?.body as string) as {
      meta?: { title?: string; schema?: string };
    };
    expect(request.meta).toEqual({ title: "Contact" });
  });

  it("loads exact source and sparse requested canonical values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            sourceMetadata: {
              title: "Source",
              schema: JSON.stringify({ id: "schema_A", steps: [] }),
            },
            localeMetadata: {
              schema: JSON.stringify({ id: "schema_A", steps: [] }),
            },
            sourceLocale: "en",
            locale: "ko",
            localeExists: true,
            presentLocaleValues: [],
            documentRevision: "document-revision",
            targetRevision: "target-revision",
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      loadFormDocument({ formId: "form-1", locale: "ko" }),
    ).resolves.toEqual({
      source: {
        title: "Source",
        schema: { id: "schema_A", steps: [] },
      },
      requested: { schema: { id: "schema_A", steps: [] } },
      sourceLocale: "en",
      locale: "ko",
      localeExists: true,
      presentLocaleValues: [],
      documentRevision: "document-revision",
      targetRevision: "target-revision",
    });
  });
});
