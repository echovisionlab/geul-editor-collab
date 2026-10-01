import {
  applyFormSchemaPatch,
  FormSchemaPatchError,
} from "@echovisionlab/geul-common/collaboration/form-schema-delta";
import {
  FORM_CANONICAL_CONTEXT_MAP_NAME,
  FORM_FIELDS_MAP_NAME,
  recordFormLocaleFieldChange,
} from "@echovisionlab/geul-common/collaboration/form";
import {
  CollaborativeDocumentType,
  parseDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import type { Connection, onStatelessPayload } from "@hocuspocus/server";
import * as Y from "yjs";
import { CollaborationConflictError } from "../api/transport.ts";
import type { CollabConnectionContext } from "./connection-context.ts";
import {
  DOCUMENT_ROOM_SNAPSHOT_KEYS,
  DOCUMENT_ROOM_SNAPSHOT_MAP_NAME,
} from "./document-room-snapshot.ts";

export const FORM_SCHEMA_PATCH_KIND = "form.schema.patch";
export const FORM_SCHEMA_PATCH_ACK_KIND = "form.schema.patch.ack";
export const FORM_SCHEMA_CHANGED_KIND = "form.schema.changed";
export const FORM_SCHEMA_PROTOCOL_VERSION = 1;

interface FormSchemaPatchMessage {
  kind: typeof FORM_SCHEMA_PATCH_KIND;
  protocolVersion: typeof FORM_SCHEMA_PROTOCOL_VERSION;
  requestId: string;
  documentName: string;
  previousSchema: unknown;
  nextSchema: unknown;
}

interface FormSchemaPatchAck {
  kind: typeof FORM_SCHEMA_PATCH_ACK_KIND;
  protocolVersion: typeof FORM_SCHEMA_PROTOCOL_VERSION;
  requestId: string;
  ok: boolean;
  documentName: string;
  canonicalSchema?: unknown;
  error?: string;
}

interface FormSchemaChangedMessage {
  kind: typeof FORM_SCHEMA_CHANGED_KIND;
  protocolVersion: typeof FORM_SCHEMA_PROTOCOL_VERSION;
  requestId: string;
  documentName: string;
  canonicalSchema: unknown;
}

interface QueuedDocument extends Y.Doc {
  broadcastStateless?(payload: string): void;
  getConnections?(): Iterable<Connection>;
}

export interface FormSchemaProtocolDependencies {
  isDocumentFenced(documentName: string): boolean;
  isDocumentStale(document: Y.Doc): boolean;
  ownsDocument(documentName: string): boolean;
  persist(
    documentName: string,
    document: Y.Doc,
    authenticatedMemberId: string,
  ): Promise<void>;
  recordAcceptedChange(
    documentName: string,
    authenticatedMemberId: string,
  ): void;
  handleRevisionConflict(
    error: unknown,
    documentName: string,
    document: Y.Doc,
  ): boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidPatchEnvelope(
  value: Record<string, unknown>,
  requestId: string,
): boolean {
  return (
    value.protocolVersion === FORM_SCHEMA_PROTOCOL_VERSION &&
    requestId.length > 0 &&
    requestId.length <= 160 &&
    typeof value.documentName === "string" &&
    isObject(value.previousSchema) &&
    isObject(value.nextSchema)
  );
}

function parseMessage(
  payload: string,
):
  | { recognized: false }
  | { recognized: true; message?: FormSchemaPatchMessage; requestId: string } {
  let value: unknown;
  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    return { recognized: false };
  }
  if (!isObject(value) || value.kind !== FORM_SCHEMA_PATCH_KIND) {
    return { recognized: false };
  }
  const requestId = typeof value.requestId === "string" ? value.requestId : "";
  if (!isValidPatchEnvelope(value, requestId)) {
    return { recognized: true, requestId };
  }
  return {
    recognized: true,
    requestId,
    message: value as unknown as FormSchemaPatchMessage,
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readCurrentSchema(document: Y.Doc): unknown {
  const serialized = document
    .getMap<unknown>(FORM_FIELDS_MAP_NAME)
    .get("schema");
  if (typeof serialized !== "string") {
    throw new FormSchemaPatchError("invalid_schema");
  }
  try {
    return JSON.parse(serialized) as unknown;
  } catch {
    throw new FormSchemaPatchError("invalid_schema");
  }
}

function sendAck(
  connection: Pick<Connection, "sendStateless">,
  message: FormSchemaPatchMessage | undefined,
  requestId: string,
  documentName: string,
  result: Pick<FormSchemaPatchAck, "ok" | "canonicalSchema" | "error">,
): FormSchemaPatchAck {
  const ack: FormSchemaPatchAck = {
    kind: FORM_SCHEMA_PATCH_ACK_KIND,
    protocolVersion: FORM_SCHEMA_PROTOCOL_VERSION,
    requestId,
    documentName: message?.documentName ?? documentName,
    ...result,
  };
  connection.sendStateless(JSON.stringify(ack));
  return ack;
}

function patchErrorName(error: FormSchemaPatchError): string {
  return error.reason;
}

function isAuthenticatedFormEditor(
  context: CollabConnectionContext | undefined,
  documentName: string,
): context is CollabConnectionContext & { member: { id: string } } {
  const scope = parseDocumentName(documentName);
  return (
    scope.type === CollaborativeDocumentType.FORM &&
    context !== undefined &&
    context.canEdit !== false &&
    typeof context.member?.id === "string" &&
    context.member.id.trim() !== "" &&
    context.documentType === scope.type &&
    context.resourceId === scope.entityId &&
    context.locale === scope.locale
  );
}

function requireAuthenticatedEditor(
  connection: Connection,
  documentName: string,
): string {
  const context = connection.context as CollabConnectionContext | undefined;
  if (!isAuthenticatedFormEditor(context, documentName)) {
    throw new Error("permission_denied");
  }
  return context.member.id;
}

function assertOwnedRoom(
  dependencies: FormSchemaProtocolDependencies,
  documentName: string,
  document: Y.Doc,
): void {
  if (
    !dependencies.ownsDocument(documentName) ||
    dependencies.isDocumentStale(document) ||
    dependencies.isDocumentFenced(documentName)
  ) {
    throw new CollaborationConflictError(
      "document_revision_changed",
      "room_ownership_lost",
    );
  }
}

function patchScope(
  document: Y.Doc,
  connection: Connection,
  documentName: string,
): "source" | "target" {
  const context = document.getMap<string>(FORM_CANONICAL_CONTEXT_MAP_NAME);
  const sourceLocale = context.get("sourceLocale");
  const roomLocale = context.get("locale");
  const scope = parseDocumentName(documentName);
  const connectionContext = connection.context as
    CollabConnectionContext | undefined;
  if (
    sourceLocale === undefined ||
    roomLocale !== scope.locale ||
    connectionContext?.locale !== roomLocale
  ) {
    throw new Error("form_room_context_mismatch");
  }
  const isTarget = roomLocale !== sourceLocale;
  const snapshot = document.getMap<string | boolean>(
    DOCUMENT_ROOM_SNAPSHOT_MAP_NAME,
  );
  if (
    isTarget &&
    snapshot.get(DOCUMENT_ROOM_SNAPSHOT_KEYS.localeExists) !== true
  ) {
    throw new Error("target_missing");
  }
  return isTarget ? "target" : "source";
}

async function persistCanonicalPatch(
  dependencies: FormSchemaProtocolDependencies,
  documentName: string,
  document: Y.Doc,
  authenticatedMemberId: string,
  currentSchema: unknown,
  canonicalSchema: unknown,
): Promise<void> {
  const beforeStateVector = Y.encodeStateVector(document);
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
    candidate
      .getMap<unknown>(FORM_FIELDS_MAP_NAME)
      .set("schema", JSON.stringify(canonicalSchema));
    recordFormLocaleFieldChange(
      candidate,
      { schema: currentSchema },
      { schema: canonicalSchema },
    );
    await dependencies.persist(documentName, candidate, authenticatedMemberId);
    dependencies.recordAcceptedChange(documentName, authenticatedMemberId);
    Y.applyUpdate(
      document,
      Y.encodeStateAsUpdate(candidate, beforeStateVector),
    );
  } finally {
    candidate.destroy();
  }
}

function errorName(error: unknown): string {
  if (error instanceof FormSchemaPatchError) return patchErrorName(error);
  if (error instanceof Error) return error.message;
  return "form_schema_patch_failed";
}

/** Server-serialized stateless patches for the existing JSON FormSchema map. */
export class FormSchemaProtocol {
  private readonly documentQueues = new Map<string, Promise<unknown>>();
  private readonly acceptedRequests = new WeakMap<Y.Doc, Map<string, true>>();

  constructor(private readonly dependencies: FormSchemaProtocolDependencies) {}

  async handleStateless(payload: onStatelessPayload): Promise<boolean> {
    const parsed = parseMessage(payload.payload);
    if (!parsed.recognized) return false;
    if (!parsed.message) {
      sendAck(
        payload.connection,
        undefined,
        parsed.requestId,
        payload.documentName,
        { ok: false, error: "invalid_request" },
      );
      return true;
    }

    await this.enqueue(payload.documentName, async () => {
      await this.applyPatch(payload, parsed.message!, parsed.requestId);
    });
    return true;
  }

  private async applyPatch(
    payload: onStatelessPayload,
    message: FormSchemaPatchMessage,
    requestId: string,
  ): Promise<FormSchemaPatchAck> {
    const { connection, documentName, document } = payload;
    try {
      const memberId = requireAuthenticatedEditor(connection, documentName);
      if (message.documentName !== documentName) {
        throw new Error("document_name_mismatch");
      }
      assertOwnedRoom(this.dependencies, documentName, document);
      const scopeKind = patchScope(document, connection, documentName);
      const currentSchema = readCurrentSchema(document);
      if (this.hasAcceptedRequest(document, memberId, requestId)) {
        return sendAck(connection, message, requestId, documentName, {
          ok: true,
          canonicalSchema: currentSchema,
        });
      }

      const canonicalSchema = applyFormSchemaPatch(
        currentSchema,
        message.previousSchema,
        message.nextSchema,
        scopeKind,
      );
      if (stableJson(canonicalSchema) === stableJson(currentSchema)) {
        this.cacheAcceptedRequest(document, memberId, requestId);
        return sendAck(connection, message, requestId, documentName, {
          ok: true,
          canonicalSchema,
        });
      }

      await persistCanonicalPatch(
        this.dependencies,
        documentName,
        document,
        memberId,
        currentSchema,
        canonicalSchema,
      );
      this.cacheAcceptedRequest(document, memberId, requestId);

      const changed: FormSchemaChangedMessage = {
        kind: FORM_SCHEMA_CHANGED_KIND,
        protocolVersion: FORM_SCHEMA_PROTOCOL_VERSION,
        requestId,
        documentName,
        canonicalSchema,
      };
      (document as QueuedDocument).broadcastStateless?.(
        JSON.stringify(changed),
      );
      return sendAck(connection, message, requestId, documentName, {
        ok: true,
        canonicalSchema,
      });
    } catch (error) {
      if (error instanceof CollaborationConflictError) {
        const ack = sendAck(connection, message, requestId, documentName, {
          ok: false,
          error: error.reason,
        });
        this.dependencies.handleRevisionConflict(error, documentName, document);
        return ack;
      }
      const ack = sendAck(connection, message, requestId, documentName, {
        ok: false,
        error: errorName(error),
      });
      return ack;
    }
  }

  private async enqueue<T>(documentName: string, operation: () => Promise<T>) {
    const previous = this.documentQueues.get(documentName);
    const ready = previous
      ? previous.then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
    const queued = ready.then(operation);
    this.documentQueues.set(documentName, queued);
    try {
      return await queued;
    } finally {
      if (this.documentQueues.get(documentName) === queued) {
        this.documentQueues.delete(documentName);
      }
    }
  }

  private hasAcceptedRequest(
    document: Y.Doc,
    memberId: string,
    requestId: string,
  ): boolean {
    return (
      this.acceptedRequests
        .get(document)
        ?.has(JSON.stringify([memberId, requestId])) ?? false
    );
  }

  private cacheAcceptedRequest(
    document: Y.Doc,
    memberId: string,
    requestId: string,
  ): void {
    const perDocument = this.acceptedRequests.get(document) ?? new Map();
    perDocument.set(JSON.stringify([memberId, requestId]), true);
    while (perDocument.size > 256) {
      // The size check guarantees that the map has at least one key.
      const oldest = perDocument.keys().next().value!;
      perDocument.delete(oldest);
    }
    this.acceptedRequests.set(document, perDocument);
  }
}
