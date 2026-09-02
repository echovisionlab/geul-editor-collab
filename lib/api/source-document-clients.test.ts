import { create } from "@bufbuild/protobuf";
import { AIDocumentFieldTargetSchema } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadEmailLayoutDocument,
  saveEmailLayoutDocument,
} from "./email-layout.ts";
import { loadFormDocument, saveFormDocument } from "./form.ts";
import { loadMenuDocument, saveMenuDocument } from "./menu.ts";
import {
  loadPostSeriesDocument,
  savePostSeriesDocument,
} from "./post-series.ts";
import { postInternalApi } from "./transport.ts";

vi.mock("./transport.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transport.ts")>();
  return {
    ...actual,
    postInternalApi: vi.fn(),
    throwIfCollaborationResourceNotFound: vi.fn(),
  };
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Broken",
    headers: { "content-type": "application/json" },
  });
}

function formRootTitleTarget() {
  return create(AIDocumentFieldTargetSchema, {
    owner: { case: "blockHandle", value: "document" },
    fieldHandle: "title",
  });
}

describe("canonical document API clients", () => {
  beforeEach(() => vi.mocked(postInternalApi).mockReset());

  it("round-trips Post Series sparse fields and revision fences", async () => {
    vi.mocked(postInternalApi)
      .mockResolvedValueOnce(
        json({
          locale: "ko",
          documentRevision: "doc-1",
          targetRevision: "target-2",
        }),
      )
      .mockResolvedValueOnce(
        json({
          sourceLocale: "en",
          locale: "ko",
          localeExists: true,
          source: { title: "Series", summary: "Summary" },
          requested: { title: "시리즈" },
          documentRevision: "doc-1",
          targetRevision: "target-2",
        }),
      );

    await expect(
      savePostSeriesDocument({
        seriesId: "series-1",
        locale: "ko",
        requested: { title: "시리즈" },
        contributorMemberIds: ["member-1"],
        expectedDocumentRevision: "doc-1",
        expectedTargetRevision: "target-1",
      }),
    ).resolves.toMatchObject({ targetRevision: "target-2" });
    await expect(
      loadPostSeriesDocument({ seriesId: "series-1", locale: "ko" }),
    ).resolves.toEqual({
      sourceLocale: "en",
      locale: "ko",
      localeExists: true,
      source: { title: "Series", summary: "Summary" },
      requested: { title: "시리즈" },
      documentRevision: "doc-1",
      targetRevision: "target-2",
    });
  });

  it("round-trips Menu structure, sparse labels, and revision fences", async () => {
    vi.mocked(postInternalApi)
      .mockResolvedValueOnce(
        json({
          locale: "ko",
          documentRevision: "doc-1",
          targetRevision: "target-2",
        }),
      )
      .mockResolvedValueOnce(
        json({
          sourceLocale: "en",
          locale: "ko",
          localeExists: true,
          name: "Main",
          items: [{ id: "posts", linkType: "custom", url: "/posts" }],
          sourceLabels: { posts: "Posts" },
          requestedLabels: { posts: "게시물" },
          documentRevision: "doc-1",
          targetRevision: "target-2",
        }),
      );
    const items = [{ id: "posts", linkType: "custom", url: "/posts" }];

    await expect(
      saveMenuDocument({
        menuId: "menu-1",
        locale: "ko",
        name: "Main",
        items,
        requestedLabels: { posts: "게시물" },
        contributorMemberIds: ["member-1"],
        expectedDocumentRevision: "doc-1",
        expectedTargetRevision: "target-1",
      }),
    ).resolves.toMatchObject({ targetRevision: "target-2" });
    await expect(
      loadMenuDocument({ menuId: "menu-1", locale: "ko" }),
    ).resolves.toEqual({
      sourceLocale: "en",
      locale: "ko",
      localeExists: true,
      name: "Main",
      items,
      sourceLabels: { posts: "Posts" },
      requestedLabels: { posts: "게시물" },
      documentRevision: "doc-1",
      targetRevision: "target-2",
    });
  });

  it("preserves every Menu item option and absent target state", async () => {
    vi.mocked(postInternalApi)
      .mockResolvedValueOnce(
        json({
          locale: "en",
          documentRevision: "doc-2",
        }),
      )
      .mockResolvedValueOnce(
        json({
          sourceLocale: "en",
          locale: "en",
          localeExists: true,
          name: "Main",
          items: [
            {
              id: "parent",
              linkType: "custom",
              url: "/parent",
              targetId: "target-1",
              targetSlug: "target",
              openInNewTab: false,
              visibilityMode: "roles",
              visibilityRoles: ["author"],
              localizationMode: "fixed_locale",
              fixedLocale: "en",
              children: [{ id: "child", linkType: "custom" }],
            },
          ],
          sourceLabels: {},
          requestedLabels: {},
          documentRevision: "doc-2",
        }),
      );
    const items = [
      {
        id: "parent",
        linkType: "custom",
        url: "/parent",
        targetId: "target-1",
        targetSlug: "target",
        openInNewTab: false,
        visibilityMode: "roles",
        visibilityRoles: ["author"],
        localizationMode: "fixed_locale",
        fixedLocale: "en",
        children: [{ id: "child", linkType: "custom" }],
      },
    ];

    await expect(
      saveMenuDocument({
        menuId: "menu-options",
        locale: "en",
        name: "Main",
        items,
        requestedLabels: {},
        contributorMemberIds: [],
        expectedDocumentRevision: "doc-1",
      }),
    ).resolves.toMatchObject({ documentRevision: "doc-2" });
    await expect(
      loadMenuDocument({ menuId: "menu-options", locale: "en" }),
    ).resolves.toEqual({
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      name: "Main",
      items,
      sourceLabels: {},
      requestedLabels: {},
      documentRevision: "doc-2",
    });
  });

  it("reports Menu transport failures with optional response detail", async () => {
    vi.mocked(postInternalApi)
      .mockResolvedValueOnce(
        new Response("", { status: 500, statusText: "Broken" }),
      )
      .mockResolvedValueOnce(
        new Response("save detail", { status: 500, statusText: "Broken" }),
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        text: vi.fn().mockRejectedValue(new Error("body stream failed")),
      } as unknown as Response);

    await expect(
      loadMenuDocument({ menuId: "menu-1", locale: "en" }),
    ).rejects.toThrow("Failed to load Menu document: 500 Broken");
    const request = {
      menuId: "menu-1",
      locale: "en",
      name: "Main",
      items: [],
      requestedLabels: {},
      contributorMemberIds: [],
      expectedDocumentRevision: "doc-1",
    };
    await expect(saveMenuDocument(request)).rejects.toThrow(
      "Failed to save Menu document: 500 Broken - save detail",
    );
    await expect(saveMenuDocument(request)).rejects.toThrow(
      "Failed to save Menu document: 503 Unavailable",
    );
  });

  it("preserves absent Post Series fields and reports transport failures", async () => {
    vi.mocked(postInternalApi)
      .mockResolvedValueOnce(
        json({
          sourceLocale: "en",
          locale: "fr",
          localeExists: false,
          documentRevision: "doc-1",
        }),
      )
      .mockResolvedValueOnce(
        new Response("", { status: 500, statusText: "Broken" }),
      )
      .mockResolvedValueOnce(
        new Response("save detail", { status: 500, statusText: "Broken" }),
      )
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Unavailable",
        text: vi.fn().mockRejectedValue(new Error("body stream failed")),
      } as unknown as Response);

    await expect(
      loadPostSeriesDocument({ seriesId: "series-1", locale: "fr" }),
    ).resolves.toEqual({
      sourceLocale: "en",
      locale: "fr",
      localeExists: false,
      source: {},
      requested: {},
      documentRevision: "doc-1",
    });
    await expect(
      loadPostSeriesDocument({ seriesId: "series-1", locale: "en" }),
    ).rejects.toThrow("Failed to load Post Series document: 500 Broken");
    const request = {
      seriesId: "series-1",
      locale: "en",
      requested: {},
      contributorMemberIds: [],
      expectedDocumentRevision: "doc-1",
    };
    await expect(savePostSeriesDocument(request)).rejects.toThrow(
      "Failed to save Post Series document: 500 Broken - save detail",
    );
    await expect(savePostSeriesDocument(request)).rejects.toThrow(
      "Failed to save Post Series document: 503 Unavailable",
    );
  });

  it("saves and loads canonical Form fields with document and target revision fences", async () => {
    vi.mocked(postInternalApi)
      .mockResolvedValueOnce(
        json({
          success: true,
          locale: "ko",
          documentRevision: "doc-2",
          targetRevision: "target-2",
        }),
      )
      .mockResolvedValueOnce(
        json({
          sourceMetadata: {
            title: "Form",
            schema: JSON.stringify({ id: "schema_A", steps: [] }),
          },
          localeMetadata: {
            title: "양식",
            schema: JSON.stringify({ id: "schema_A", steps: [] }),
          },
          sourceLocale: "en",
          locale: "ko",
          localeExists: true,
          presentLocaleValues: [
            {
              blockHandle: "document",
              fieldHandle: "title",
            },
          ],
          documentRevision: "doc-2",
          targetRevision: "target-2",
        }),
      );

    await expect(
      saveFormDocument({
        formId: "form-1",
        locale: "ko",
        fields: { title: "양식", schema: { id: "schema_A", steps: [] } },
        presentLocaleValues: [formRootTitleTarget()],
        contributorMemberIds: ["member-1"],
        expectedDocumentRevision: "doc-1",
        expectedTargetRevision: "target-1",
      }),
    ).resolves.toMatchObject({
      success: true,
      documentRevision: "doc-2",
      targetRevision: "target-2",
    });
    expect(postInternalApi).toHaveBeenNthCalledWith(
      1,
      "/api.intra.v1.InternalFormService/SaveDocument",
      {
        formId: "form-1",
        locale: "ko",
        meta: {
          title: "양식",
          schema: JSON.stringify({ id: "schema_A", steps: [] }),
        },
        presentLocaleValues: [
          {
            blockHandle: "document",
            fieldHandle: "title",
          },
        ],
        contributorMemberIds: ["member-1"],
        expectedDocumentRevision: "doc-1",
        expectedTargetRevision: "target-1",
      },
    );
    await expect(
      loadFormDocument({ formId: "form-1", locale: "ko" }),
    ).resolves.toEqual({
      source: { title: "Form", schema: { id: "schema_A", steps: [] } },
      requested: { title: "양식", schema: { id: "schema_A", steps: [] } },
      sourceLocale: "en",
      locale: "ko",
      localeExists: true,
      presentLocaleValues: [formRootTitleTarget()],
      documentRevision: "doc-2",
      targetRevision: "target-2",
    });
  });

  it("covers Form not-found, empty load, and failed responses", async () => {
    vi.mocked(postInternalApi)
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(
        new Response("save detail", { status: 500, statusText: "Broken" }),
      )
      .mockResolvedValueOnce(
        new Response("", { status: 500, statusText: "Broken" }),
      )
      .mockResolvedValueOnce(
        new Response("", { status: 500, statusText: "Broken" }),
      );

    await expect(
      loadFormDocument({ formId: "missing", locale: "ko" }),
    ).resolves.toEqual({
      source: {},
      requested: {},
      sourceLocale: "",
      locale: "ko",
      localeExists: false,
      presentLocaleValues: [],
      documentRevision: "",
    });
    await expect(
      loadFormDocument({ formId: "form-1", locale: "ko" }),
    ).resolves.toEqual({
      source: {},
      requested: {},
      sourceLocale: "",
      locale: "",
      localeExists: false,
      presentLocaleValues: [],
      documentRevision: "",
    });
    const request = {
      formId: "form-1",
      locale: "ko",
      fields: { schema: { id: "schema_A", steps: [] } },
      presentLocaleValues: [],
      contributorMemberIds: [],
      expectedDocumentRevision: "doc-1",
    };
    await expect(saveFormDocument(request)).rejects.toThrow(
      "500 Broken - save detail",
    );
    await expect(saveFormDocument(request)).rejects.toThrow("500 Broken");
    await expect(
      loadFormDocument({ formId: "form-1", locale: "ko" }),
    ).rejects.toThrow("Failed to load form document: 500 Broken");
  });

  it("saves and loads Email Layout with only semantic HTML and revision fences", async () => {
    vi.mocked(postInternalApi)
      .mockResolvedValueOnce(
        json({
          success: true,
          locale: "en",
          documentRevision: "doc-2",
        }),
      )
      .mockResolvedValueOnce(
        json({
          contentHtml: "<main>source</main>",
          contentText: "source",
          sourceLocale: "en",
          locale: "en",
          documentRevision: "doc-2",
        }),
      );

    await expect(
      saveEmailLayoutDocument({
        emailLayoutId: "layout-1",
        locale: "en",
        contentHtml: "<main>source</main>",
        contentText: "source",
        contributorMemberIds: ["member-1"],
        expectedDocumentRevision: "doc-1",
      }),
    ).resolves.toEqual({
      success: true,
      locale: "en",
      documentRevision: "doc-2",
    });
    expect(postInternalApi).toHaveBeenNthCalledWith(
      1,
      "/api.intra.v1.InternalEmailLayoutService/SaveDocument",
      {
        emailLayoutId: "layout-1",
        locale: "en",
        contentHtml: "<main>source</main>",
        contentText: "source",
        contributorMemberIds: ["member-1"],
        expectedDocumentRevision: "doc-1",
        expectedTargetRevision: undefined,
        localeValues: undefined,
      },
    );
    await expect(
      loadEmailLayoutDocument({
        emailLayoutId: "layout-1",
        locale: "en",
      }),
    ).resolves.toEqual({
      contentHtml: "<main>source</main>",
      contentText: "source",
      sourceLocale: "en",
      locale: "en",
      documentRevision: "doc-2",
      targetRevision: undefined,
      units: [],
      localeValues: [],
    });
  });

  it("covers Email Layout not-found, empty load, and failed responses", async () => {
    vi.mocked(postInternalApi)
      .mockResolvedValueOnce(new Response("", { status: 404 }))
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(
        new Response("save detail", { status: 500, statusText: "Broken" }),
      )
      .mockResolvedValueOnce(
        new Response("", { status: 500, statusText: "Broken" }),
      )
      .mockResolvedValueOnce(
        new Response("", { status: 500, statusText: "Broken" }),
      );

    await expect(
      loadEmailLayoutDocument({ emailLayoutId: "missing", locale: "en" }),
    ).resolves.toEqual({
      sourceLocale: "",
      locale: "en",
      documentRevision: "",
      units: [],
      localeValues: [],
    });
    await expect(
      loadEmailLayoutDocument({
        emailLayoutId: "layout-1",
        locale: "en",
      }),
    ).resolves.toEqual({
      contentHtml: undefined,
      contentText: undefined,
      sourceLocale: "",
      locale: "",
      documentRevision: "",
      targetRevision: undefined,
      units: [],
      localeValues: [],
    });
    const request = {
      emailLayoutId: "layout-1",
      locale: "en",
      contentHtml: "",
      expectedDocumentRevision: "doc-1",
    };
    await expect(saveEmailLayoutDocument(request)).rejects.toThrow(
      "500 Broken save detail",
    );
    await expect(saveEmailLayoutDocument(request)).rejects.toThrow(
      "500 Broken",
    );
    await expect(
      loadEmailLayoutDocument({
        emailLayoutId: "layout-1",
        locale: "en",
      }),
    ).rejects.toThrow("Failed to load email layout document: 500 Broken");
  });

  it("keeps Email Layout save status when the error body cannot be read", async () => {
    vi.mocked(postInternalApi).mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Unavailable",
      text: vi.fn().mockRejectedValue(new Error("body stream failed")),
    } as unknown as Response);
    await expect(
      saveEmailLayoutDocument({
        emailLayoutId: "layout-1",
        locale: "en",
        contentHtml: "",
        expectedDocumentRevision: "doc-1",
      }),
    ).rejects.toThrow("503 Unavailable");
  });
});
