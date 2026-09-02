import { create } from "@bufbuild/protobuf";
import {
  PostNullableStringChangeSchema,
  PostStringIdListSchema,
} from "@echovisionlab/geul-proto/intra/post_pb.ts";
import { updatePageLocaleMetadata } from "../api/page.ts";
import {
  updatePostDocumentMetadata,
  updatePostLocaleMetadata,
} from "../api/post.ts";
import {
  type ResidentRichTextMetadataUpdate,
  updateResidentRichTextMetadata,
} from "../api/resident-block-domain.ts";
import {
  type ResidentRichTextDocumentMetadataUpdate,
  updateResidentRichTextDocumentMetadata,
} from "../api/resident-document-metadata.ts";
import { updateWorkLocaleMetadata } from "../api/work.ts";

export type ResidentBlockMetadataUpdate =
  | {
      type: "post";
      scope: "locale";
      title?: string | null;
      summary?: string | null;
    }
  | {
      type: "post";
      scope: "document";
      categoryIds?: readonly string[];
      tagIds?: readonly string[];
    }
  | { type: "page"; title?: string; summary?: string | null }
  | {
      type: "work";
      sourceTitle?: string;
      summary?: string | null;
    }
  | ({ scope: "document" } & ResidentRichTextDocumentMetadataUpdate)
  | ResidentRichTextMetadataUpdate;

export interface ResidentBlockMetadataAck {
  documentRevision: string;
  changed: boolean;
  sourceChanged: boolean;
  changedLocales: string[];
  locale: string;
  targetRevision?: string;
}

function pageSummaryChange(value: string | null | undefined) {
  if (value === undefined) return { case: undefined } as const;
  if (value === null) return { case: "clearSummary", value: true } as const;
  return { case: "setSummary", value } as const;
}

function workSummaryUpdate(value: string | null | undefined) {
  if (value === undefined) return { case: undefined } as const;
  if (value === null) return { case: "clearSummary", value: true } as const;
  return { case: "summary", value } as const;
}

function postNullableChange(value: string | null | undefined) {
  if (value === undefined) return undefined;
  return create(PostNullableStringChangeSchema, {
    value:
      value === null
        ? { case: "clear", value: true }
        : { case: "setValue", value },
  });
}

async function updatePostBlockMetadata(
  entityId: string,
  locale: string,
  request: Extract<ResidentBlockMetadataUpdate, { type: "post" }>,
  expectedDocumentRevision: string,
  expectedTargetRevision: string | undefined,
  contributors: string[],
): Promise<ResidentBlockMetadataAck> {
  if (request.scope === "document") {
    const response = await updatePostDocumentMetadata({
      postId: entityId,
      categoryIds: request.categoryIds
        ? create(PostStringIdListSchema, { ids: [...request.categoryIds] })
        : undefined,
      tagIds: request.tagIds
        ? create(PostStringIdListSchema, { ids: [...request.tagIds] })
        : undefined,
      expectedRevision: expectedDocumentRevision,
      contributorMemberIds: contributors,
      locale,
    });
    return {
      documentRevision: response.documentRevision,
      changed: response.changed,
      sourceChanged: response.sourceChanged,
      changedLocales: [],
      locale: response.locale,
    };
  }
  const response = await updatePostLocaleMetadata({
    postId: entityId,
    titleChange: postNullableChange(request.title),
    summaryChange: postNullableChange(request.summary),
    expectedRevision: expectedDocumentRevision,
    expectedTargetRevision,
    contributorMemberIds: contributors,
    locale,
  });
  return {
    documentRevision: response.documentRevision,
    changed: response.changed,
    sourceChanged: response.sourceChanged,
    changedLocales: response.changedLocales,
    locale: response.locale,
    ...(response.targetRevision === undefined
      ? {}
      : { targetRevision: response.targetRevision }),
  };
}

export async function updateResidentBlockMetadata(
  entityId: string,
  locale: string,
  request: ResidentBlockMetadataUpdate,
  expectedDocumentRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
): Promise<ResidentBlockMetadataAck> {
  const contributors = [...contributorMemberIds];
  if (request.type === "post") {
    return updatePostBlockMetadata(
      entityId,
      locale,
      request,
      expectedDocumentRevision,
      expectedTargetRevision,
      contributors,
    );
  }
  if (request.type === "page") {
    const response = await updatePageLocaleMetadata({
      pageId: entityId,
      title: request.title,
      summaryChange: pageSummaryChange(request.summary),
      expectedRevision: expectedDocumentRevision,
      expectedTargetRevision,
      contributorMemberIds: contributors,
      locale,
    });
    return {
      documentRevision: response.documentRevision,
      changed: response.changed,
      sourceChanged: response.sourceChanged,
      changedLocales: response.changedLocales,
      locale: response.locale,
      ...(response.targetRevision === undefined
        ? {}
        : { targetRevision: response.targetRevision }),
    };
  }
  if (request.type === "work") {
    const response = await updateWorkLocaleMetadata({
      workId: entityId,
      title: request.sourceTitle,
      summaryUpdate: workSummaryUpdate(request.summary),
      expectedRevision: expectedDocumentRevision,
      expectedTargetRevision,
      contributorMemberIds: contributors,
      locale,
    });
    return {
      documentRevision: response.documentRevision,
      changed: response.changed,
      sourceChanged: response.sourceChanged,
      changedLocales: response.changedLocales,
      locale: response.locale,
      ...(response.targetRevision === undefined
        ? {}
        : { targetRevision: response.targetRevision }),
    };
  }
  if (
    (request.type === "artist" || request.type === "label") &&
    "scope" in request
  ) {
    const response = await updateResidentRichTextDocumentMetadata(
      entityId,
      locale,
      request,
      expectedDocumentRevision,
      contributors,
    );
    return {
      documentRevision: response.documentRevision,
      changed: response.changed,
      sourceChanged: response.sourceChanged,
      changedLocales: response.changedLocales,
      locale: response.locale,
    };
  }
  const response = await updateResidentRichTextMetadata(
    entityId,
    locale,
    request,
    expectedDocumentRevision,
    expectedTargetRevision,
    contributors,
  );
  return {
    documentRevision: response.documentRevision,
    changed: response.changed,
    sourceChanged: response.sourceChanged,
    changedLocales: response.changedLocales,
    locale: response.locale,
    ...(response.targetRevision === undefined
      ? {}
      : { targetRevision: response.targetRevision }),
  };
}
