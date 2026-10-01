import type { DocumentSaveOptions } from "@echovisionlab/geul-common/collaboration/document";
import type { EditSessionCheckpointFailureReason } from "./edit-session-contributor-types.ts";
import { CollaborationConflictError } from "../api/transport.ts";

interface CheckpointDocument<TDocument> {
  documentName: string;
  document: TDocument;
}

type PersistDocument<TDocument> = (
  documentName: string,
  document: TDocument,
  options: DocumentSaveOptions,
) => Promise<unknown>;

export interface EditSessionFinalizationOptions<TDocument> {
  entityDocumentName: string;
  sourceDocument: CheckpointDocument<TDocument> | undefined;
  contributorMemberIds: string[];
  canContinue(): boolean;
  isCurrent(): boolean;
  sourceDocumentIsCurrent(documentName: string, document: TDocument): boolean;
  persistWith(
    persistDocument: PersistDocument<TDocument>,
    documentName: string,
    document: TDocument,
    options: DocumentSaveOptions,
  ): Promise<unknown>;
  withPersistenceQueue(
    queueKey: string,
    operation: (persistDocument: PersistDocument<TDocument>) => Promise<void>,
  ): Promise<void>;
}

export async function persistEditSessionCheckpoint<TDocument>(
  options: EditSessionFinalizationOptions<TDocument>,
): Promise<CheckpointDocument<TDocument> | undefined> {
  let completedSource: CheckpointDocument<TDocument> | undefined;
  await options.withPersistenceQueue(
    options.entityDocumentName,
    async (persistDocument) => {
      const source = options.sourceDocument;
      if (!source) {
        throw new Error("source_document_unavailable");
      }
      if (!options.canContinue()) {
        return;
      }

      await options.persistWith(
        persistDocument,
        source.documentName,
        source.document,
        {},
      );
      if (!options.canContinue()) {
        return;
      }

      await options.persistWith(
        persistDocument,
        source.documentName,
        source.document,
        {
          contributorMemberIds: options.contributorMemberIds,
          versionCheckpoint: true,
        },
      );
      if (!options.isCurrent()) {
        return;
      }
      if (
        !options.sourceDocumentIsCurrent(source.documentName, source.document)
      ) {
        throw new Error("source_document_unavailable");
      }
      completedSource = source;
    },
  );
  return completedSource;
}

export function finalizationFailureReason(
  error: unknown,
): EditSessionCheckpointFailureReason {
  if (error instanceof CollaborationConflictError) {
    switch (error.reason) {
      case "document_revision_changed":
      case "target_revision_changed":
        return error.reason;
      default:
        return "persist_failed";
    }
  }
  if (
    error instanceof Error &&
    error.message === "source_document_unavailable"
  ) {
    return error.message;
  }
  return "persist_failed";
}
