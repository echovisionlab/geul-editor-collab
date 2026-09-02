import { create, fromJson } from "@bufbuild/protobuf";
import { contentBlockCatalogFingerprint } from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedPageDocumentSchema,
  LocalizedRichTextDocumentSchema,
  RichTextProfile,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { DocumentLayoutSchema } from "@echovisionlab/geul-proto/common/common_pb.ts";
import { CollaborationPrincipalSchema } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { describe, expect, it, vi } from "vitest";
import type { BlockMutationBatch } from "./block-mutation-batch.ts";
import type { BlockRoomLocaleData } from "./block-room-snapshot.ts";

const api = vi.hoisted(() => ({
  loadPostBlockDocument: vi.fn(),
  applyPostBlockBatch: vi.fn(),
  createPostVersionCheckpoint: vi.fn(),
  loadPageBlockDocument: vi.fn(),
  applyPageBlockBatch: vi.fn(),
  createPageVersionCheckpoint: vi.fn(),
  updatePageDocumentMetadata: vi.fn(),
  loadWorkBlockDocument: vi.fn(),
  applyWorkBlockBatch: vi.fn(),
  createWorkVersionCheckpoint: vi.fn(),
  loadResidentRichTextDocument: vi.fn(),
  applyResidentRichTextBlockBatch: vi.fn(),
  updateResidentBlockMetadata: vi.fn(),
}));

vi.mock("../api/post.ts", () => ({
  loadPostBlockDocument: api.loadPostBlockDocument,
  applyPostBlockBatch: api.applyPostBlockBatch,
  createPostVersionCheckpoint: api.createPostVersionCheckpoint,
}));
vi.mock("../api/page.ts", () => ({
  loadPageBlockDocument: api.loadPageBlockDocument,
  applyPageBlockBatch: api.applyPageBlockBatch,
  createPageVersionCheckpoint: api.createPageVersionCheckpoint,
  updatePageDocumentMetadata: api.updatePageDocumentMetadata,
}));
vi.mock("../api/work.ts", () => ({
  loadWorkBlockDocument: api.loadWorkBlockDocument,
  applyWorkBlockBatch: api.applyWorkBlockBatch,
  createWorkVersionCheckpoint: api.createWorkVersionCheckpoint,
}));
vi.mock("../api/resident-block-domain.ts", () => ({
  loadResidentRichTextDocument: api.loadResidentRichTextDocument,
  applyResidentRichTextBlockBatch: api.applyResidentRichTextBlockBatch,
}));
vi.mock("./resident-block-metadata.ts", () => ({
  updateResidentBlockMetadata: api.updateResidentBlockMetadata,
}));

import {
  ResidentBlockRuntime,
  type ResidentBlockDomainGateway,
} from "./resident-block-runtime.ts";

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const PRINCIPAL = create(CollaborationPrincipalSchema, {
  sessionId: "33333333-3333-4333-8333-333333333333",
});

function richText(profile: RichTextProfile, locale = "ko") {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile,
    locale,
    base: { nodes: [] },
    localeOverlay: { locale, blocks: [] },
  });
}

function page(locale = "ko") {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale,
    base: { nodes: [] },
    localeOverlay: { locale, sections: [] },
  });
}

function loaded(
  document: ReturnType<typeof richText> | ReturnType<typeof page>,
) {
  return {
    document,
    documentRevision: "revision-1",
    locale: "ko",
    localeExists: true,
    presentLocaleValues: [],
    sourceMetadata: { locale: "ko", title: "title" },
    localeMetadata: { locale: "ko", title: "title" },
  };
}

function ack() {
  return {
    documentRevision: "revision-2",
    changed: true,
    sourceChanged: true,
    changedLocales: ["ko"],
    locale: "ko",
  };
}

function sourceAck() {
  const value = ack();
  return {
    documentRevision: value.documentRevision,
    changed: value.changed,
    sourceChanged: value.sourceChanged,
    locale: value.locale,
  };
}

function batch(
  profile?: RichTextProfile,
): BlockMutationBatch<unknown, BlockRoomLocaleData> {
  return {
    expectedDocumentRevision: "revision-1",
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    ...(profile === undefined ? {} : { profile }),
    baseMutations: [],
    locale: "ko",
    localeMutations: [],
    affectedLocaleValueTargets: [],
    contributorMemberIds: ["member-1"],
  };
}

function runtimeGateways(): Record<string, ResidentBlockDomainGateway> {
  const runtime = new ResidentBlockRuntime();
  return (
    runtime as unknown as {
      domainGateways: Record<string, ResidentBlockDomainGateway>;
    }
  ).domainGateways;
}

