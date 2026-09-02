import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import {
  readJsonResponse,
  postInternalApi,
  throwIfCollaborationResourceNotFound,
} from "./transport.ts";

// ============================================================================
// Email Layout exact-locale document API
// ============================================================================

interface SaveEmailLayoutDocumentRequest {
  emailLayoutId: string;
  locale: string;
  contentHtml?: string;
  contentText?: string;
  localeValues?: ReadonlyArray<{ handle: string; value: string }>;
  contributorMemberIds?: string[];
  expectedDocumentRevision: string;
  expectedTargetRevision?: string;
}

interface SaveEmailLayoutDocumentResponse {
  success: boolean;
  locale: string;
  documentRevision: string;
  targetRevision?: string;
}

interface LoadEmailLayoutDocumentRequest {
  emailLayoutId: string;
  locale: string;
}

interface LoadEmailLayoutDocumentResponse {
  contentHtml?: string;
  contentText?: string;
  sourceLocale: string;
  locale: string;
  documentRevision: string;
  targetRevision?: string;
  units: ReadonlyArray<{
    handle: string;
    kind: "text" | "attribute";
    element: string;
    attribute: string;
    order: number;
    sourceValue: string;
  }>;
  localeValues: ReadonlyArray<{ handle: string; value: string }>;
}

export async function saveEmailLayoutDocument(
  req: SaveEmailLayoutDocumentRequest,
): Promise<SaveEmailLayoutDocumentResponse> {
  const response = await postInternalApi(
    "/api.intra.v1.InternalEmailLayoutService/SaveDocument",
    {
      emailLayoutId: req.emailLayoutId,
      locale: req.locale,
      contentHtml: req.contentHtml,
      contentText: req.contentText,
      localeValues: req.localeValues,
      contributorMemberIds: req.contributorMemberIds,
      expectedDocumentRevision: req.expectedDocumentRevision,
      expectedTargetRevision: req.expectedTargetRevision,
    },
  );

  throwIfCollaborationResourceNotFound(
    response,
    CollaborativeDocumentType.EMAIL_LAYOUT,
    req.emailLayoutId,
  );
  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    const errorSuffix = errorBody ? ` ${errorBody.slice(0, 500)}` : "";
    throw new Error(
      `Failed to save email layout document: ${response.status} ${response.statusText}${errorSuffix}`,
    );
  }

  return readJsonResponse<SaveEmailLayoutDocumentResponse>(response);
}

export async function loadEmailLayoutDocument(
  req: LoadEmailLayoutDocumentRequest,
): Promise<LoadEmailLayoutDocumentResponse> {
  const response = await postInternalApi(
    "/api.intra.v1.InternalEmailLayoutService/LoadDocument",
    {
      emailLayoutId: req.emailLayoutId,
      locale: req.locale,
    },
  );

  if (response.status === 404) {
    return {
      sourceLocale: "",
      locale: req.locale,
      documentRevision: "",
      units: [],
      localeValues: [],
    };
  }
  if (!response.ok) {
    throw new Error(
      `Failed to load email layout document: ${response.status} ${response.statusText}`,
    );
  }

  const data = await readJsonResponse<{
    contentHtml?: string;
    contentText?: string;
    sourceLocale?: string;
    locale?: string;
    documentRevision?: string;
    targetRevision?: string;
    units?: LoadEmailLayoutDocumentResponse["units"];
    localeValues?: LoadEmailLayoutDocumentResponse["localeValues"];
  }>(response);
  return {
    contentHtml: data.contentHtml,
    contentText: data.contentText,
    sourceLocale: data.sourceLocale ?? "",
    locale: data.locale ?? "",
    documentRevision: data.documentRevision ?? "",
    targetRevision: data.targetRevision,
    units: data.units ?? [],
    localeValues: data.localeValues ?? [],
  };
}
