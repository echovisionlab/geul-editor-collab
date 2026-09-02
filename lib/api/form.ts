import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import {
  formCollabFieldsSchema,
  type FormCollabFields,
} from "@echovisionlab/geul-common/collaboration/form";
import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import {
  LoadFormDocumentResponseSchema,
  FormMetaSchema,
  SaveFormDocumentRequestSchema,
  SaveFormDocumentResponseSchema,
  type FormMeta,
  type SaveFormDocumentResponse as SaveFormDocumentProtoResponse,
} from "@echovisionlab/geul-proto/intra/form_pb.ts";
import {
  postInternalApi,
  throwIfCollaborationResourceNotFound,
} from "./transport.ts";

export interface SaveFormDocumentRequest {
  formId: string;
  locale: string;
  fields: FormCollabFields;
  presentLocaleValues: readonly AIDocumentFieldTarget[];
  contributorMemberIds: readonly string[];
  expectedDocumentRevision: string;
  expectedTargetRevision?: string;
}

type SaveFormDocumentResponse = Pick<
  SaveFormDocumentProtoResponse,
  "success" | "locale" | "documentRevision" | "targetRevision"
>;

interface LoadFormDocumentRequest {
  formId: string;
  locale: string;
}

export interface LoadFormDocumentResponse {
  source: FormCollabFields;
  requested: FormCollabFields;
  sourceLocale: string;
  locale: string;
  localeExists: boolean;
  presentLocaleValues: readonly AIDocumentFieldTarget[];
  documentRevision: string;
  targetRevision?: string;
}

function parseFields(metadata: FormMeta | undefined): FormCollabFields {
  const fields: FormCollabFields = {
    ...(metadata?.title === undefined ? {} : { title: metadata.title }),
    ...(metadata?.schema === undefined
      ? {}
      : { schema: JSON.parse(metadata.schema) as unknown }),
  };
  return formCollabFieldsSchema.parse(fields);
}

function formMetadata(fields: FormCollabFields): FormMeta {
  return create(FormMetaSchema, {
    ...(fields.title === undefined ? {} : { title: fields.title }),
    ...(fields.schema === undefined
      ? {}
      : { schema: JSON.stringify(fields.schema) }),
  });
}

export async function saveFormDocument(
  req: SaveFormDocumentRequest,
): Promise<SaveFormDocumentResponse> {
  const request = create(SaveFormDocumentRequestSchema, {
    formId: req.formId,
    locale: req.locale,
    meta: formMetadata(req.fields),
    presentLocaleValues: [...req.presentLocaleValues],
    contributorMemberIds: [...req.contributorMemberIds],
    expectedDocumentRevision: req.expectedDocumentRevision,
    expectedTargetRevision: req.expectedTargetRevision,
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalFormService/SaveDocument",
    toJson(SaveFormDocumentRequestSchema, request),
  );

  throwIfCollaborationResourceNotFound(
    response,
    CollaborativeDocumentType.FORM,
    req.formId,
  );
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Failed to save form document: ${response.status} ${response.statusText}${errorBody ? ` - ${errorBody}` : ""}`,
    );
  }

  return fromJson(SaveFormDocumentResponseSchema, await response.json());
}

export async function loadFormDocument(
  req: LoadFormDocumentRequest,
): Promise<LoadFormDocumentResponse> {
  const response = await postInternalApi(
    "/api.intra.v1.InternalFormService/LoadDocument",
    { formId: req.formId, locale: req.locale },
  );

  if (response.status === 404) {
    return {
      source: {},
      requested: {},
      sourceLocale: "",
      locale: req.locale,
      localeExists: false,
      presentLocaleValues: [],
      documentRevision: "",
    };
  }
  if (!response.ok) {
    throw new Error(
      `Failed to load form document: ${response.status} ${response.statusText}`,
    );
  }

  const data = fromJson(LoadFormDocumentResponseSchema, await response.json());
  return {
    source: parseFields(data.sourceMetadata),
    requested: parseFields(data.localeMetadata),
    sourceLocale: data.sourceLocale,
    locale: data.locale,
    localeExists: data.localeExists,
    presentLocaleValues: data.presentLocaleValues,
    documentRevision: data.documentRevision,
    ...(data.targetRevision === undefined
      ? {}
      : { targetRevision: data.targetRevision }),
  };
}
