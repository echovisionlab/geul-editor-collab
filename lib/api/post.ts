import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import type { RichTextBlockMutationBatch } from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import type { CollaborationPrincipal } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import {
  ApplyPostBlockBatchRequestSchema,
  ApplyPostBlockBatchResponseSchema,
  CreatePostVersionCheckpointRequestSchema,
  CreatePostVersionCheckpointResponseSchema,
  LoadPostBlockDocumentRequestSchema,
  LoadPostBlockDocumentResponseSchema,
  UpdatePostDocumentMetadataRequestSchema,
  UpdatePostDocumentMetadataResponseSchema,
  UpdatePostLocaleMetadataRequestSchema,
  UpdatePostLocaleMetadataResponseSchema,
  type ApplyPostBlockBatchResponse,
  type CreatePostVersionCheckpointResponse,
  type LoadPostBlockDocumentResponse,
  type UpdatePostDocumentMetadataRequest,
  type UpdatePostDocumentMetadataResponse,
  type UpdatePostLocaleMetadataRequest,
  type UpdatePostLocaleMetadataResponse,
} from "@echovisionlab/geul-proto/intra/post_pb.ts";
import {
  postInternalApi,
  throwIfCollaborationConflictResponse,
  throwIfCollaborationResourceNotFound,
} from "./transport.ts";

async function requirePostResponse(
  response: Response,
  postId: string,
  operation: string,
): Promise<void> {
  throwIfCollaborationResourceNotFound(
    response,
    CollaborativeDocumentType.POST,
    postId,
  );
  await throwIfCollaborationConflictResponse(response);
  if (!response.ok) {
    throw new Error(
      `Failed to ${operation}: ${response.status} ${response.statusText}`,
    );
  }
}

export async function loadPostBlockDocument(
  postId: string,
  locale: string,
  principal: CollaborationPrincipal,
): Promise<LoadPostBlockDocumentResponse> {
  const request = create(LoadPostBlockDocumentRequestSchema, {
    postId,
    locale,
    principal,
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalPostService/LoadPostBlockDocument",
    toJson(LoadPostBlockDocumentRequestSchema, request),
  );
  await requirePostResponse(response, postId, "load Post Block document");
  return fromJson(LoadPostBlockDocumentResponseSchema, await response.json());
}

export async function applyPostBlockBatch(
  postId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
): Promise<ApplyPostBlockBatchResponse> {
  const request = create(ApplyPostBlockBatchRequestSchema, {
    postId,
    locale,
    batch,
    affectedLocaleValues: [...affectedLocaleValues],
    expectedTargetRevision,
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalPostService/ApplyPostBlockBatch",
    toJson(ApplyPostBlockBatchRequestSchema, request),
  );
  await requirePostResponse(response, postId, "apply Post Block batch");
  return fromJson(ApplyPostBlockBatchResponseSchema, await response.json());
}

export async function updatePostLocaleMetadata(
  input: Omit<UpdatePostLocaleMetadataRequest, "$typeName">,
): Promise<UpdatePostLocaleMetadataResponse> {
  const request = create(UpdatePostLocaleMetadataRequestSchema, input);
  const response = await postInternalApi(
    "/api.intra.v1.InternalPostService/UpdatePostLocaleMetadata",
    toJson(UpdatePostLocaleMetadataRequestSchema, request),
  );
  await requirePostResponse(
    response,
    input.postId,
    "update Post locale metadata",
  );
  return fromJson(
    UpdatePostLocaleMetadataResponseSchema,
    await response.json(),
  );
}

export async function updatePostDocumentMetadata(
  input: Omit<UpdatePostDocumentMetadataRequest, "$typeName">,
): Promise<UpdatePostDocumentMetadataResponse> {
  const request = create(UpdatePostDocumentMetadataRequestSchema, input);
  const response = await postInternalApi(
    "/api.intra.v1.InternalPostService/UpdatePostDocumentMetadata",
    toJson(UpdatePostDocumentMetadataRequestSchema, request),
  );
  await requirePostResponse(
    response,
    input.postId,
    "update Post document metadata",
  );
  return fromJson(
    UpdatePostDocumentMetadataResponseSchema,
    await response.json(),
  );
}

export async function createPostVersionCheckpoint(
  postId: string,
  locale: string,
  expectedRevision: string,
  contributorMemberIds: readonly string[],
): Promise<CreatePostVersionCheckpointResponse> {
  const request = create(CreatePostVersionCheckpointRequestSchema, {
    postId,
    locale,
    expectedRevision,
    contributorMemberIds: [...contributorMemberIds],
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalPostService/CreatePostVersionCheckpoint",
    toJson(CreatePostVersionCheckpointRequestSchema, request),
  );
  await requirePostResponse(response, postId, "create Post version checkpoint");
  return fromJson(
    CreatePostVersionCheckpointResponseSchema,
    await response.json(),
  );
}
