import {
  CollaborativeDocumentType,
  parseDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import type { Connection, onAuthenticatePayload } from "@hocuspocus/server";
import { env } from "../../env.ts";
import {
  authorizeCollaboration,
  CollaborationSessionInvalidError,
} from "../api/collaboration.ts";
import { CollaborationPermission } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { logger } from "../logger.ts";
import { CANONICAL_SESSION_HEADER, isCanonicalSession } from "./admission.ts";
import type { CollabConnectionContext } from "./connection-context.ts";
import { SESSION_EXPIRED_SIGNAL } from "./permission-guard.ts";
import {
  type ShutdownConnectionAdmission,
  ShutdownConnectionDrain,
  shutdownSocketAdmissionScopeFromContext,
} from "./shutdown-connection-drain.ts";
import {
  COLLAB_RELOAD_REQUIRED_SIGNAL,
  RoomEpochMismatchError,
  type RoomEpochRegistry,
} from "./room-epoch.ts";
import { residentBlockDocumentType } from "./resident-block-runtime.ts";

export { COLLAB_RELOAD_REQUIRED_SIGNAL } from "./room-epoch.ts";

interface AdmissionControl {
  admission: ShutdownConnectionAdmission;
  reject(error: Error): never;
}

function blockRoomAdmission(
  documentName: string,
  token: string,
  roomEpochs: RoomEpochRegistry,
  reject: (error: Error) => never,
) {
  if (!token) {
    return {
      ...roomEpochs.issue(documentName),
      blockRoomAdmissionState: "pending" as const,
      requiresCanonicalSyncFence: true,
    };
  }
  const resumed = roomEpochs.validate(documentName, token);
  if (resumed && !resumed.requiresCanonicalSyncFence) {
    return {
      ...resumed,
      blockRoomAdmissionState: "accepted" as const,
      bootstrapChallenge: token,
    };
  }
  // A stale epoch is an expected recovery path after a room rollover or
  // service deployment. The Web client drops the resident document and opens
  // a fresh tokenless socket, so keep it observable without paging as a warn.
  logger.info("Authentication rejected: stale collaboration resume token", {
    reason: COLLAB_RELOAD_REQUIRED_SIGNAL,
    documentName,
  });
  return reject(new RoomEpochMismatchError());
}

function beginAdmission(
  payload: Pick<onAuthenticatePayload, "context" | "documentName" | "socketId">,
  shutdownConnections: ShutdownConnectionDrain<Connection>,
): AdmissionControl {
  const socketAdmission = shutdownSocketAdmissionScopeFromContext<Connection>(
    payload.context,
  );
  const admission = socketAdmission
    ? socketAdmission.beginAdmission(payload.documentName, payload.socketId)
    : shutdownConnections.beginAdmission(
        payload.documentName,
        payload.socketId,
      );
  if (!admission) {
    logger.warn("Authentication rejected: service shutdown in progress", {
      reason: "service_stopping",
    });
    throw new Error("Collaboration service is shutting down");
  }
  return {
    admission,
    reject(error): never {
      if (socketAdmission) {
        socketAdmission.releaseAdmission(admission);
      } else {
        shutdownConnections.releaseAdmission(admission);
      }
      throw error;
    },
  };
}

function requireCanonicalRequest(
  payload: Pick<onAuthenticatePayload, "request">,
  reject: (error: Error) => never,
): string {
  const headers = payload.request.headers;
  if (headers.get("origin") !== env.SITE_ORIGIN) {
    logger.warn("Authentication rejected: invalid origin", {
      reason: "invalid_origin",
    });
    return reject(new Error("Authentication required"));
  }
  const session = headers.get(CANONICAL_SESSION_HEADER);
  if (!isCanonicalSession(session)) {
    logger.warn("Authentication rejected: invalid canonical session", {
      reason: "invalid_canonical_session",
    });
    return reject(new Error("Authentication required"));
  }
  return session;
}

function requireDocumentScope(
  documentName: string,
  reject: (error: Error) => never,
): {
  documentType: CollaborativeDocumentType;
  entityId: string;
  locale: string;
} {
  let parsed;
  try {
    parsed = parseDocumentName(documentName);
  } catch (error) {
    logger.warn("Authentication rejected: invalid document name", {
      reason: "invalid_document_name",
      error,
    });
    return reject(new Error("Invalid document name"));
  }
  return {
    documentType: parsed.type,
    entityId: parsed.entityId,
    locale: parsed.locale,
  };
}

function rejectFencedDocument(
  documentName: string,
  fencedDocumentNames: ReadonlySet<string>,
  reject: (error: Error) => never,
): void {
  if (!fencedDocumentNames.has(documentName)) {
    return;
  }
  logger.warn("Authentication rejected: collaboration reload required", {
    reason: COLLAB_RELOAD_REQUIRED_SIGNAL,
    documentName,
  });
  reject(new RoomEpochMismatchError());
}

export function createAuthenticationHook(
  shutdownConnections: ShutdownConnectionDrain<Connection>,
  fencedDocumentNames: ReadonlySet<string>,
  roomEpochs: RoomEpochRegistry,
): (payload: onAuthenticatePayload) => Promise<CollabConnectionContext> {
  return async (payload) => {
    const { admission, reject } = beginAdmission(payload, shutdownConnections);
    rejectFencedDocument(payload.documentName, fencedDocumentNames, reject);
    const sessionId = requireCanonicalRequest(payload, reject);
    const { documentType, entityId, locale } = requireDocumentScope(
      payload.documentName,
      reject,
    );
    let member;
    try {
      member = await authorizeCollaboration({
        sessionId,
        documentType,
        resourceId: entityId,
        locale,
        permission: CollaborationPermission.VIEW,
      });
    } catch (error) {
      if (error instanceof CollaborationSessionInvalidError) {
        logger.warn("Authentication rejected: session expired", {
          reason: SESSION_EXPIRED_SIGNAL,
          entity_type: documentType,
          entity_id: entityId,
          locale,
        });
        return reject(new Error(SESSION_EXPIRED_SIGNAL));
      }
      logger.error(
        "Authentication rejected: collaboration authorization failed",
        {
          reason: "collaboration_authorization_failed",
          entity_type: documentType,
          entity_id: entityId,
          locale,
          error,
        },
      );
      return reject(new Error("Collaboration authorization failed"));
    }

    rejectFencedDocument(payload.documentName, fencedDocumentNames, reject);
    if (!member) {
      logger.warn("Authentication rejected: permission denied", {
        reason: "permission_denied",
        entity_type: documentType,
        entity_id: entityId,
        locale,
      });
      return reject(new Error("Permission denied"));
    }

    let canEdit = false;
    try {
      const editMember = await authorizeCollaboration({
        sessionId,
        documentType,
        resourceId: entityId,
        locale,
        permission: CollaborationPermission.EDIT,
      });
      canEdit = editMember?.id === member.id;
    } catch (error) {
      if (error instanceof CollaborationSessionInvalidError) {
        return reject(new Error(SESSION_EXPIRED_SIGNAL));
      }
      logger.error("Authentication rejected: edit authorization failed", {
        reason: "collaboration_edit_authorization_failed",
        entity_type: documentType,
        entity_id: entityId,
        error,
      });
      return reject(new Error("Collaboration authorization failed"));
    }

    // Hocuspocus sends its authentication acknowledgement and creates the
    // Connection from this configuration before it invokes `connected`.
    // Keep the client and transport in the same mode from the first frame.
    payload.connectionConfig.readOnly = !canEdit;

    const blockRoom = residentBlockDocumentType(documentType)
      ? blockRoomAdmission(
          payload.documentName,
          payload.token,
          roomEpochs,
          reject,
        )
      : undefined;
    return {
      member,
      sessionId,
      documentType,
      resourceId: entityId,
      locale,
      canEdit,
      shutdownAdmission: admission,
      ...(blockRoom ?? {}),
    };
  };
}
