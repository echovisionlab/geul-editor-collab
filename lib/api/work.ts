import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import type { RichTextBlockMutationBatch } from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import type { CollaborationPrincipal } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import {
  ApplyWorkBlockBatchRequestSchema,
  ApplyWorkBlockBatchResponseSchema,
  CreateWorkVersionCheckpointRequestSchema,
  CreateWorkVersionCheckpointResponseSchema,
  LoadWorkBlockDocumentRequestSchema,
  LoadWorkBlockDocumentResponseSchema,
  UpdateWorkLocaleMetadataRequestSchema,
  UpdateWorkLocaleMetadataResponseSchema,
  type ApplyWorkBlockBatchResponse,
  type CreateWorkVersionCheckpointResponse,
  type LoadWorkBlockDocumentResponse,
  type UpdateWorkLocaleMetadataRequest,
  type UpdateWorkLocaleMetadataResponse,
} from "@echovisionlab/geul-proto/intra/work_pb.ts";
import {
  postInternalApi,
  throwIfCollaborationConflictResponse,
  throwIfCollaborationResourceNotFound,
} from "./transport.ts";

async function requireWorkResponse(
  response: Response,
  workId: string,
  operation: string,
): Promise<void> {
  throwIfCollaborationResourceNotFound(
    response,
    CollaborativeDocumentType.WORK,
    workId,
  );
  await throwIfCollaborationConflictResponse(response);
  if (!response.ok) {
    throw new Error(
      `Failed to ${operation}: ${response.status} ${response.statusText}`,
    );
  }
}

export async function loadWorkBlockDocument(
  workId: string,
  locale: string,
  principal: CollaborationPrincipal,
): Promise<LoadWorkBlockDocumentResponse> {
  const request = create(LoadWorkBlockDocumentRequestSchema, {
    workId,
    locale,
    principal,
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalWorkService/LoadWorkBlockDocument",
    toJson(LoadWorkBlockDocumentRequestSchema, request),
  );
  await requireWorkResponse(response, workId, "load Work Block document");
  return fromJson(LoadWorkBlockDocumentResponseSchema, await response.json());
}

export async function applyWorkBlockBatch(
  workId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
): Promise<ApplyWorkBlockBatchResponse> {
  const request = create(ApplyWorkBlockBatchRequestSchema, {
    workId,
    locale,
    batch,
    affectedLocaleValues: [...affectedLocaleValues],
    expectedTargetRevision,
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalWorkService/ApplyWorkBlockBatch",
    toJson(ApplyWorkBlockBatchRequestSchema, request),
  );
  await requireWorkResponse(response, workId, "apply Work Block batch");
  return fromJson(ApplyWorkBlockBatchResponseSchema, await response.json());
}

export async function updateWorkLocaleMetadata(
  input: Omit<UpdateWorkLocaleMetadataRequest, "$typeName">,
): Promise<UpdateWorkLocaleMetadataResponse> {
  const request = create(UpdateWorkLocaleMetadataRequestSchema, input);
  const response = await postInternalApi(
    "/api.intra.v1.InternalWorkService/UpdateWorkLocaleMetadata",
    toJson(UpdateWorkLocaleMetadataRequestSchema, request),
  );
  await requireWorkResponse(
    response,
    input.workId,
    "update Work locale metadata",
  );
  return fromJson(
    UpdateWorkLocaleMetadataResponseSchema,
    await response.json(),
  );
}

export async function createWorkVersionCheckpoint(
  workId: string,
  locale: string,
  expectedRevision: string,
  contributorMemberIds: readonly string[],
): Promise<CreateWorkVersionCheckpointResponse> {
  const request = create(CreateWorkVersionCheckpointRequestSchema, {
    workId,
    locale,
    expectedRevision,
    contributorMemberIds: [...contributorMemberIds],
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalWorkService/CreateWorkVersionCheckpoint",
    toJson(CreateWorkVersionCheckpointRequestSchema, request),
  );
  await requireWorkResponse(response, workId, "create Work version checkpoint");
  return fromJson(
    CreateWorkVersionCheckpointResponseSchema,
    await response.json(),
  );
}
