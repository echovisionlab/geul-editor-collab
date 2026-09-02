import { create } from "@bufbuild/protobuf";
import { NullableStringMutationSchema } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import * as artist from "@echovisionlab/geul-proto/intra/artist_pb.ts";
import * as campaign from "@echovisionlab/geul-proto/intra/campaign_pb.ts";
import * as emailTemplate from "@echovisionlab/geul-proto/intra/email_template_pb.ts";
import * as label from "@echovisionlab/geul-proto/intra/label_pb.ts";
import * as privacy from "@echovisionlab/geul-proto/intra/privacy_pb.ts";
import * as programEvent from "@echovisionlab/geul-proto/intra/program_event_pb.ts";
import * as release from "@echovisionlab/geul-proto/intra/release_pb.ts";
import * as terms from "@echovisionlab/geul-proto/intra/terms_pb.ts";
import type {
  ResidentRichTextMetadataAck,
  ResidentRichTextMetadataUpdate,
} from "./resident-block-domain.ts";
import { callResidentRpc } from "./resident-block-rpc.ts";

type MetadataType = ResidentRichTextMetadataUpdate["type"];
type MetadataInput<Type extends MetadataType> = Extract<
  ResidentRichTextMetadataUpdate,
  { type: Type }
>;
type ResidentMetadataUpdater<Type extends MetadataType> = (
  entityId: string,
  locale: string,
  input: MetadataInput<Type>,
  expectedRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
) => Promise<ResidentRichTextMetadataAck>;

function nullableSummary(value: string | null | undefined) {
  if (value === undefined) {
    return undefined;
  }
  return create(NullableStringMutationSchema, {
    operation:
      value === null ? { case: "clear", value: true } : { case: "set", value },
  });
}

function updateArtist(
  entityId: string,
  locale: string,
  input: MetadataInput<"artist">,
  expectedRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalArtistService/UpdateArtistLocaleMetadata",
      requestSchema: artist.UpdateArtistLocaleMetadataRequestSchema,
      responseSchema: artist.UpdateArtistLocaleMetadataResponseSchema,
      operation: "update Artist locale metadata",
    },
    "artist",
    entityId,
    {
      artistId: entityId,
      title: input.title,
      expectedRevision,
      expectedTargetRevision,
      contributorMemberIds: [...contributorMemberIds],
      locale,
    },
  );
}

function updateLabel(
  entityId: string,
  locale: string,
  input: MetadataInput<"label">,
  expectedRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalLabelService/UpdateLabelLocaleMetadata",
      requestSchema: label.UpdateLabelLocaleMetadataRequestSchema,
      responseSchema: label.UpdateLabelLocaleMetadataResponseSchema,
      operation: "update Label locale metadata",
    },
    "label",
    entityId,
    {
      labelId: entityId,
      title: input.title,
      expectedRevision,
      expectedTargetRevision,
      contributorMemberIds: [...contributorMemberIds],
      locale,
    },
  );
}

function updateRelease(
  entityId: string,
  locale: string,
  input: MetadataInput<"release">,
  expectedRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalReleaseService/UpdateReleaseLocaleMetadata",
      requestSchema: release.UpdateReleaseLocaleMetadataRequestSchema,
      responseSchema: release.UpdateReleaseLocaleMetadataResponseSchema,
      operation: "update Release locale metadata",
    },
    "release",
    entityId,
    {
      releaseId: entityId,
      title: input.title,
      creditNotes: input.creditNotes
        ? create(release.ReleaseCreditNotesValueSchema, {
            values: [...input.creditNotes],
          })
        : undefined,
      expectedRevision,
      expectedTargetRevision,
      contributorMemberIds: [...contributorMemberIds],
      locale,
    },
  );
}

function updateProgramEvent(
  entityId: string,
  locale: string,
  input: MetadataInput<"program-event">,
  expectedRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalProgramEventService/UpdateProgramEventLocaleMetadata",
      requestSchema: programEvent.UpdateProgramEventLocaleMetadataRequestSchema,
      responseSchema:
        programEvent.UpdateProgramEventLocaleMetadataResponseSchema,
      operation: "update Program Event locale metadata",
    },
    "program-event",
    entityId,
    {
      eventId: entityId,
      title: input.title,
      summary: nullableSummary(input.summary),
      expectedRevision,
      expectedTargetRevision,
      contributorMemberIds: [...contributorMemberIds],
      locale,
    },
  );
}

function updateCampaign(
  entityId: string,
  locale: string,
  input: MetadataInput<"campaign">,
  expectedRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalCampaignService/UpdateCampaignLocaleMetadata",
      requestSchema: campaign.UpdateCampaignLocaleMetadataRequestSchema,
      responseSchema: campaign.UpdateCampaignLocaleMetadataResponseSchema,
      operation: "update Campaign locale metadata",
    },
    "campaign",
    entityId,
    {
      campaignId: entityId,
      subject: input.subject,
      expectedRevision,
      expectedTargetRevision,
      contributorMemberIds: [...contributorMemberIds],
      locale,
    },
  );
}

