import type { RichTextBlockMutationBatch } from "@echovisionlab/geul-proto/content/block_content_pb.ts";
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
  ResidentRichTextDocumentAck,
  ResidentRichTextDocumentType,
} from "./resident-block-domain.ts";
import { callResidentRpc } from "./resident-block-rpc.ts";

type ResidentBatcher = (
  entityId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues?: readonly AIDocumentFieldTarget[],
) => Promise<ResidentRichTextDocumentAck>;

function applyArtist(
  entityId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalArtistService/ApplyArtistBlockBatch",
      requestSchema: artist.ApplyArtistBlockBatchRequestSchema,
      responseSchema: artist.ApplyArtistBlockBatchResponseSchema,
      operation: "apply Artist Block batch",
    },
    "artist",
    entityId,
    {
      artistId: entityId,
      locale,
      batch,
      affectedLocaleValues: [...affectedLocaleValues],
      expectedTargetRevision,
    },
  );
}

function applyLabel(
  entityId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalLabelService/ApplyLabelBlockBatch",
      requestSchema: label.ApplyLabelBlockBatchRequestSchema,
      responseSchema: label.ApplyLabelBlockBatchResponseSchema,
      operation: "apply Label Block batch",
    },
    "label",
    entityId,
    {
      labelId: entityId,
      locale,
      batch,
      affectedLocaleValues: [...affectedLocaleValues],
      expectedTargetRevision,
    },
  );
}

function applyRelease(
  entityId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalReleaseService/ApplyReleaseBlockBatch",
      requestSchema: release.ApplyReleaseBlockBatchRequestSchema,
      responseSchema: release.ApplyReleaseBlockBatchResponseSchema,
      operation: "apply Release Block batch",
    },
    "release",
    entityId,
    {
      releaseId: entityId,
      locale,
      batch,
      affectedLocaleValues: [...affectedLocaleValues],
      expectedTargetRevision,
    },
  );
}

function applyProgramEvent(
  entityId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalProgramEventService/ApplyProgramEventBlockBatch",
      requestSchema: programEvent.ApplyProgramEventBlockBatchRequestSchema,
      responseSchema: programEvent.ApplyProgramEventBlockBatchResponseSchema,
      operation: "apply Program Event Block batch",
    },
    "program-event",
    entityId,
    {
      eventId: entityId,
      locale,
      batch,
      affectedLocaleValues: [...affectedLocaleValues],
      expectedTargetRevision,
    },
  );
}

function applyCampaign(
  entityId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalCampaignService/ApplyBlockBatch",
      requestSchema: campaign.ApplyCampaignBlockBatchRequestSchema,
      responseSchema: campaign.ApplyCampaignBlockBatchResponseSchema,
      operation: "apply Campaign Block batch",
    },
    "campaign",
    entityId,
    {
      campaignId: entityId,
      locale,
      batch,
      affectedLocaleValues: [...affectedLocaleValues],
      expectedTargetRevision,
    },
  );
}

function applyEmailTemplate(
  entityId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalEmailTemplateService/ApplyBlockBatch",
      requestSchema: emailTemplate.ApplyEmailTemplateBlockBatchRequestSchema,
      responseSchema: emailTemplate.ApplyEmailTemplateBlockBatchResponseSchema,
      operation: "apply Email Template Block batch",
    },
    "email-template",
    entityId,
    {
      emailTemplateId: entityId,
      locale,
      batch,
      affectedLocaleValues: [...affectedLocaleValues],
      expectedTargetRevision,
    },
  );
}

function applyPrivacy(
  entityId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalPrivacyService/ApplyPrivacyBlockBatch",
      requestSchema: privacy.ApplyPrivacyBlockBatchRequestSchema,
      responseSchema: privacy.ApplyPrivacyBlockBatchResponseSchema,
      operation: "apply Privacy Block batch",
    },
    "privacy-history",
    entityId,
    {
      privacyId: entityId,
      locale,
      batch,
      affectedLocaleValues: [...affectedLocaleValues],
      expectedTargetRevision,
    },
  );
}

function applyTerms(
  entityId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalTermsService/ApplyTermsBlockBatch",
      requestSchema: terms.ApplyTermsBlockBatchRequestSchema,
      responseSchema: terms.ApplyTermsBlockBatchResponseSchema,
      operation: "apply Terms Block batch",
    },
    "terms-history",
    entityId,
    {
      termsId: entityId,
      locale,
      batch,
      affectedLocaleValues: [...affectedLocaleValues],
      expectedTargetRevision,
    },
  );
}

const batchers = {
  artist: applyArtist,
  label: applyLabel,
  release: applyRelease,
  "program-event": applyProgramEvent,
  campaign: applyCampaign,
  "email-template": applyEmailTemplate,
  "privacy-history": applyPrivacy,
  "terms-history": applyTerms,
} satisfies Record<ResidentRichTextDocumentType, ResidentBatcher>;

export async function applyResidentBlockBatch(
  type: ResidentRichTextDocumentType,
  entityId: string,
  locale: string,
  batch: RichTextBlockMutationBatch,
  expectedTargetRevision?: string,
  affectedLocaleValues: readonly AIDocumentFieldTarget[] = [],
): Promise<ResidentRichTextDocumentAck> {
  const ack = await batchers[type](
    entityId,
    locale,
    batch,
    expectedTargetRevision,
    affectedLocaleValues,
  );
  return {
    documentRevision: ack.documentRevision,
    changed: ack.changed,
    sourceChanged: ack.sourceChanged,
    locale: ack.locale,
    ...(ack.targetRevision === undefined
      ? {}
      : { targetRevision: ack.targetRevision }),
  };
}
