import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { contentBlockCatalogFingerprint } from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedRichTextDocumentSchema,
  RichTextBlockMutationBatchSchema,
  RichTextProfile,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { CollaborationPrincipalSchema } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyResidentRichTextBlockBatch,
  loadResidentRichTextDocument,
  updateResidentRichTextMetadata,
  type ResidentRichTextDocumentType,
  type ResidentRichTextMetadataUpdate,
} from "./resident-block-domain.ts";
import { postInternalApi } from "./transport.ts";

vi.mock("./transport.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./transport.ts")>();
  return { ...actual, postInternalApi: vi.fn() };
});

const types = [
  "artist",
  "label",
  "release",
  "program-event",
  "campaign",
  "email-template",
  "privacy-history",
  "terms-history",
] as const satisfies readonly ResidentRichTextDocumentType[];

const document = toJson(
  LocalizedRichTextDocumentSchema,
  fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.COMPACT,
    locale: "ko",
    base: { nodes: [] },
    localeOverlay: { locale: "ko", blocks: [] },
  }),
);
const targetDocument = toJson(
  LocalizedRichTextDocumentSchema,
  fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.COMPACT,
    locale: "en",
    base: { nodes: [] },
    localeOverlay: { locale: "en", blocks: [] },
  }),
);
const principal = create(CollaborationPrincipalSchema, {
  sessionId: "session-1",
});

function responseBody(): Record<string, unknown> {
  return {
    document,
    documentRevision: "revision-2",
    locale: "ko",
    localeExists: true,
    presentLocaleValues: [],
    sourceMetadata: { locale: "ko" },
    localeMetadata: { locale: "ko" },
  };
}

