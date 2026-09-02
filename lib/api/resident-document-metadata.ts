import { create, fromJson, toJson } from "@bufbuild/protobuf";
import {
  ArtistDocumentMetadataUpdateSchema,
  ArtistLabelIdsValueSchema,
  ArtistSocialLinksValueSchema,
  UpdateArtistDocumentMetadataRequestSchema,
  UpdateArtistDocumentMetadataResponseSchema,
} from "@echovisionlab/geul-proto/intra/artist_pb.ts";
import { NullableStringMutationSchema } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import {
  LabelDocumentMetadataUpdateSchema,
  LabelSocialLinksValueSchema,
  UpdateLabelDocumentMetadataRequestSchema,
  UpdateLabelDocumentMetadataResponseSchema,
} from "@echovisionlab/geul-proto/intra/label_pb.ts";
import {
  postInternalApi,
  throwIfCollaborationConflictResponse,
} from "./transport.ts";

export type ResidentRichTextDocumentMetadataUpdate =
  | {
      type: "artist";
      realName?: string | null;
      countryCode?: string | null;
      website?: string | null;
      socialLinks?: Readonly<Record<string, string>>;
      slug?: string | null;
      labelIds?: readonly string[];
      parentArtistId?: string | null;
    }
  | {
      type: "label";
      slug?: string | null;
      countryCode?: string | null;
      website?: string | null;
      socialLinks?: Readonly<Record<string, string>>;
      parentLabelId?: string | null;
    };

export interface ResidentDocumentMetadataAck {
  documentRevision: string;
  changed: boolean;
  sourceChanged: boolean;
  changedLocales: string[];
  locale: string;
}

function nullableStringMutation(value: string | null | undefined) {
  if (value === undefined) return undefined;
  return create(NullableStringMutationSchema, {
    operation:
      value === null ? { case: "clear", value: true } : { case: "set", value },
  });
}

async function requireMetadataResponse(response: Response): Promise<void> {
  await throwIfCollaborationConflictResponse(response);
  if (!response.ok) {
    throw new Error(
      `Resident document metadata failed with HTTP ${response.status}.`,
    );
  }
}

export async function updateResidentRichTextDocumentMetadata(
  entityId: string,
  locale: string,
  input: ResidentRichTextDocumentMetadataUpdate,
  expectedRevision: string,
  contributorMemberIds: readonly string[],
): Promise<ResidentDocumentMetadataAck> {
  const contributors = [...contributorMemberIds];
  if (input.type === "artist") {
    const request = create(UpdateArtistDocumentMetadataRequestSchema, {
      artistId: entityId,
      update: create(ArtistDocumentMetadataUpdateSchema, {
        realName: nullableStringMutation(input.realName),
        countryCode: nullableStringMutation(input.countryCode),
        website: nullableStringMutation(input.website),
        socialLinks:
          input.socialLinks === undefined
            ? undefined
            : create(ArtistSocialLinksValueSchema, {
                values: { ...input.socialLinks },
              }),
        slug: nullableStringMutation(input.slug),
        labelIds:
          input.labelIds === undefined
            ? undefined
            : create(ArtistLabelIdsValueSchema, {
                values: [...input.labelIds],
              }),
        parentArtistId: nullableStringMutation(input.parentArtistId),
      }),
      expectedRevision,
      contributorMemberIds: contributors,
      locale,
    });
    const response = await postInternalApi(
      "/api.intra.v1.InternalArtistService/UpdateArtistDocumentMetadata",
      toJson(UpdateArtistDocumentMetadataRequestSchema, request),
    );
    await requireMetadataResponse(response);
    const value = fromJson(
      UpdateArtistDocumentMetadataResponseSchema,
      await response.json(),
    );
    return {
      documentRevision: value.documentRevision,
      changed: value.changed,
      sourceChanged: value.sourceChanged,
      changedLocales: [],
      locale: value.locale,
    };
  }
  const request = create(UpdateLabelDocumentMetadataRequestSchema, {
    labelId: entityId,
    update: create(LabelDocumentMetadataUpdateSchema, {
      slug: nullableStringMutation(input.slug),
      countryCode: nullableStringMutation(input.countryCode),
      website: nullableStringMutation(input.website),
      socialLinks:
        input.socialLinks === undefined
          ? undefined
          : create(LabelSocialLinksValueSchema, {
              values: { ...input.socialLinks },
            }),
      parentLabelId: nullableStringMutation(input.parentLabelId),
    }),
    expectedRevision,
    contributorMemberIds: contributors,
    locale,
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalLabelService/UpdateLabelDocumentMetadata",
    toJson(UpdateLabelDocumentMetadataRequestSchema, request),
  );
  await requireMetadataResponse(response);
  const value = fromJson(
    UpdateLabelDocumentMetadataResponseSchema,
    await response.json(),
  );
  return {
    documentRevision: value.documentRevision,
    changed: value.changed,
    sourceChanged: value.sourceChanged,
    changedLocales: [],
    locale: value.locale,
  };
}
