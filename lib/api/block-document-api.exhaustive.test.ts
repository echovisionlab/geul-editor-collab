import { create, fromJson } from "@bufbuild/protobuf";
import {
  PageSectionMutationBatchSchema,
  RichTextBlockMutationBatchSchema,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { CollaborationPrincipalSchema } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPostBlockBatch,
  createPostVersionCheckpoint,
  loadPostBlockDocument,
  updatePostDocumentMetadata,
  updatePostLocaleMetadata,
} from "./post.ts";
import {
  applyWorkBlockBatch,
  createWorkVersionCheckpoint,
  loadWorkBlockDocument,
  updateWorkLocaleMetadata,
} from "./work.ts";
import {
  applyPageBlockBatch,
  createPageVersionCheckpoint,
  loadPageBlockDocument,
  updatePageDocumentMetadata,
  updatePageLocaleMetadata,
} from "./page/document.ts";
import {
  CollaborationPersistenceRejectedError,
  postInternalApi,
  throwIfCollaborationConflictResponse,
  throwIfCollaborationResourceNotFound,
} from "./transport.ts";

vi.mock("./transport.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./transport.ts")>()),
  postInternalApi: vi.fn(),
  throwIfCollaborationConflictResponse: vi.fn(),
  throwIfCollaborationResourceNotFound: vi.fn(),
}));

const richBatch = fromJson(RichTextBlockMutationBatchSchema, {});
const pageBatch = fromJson(PageSectionMutationBatchSchema, {});
const PRINCIPAL = create(CollaborationPrincipalSchema, {
  sessionId: "33333333-3333-4333-8333-333333333333",
});

describe("Block document API clients", () => {
  beforeEach(() => {
    vi.mocked(postInternalApi)
      .mockReset()
      .mockImplementation(async () => new Response("{}", { status: 200 }));
    vi.mocked(throwIfCollaborationConflictResponse).mockReset();
    vi.mocked(throwIfCollaborationResourceNotFound).mockReset();
  });

  it("covers all Post Block operations", async () => {
    await loadPostBlockDocument("post-1", "ko", PRINCIPAL);
    await applyPostBlockBatch("post-1", "ko", richBatch);
    await updatePostLocaleMetadata({
      postId: "post-1",
      expectedRevision: "revision-1",
      contributorMemberIds: [],
      locale: "ko",
    });
    await updatePostDocumentMetadata({
      postId: "post-1",
      expectedRevision: "revision-1",
      contributorMemberIds: [],
      locale: "ko",
    });
    await createPostVersionCheckpoint("post-1", "ko", "revision-1", [
      "member-1",
    ]);
    expect(postInternalApi).toHaveBeenCalledTimes(5);
    expect(postInternalApi).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        postId: "post-1",
        locale: "ko",
        principal: { sessionId: PRINCIPAL.sessionId },
      }),
    );
  });

  it("covers all Work Block operations", async () => {
    await loadWorkBlockDocument("work-1", "ko", PRINCIPAL);
    await applyWorkBlockBatch("work-1", "ko", richBatch);
    await updateWorkLocaleMetadata({
      workId: "work-1",
      summaryUpdate: { case: undefined },
      expectedRevision: "revision-1",
      contributorMemberIds: [],
      locale: "ko",
    });
    await createWorkVersionCheckpoint("work-1", "ko", "revision-1", [
      "member-1",
    ]);
    expect(postInternalApi).toHaveBeenCalledTimes(4);
    expect(postInternalApi).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        workId: "work-1",
        locale: "ko",
        principal: { sessionId: PRINCIPAL.sessionId },
      }),
    );
  });

  it("covers all Page Block operations and AbortSignal forwarding", async () => {
    const controller = new AbortController();
    await loadPageBlockDocument("page-1", "ko", PRINCIPAL, controller.signal);
    await applyPageBlockBatch("page-1", "ko", pageBatch, controller.signal);
    await updatePageLocaleMetadata({
      pageId: "page-1",
      summaryChange: { case: undefined },
      expectedRevision: "revision-1",
      contributorMemberIds: [],
      locale: "ko",
    });
    await updatePageDocumentMetadata({
      pageId: "page-1",
      expectedRevision: "revision-1",
      contributorMemberIds: [],
      locale: "ko",
    });
    await createPageVersionCheckpoint("page-1", "ko", "revision-1", [
      "member-1",
    ]);
    expect(postInternalApi).toHaveBeenCalledTimes(5);
    expect(postInternalApi).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        pageId: "page-1",
        locale: "ko",
        principal: { sessionId: PRINCIPAL.sessionId },
      }),
      controller.signal,
    );
  });

  it.each([
    ["Post", () => loadPostBlockDocument("post-1", "ko", PRINCIPAL)],
    ["Work", () => loadWorkBlockDocument("work-1", "ko", PRINCIPAL)],
  ] as const)("reports failed %s operations", async (name, operation) => {
    vi.mocked(postInternalApi).mockResolvedValueOnce(
      new Response("", {
        status: 503,
        statusText: "Unavailable",
      }),
    );
    await expect(operation()).rejects.toThrow(
      `Failed to load ${name} Block document: 503 Unavailable`,
    );
  });

  it("reports a definitive failed Page operation without creating a revision conflict", async () => {
    vi.mocked(postInternalApi).mockResolvedValueOnce(
      new Response("", {
        status: 503,
        statusText: "Unavailable",
      }),
    );
    await expect(
      loadPageBlockDocument("page-1", "ko", PRINCIPAL),
    ).rejects.toMatchObject({
      name: "CollaborationPersistenceRejectedError",
      status: 503,
      operation: "load Page Block document",
    } satisfies Partial<CollaborationPersistenceRejectedError>);
  });
});