describe("resident locale rich-text domain API", () => {
  beforeEach(() => {
    vi.mocked(postInternalApi)
      .mockReset()
      .mockImplementation(
        async (path) =>
          new Response(
            JSON.stringify(
              path.includes("Load")
                ? responseBody()
                : path.includes("Checkpoint")
                  ? { locale: "ko" }
                  : {
                      documentRevision: "revision-2",
                      changed: true,
                      sourceChanged: true,
                      changedLocales: ["ko"],
                      locale: "ko",
                    },
            ),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      );
  });

  it.each(types)("loads and applies %s", async (type) => {
    const loaded = await loadResidentRichTextDocument(
      type,
      "entity-1",
      "ko",
      principal,
    );
    expect(loaded).toMatchObject({
      documentRevision: "revision-2",
      sourceMetadata: { locale: "ko" },
    });
    const ack = await applyResidentRichTextBlockBatch(
      type,
      "entity-1",
      "ko",
      fromJson(RichTextBlockMutationBatchSchema, {}),
    );
    expect(ack).toEqual({
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: true,
      locale: "ko",
    });
  });

  it("projects exact target authority through load, mutation, and metadata ACKs", async () => {
    vi.mocked(postInternalApi)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...responseBody(),
            document: targetDocument,
            documentRevision: "revision-1",
            locale: "en",
            sourceMetadata: { locale: "ko" },
            localeMetadata: { locale: "en" },
            targetRevision: "tr1_target_1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documentRevision: "revision-1",
            changed: true,
            sourceChanged: false,
            locale: "en",
            targetRevision: "tr1_target_2",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documentRevision: "revision-1",
            changed: true,
            sourceChanged: false,
            locale: "en",
            targetRevision: "tr1_target_3",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    await expect(
      loadResidentRichTextDocument("artist", "entity-1", "en", principal),
    ).resolves.toMatchObject({ targetRevision: "tr1_target_1" });
    await expect(
      applyResidentRichTextBlockBatch(
        "artist",
        "entity-1",
        "en",
        fromJson(RichTextBlockMutationBatchSchema, {}),
        "tr1_target_1",
      ),
    ).resolves.toMatchObject({ targetRevision: "tr1_target_2" });
    await expect(
      updateResidentRichTextMetadata(
        "entity-1",
        "en",
        { type: "artist", title: "Target" },
        "revision-1",
        "tr1_target_2",
        ["member-1"],
      ),
    ).resolves.toMatchObject({
      targetRevision: "tr1_target_3",
      changedLocales: [],
    });
  });

  it("rejects a resident RPC response for a different locale", async () => {
    vi.mocked(postInternalApi).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          documentRevision: "revision-2",
          changed: true,
          sourceChanged: true,
          locale: "en",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await expect(
      applyResidentRichTextBlockBatch(
        "artist",
        "entity-1",
        "ko",
        fromJson(RichTextBlockMutationBatchSchema, {}),
      ),
    ).rejects.toThrow("collaboration_response_locale_mismatch:ko");
  });

  it.each([
    {
      input: { type: "artist", title: "Artist" },
      path: "/api.intra.v1.InternalArtistService/UpdateArtistLocaleMetadata",
    },
    {
      input: { type: "label", title: "Label" },
      path: "/api.intra.v1.InternalLabelService/UpdateLabelLocaleMetadata",
    },
    {
      input: {
        type: "release",
        title: "Release",
        creditNotes: [{ creditId: "credit-1", note: "note" }],
      },
      path: "/api.intra.v1.InternalReleaseService/UpdateReleaseLocaleMetadata",
    },
    {
      input: { type: "program-event", title: "Event", summary: "Summary" },
      path: "/api.intra.v1.InternalProgramEventService/UpdateProgramEventLocaleMetadata",
    },
    {
      input: { type: "campaign", subject: "Campaign" },
      path: "/api.intra.v1.InternalCampaignService/UpdateCampaignLocaleMetadata",
    },
    {
      input: { type: "email-template", subject: "Template" },
      path: "/api.intra.v1.InternalEmailTemplateService/UpdateEmailTemplateLocaleMetadata",
    },
    {
      input: { type: "privacy-history", title: "Privacy" },
      path: "/api.intra.v1.InternalPrivacyService/UpdatePrivacyLocaleMetadata",
    },
    {
      input: { type: "terms-history", title: "Terms" },
      path: "/api.intra.v1.InternalTermsService/UpdateTermsLocaleMetadata",
    },
  ] satisfies readonly {
    input: ResidentRichTextMetadataUpdate;
    path: string;
  }[])(
    "updates $input.type source metadata through its declared RPC",
    async ({ input, path }) => {
      await expect(
        updateResidentRichTextMetadata(
          "entity-1",
          "ko",
          input,
          "revision-1",
          undefined,
          ["member-1"],
        ),
      ).resolves.toEqual({
        documentRevision: "revision-2",
        changed: true,
        sourceChanged: true,
        changedLocales: ["ko"],
        locale: "ko",
      });
      expect(postInternalApi).toHaveBeenLastCalledWith(
        path,
        expect.any(Object),
      );
    },
  );

  it("rejects missing documents and failed responses", async () => {
    vi.mocked(postInternalApi).mockResolvedValueOnce(
      new Response(JSON.stringify({ ...responseBody(), document: undefined }), {
        status: 200,
      }),
    );
    await expect(
      loadResidentRichTextDocument("artist", "entity-1", "ko", principal),
    ).rejects.toThrow("block_document_missing:artist");
    vi.mocked(postInternalApi).mockResolvedValueOnce(
      new Response("", { status: 500, statusText: "Broken" }),
    );
    await expect(
      applyResidentRichTextBlockBatch(
        "artist",
        "entity-1",
        "ko",
        fromJson(RichTextBlockMutationBatchSchema, {}),
      ),
    ).rejects.toThrow("Failed to apply Artist Block batch: 500 Broken");
  });

  it("projects complete source metadata", async () => {
    vi.mocked(postInternalApi)
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...responseBody(),
            sourceMetadata: {
              locale: "ko",
              title: "Title",
              creditNotes: [{ creditId: "credit-1", note: "Note" }],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...responseBody(),
            sourceMetadata: { locale: "ko", summary: "Summary" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...responseBody(),
            sourceMetadata: { locale: "ko", subject: "Subject" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documentRevision: "revision-3",
            changed: false,
            sourceChanged: false,
            locale: "ko",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documentRevision: "revision-4",
            changed: false,
            sourceChanged: false,
            locale: "ko",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documentRevision: "revision-5",
            changed: false,
            sourceChanged: false,
            locale: "ko",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            documentRevision: "revision-6",
            changed: false,
            sourceChanged: false,
            locale: "ko",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    await expect(
      loadResidentRichTextDocument("release", "entity-1", "ko", principal),
    ).resolves.toMatchObject({
      sourceMetadata: {
        locale: "ko",
        title: "Title",
        creditNotes: [{ creditId: "credit-1", note: "Note" }],
      },
    });
    await expect(
      loadResidentRichTextDocument(
        "program-event",
        "entity-1",
        "ko",
        principal,
      ),
    ).resolves.toMatchObject({
      sourceMetadata: { locale: "ko", summary: "Summary" },
    });
    await expect(
      loadResidentRichTextDocument("campaign", "entity-1", "ko", principal),
    ).resolves.toMatchObject({
      sourceMetadata: { locale: "ko", subject: "Subject" },
    });
    await expect(
      applyResidentRichTextBlockBatch(
        "artist",
        "entity-1",
        "ko",
        fromJson(RichTextBlockMutationBatchSchema, {}),
      ),
    ).resolves.toEqual({
      documentRevision: "revision-3",
      changed: false,
      sourceChanged: false,
      locale: "ko",
    });
    await expect(
      updateResidentRichTextMetadata(
        "program-event",
        "ko",
        { type: "program-event", summary: null },
        "revision-3",
        undefined,
        [],
      ),
    ).resolves.toEqual({
      documentRevision: "revision-4",
      changed: false,
      sourceChanged: false,
      changedLocales: [],
      locale: "ko",
    });
    await expect(
      updateResidentRichTextMetadata(
        "release",
        "ko",
        { type: "release", title: "No credits" },
        "revision-4",
        undefined,
        [],
      ),
    ).resolves.toEqual({
      documentRevision: "revision-5",
      changed: false,
      sourceChanged: false,
      changedLocales: [],
      locale: "ko",
    });
    await expect(
      updateResidentRichTextMetadata(
        "program-event",
        "ko",
        { type: "program-event", title: "Title only" },
        "revision-5",
        undefined,
        [],
      ),
    ).resolves.toEqual({
      documentRevision: "revision-6",
      changed: false,
      sourceChanged: false,
      changedLocales: [],
      locale: "ko",
    });
  });

  it("rejects an absent source metadata projection", async () => {
    vi.mocked(postInternalApi).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...responseBody(), sourceMetadata: undefined }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(
      loadResidentRichTextDocument("artist", "entity-1", "ko", principal),
    ).rejects.toThrow();
  });
});
