import type { AuthorizedCollaborationMember } from "../api/collaboration.ts";
import type { CollaborationPermissionContext } from "./permission-guard.ts";
import type { ShutdownConnectionAdmission } from "./shutdown-connection-drain.ts";
import type { RoomEpochAdmission } from "./room-epoch.ts";

export type AuthenticatedMemberContext = AuthorizedCollaborationMember;

type BlockRoomAdmissionState = "pending" | "issued" | "accepted";

export type CollabConnectionContext = CollaborationPermissionContext & {
  canEdit?: boolean;
  shutdownAdmission?: ShutdownConnectionAdmission;
  blockRoomAdmissionState?: BlockRoomAdmissionState;
  bootstrapChallenge?: string;
} & Partial<RoomEpochAdmission>;

export function shutdownAdmissionFromContext(
  context: unknown,
): ShutdownConnectionAdmission | undefined {
  if (typeof context !== "object" || context === null) {
    return undefined;
  }
  return (context as CollabConnectionContext).shutdownAdmission;
}
