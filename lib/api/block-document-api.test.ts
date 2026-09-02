import { create, toJson } from "@bufbuild/protobuf";
import {
  PageSectionMutationBatchSchema,
  RichTextBlockGraphSchema,
  RichTextBlockMutationBatchSchema,
  LocalizedRichTextDocumentSchema,
  RichTextProfile,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { ApplyWorkBlockBatchResponseSchema } from "@echovisionlab/geul-proto/intra/work_pb.ts";
import { CollaborationPrincipalSchema } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { LoadPostBlockDocumentResponseSchema } from "@echovisionlab/geul-proto/intra/post_pb.ts";
import {
  LoadReleaseBlockDocumentResponseSchema,
  ReleaseCreditNoteSchema,
} from "@echovisionlab/geul-proto/intra/release_pb.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyPageBlockBatch } from "./page.ts";
import { applyPostBlockBatch, loadPostBlockDocument } from "./post.ts";
import { applyWorkBlockBatch } from "./work.ts";
import { loadResidentRichTextDocument } from "./resident-block-domain.ts";
import {
  CollaborationConflictError,
  CollaborationPersistenceRejectedError,
} from "./transport.ts";

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const PRINCIPAL = create(CollaborationPrincipalSchema, {
  sessionId: "33333333-3333-4333-8333-333333333333",
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function richTextBatch() {
  return create(RichTextBlockMutationBatchSchema, {
    blockCatalogFingerprint: "catalog-v1",
    profile: RichTextProfile.POST,
    expectedRevision: "revision-1",
    contributorMemberIds: ["member-1"],
  });
}

describe("typed aggregate Block API adapters", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads one locale-scoped Post aggregate without a Yjs byte payload", async () => {
    const response = create(LoadPostBlockDocumentResponseSchema, {
      document: create(LocalizedRichTextDocumentSchema, {
        blockCatalogFingerprint: "catalog-v1",
        profile: RichTextProfile.POST,
        locale: "ko",
        base: create(RichTextBlockGraphSchema, { nodes: [] }),
      }),
      documentRevision: "revision-1",
      locale: "ko",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(toJson(LoadPostBlockDocumentResponseSchema, response)),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      loadPostBlockDocument(ENTITY_ID, "ko", PRINCIPAL),
    ).resolves.toMatchObject({
      documentRevision: "revision-1",
      locale: "ko",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("InternalPostService/LoadPostBlockDocument");
    expect(JSON.parse(String(init.body))).toEqual({
      postId: ENTITY_ID,
      locale: "ko",
      principal: { sessionId: PRINCIPAL.sessionId },
    });
  });

  it("sends generated RichTextBlockMutationBatch for Post and Work", async () => {
    const workResponse = create(ApplyWorkBlockBatchResponseSchema, {
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: true,
      changedLocales: ["ko"],
      locale: "ko",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          documentRevision: "revision-2",
          changed: true,
          sourceChanged: true,
          changedLocales: ["ko"],
          locale: "ko",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(toJson(ApplyWorkBlockBatchResponseSchema, workResponse)),
      );
    vi.stubGlobal("fetch", fetchMock);
    const batch = richTextBatch();

    await applyPostBlockBatch(ENTITY_ID, "ko", batch);
    await applyWorkBlockBatch(ENTITY_ID, "ko", batch);

    for (const call of fetchMock.mock.calls) {
      const request = JSON.parse(String(call[1].body)) as Record<
        string,
        unknown
      >;
      expect(request.batch).toMatchObject({
        blockCatalogFingerprint: "catalog-v1",
        expectedRevision: "revision-1",
        contributorMemberIds: ["member-1"],
      });
      expect(request.locale).toBe("ko");
      expect(JSON.stringify(request)).not.toContain("yjs");
      expect(JSON.stringify(request)).not.toContain("contentJson");
    }
  });

  it("loads Release credit notes as the source projection", async () => {
    const response = create(LoadReleaseBlockDocumentResponseSchema, {
      document: create(LocalizedRichTextDocumentSchema, {
        blockCatalogFingerprint: "catalog-v1",
        profile: RichTextProfile.COMPACT,
        locale: "ko",
        base: create(RichTextBlockGraphSchema, { nodes: [] }),
      }),
      documentRevision: "revision-1",
      sourceMetadata: {
        locale: "ko",
        title: "Release",
        creditNotes: [
          create(ReleaseCreditNoteSchema, {
            creditId: "credit-1",
            note: "Producer",
          }),
        ],
      },
      locale: "ko",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            toJson(LoadReleaseBlockDocumentResponseSchema, response),
          ),
        ),
    );

    await expect(
      loadResidentRichTextDocument("release", ENTITY_ID, "ko", PRINCIPAL),
    ).resolves.toMatchObject({
      documentRevision: "revision-1",
      locale: "ko",
      sourceMetadata: {
        locale: "ko",
        title: "Release",
        creditNotes: [{ creditId: "credit-1", note: "Producer" }],
      },
    });
  });

  it("maps Page failed_precondition through the common revision conflict decoder", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            code: "failed_precondition",
          },
          400,
        ),
      ),
    );
    const batch = create(PageSectionMutationBatchSchema, {
      blockCatalogFingerprint: "catalog-v1",
      expectedRevision: "revision-1",
    });

    await expect(
      applyPageBlockBatch(ENTITY_ID, "ko", batch),
    ).rejects.toMatchObject({
      reason: "document_revision_changed",
    } satisfies Partial<CollaborationConflictError>);
  });

  it("keeps a definitive Page persistence rejection out of the revision conflict path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            code: "unauthenticated",
          },
          401,
        ),
      ),
    );
    const batch = create(PageSectionMutationBatchSchema, {
      blockCatalogFingerprint: "catalog-v1",
      expectedRevision: "revision-1",
    });

    await expect(
      applyPageBlockBatch(ENTITY_ID, "ko", batch),
    ).rejects.toMatchObject({
      name: "CollaborationPersistenceRejectedError",
      status: 401,
      operation: "apply Page Block batch",
    } satisfies Partial<CollaborationPersistenceRejectedError>);
  });
});
