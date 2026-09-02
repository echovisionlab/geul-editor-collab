import type { CollaborationPrincipal } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import * as artist from "@echovisionlab/geul-proto/intra/artist_pb.ts";
import * as campaign from "@echovisionlab/geul-proto/intra/campaign_pb.ts";
import * as emailTemplate from "@echovisionlab/geul-proto/intra/email_template_pb.ts";
import * as label from "@echovisionlab/geul-proto/intra/label_pb.ts";
import * as privacy from "@echovisionlab/geul-proto/intra/privacy_pb.ts";
import * as programEvent from "@echovisionlab/geul-proto/intra/program_event_pb.ts";
import * as release from "@echovisionlab/geul-proto/intra/release_pb.ts";
import * as terms from "@echovisionlab/geul-proto/intra/terms_pb.ts";
import type {
  ResidentSourceMetadataProjection,
  ResidentRichTextDocumentLoad,
  ResidentRichTextDocumentType,
} from "./resident-block-domain.ts";
import { callResidentRpc } from "./resident-block-rpc.ts";

interface ResidentLoadResponse {
  document?: ResidentRichTextDocumentLoad["document"];
  documentRevision: string;
  locale: string;
  localeExists: boolean;
  targetRevision?: string;
  presentLocaleValues: readonly AIDocumentFieldTarget[];
  sourceMetadata?: SourceMetadataMessage;
  localeMetadata?: SourceMetadataMessage;
}

interface SourceMetadataMessage {
  locale: string;
  title?: string;
  summary?: string;
  subject?: string;
  creditNotes?: readonly { creditId: string; note: string }[];
}

type ResidentLoader = (
  entityId: string,
  locale: string,
  principal: CollaborationPrincipal,
) => Promise<ResidentLoadResponse>;

function loadArtist(
  entityId: string,
  locale: string,
  principal: CollaborationPrincipal,
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalArtistService/LoadArtistBlockDocument",
      requestSchema: artist.LoadArtistBlockDocumentRequestSchema,
      responseSchema: artist.LoadArtistBlockDocumentResponseSchema,
      operation: "load Artist Block document",
    },
    "artist",
    entityId,
    { artistId: entityId, locale, principal },
  );
}

function loadLabel(
  entityId: string,
  locale: string,
  principal: CollaborationPrincipal,
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalLabelService/LoadLabelBlockDocument",
      requestSchema: label.LoadLabelBlockDocumentRequestSchema,
      responseSchema: label.LoadLabelBlockDocumentResponseSchema,
      operation: "load Label Block document",
    },
    "label",
    entityId,
    { labelId: entityId, locale, principal },
  );
}

function loadRelease(
  entityId: string,
  locale: string,
  principal: CollaborationPrincipal,
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalReleaseService/LoadReleaseBlockDocument",
      requestSchema: release.LoadReleaseBlockDocumentRequestSchema,
      responseSchema: release.LoadReleaseBlockDocumentResponseSchema,
      operation: "load Release Block document",
    },
    "release",
    entityId,
    { releaseId: entityId, locale, principal },
  );
}

function loadProgramEvent(
  entityId: string,
  locale: string,
  principal: CollaborationPrincipal,
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalProgramEventService/LoadProgramEventBlockDocument",
      requestSchema: programEvent.LoadProgramEventBlockDocumentRequestSchema,
      responseSchema: programEvent.LoadProgramEventBlockDocumentResponseSchema,
      operation: "load Program Event Block document",
    },
    "program-event",
    entityId,
    { eventId: entityId, locale, principal },
  );
}

function loadCampaign(
  entityId: string,
  locale: string,
  principal: CollaborationPrincipal,
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalCampaignService/LoadDocument",
      requestSchema: campaign.LoadCampaignDocumentRequestSchema,
      responseSchema: campaign.LoadCampaignDocumentResponseSchema,
      operation: "load Campaign Block document",
    },
    "campaign",
    entityId,
    { campaignId: entityId, locale, principal },
  );
}

function loadEmailTemplate(
  entityId: string,
  locale: string,
  principal: CollaborationPrincipal,
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalEmailTemplateService/LoadDocument",
      requestSchema: emailTemplate.LoadEmailTemplateDocumentRequestSchema,
      responseSchema: emailTemplate.LoadEmailTemplateDocumentResponseSchema,
      operation: "load Email Template Block document",
    },
    "email-template",
    entityId,
    { emailTemplateId: entityId, locale, principal },
  );
}

function loadPrivacy(
  entityId: string,
  locale: string,
  principal: CollaborationPrincipal,
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalPrivacyService/LoadPrivacyBlockDocument",
      requestSchema: privacy.LoadPrivacyBlockDocumentRequestSchema,
      responseSchema: privacy.LoadPrivacyBlockDocumentResponseSchema,
      operation: "load Privacy Block document",
    },
    "privacy-history",
    entityId,
    { privacyId: entityId, locale, principal },
  );
}

function loadTerms(
  entityId: string,
  locale: string,
  principal: CollaborationPrincipal,
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalTermsService/LoadTermsBlockDocument",
      requestSchema: terms.LoadTermsBlockDocumentRequestSchema,
      responseSchema: terms.LoadTermsBlockDocumentResponseSchema,
      operation: "load Terms Block document",
    },
    "terms-history",
    entityId,
    { termsId: entityId, locale, principal },
  );
}

const loaders = {
  artist: loadArtist,
  label: loadLabel,
  release: loadRelease,
  "program-event": loadProgramEvent,
  campaign: loadCampaign,
  "email-template": loadEmailTemplate,
  "privacy-history": loadPrivacy,
  "terms-history": loadTerms,
} satisfies Record<ResidentRichTextDocumentType, ResidentLoader>;

function requireDocument(
  document: ResidentLoadResponse["document"],
  type: ResidentRichTextDocumentType,
): ResidentRichTextDocumentLoad["document"] {
  if (!document) {
    throw new Error(`block_document_missing:${type}`);
  }
  return document;
}

export function projectSourceMetadata(
  value: SourceMetadataMessage | undefined,
): ResidentSourceMetadataProjection | undefined {
  return value
    ? {
        locale: value.locale,
        ...(value.title === undefined ? {} : { title: value.title }),
        ...(value.summary === undefined ? {} : { summary: value.summary }),
        ...(value.subject === undefined ? {} : { subject: value.subject }),
        ...(value.creditNotes === undefined
          ? {}
          : {
              creditNotes: value.creditNotes.map(({ creditId, note }) => ({
                creditId,
                note,
              })),
            }),
      }
    : undefined;
}

export async function loadResidentBlockDocument(
  type: ResidentRichTextDocumentType,
  entityId: string,
  locale: string,
  principal: CollaborationPrincipal,
): Promise<ResidentRichTextDocumentLoad> {
  const response = await loaders[type](entityId, locale, principal);
  const sourceMetadata = projectSourceMetadata(response.sourceMetadata);
  if (!sourceMetadata) throw new Error(`source_metadata_missing:${type}`);
  return {
    document: requireDocument(response.document, type),
    documentRevision: response.documentRevision,
    locale: response.locale,
    localeExists: response.localeExists,
    presentLocaleValues: response.presentLocaleValues,
    ...(response.targetRevision === undefined
      ? {}
      : { targetRevision: response.targetRevision }),
    sourceMetadata,
    ...(response.localeMetadata === undefined
      ? {}
      : { localeMetadata: projectSourceMetadata(response.localeMetadata) }),
  };
}
