import {
  CollaborativeDocumentType,
  parseDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import type * as Y from "yjs";
import { clearMapThemeTransientRevision } from "../../handlers/map-theme.ts";
import { CollaborationConflictError } from "../api/transport.ts";
import { MapThemeRevisionConflictError } from "../api/map-theme.ts";
import { logger } from "../logger.ts";
import { COLLAB_RELOAD_REQUIRED_SIGNAL } from "./authentication.ts";
import { errorMessage } from "./error-message.ts";

type RevisionDocument = Y.Doc & {
  getConnections(): Iterable<{
    sendStateless?(payload: string): unknown;
    close?(): unknown;
  }>;
};

interface RevisionConflictKinds {
  collaboration: boolean;
  mapTheme: boolean;
}

function closeFencedConnection(
  connection: { close?(): unknown },
  documentName: string,
): void {
  try {
    connection.close?.();
  } catch (closeError) {
    logger.error("Failed to close fenced collaboration connection", {
      documentName,
      error: errorMessage(closeError),
    });
  }
}

function revisionConflictKinds(
  error: unknown,
  parsed: ReturnType<typeof parseDocumentName>,
): RevisionConflictKinds {
  return {
    collaboration: error instanceof CollaborationConflictError,
    mapTheme:
      error instanceof MapThemeRevisionConflictError &&
      parsed.type === CollaborativeDocumentType.MAP_THEME,
  };
}

function conflictLogFields(error: unknown) {
  return error instanceof CollaborationConflictError
    ? { reason: error.reason, conflict_detail: error.message }
    : { reason: errorMessage(error) };
}

export class RevisionConflictGuard {
  private readonly staleDocuments = new WeakSet<Y.Doc>();
  readonly fencedDocumentNames = new Set<string>();

  isStale(document: Y.Doc): boolean {
    return this.staleDocuments.has(document);
  }

  unfence(documentName: string): void {
    this.fencedDocumentNames.delete(documentName);
  }

  fencePendingLoad(documentName: string): void {
    this.fencedDocumentNames.add(documentName);
  }

  requireReload(
    reason: string,
    documentName: string,
    document: RevisionDocument,
  ): void {
    this.fence(new Error(reason), documentName, document, false);
  }

  handle(
    error: unknown,
    documentName: string,
    document: RevisionDocument,
  ): boolean {
    const parsed = parseDocumentName(documentName);
    const conflicts = revisionConflictKinds(error, parsed);
    if (!conflicts.collaboration && !conflicts.mapTheme) {
      return false;
    }

    return this.fence(error, documentName, document, conflicts.mapTheme);
  }

  handleEntity(
    error: unknown,
    entityDocumentName: string,
    documents: Iterable<{ documentName: string; document: RevisionDocument }>,
  ): boolean {
    if (!(error instanceof CollaborationConflictError)) {
      return false;
    }
    let handled = false;
    for (const { documentName, document } of documents) {
      this.fence(
        error,
        documentName,
        document,
        parseDocumentName(documentName).type ===
          CollaborativeDocumentType.MAP_THEME,
        false,
      );
      handled = true;
    }
    if (handled) {
      const scope = parseDocumentName(entityDocumentName);
      logger.warn("Collaboration revision conflict requires reload", {
        ...conflictLogFields(error),
        entity_type: scope.type,
        entity_id: scope.entityId,
        locale: scope.locale,
      });
    }
    return handled;
  }

  private fence(
    error: unknown,
    documentName: string,
    document: RevisionDocument,
    mapTheme: boolean,
    logConflict = true,
  ): boolean {
    const scoped = parseDocumentName(documentName);

    this.staleDocuments.add(document);
    if (this.fencedDocumentNames.has(documentName)) {
      return true;
    }
    this.fencedDocumentNames.add(documentName);
    if (mapTheme) {
      clearMapThemeTransientRevision(documentName);
    }
    for (const connection of [...document.getConnections()]) {
      try {
        connection.sendStateless?.(
          JSON.stringify({
            kind: COLLAB_RELOAD_REQUIRED_SIGNAL,
            reason: COLLAB_RELOAD_REQUIRED_SIGNAL,
          }),
        );
      } catch (signalError) {
        logger.error("Failed to signal collaboration reload", {
          documentName,
          error: errorMessage(signalError),
        });
      } finally {
        closeFencedConnection(connection, documentName);
      }
    }
    if (logConflict) {
      logger.warn("Collaboration revision conflict requires reload", {
        ...conflictLogFields(error),
        entity_type: scoped.type,
        entity_id: scoped.entityId,
        locale: scoped.locale,
      });
    }
    return true;
  }
}