function updateEmailTemplate(
  entityId: string,
  locale: string,
  input: MetadataInput<"email-template">,
  expectedRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalEmailTemplateService/UpdateEmailTemplateLocaleMetadata",
      requestSchema:
        emailTemplate.UpdateEmailTemplateLocaleMetadataRequestSchema,
      responseSchema:
        emailTemplate.UpdateEmailTemplateLocaleMetadataResponseSchema,
      operation: "update Email Template locale metadata",
    },
    "email-template",
    entityId,
    {
      emailTemplateId: entityId,
      subject: input.subject,
      expectedRevision,
      expectedTargetRevision,
      contributorMemberIds: [...contributorMemberIds],
      locale,
    },
  );
}

function updatePrivacy(
  entityId: string,
  locale: string,
  input: MetadataInput<"privacy-history">,
  expectedRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalPrivacyService/UpdatePrivacyLocaleMetadata",
      requestSchema: privacy.UpdatePrivacyLocaleMetadataRequestSchema,
      responseSchema: privacy.UpdatePrivacyLocaleMetadataResponseSchema,
      operation: "update Privacy locale metadata",
    },
    "privacy-history",
    entityId,
    {
      privacyId: entityId,
      title: input.title,
      expectedRevision,
      expectedTargetRevision,
      contributorMemberIds: [...contributorMemberIds],
      locale,
    },
  );
}

function updateTerms(
  entityId: string,
  locale: string,
  input: MetadataInput<"terms-history">,
  expectedRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
) {
  return callResidentRpc(
    {
      path: "/api.intra.v1.InternalTermsService/UpdateTermsLocaleMetadata",
      requestSchema: terms.UpdateTermsLocaleMetadataRequestSchema,
      responseSchema: terms.UpdateTermsLocaleMetadataResponseSchema,
      operation: "update Terms locale metadata",
    },
    "terms-history",
    entityId,
    {
      termsId: entityId,
      title: input.title,
      expectedRevision,
      expectedTargetRevision,
      contributorMemberIds: [...contributorMemberIds],
      locale,
    },
  );
}

const metadataUpdaters = {
  artist: updateArtist,
  label: updateLabel,
  release: updateRelease,
  "program-event": updateProgramEvent,
  campaign: updateCampaign,
  "email-template": updateEmailTemplate,
  "privacy-history": updatePrivacy,
  "terms-history": updateTerms,
} satisfies {
  [Type in MetadataType]: ResidentMetadataUpdater<Type>;
};

function updateByType(
  entityId: string,
  locale: string,
  input: ResidentRichTextMetadataUpdate,
  expectedRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
): Promise<ResidentRichTextMetadataAck> {
  switch (input.type) {
    case "artist":
      return metadataUpdaters.artist(
        entityId,
        locale,
        input,
        expectedRevision,
        expectedTargetRevision,
        contributorMemberIds,
      );
    case "label":
      return metadataUpdaters.label(
        entityId,
        locale,
        input,
        expectedRevision,
        expectedTargetRevision,
        contributorMemberIds,
      );
    case "release":
      return metadataUpdaters.release(
        entityId,
        locale,
        input,
        expectedRevision,
        expectedTargetRevision,
        contributorMemberIds,
      );
    case "program-event":
      return metadataUpdaters["program-event"](
        entityId,
        locale,
        input,
        expectedRevision,
        expectedTargetRevision,
        contributorMemberIds,
      );
    case "campaign":
      return metadataUpdaters.campaign(
        entityId,
        locale,
        input,
        expectedRevision,
        expectedTargetRevision,
        contributorMemberIds,
      );
    case "email-template":
      return metadataUpdaters["email-template"](
        entityId,
        locale,
        input,
        expectedRevision,
        expectedTargetRevision,
        contributorMemberIds,
      );
    case "privacy-history":
      return metadataUpdaters["privacy-history"](
        entityId,
        locale,
        input,
        expectedRevision,
        expectedTargetRevision,
        contributorMemberIds,
      );
    case "terms-history":
      return metadataUpdaters["terms-history"](
        entityId,
        locale,
        input,
        expectedRevision,
        expectedTargetRevision,
        contributorMemberIds,
      );
  }
}

export async function updateResidentBlockMetadata(
  entityId: string,
  locale: string,
  input: ResidentRichTextMetadataUpdate,
  expectedRevision: string,
  expectedTargetRevision: string | undefined,
  contributorMemberIds: readonly string[],
): Promise<ResidentRichTextMetadataAck> {
  const ack = await updateByType(
    entityId,
    locale,
    input,
    expectedRevision,
    expectedTargetRevision,
    contributorMemberIds,
  );
  return {
    documentRevision: ack.documentRevision,
    changed: ack.changed,
    sourceChanged: ack.sourceChanged,
    changedLocales: ack.changedLocales,
    locale: ack.locale,
    ...(ack.targetRevision === undefined
      ? {}
      : { targetRevision: ack.targetRevision }),
  };
}
