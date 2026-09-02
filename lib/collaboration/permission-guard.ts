import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import {
  authorizeCollaboration,
  type AuthorizedCollaborationMember,
} from "../api/collaboration.ts";
import { CollaborationPermission } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";

export const PERMISSION_REVOKED_SIGNAL = "permission_revoked";
export const SESSION_EXPIRED_SIGNAL = "session_expired";

export class CollaborationPermissionRevokedError extends Error {
  constructor(readonly memberId?: string) {
    super(PERMISSION_REVOKED_SIGNAL);
    this.name = "CollaborationPermissionRevokedError";
  }
}

export interface CollaborationPermissionContext {
  member?: AuthorizedCollaborationMember;
  sessionId?: string;
  documentType?: CollaborativeDocumentType;
  resourceId?: string;
  locale?: string;
  canEdit?: boolean;
}

interface FramePermission {
  memberId: string;
  sessionId: string;
  documentType: CollaborativeDocumentType;
  resourceId: string;
  locale: string;
}

type Authorize = typeof authorizeCollaboration;

function framePermission(
  context: CollaborationPermissionContext,
): FramePermission | undefined {
  if (
    !context.member?.id ||
    !context.sessionId ||
    !context.documentType ||
    !context.resourceId ||
    !context.locale
  ) {
    return undefined;
  }
  return {
    memberId: context.member.id,
    sessionId: context.sessionId,
    documentType: context.documentType,
    resourceId: context.resourceId,
    locale: context.locale,
  };
}

export class CollaborationPermissionGuard {
  constructor(private readonly authorize: Authorize = authorizeCollaboration) {}

  /**
   * The successful API response is the linearization point for one inbound
   * frame. Hocuspocus processes a connection's frame queue FIFO and applies
   * the frame only after this promise resolves. Accepted Yjs work is therefore
   * never re-authorized later during debounce, version checkpoint, or shutdown drain.
   */
  async authorizeFrame(
    context: CollaborationPermissionContext,
  ): Promise<AuthorizedCollaborationMember> {
    const permission = framePermission(context);
    if (!permission) {
      throw new CollaborationPermissionRevokedError();
    }
    const member = await this.authorize({
      sessionId: permission.sessionId,
      documentType: permission.documentType,
      resourceId: permission.resourceId,
      locale: permission.locale,
      permission:
        context.canEdit === false
          ? CollaborationPermission.VIEW
          : CollaborationPermission.EDIT,
    });
    if (!member || member.id !== permission.memberId) {
      throw new CollaborationPermissionRevokedError(permission.memberId);
    }
    return member;
  }
}
