import type {
  CampaignFieldValue,
  CampaignRecipientScope,
} from "@echovisionlab/geul-common/collaboration/campaign";
import { CampaignTargetMode } from "@echovisionlab/geul-proto/secure/campaign_pb.ts";

interface CampaignDocumentMetaBase {
  layoutId: string | null;
  recipientScope: CampaignRecipientScope;
}

export type CampaignDocumentMeta = CampaignDocumentMetaBase &
  (
    | {
        targetMode: CampaignTargetMode.ALL;
        segmentId: null;
      }
    | {
        targetMode: CampaignTargetMode.SEGMENT;
        segmentId: string;
      }
  );

export type CampaignDocumentFieldValue =
  CampaignFieldValue | CampaignTargetMode;

interface CampaignDocumentMetaInput {
  targetMode: unknown;
  segmentId: unknown;
  layoutId: unknown;
  recipientScope: unknown;
}

interface CampaignFieldReader {
  get(key: string): unknown;
}

function readNullableID(
  field: "segmentId" | "layoutId",
  value: unknown,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Invalid campaign metadata: ${field} must be a non-empty string or null`,
    );
  }
  return value;
}

function assertCampaignDocumentMeta(
  input: CampaignDocumentMetaInput,
): CampaignDocumentMeta {
  if (
    input.targetMode !== CampaignTargetMode.ALL &&
    input.targetMode !== CampaignTargetMode.SEGMENT
  ) {
    throw new Error(
      "Invalid campaign metadata: targetMode must be ALL or SEGMENT",
    );
  }
  if (
    input.recipientScope !== "SUBSCRIBED_USERS" &&
    input.recipientScope !== "ALL_MATCHING_USERS"
  ) {
    throw new Error(
      "Invalid campaign metadata: recipientScope must be SUBSCRIBED_USERS or ALL_MATCHING_USERS",
    );
  }

  const segmentId = readNullableID("segmentId", input.segmentId);
  const layoutId = readNullableID("layoutId", input.layoutId);

  if (input.targetMode === CampaignTargetMode.ALL && segmentId !== null) {
    throw new Error(
      "Invalid campaign metadata: ALL must not include segmentId",
    );
  }
  if (input.targetMode === CampaignTargetMode.ALL) {
    return {
      targetMode: CampaignTargetMode.ALL,
      segmentId: null,
      layoutId,
      recipientScope: input.recipientScope,
    };
  }
  if (segmentId === null) {
    throw new Error("Invalid campaign metadata: SEGMENT requires segmentId");
  }
  return {
    targetMode: CampaignTargetMode.SEGMENT,
    segmentId,
    layoutId,
    recipientScope: input.recipientScope,
  };
}

export function extractCampaignDocumentMeta(
  fields: CampaignFieldReader,
): CampaignDocumentMeta {
  return assertCampaignDocumentMeta({
    targetMode: fields.get("targetMode"),
    segmentId: fields.get("segmentId"),
    layoutId: fields.get("layoutId"),
    recipientScope: fields.get("recipientScope"),
  });
}
