import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import type { MemberSummary } from "@echovisionlab/geul-proto/common/common_pb.ts";
import {
  AuthorizeCollaborationRequestSchema,
  AuthorizeCollaborationResponseSchema,
  CollaborationAuthorizationDenialReason,
  CollaborationPermission,
  CollaborationPrincipalSchema,
  CollaborationResourceSchema,
  CollaborationResourceType,
  type CollaborationPrincipal,
  type AuthorizeCollaborationResponse,
} from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { postInternalApi } from "./transport.ts";

export interface AuthorizeCollaborationInput {
  sessionId: string;
  documentType: CollaborativeDocumentType;
  resourceId: string;
  locale: string;
  permission: CollaborationPermission;
}

export type AuthorizedCollaborationMember = MemberSummary & {
  nickname: string;
};

export class CollaborationSessionInvalidError extends Error {
  constructor() {
    super("collaboration_session_invalid");
    this.name = "CollaborationSessionInvalidError";
  }
}

export function createCollaborationPrincipal(
  sessionId: string,
): CollaborationPrincipal {
  return create(CollaborationPrincipalSchema, { sessionId });
}

const collaborationResourceTypes = new Map<
  CollaborativeDocumentType,
  CollaborationResourceType
>([
  [CollaborativeDocumentType.POST, CollaborationResourceType.POST],
  [CollaborativeDocumentType.WORK, CollaborationResourceType.WORK],
  [CollaborativeDocumentType.RELEASE, CollaborationResourceType.RELEASE],
  [CollaborativeDocumentType.LABEL, CollaborationResourceType.LABEL],
  [CollaborativeDocumentType.ARTIST, CollaborationResourceType.ARTIST],
  [CollaborativeDocumentType.FORM, CollaborationResourceType.FORM],
  [CollaborativeDocumentType.PAGE, CollaborationResourceType.PAGE],
  [CollaborativeDocumentType.CAMPAIGN, CollaborationResourceType.CAMPAIGN],
  [
    CollaborativeDocumentType.EMAIL_TEMPLATE,
    CollaborationResourceType.EMAIL_TEMPLATE,
  ],
  [
    CollaborativeDocumentType.EMAIL_LAYOUT,
    CollaborationResourceType.EMAIL_LAYOUT,
  ],
  [
    CollaborativeDocumentType.TERMS_HISTORY,
    CollaborationResourceType.TERMS_HISTORY,
  ],
  [
    CollaborativeDocumentType.PRIVACY_HISTORY,
    CollaborationResourceType.PRIVACY_HISTORY,
  ],
  [CollaborativeDocumentType.MAP_THEME, CollaborationResourceType.MAP_THEME],
  [
    CollaborativeDocumentType.PROGRAM_EVENT,
    CollaborationResourceType.PROGRAM_EVENT,
  ],
  [CollaborativeDocumentType.MENU, CollaborationResourceType.MENU],
  [
    CollaborativeDocumentType.POST_SERIES,
    CollaborationResourceType.POST_SERIES,
  ],
]);

function collaborationResourceType(
  documentType: CollaborativeDocumentType,
): CollaborationResourceType {
  const resourceType = collaborationResourceTypes.get(documentType);
  if (resourceType === undefined) {
    throw new Error("Unsupported collaboration resource type");
  }
  return resourceType;
}

function deniedAuthorizationResult(
  result: AuthorizeCollaborationResponse,
): null {
  switch (result.denialReason) {
    case CollaborationAuthorizationDenialReason.SESSION_INVALID:
      throw new CollaborationSessionInvalidError();
    case CollaborationAuthorizationDenialReason.PERMISSION_DENIED:
      return null;
    default:
      throw new Error("Invalid collaboration authorization response");
  }
}

function requireAuthorizedMember(
  result: AuthorizeCollaborationResponse,
): AuthorizedCollaborationMember {
  const member = result.member;
  if (
    result.denialReason !==
      CollaborationAuthorizationDenialReason.UNSPECIFIED ||
    !member ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      member.id,
    ) ||
    member.deleted ||
    member.nickname === undefined ||
    member.nickname.trim() === ""
  ) {
    throw new Error("Invalid collaboration authorization response");
  }
  return member as AuthorizedCollaborationMember;
}

/**
 * Calls the single API-owned session-to-account_identity, active Member, and
 * fully consistent document authorization boundary. The returned
 * MemberSummary is the only connection actor; there is no secondary profile
 * lookup or header-projected identity/Member fallback.
 */
export async function authorizeCollaboration(
  input: AuthorizeCollaborationInput,
): Promise<AuthorizedCollaborationMember | null> {
  const request = create(AuthorizeCollaborationRequestSchema, {
    principal: createCollaborationPrincipal(input.sessionId),
    resource: create(CollaborationResourceSchema, {
      type: collaborationResourceType(input.documentType),
      id: input.resourceId,
      locale: input.locale,
    }),
    permission: input.permission,
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalCollaborationAuthorizationService/AuthorizeCollaboration",
    toJson(AuthorizeCollaborationRequestSchema, request),
  );

  if (!response.ok) {
    throw new Error(
      `Failed to authorize collaboration: ${response.status} ${response.statusText}`,
    );
  }

  let result: AuthorizeCollaborationResponse;
  try {
    result = fromJson(
      AuthorizeCollaborationResponseSchema,
      await response.json(),
    );
  } catch {
    throw new Error("Invalid collaboration authorization response");
  }
  if (!result.authorized && result.member) {
    throw new Error("Invalid collaboration authorization response");
  }
  if (!result.authorized) {
    return deniedAuthorizationResult(result);
  }
  if (result.locale !== input.locale) {
    throw new Error("Invalid collaboration authorization locale");
  }
  return requireAuthorizedMember(result);
}
