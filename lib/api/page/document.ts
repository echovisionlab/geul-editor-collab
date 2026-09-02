import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import type { PageSectionMutationBatch } from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import type { CollaborationPrincipal } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import {
  ApplyPageBlockBatchRequestSchema,
  ApplyPageBlockBatchResponseSchema,
  CreatePageVersionCheckpointRequestSchema,
  CreatePageVersionCheckpointResponseSchema,
  LoadPageBlockDocumentRequestSchema,
  LoadPageBlockDocumentResponseSchema,
  UpdatePageDocumentMetadataRequestSchema,
  UpdatePageDocumentMetadataResponseSchema,
  UpdatePageLocaleMetadataRequestSchema,
  UpdatePageLocaleMetadataResponseSchema,
  type ApplyPageBlockBatchResponse,
  type CreatePageVersionCheckpointResponse,
  type LoadPageBlockDocumentResponse,
  type UpdatePageDocumentMetadataRequest,
  type UpdatePageDocumentMetadataResponse,
  type UpdatePageLocaleMetadataRequest,
  type UpdatePageLocaleMetadataResponse,
} from "@echovisionlab/geul-proto/intra/page_pb.ts";
import {
  CollaborationPersistenceRejectedError,
  postInternalApi,
  throwIfCollaborationConflictResponse,
  throwIfCollaborationResourceNotFound,
} from "../transport.ts";

async function requirePageResponse(
  response: Response,
  pageId: string,
  operation: string,
): Promise<void> {
  throwIfCollaborationResourceNotFound(
    response,
    CollaborativeDocumentType.PAGE,
    pageId,
  );
  await throwIfCollaborationConflictResponse(response);
  if (!response.ok) {
    throw new CollaborationPersistenceRejectedError(response.status, operation);
  }
}

export async function loadPageBlockDocument(
  pageId: string,
  locale: string,
  principal: CollaborationPrincipal,
  signal?: AbortSignal,
): Promise<LoadPageBlockDocumentResponse> {
  const request = create(LoadPageBlockDocumentRequestSchema, {
    pageId,
    locale,
    principal,
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalPageService/LoadPageBlockDocument",
    toJson(LoadPageBlockDocumentRequestSchema, request),
    signal,
  );
  await requirePageResponse(response, pageId, "load Page Block document");
  return fromJson(LoadPageBlockDocumentResponseSchema, await response.json());
}

export async function applyPageBlockBatch(
  pageId: string,
  locale: string,
  batch: PageSectionMutationBatch,
  signal?: AbortSignal,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
): Promise<ApplyPageBlockBatchResponse> {
  const request = create(ApplyPageBlockBatchRequestSchema, {
    pageId,
    locale,
    batch,
    affectedLocaleValues: [...affectedLocaleValues],
    expectedTargetRevision,
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalPageService/ApplyPageBlockBatch",
    toJson(ApplyPageBlockBatchRequestSchema, request),
    signal,
  );
  await requirePageResponse(response, pageId, "apply Page Block batch");
  return fromJson(ApplyPageBlockBatchResponseSchema, await response.json());
}

export async function updatePageLocaleMetadata(
  input: Omit<UpdatePageLocaleMetadataRequest, "$typeName">,
): Promise<UpdatePageLocaleMetadataResponse> {
  const request = create(UpdatePageLocaleMetadataRequestSchema, input);
  const response = await postInternalApi(
    "/api.intra.v1.InternalPageService/UpdatePageLocaleMetadata",
    toJson(UpdatePageLocaleMetadataRequestSchema, request),
  );
  await requirePageResponse(
    response,
    input.pageId,
    "update Page locale metadata",
  );
  return fromJson(
    UpdatePageLocaleMetadataResponseSchema,
    await response.json(),
  );
}

export async function updatePageDocumentMetadata(
  input: Omit<UpdatePageDocumentMetadataRequest, "$typeName">,
): Promise<UpdatePageDocumentMetadataResponse> {
  const request = create(UpdatePageDocumentMetadataRequestSchema, input);
  const response = await postInternalApi(
    "/api.intra.v1.InternalPageService/UpdatePageDocumentMetadata",
    toJson(UpdatePageDocumentMetadataRequestSchema, request),
  );
  await requirePageResponse(
    response,
    input.pageId,
    "update Page document metadata",
  );
  return fromJson(
    UpdatePageDocumentMetadataResponseSchema,
    await response.json(),
  );
}

export async function createPageVersionCheckpoint(
  pageId: string,
  locale: string,
  expectedRevision: string,
  contributorMemberIds: readonly string[],
): Promise<CreatePageVersionCheckpointResponse> {
  const request = create(CreatePageVersionCheckpointRequestSchema, {
    pageId,
    locale,
    expectedRevision,
    contributorMemberIds: [...contributorMemberIds],
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalPageService/CreatePageVersionCheckpoint",
    toJson(CreatePageVersionCheckpointRequestSchema, request),
  );
  await requirePageResponse(response, pageId, "create Page version checkpoint");
  return fromJson(
    CreatePageVersionCheckpointResponseSchema,
    await response.json(),
  );
}
