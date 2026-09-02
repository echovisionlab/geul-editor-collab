import type {
  CollaborativeDocumentType,
  DocumentSaveOptions,
} from "@echovisionlab/geul-common/collaboration/document";

export const EDIT_SESSION_RECONNECT_GRACE_MS = 10_000;
export const EDIT_SESSION_VERSION_CHECKPOINT_MS = 30 * 60 * 1_000;
export const EDIT_SESSION_MAX_RETRIES = 3;

type Timer = ReturnType<typeof setTimeout>;

interface ConnectionLike {
  sendStateless?(payload: string): unknown;
  close?(): unknown;
  context?: {
    member?: {
      id?: string;
    };
  };
}

export interface EditSessionDocumentLike {
  getConnections(): Iterable<ConnectionLike>;
}

export interface AcceptedDocumentChange {
  documentName: string;
  context?: unknown;
  connection?: unknown;
  transactionOrigin?: unknown;
}

export interface EditSessionContributorTrackerOptions<
  TDocument extends EditSessionDocumentLike,
> {
  listDocuments(): Iterable<[string, TDocument]>;
  loadDocument(documentName: string): Promise<TDocument | null>;
  persistDocument(
    documentName: string,
    document: TDocument,
    options: DocumentSaveOptions,
    queueKey: string,
  ): Promise<unknown>;
  withPersistenceQueue(
    queueKey: string,
    operation: (
      persist: (
        documentName: string,
        document: TDocument,
        options: DocumentSaveOptions,
      ) => Promise<unknown>,
    ) => Promise<void>,
  ): Promise<void>;
  unloadDocument(document: TDocument): Promise<unknown>;
  supportsVersionCheckpoints(type: CollaborativeDocumentType): boolean;
  isEntityDeleted?(entityDocumentName: string, error: unknown): boolean;
  onEntityDeleted?(entityDocumentName: string): void | Promise<void>;
  onCheckpointConflict?(
    entityDocumentName: string,
    error: unknown,
  ): void | Promise<void>;
  onEntitySettled?(entityDocumentName: string): void;
  logFailure(fields: Record<string, unknown>): void;
  logTerminalCheckpointFailure(
    fields: EditSessionTerminalCheckpointFailure,
  ): void;
}

export class EditSessionEntityDeletedError extends Error {
  constructor(readonly entityDocumentName: string) {
    super("edit_session_entity_deleted");
    this.name = "EditSessionEntityDeletedError";
  }
}

export interface EditSessionState {
  contributors: Set<string>;
  nextContributors: Set<string>;
  checkpointDueAt: number;
  finalizing: boolean;
  generation: number;
  retryAttempts: number;
  timer?: Timer;
  timerMode?: FinalizationMode;
}

export type FinalizationMode = "active-window" | "room-close";

export type EditSessionCheckpointFailureReason =
  | "source_document_unavailable"
  | "document_revision_changed"
  | "target_revision_changed"
  | "persist_failed";

export interface EditSessionTerminalCheckpointFailure {
  reason: EditSessionCheckpointFailureReason;
  entity_type:
    | "post"
    | "page"
    | "work"
    | "release"
    | "label"
    | "artist"
    | "campaign"
    | "email_layout"
    | "form"
    | "program_event"
    | "map_theme"
    | "terms_history"
    | "privacy_history";
  entity_id: string;
  retry_count: number;
}

const checkpointEntityTypes: Record<
  string,
  EditSessionTerminalCheckpointFailure["entity_type"]
> = {
  post: "post",
  page: "page",
  work: "work",
  release: "release",
  label: "label",
  artist: "artist",
  campaign: "campaign",
  "email-layout": "email_layout",
  form: "form",
  "program-event": "program_event",
  "map-theme": "map_theme",
  "terms-history": "terms_history",
  "privacy-history": "privacy_history",
};

export function checkpointEntityType(
  entityDocumentName: string,
): EditSessionTerminalCheckpointFailure["entity_type"] | undefined {
  return checkpointEntityTypes[entityDocumentName.split(":", 1)[0]!];
}
export type PendingContributors = Map<string, number>;

export function authenticatedMemberId(context: unknown): string | undefined {
  const memberId = (context as { member?: { id?: unknown } } | undefined)
    ?.member?.id;
  return typeof memberId === "string" && memberId.trim() !== ""
    ? memberId.trim()
    : undefined;
}

export function isAcceptedConnectionChange(
  change: AcceptedDocumentChange,
): boolean {
  const origin = change.transactionOrigin as { source?: unknown } | undefined;
  return origin?.source === "connection" && change.connection != null;
}

export function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function activeCheckpointDelay(session: EditSessionState): number {
  return Math.max(0, session.checkpointDueAt - Date.now());
}
