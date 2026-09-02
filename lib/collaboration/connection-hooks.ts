import type { Connection } from "@hocuspocus/server";
import { CollaborationSessionInvalidError } from "../api/collaboration.ts";
import { logger } from "../logger.ts";
import { AwarenessConnectionOwnership } from "./awareness-ownership.ts";
import type { CollabConnectionContext } from "./connection-context.ts";
import {
  createConnectionHandlers,
  type ConnectionHookDependencies as ConnectionHandlerDependencies,
  type ConnectionHookState,
} from "./connection-handler-helpers.ts";
import {
  CollaborationPermissionGuard,
  CollaborationPermissionRevokedError,
  PERMISSION_REVOKED_SIGNAL,
  SESSION_EXPIRED_SIGNAL,
} from "./permission-guard.ts";

export type ConnectionHookDependencies = ConnectionHandlerDependencies;

function signalAccessEnded(
  connection: Pick<Connection, "close" | "sendStateless">,
  context: CollabConnectionContext,
  documentName: string,
  signal: typeof PERMISSION_REVOKED_SIGNAL | typeof SESSION_EXPIRED_SIGNAL,
): void {
  let signalFailed = false;
  let closeFailed = false;
  try {
    connection.sendStateless(JSON.stringify({ kind: signal, reason: signal }));
  } catch {
    signalFailed = true;
  }
  try {
    connection.close();
  } catch {
    closeFailed = true;
  }
  logger.warn(
    signal === PERMISSION_REVOKED_SIGNAL
      ? "Collaboration permission revoked"
      : "Collaboration session expired",
    {
      reason: signal,
      entity_type: context.documentType,
      entity_id: context.resourceId,
      member_id: context.member?.id,
      documentName,
      signal_failed: signalFailed,
      close_failed: closeFailed,
    },
  );
}

export function signalPermissionRevoked(
  connection: Pick<Connection, "close" | "sendStateless">,
  context: CollabConnectionContext,
  documentName: string,
): void {
  signalAccessEnded(
    connection,
    context,
    documentName,
    PERMISSION_REVOKED_SIGNAL,
  );
}

function signalSessionExpired(
  connection: Pick<Connection, "close" | "sendStateless">,
  context: CollabConnectionContext,
  documentName: string,
): void {
  signalAccessEnded(connection, context, documentName, SESSION_EXPIRED_SIGNAL);
}

function createConnectionHookState(): ConnectionHookState {
  const awarenessOwnership =
    new AwarenessConnectionOwnership<CollabConnectionContext>();
  const permissionGuard = new CollaborationPermissionGuard();
  const awarenessConnections = new Map<string, Connection>();
  const connectionKey = (documentName: string, socketId: string) =>
    `${documentName}\0${socketId}`;

  const authorizeFrame = async (
    connection: Connection,
    context: CollabConnectionContext,
    documentName: string,
  ): Promise<void> => {
    try {
      context.member = await permissionGuard.authorizeFrame(context);
    } catch (error) {
      if (error instanceof CollaborationSessionInvalidError) {
        signalSessionExpired(connection, context, documentName);
      } else if (error instanceof CollaborationPermissionRevokedError) {
        signalPermissionRevoked(connection, context, documentName);
      }
      throw error;
    }
  };

  return {
    awarenessOwnership,
    awarenessConnections,
    connectionKey,
    authorizeFrame,
  };
}

export function createConnectionHooks(
  dependencies: ConnectionHookDependencies,
) {
  return createConnectionHandlers(dependencies, createConnectionHookState());
}
