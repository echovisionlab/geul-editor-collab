import { createHash } from "node:crypto";
import type { AuthorizedCollaborationMember } from "../api/collaboration.ts";

const memberColors = [
  "#F44336",
  "#E91E63",
  "#9C27B0",
  "#673AB7",
  "#3F51B5",
  "#2196F3",
  "#03A9F4",
  "#00BCD4",
  "#009688",
  "#4CAF50",
  "#8BC34A",
  "#CDDC39",
  "#FFC107",
  "#FF9800",
  "#FF5722",
  "#795548",
] as const;

export const CANONICAL_SESSION_HEADER = "X-Session-Id";

export function isCanonicalSession(
  value: string | null | undefined,
): value is string {
  return (
    value != null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
  );
}

function colorForMember(memberId: string): string {
  const hash = createHash("md5").update(memberId).digest("hex");
  return memberColors[
    Number.parseInt(hash.substring(0, 8), 16) % memberColors.length
  ];
}

export function presenceForMember(member: AuthorizedCollaborationMember) {
  return {
    id: member.id,
    name: member.nickname,
    image: member.avatarAsset?.url,
    color: colorForMember(member.id),
  };
}
