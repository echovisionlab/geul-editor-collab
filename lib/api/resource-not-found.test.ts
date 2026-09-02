import { create } from "@bufbuild/protobuf";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import {
  PageSectionMutationBatchSchema,
  RichTextBlockMutationBatchSchema,
  RichTextProfile,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyResidentRichTextBlockBatch,
  saveEmailLayoutDocument,
  saveFormDocument,
} from "../api-client.ts";
import { applyPageBlockBatch } from "./page.ts";
import { applyPostBlockBatch } from "./post.ts";
import { CollaborationResourceNotFoundError } from "./transport.ts";
import { applyWorkBlockBatch } from "./work.ts";

const richTextBatch = create(RichTextBlockMutationBatchSchema, {
  blockCatalogFingerprint: "catalog-v1",
  profile: RichTextProfile.POST,
  expectedRevision: "revision-1",
});
const pageBatch = create(PageSectionMutationBatchSchema, {
  blockCatalogFingerprint: "catalog-v1",
  expectedRevision: "revision-1",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collaboration persistence resource-not-found classification", () => {
  it.each([
    [
      CollaborativeDocumentType.POST,
      "post-1",
      () => applyPostBlockBatch("post-1", "en", richTextBatch),
    ],
    [
      CollaborativeDocumentType.PAGE,
      "page-1",
      () => applyPageBlockBatch("page-1", "en", pageBatch),
    ],
    [
      CollaborativeDocumentType.CAMPAIGN,
      "campaign-1",
      () =>
        applyResidentRichTextBlockBatch(
          "campaign",
          "campaign-1",
          "en",
          richTextBatch,
        ),
    ],
    [
      CollaborativeDocumentType.WORK,
      "work-1",
      () => applyWorkBlockBatch("work-1", "en", richTextBatch),
    ],
    [
      CollaborativeDocumentType.EMAIL_TEMPLATE,
      "email-template-1",
      () =>
        applyResidentRichTextBlockBatch(
          "email-template",
          "email-template-1",
          "en",
          richTextBatch,
        ),
    ],
    [
      CollaborativeDocumentType.EMAIL_LAYOUT,
      "email-layout-1",
      () =>
        saveEmailLayoutDocument({
          emailLayoutId: "email-layout-1",
          locale: "en",
          contentHtml: "<p>Layout</p>",
          expectedDocumentRevision: "document-revision",
        }),
    ],
    [
      CollaborativeDocumentType.TERMS_HISTORY,
      "terms-1",
      () =>
        applyResidentRichTextBlockBatch(
          "terms-history",
          "terms-1",
          "en",
          richTextBatch,
        ),
    ],
    [
      CollaborativeDocumentType.PRIVACY_HISTORY,
      "privacy-1",
      () =>
        applyResidentRichTextBlockBatch(
          "privacy-history",
          "privacy-1",
          "en",
          richTextBatch,
        ),
    ],
    [
      CollaborativeDocumentType.ARTIST,
      "artist-1",
      () =>
        applyResidentRichTextBlockBatch(
          "artist",
          "artist-1",
          "en",
          richTextBatch,
        ),
    ],
    [
      CollaborativeDocumentType.RELEASE,
      "release-1",
      () =>
        applyResidentRichTextBlockBatch(
          "release",
          "release-1",
          "en",
          richTextBatch,
        ),
    ],
    [
      CollaborativeDocumentType.LABEL,
      "label-1",
      () =>
        applyResidentRichTextBlockBatch(
          "label",
          "label-1",
          "en",
          richTextBatch,
        ),
    ],
    [
      CollaborativeDocumentType.FORM,
      "form-1",
      () =>
        saveFormDocument({
          formId: "form-1",
          locale: "en",
          fields: { schema: { id: "schema_A", steps: [] } },
          presentLocaleValues: [],
          contributorMemberIds: [],
          expectedDocumentRevision: "document-revision",
        }),
    ],
    [
      CollaborativeDocumentType.PROGRAM_EVENT,
      "event-1",
      () =>
        applyResidentRichTextBlockBatch(
          "program-event",
          "event-1",
          "en",
          richTextBatch,
        ),
    ],
  ] as const)(
    "uses typed not-found for %s persistence",
    async (documentType, resourceId, save) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(null, { status: 404 })),
      );

      const outcome = save();
      await expect(outcome).rejects.toBeInstanceOf(
        CollaborationResourceNotFoundError,
      );
      await expect(outcome).rejects.toMatchObject({
        documentType,
        resourceId,
      });
    },
  );
});