describe("ResidentBlockRuntime domain gateways", () => {
  it("adapts Post, Page, and Work loads, saves, checkpoints, and Page layout metadata", async () => {
    api.loadPostBlockDocument.mockResolvedValue(
      loaded(richText(RichTextProfile.POST)),
    );
    api.loadPageBlockDocument.mockResolvedValue(loaded(page()));
    api.loadWorkBlockDocument.mockResolvedValue(
      loaded(richText(RichTextProfile.WORK)),
    );
    api.applyPostBlockBatch.mockResolvedValue(ack());
    api.applyPageBlockBatch.mockResolvedValue(ack());
    api.applyWorkBlockBatch.mockResolvedValue(ack());
    api.createPostVersionCheckpoint.mockResolvedValue({
      success: true,
      locale: "ko",
    });
    api.createPageVersionCheckpoint.mockResolvedValue({
      success: true,
      locale: "ko",
    });
    api.createWorkVersionCheckpoint.mockResolvedValue({
      success: true,
      locale: "ko",
    });
    api.updatePageDocumentMetadata.mockResolvedValue({
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: false,
      locale: "ko",
    });
    const gateways = runtimeGateways();

    await expect(
      gateways.post.load(ENTITY_ID, "ko", PRINCIPAL),
    ).resolves.toMatchObject({
      documentRevision: "revision-1",
    });
    await expect(
      gateways.page.load(ENTITY_ID, "ko", PRINCIPAL),
    ).resolves.toMatchObject({
      documentRevision: "revision-1",
    });
    await expect(
      gateways.work.load(ENTITY_ID, "ko", PRINCIPAL),
    ).resolves.toMatchObject({
      documentRevision: "revision-1",
    });
    await expect(
      gateways.post.save(ENTITY_ID, "ko", batch(RichTextProfile.POST)),
    ).resolves.toEqual(sourceAck());
    await expect(gateways.page.save(ENTITY_ID, "ko", batch())).resolves.toEqual(
      sourceAck(),
    );
    await expect(
      gateways.work.save(ENTITY_ID, "ko", batch(RichTextProfile.WORK)),
    ).resolves.toEqual(sourceAck());
    await gateways.post.checkpoint!(ENTITY_ID, "ko", {
      expectedDocumentRevision: "revision-1",
      contributorMemberIds: ["member-1"],
    });
    await gateways.page.checkpoint!(ENTITY_ID, "ko", {
      expectedDocumentRevision: "revision-1",
      contributorMemberIds: ["member-1"],
    });
    await gateways.work.checkpoint!(ENTITY_ID, "ko", {
      expectedDocumentRevision: "revision-1",
      contributorMemberIds: ["member-1"],
    });
    await expect(
      gateways.page.updatePageDocumentLayout?.(ENTITY_ID, "ko", {
        expectedDocumentRevision: "revision-1",
        documentLayout: fromJson(DocumentLayoutSchema, {}),
        contributorMemberIds: ["member-1"],
      }),
    ).resolves.toEqual({
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: false,
      locale: "ko",
    });

    expect(api.createPostVersionCheckpoint).toHaveBeenCalledWith(
      ENTITY_ID,
      "ko",
      "revision-1",
      ["member-1"],
    );
    expect(api.loadPostBlockDocument).toHaveBeenCalledWith(
      ENTITY_ID,
      "ko",
      PRINCIPAL,
    );
    expect(api.loadPageBlockDocument).toHaveBeenCalledWith(
      ENTITY_ID,
      "ko",
      PRINCIPAL,
    );
    expect(api.loadWorkBlockDocument).toHaveBeenCalledWith(
      ENTITY_ID,
      "ko",
      PRINCIPAL,
    );
    expect(api.updatePageDocumentMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: ENTITY_ID,
        expectedRevision: "revision-1",
        locale: "ko",
      }),
    );
  });

  it("rejects missing primary-domain documents", async () => {
    const gateways = runtimeGateways();
    api.loadPostBlockDocument.mockResolvedValueOnce({
      ...loaded(richText(RichTextProfile.POST)),
      document: undefined,
    });
    api.loadPageBlockDocument.mockResolvedValueOnce({
      ...loaded(page()),
      document: undefined,
    });
    api.loadWorkBlockDocument.mockResolvedValueOnce({
      ...loaded(richText(RichTextProfile.WORK)),
      document: undefined,
    });

    await expect(
      gateways.post.load(ENTITY_ID, "ko", PRINCIPAL),
    ).rejects.toThrow("block_document_missing:post");
    await expect(
      gateways.page.load(ENTITY_ID, "ko", PRINCIPAL),
    ).rejects.toThrow("block_document_missing:page");
    await expect(
      gateways.work.load(ENTITY_ID, "ko", PRINCIPAL),
    ).rejects.toThrow("block_document_missing:work");
  });

  it("rejects a load whose owning API document locale differs from the room", async () => {
    api.loadPostBlockDocument.mockResolvedValue(
      loaded(richText(RichTextProfile.POST)),
    );
    await expect(
      runtimeGateways().post.load(ENTITY_ID, "en", PRINCIPAL),
    ).rejects.toThrow("block_document_locale_mismatch:en");
  });

  it("preserves an opaque target revision through load, save, and ACK", async () => {
    const targetRevision = "tr1_ZXhhY3Qtb3BhcXVlLXRva2Vu";
    api.loadPostBlockDocument.mockResolvedValue({
      ...loaded(richText(RichTextProfile.POST, "en")),
      locale: "en",
      localeExists: true,
      sourceMetadata: { title: "Source", locale: "ko" },
      localeMetadata: { locale: "en", title: "Target" },
      targetRevision,
    });
    api.applyPostBlockBatch.mockResolvedValue({
      documentRevision: "revision-1",
      changed: true,
      sourceChanged: false,
      locale: "en",
      targetRevision: "tr1_bmV4dC10YXJnZXQtdG9rZW4",
    });
    const gateway = runtimeGateways().post;

    await expect(
      gateway.load(ENTITY_ID, "en", PRINCIPAL),
    ).resolves.toMatchObject({
      sourceLocale: "ko",
      locale: "en",
      targetRevision,
    });
    await expect(
      gateway.save(ENTITY_ID, "en", {
        ...batch(RichTextProfile.POST),
        locale: "en",
        expectedTargetRevision: targetRevision,
      }),
    ).resolves.toMatchObject({
      documentRevision: "revision-1",
      targetRevision: "tr1_bmV4dC10YXJnZXQtdG9rZW4",
    });
    expect(api.applyPostBlockBatch).toHaveBeenCalledWith(
      ENTITY_ID,
      "en",
      expect.anything(),
      targetRevision,
      [],
    );
  });

  it("accepts semantically equal source metadata independent of object key order", async () => {
    api.loadPostBlockDocument.mockResolvedValue({
      ...loaded(richText(RichTextProfile.POST)),
      sourceMetadata: { locale: "ko", title: "Title", summary: "Summary" },
      localeMetadata: { summary: "Summary", title: "Title", locale: "ko" },
    });
    await expect(
      runtimeGateways().post.load(ENTITY_ID, "ko", PRINCIPAL),
    ).resolves.toMatchObject({ sourceLocale: "ko", locale: "ko" });
  });

  it("compares Release credit-note metadata by ordered identity and value", async () => {
    const exact = {
      locale: "ko",
      title: "Release",
      creditNotes: [{ creditId: "credit-1", note: "Producer" }],
    };
    api.loadResidentRichTextDocument.mockResolvedValueOnce({
      ...loaded(richText(RichTextProfile.COMPACT)),
      sourceMetadata: exact,
      localeMetadata: { ...exact, creditNotes: [...exact.creditNotes] },
    });
    await expect(
      runtimeGateways().release.load(ENTITY_ID, "ko", PRINCIPAL),
    ).resolves.toMatchObject({ sourceLocale: "ko" });

    for (const creditNotes of [
      [],
      [{ creditId: "credit-2", note: "Producer" }],
      [{ creditId: "credit-1", note: "Engineer" }],
    ]) {
      api.loadResidentRichTextDocument.mockResolvedValueOnce({
        ...loaded(richText(RichTextProfile.COMPACT)),
        sourceMetadata: exact,
        localeMetadata: { locale: "ko", title: "Release", creditNotes },
      });
      await expect(
        runtimeGateways().release.load(ENTITY_ID, "ko", PRINCIPAL),
      ).rejects.toThrow("block_source_locale_metadata_mismatch");
    }
  });

  it.each([
    [
      "missing source metadata",
      { sourceMetadata: undefined },
      "block_source_metadata_missing:post",
    ],
    [
      "blank source metadata locale",
      { sourceMetadata: { locale: "" } },
      "block_source_metadata_missing:post",
    ],
    [
      "locale metadata presence",
      { localeMetadata: undefined },
      "block_locale_metadata_presence_mismatch",
    ],
    [
      "source metadata equality",
      { localeMetadata: { locale: "ko", title: "other" } },
      "block_source_locale_metadata_mismatch",
    ],
    [
      "source target token absence",
      { targetRevision: "tr1_forbidden" },
      "block_source_locale_authority_invalid",
    ],
    [
      "source locale presence",
      { localeExists: false, localeMetadata: undefined },
      "block_source_locale_authority_invalid",
    ],
  ] as const)(
    "rejects invalid %s authority",
    async (_label, overrides, reason) => {
      api.loadPostBlockDocument.mockResolvedValue({
        ...loaded(richText(RichTextProfile.POST)),
        ...overrides,
      });
      await expect(
        runtimeGateways().post.load(ENTITY_ID, "ko", PRINCIPAL),
      ).rejects.toThrow(reason);
    },
  );

  it("allows a missing target fallback only without locale metadata or a token", async () => {
    api.loadPostBlockDocument.mockResolvedValue({
      ...loaded(richText(RichTextProfile.POST, "en")),
      locale: "en",
      localeExists: false,
      sourceMetadata: { locale: "ko", title: "Source" },
      localeMetadata: undefined,
    });
    await expect(
      runtimeGateways().post.load(ENTITY_ID, "en", PRINCIPAL),
    ).resolves.toMatchObject({
      sourceLocale: "ko",
      locale: "en",
      localeExists: false,
    });
  });

  it("rejects mismatched target token and locale metadata authority", async () => {
    api.loadPostBlockDocument.mockResolvedValueOnce({
      ...loaded(richText(RichTextProfile.POST, "en")),
      locale: "en",
      sourceMetadata: { locale: "ko", title: "Source" },
      localeMetadata: { locale: "en", title: "Target" },
      targetRevision: undefined,
    });
    await expect(
      runtimeGateways().post.load(ENTITY_ID, "en", PRINCIPAL),
    ).rejects.toThrow("block_target_revision_presence_mismatch");

    api.loadPostBlockDocument.mockResolvedValueOnce({
      ...loaded(richText(RichTextProfile.POST, "en")),
      locale: "en",
      sourceMetadata: { locale: "ko", title: "Source" },
      localeMetadata: { locale: "ja", title: "Target" },
      targetRevision: "tr1_target",
    });
    await expect(
      runtimeGateways().post.load(ENTITY_ID, "en", PRINCIPAL),
    ).rejects.toThrow("block_locale_metadata_locale_mismatch");
  });

  it.each([
    [
      "artist",
      RichTextProfile.COMPACT,
      richText(RichTextProfile.COMPACT, "en"),
    ],
    ["page", undefined, page("en")],
    ["work", RichTextProfile.WORK, richText(RichTextProfile.WORK, "en")],
  ] as const)(
    "projects present and missing exact target authority for %s",
    async (type, _profile, document) => {
      const present = {
        ...loaded(document),
        locale: "en",
        sourceMetadata: { locale: "ko", title: "Source" },
        localeMetadata: { locale: "en", title: "Target" },
        targetRevision: "tr1_target",
      };
      const missing = {
        ...present,
        localeExists: false,
        localeMetadata: undefined,
        targetRevision: undefined,
      };
      const load =
        type === "artist"
          ? api.loadResidentRichTextDocument
          : type === "page"
            ? api.loadPageBlockDocument
            : api.loadWorkBlockDocument;
      load.mockResolvedValueOnce(present).mockResolvedValueOnce(missing);
      const gateway = runtimeGateways()[type];

      await expect(
        gateway.load(ENTITY_ID, "en", PRINCIPAL),
      ).resolves.toMatchObject({
        targetRevision: "tr1_target",
        localeExists: true,
      });
      await expect(
        gateway.load(ENTITY_ID, "en", PRINCIPAL),
      ).resolves.toMatchObject({ localeExists: false });
    },
  );

  it.each([
    ["program-event", RichTextProfile.PROGRAM_EVENT],
    ["artist", RichTextProfile.COMPACT],
    ["label", RichTextProfile.COMPACT],
    ["release", RichTextProfile.COMPACT],
    ["campaign", RichTextProfile.EMAIL],
    ["email-template", RichTextProfile.EMAIL],
    ["terms-history", RichTextProfile.POLICY],
    ["privacy-history", RichTextProfile.POLICY],
  ] as const)(
    "adapts the %s resident rich-text domain",
    async (type, profile) => {
      api.loadResidentRichTextDocument.mockResolvedValueOnce(
        loaded(richText(profile)),
      );
      api.applyResidentRichTextBlockBatch.mockResolvedValueOnce(ack());
      const gateway = runtimeGateways()[type];

      await expect(
        gateway.load(ENTITY_ID, "ko", PRINCIPAL),
      ).resolves.toMatchObject({
        documentRevision: "revision-1",
        sourceMetadata: { locale: "ko", title: "title" },
      });
      await expect(
        gateway.save(ENTITY_ID, "ko", batch(profile)),
      ).resolves.toEqual(sourceAck());
      expect(gateway.checkpoint).toBeUndefined();

      expect(api.loadResidentRichTextDocument).toHaveBeenLastCalledWith(
        type,
        ENTITY_ID,
        "ko",
        PRINCIPAL,
      );
      expect(gateway.updateMetadata).toBe(api.updateResidentBlockMetadata);
    },
  );
});
