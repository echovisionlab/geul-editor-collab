import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import type { PostSeriesStoredLocaleFields } from "@echovisionlab/geul-common/collaboration/post-series";
import {
  LoadPostSeriesDocumentResponseSchema,
  PostSeriesLocaleFieldsSchema,
  SavePostSeriesDocumentRequestSchema,
  SavePostSeriesDocumentResponseSchema,
} from "@echovisionlab/geul-proto/intra/post_series_pb.ts";
import {
  postInternalApi,
  throwIfCollaborationResourceNotFound,
} from "./transport.ts";

export interface LoadPostSeriesDocumentResponse {
  sourceLocale: string;
  locale: string;
  localeExists: boolean;
  source: PostSeriesStoredLocaleFields;
  requested: PostSeriesStoredLocaleFields;
  documentRevision: string;
  targetRevision?: string;
}

export async function loadPostSeriesDocument(input: {
  seriesId: string;
  locale: string;
}): Promise<LoadPostSeriesDocumentResponse> {
  const response = await postInternalApi(
    "/api.intra.v1.InternalPostSeriesService/LoadDocument",
    input,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to load Post Series document: ${response.status} ${response.statusText}`,
    );
  }
  const result = fromJson(
    LoadPostSeriesDocumentResponseSchema,
    await response.json(),
  );
  return {
    sourceLocale: result.sourceLocale,
    locale: result.locale,
    localeExists: result.localeExists,
    source: postSeriesFields(result.source),
    requested: postSeriesFields(result.requested),
    documentRevision: result.documentRevision,
    ...(result.targetRevision === undefined
      ? {}
      : { targetRevision: result.targetRevision }),
  };
}

export async function savePostSeriesDocument(input: {
  seriesId: string;
  locale: string;
  requested: PostSeriesStoredLocaleFields;
  contributorMemberIds: readonly string[];
  expectedDocumentRevision: string;
  expectedTargetRevision?: string;
}) {
  const request = create(SavePostSeriesDocumentRequestSchema, {
    seriesId: input.seriesId,
    locale: input.locale,
    requested: create(PostSeriesLocaleFieldsSchema, input.requested),
    contributorMemberIds: [...input.contributorMemberIds],
    expectedDocumentRevision: input.expectedDocumentRevision,
    expectedTargetRevision: input.expectedTargetRevision,
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalPostSeriesService/SaveDocument",
    toJson(SavePostSeriesDocumentRequestSchema, request),
  );
  throwIfCollaborationResourceNotFound(
    response,
    CollaborativeDocumentType.POST_SERIES,
    input.seriesId,
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Failed to save Post Series document: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
    );
  }
  return fromJson(SavePostSeriesDocumentResponseSchema, await response.json());
}

function postSeriesFields(
  value:
    { title?: string | undefined; summary?: string | undefined } | undefined,
): PostSeriesStoredLocaleFields {
  return {
    ...(value?.title === undefined ? {} : { title: value.title }),
    ...(value?.summary === undefined ? {} : { summary: value.summary }),
  };
}
