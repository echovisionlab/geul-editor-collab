import { create, fromJson, toJson } from "@bufbuild/protobuf";
import type {
  DescMessage,
  MessageInitShape,
  MessageShape,
} from "@bufbuild/protobuf";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import type { ResidentRichTextDocumentType } from "./resident-block-domain.ts";
import {
  postInternalApi,
  throwIfCollaborationConflictResponse,
  throwIfCollaborationResourceNotFound,
} from "./transport.ts";

const collaborationTypes: Record<
  ResidentRichTextDocumentType,
  CollaborativeDocumentType
> = {
  artist: CollaborativeDocumentType.ARTIST,
  campaign: CollaborativeDocumentType.CAMPAIGN,
  "email-template": CollaborativeDocumentType.EMAIL_TEMPLATE,
  label: CollaborativeDocumentType.LABEL,
  "privacy-history": CollaborativeDocumentType.PRIVACY_HISTORY,
  "program-event": CollaborativeDocumentType.PROGRAM_EVENT,
  release: CollaborativeDocumentType.RELEASE,
  "terms-history": CollaborativeDocumentType.TERMS_HISTORY,
};

export interface ResidentRpc<
  Request extends DescMessage,
  Response extends DescMessage,
> {
  path: string;
  requestSchema: Request;
  responseSchema: Response;
  operation: string;
}

export async function callResidentRpc<
  Request extends DescMessage,
  Response extends DescMessage,
>(
  rpc: ResidentRpc<Request, Response>,
  type: ResidentRichTextDocumentType,
  entityId: string,
  request: MessageInitShape<Request>,
): Promise<MessageShape<Response>> {
  const response = await postInternalApi(
    rpc.path,
    toJson(rpc.requestSchema, create(rpc.requestSchema, request)),
  );
  throwIfCollaborationResourceNotFound(
    response,
    collaborationTypes[type],
    entityId,
  );
  await throwIfCollaborationConflictResponse(response);
  if (!response.ok) {
    throw new Error(
      `Failed to ${rpc.operation}: ${response.status} ${response.statusText}`,
    );
  }
  const result = fromJson(rpc.responseSchema, await response.json());
  const expectedLocale = (request as { locale?: unknown }).locale;
  const actualLocale = (result as { locale?: unknown }).locale;
  if (typeof expectedLocale === "string" && actualLocale !== expectedLocale) {
    throw new Error(`collaboration_response_locale_mismatch:${expectedLocale}`);
  }
  return result;
}
