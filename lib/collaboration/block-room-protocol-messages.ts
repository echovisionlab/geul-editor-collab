import { fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import type { Connection } from "@hocuspocus/server";
import type { BlockRoomDocumentType } from "@echovisionlab/geul-common/collaboration/block-room-codec";
import {
  DocumentLayoutSchema,
  type DocumentLayout,
} from "@echovisionlab/geul-proto/common/common_pb.ts";
import {
  LocalizedPageDocumentSchema,
  LocalizedRichTextDocumentSchema,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { AIDocumentFieldTargetSchema } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import * as Y from "yjs";
import {
  parseSourceMetadataRequest,
  parsePostDocumentMetadataRequest,
  parseResidentDocumentMetadataRequest,
} from "./block-metadata-request.ts";
import type { ResidentBlockRuntime } from "./resident-block-runtime.ts";
import {
  COLLAB_RELOAD_REQUIRED_SIGNAL,
  RoomEpochMismatchError,
} from "./room-epoch.ts";

const BLOCK_ROOM_PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 16 * 1024;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const { stateVector: EMPTY_STATE_VECTOR, update: EMPTY_UPDATE } = (() => {
  const document = new Y.Doc();
  try {
    return {
      stateVector: Y.encodeStateVector(document),
      update: Y.encodeStateAsUpdate(document),
    };
  } finally {
    document.destroy();
  }
})();

export interface BootstrapAckMessage {
  kind: "block_room.bootstrap_ack";
  protocolVersion: 1;
  challenge: string;
  stateVector: string;
}

export interface MetadataMessage {
  kind: "block_room.metadata";
  protocolVersion: 1;
  requestId: string;
  operation: "locale" | "document" | "page_layout";
  payload: JsonValue;
}

export interface SnapshotMessage {
  kind: "block_room.snapshot";
  protocolVersion: 1;
  requestId: string;
}

export type ClientMessage =
  BootstrapAckMessage | MetadataMessage | SnapshotMessage;

function hasExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function parseSnapshotMessage(
  record: Record<string, unknown>,
): SnapshotMessage | undefined {
  return record.kind === "block_room.snapshot" &&
    hasExactKeys(record, ["kind", "protocolVersion", "requestId"]) &&
    record.protocolVersion === BLOCK_ROOM_PROTOCOL_VERSION &&
    typeof record.requestId === "string" &&
    UUID.test(record.requestId)
    ? (record as unknown as SnapshotMessage)
    : undefined;
}

function parseBootstrapAckMessage(
  record: Record<string, unknown>,
): BootstrapAckMessage | undefined {
  return record.kind === "block_room.bootstrap_ack" &&
    hasExactKeys(record, [
      "kind",
      "protocolVersion",
      "challenge",
      "stateVector",
    ]) &&
    record.protocolVersion === BLOCK_ROOM_PROTOCOL_VERSION &&
    typeof record.challenge === "string" &&
    record.challenge.length > 0 &&
    typeof record.stateVector === "string" &&
    BASE64.test(record.stateVector)
    ? (record as unknown as BootstrapAckMessage)
    : undefined;
}

function parseMetadataMessage(
  record: Record<string, unknown>,
): MetadataMessage | undefined {
  const operation = record.operation;
  const validOperation =
    operation === "locale" ||
    operation === "document" ||
    operation === "page_layout";
  return record.kind === "block_room.metadata" &&
    hasExactKeys(record, [
      "kind",
      "protocolVersion",
      "requestId",
      "operation",
      "payload",
    ]) &&
    record.protocolVersion === BLOCK_ROOM_PROTOCOL_VERSION &&
    typeof record.requestId === "string" &&
    UUID.test(record.requestId) &&
    validOperation
    ? (record as unknown as MetadataMessage)
    : undefined;
}

export function parseClientMessage(payload: string): ClientMessage {
  if (Buffer.byteLength(payload, "utf8") > MAX_MESSAGE_BYTES) {
    throw new Error("protocol_message_too_large");
  }
  const value: unknown = JSON.parse(payload);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("protocol_message_invalid");
  }
  const record = value as Record<string, unknown>;
  const message =
    parseSnapshotMessage(record) ??
    parseBootstrapAckMessage(record) ??
    parseMetadataMessage(record);
  if (message) {
    return message;
  }
  throw new Error("protocol_message_invalid");
}

function documentJson(
  documentType: BlockRoomDocumentType,
  document: ReturnType<ResidentBlockRuntime["bootstrap"]>["document"],
): unknown {
  return documentType === "page"
    ? toJson(LocalizedPageDocumentSchema, document as never)
    : toJson(LocalizedRichTextDocumentSchema, document as never);
}

export function sendReload(
  connection: Pick<Connection, "close" | "sendStateless">,
): void {
  try {
    connection.sendStateless(
      JSON.stringify({
        kind: COLLAB_RELOAD_REQUIRED_SIGNAL,
        reason: COLLAB_RELOAD_REQUIRED_SIGNAL,
      }),
    );
  } finally {
    connection.close();
  }
}

export function sendBootstrap(
  connection: Pick<Connection, "sendStateless">,
  input: {
    challenge: string;
    documentName: string;
    snapshot: ReturnType<ResidentBlockRuntime["bootstrap"]>;
    serverInstanceId: string;
    roomEpoch: string;
    update: Uint8Array;
  },
): void {
  connection.sendStateless(
    JSON.stringify({
      kind: "block_room.bootstrap",
      protocolVersion: BLOCK_ROOM_PROTOCOL_VERSION,
      bootstrapChallenge: input.challenge,
      documentName: input.documentName,
      documentType: input.snapshot.documentType,
      document: documentJson(
        input.snapshot.documentType,
        input.snapshot.document,
      ),
      documentRevision: input.snapshot.documentRevision,
      sourceLocale: input.snapshot.sourceLocale,
      locale: input.snapshot.locale,
      localeExists: input.snapshot.localeExists,
      ...(input.snapshot.targetRevision === undefined
        ? {}
        : { targetRevision: input.snapshot.targetRevision }),
      presentLocaleValues: input.snapshot.presentLocaleValues.map((target) =>
        toJson(AIDocumentFieldTargetSchema, target),
      ),
      sourceMetadata: input.snapshot.sourceMetadata,
      ...(input.snapshot.localeMetadata === undefined
        ? {}
        : { localeMetadata: input.snapshot.localeMetadata }),
      blockCatalogFingerprint: input.snapshot.blockCatalogFingerprint,
      serverInstanceId: input.serverInstanceId,
      roomEpoch: input.roomEpoch,
      yjsBootstrapUpdate: Buffer.from(input.update).toString("base64"),
    }),
  );
}

export function sendReady(
  connection: Pick<Connection, "sendStateless">,
  challenge: string,
): void {
  connection.sendStateless(
    JSON.stringify({
      kind: "block_room.ready",
      protocolVersion: BLOCK_ROOM_PROTOCOL_VERSION,
      bootstrapChallenge: challenge,
    }),
  );
}

export function sendSnapshotResult(
  connection: Pick<Connection, "sendStateless">,
  requestId: string,
  result:
    | {
        ok: true;
        snapshot: {
          documentRevision: string;
          sourceLocale: string;
          locale: string;
          localeExists: boolean;
          targetRevision?: string;
        };
      }
    | { ok: false; error: "reload_required" },
): void {
  connection.sendStateless(
    JSON.stringify({
      kind: "block_room.snapshot_result",
      protocolVersion: BLOCK_ROOM_PROTOCOL_VERSION,
      requestId,
      ...result,
    }),
  );
}

export function sendMetadataResult(
  connection: Pick<Connection, "sendStateless">,
  requestId: string,
  result: { ok: true; ack: unknown } | { ok: false; error: string },
): void {
  connection.sendStateless(
    JSON.stringify({
      kind: "block_room.metadata_result",
      protocolVersion: BLOCK_ROOM_PROTOCOL_VERSION,
      requestId,
      ...result,
    }),
  );
}

export function decodeStateVector(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

export function stateVectorIncludes(
  actualBytes: Uint8Array,
  expectedBytes: Uint8Array,
): boolean {
  const actual = Y.decodeStateVector(actualBytes);
  const expected = Y.decodeStateVector(expectedBytes);
  for (const [client, clock] of expected) {
    if ((actual.get(client) ?? 0) < clock) {
      return false;
    }
  }
  return true;
}

export function parsePageLayout(value: JsonValue): DocumentLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request_body_invalid");
  }
  const record = value as Record<string, JsonValue>;
  if (!hasExactKeys(record, ["documentLayout"])) {
    throw new Error("request_body_invalid");
  }
  return fromJson(DocumentLayoutSchema, record.documentLayout);
}

function isAllowedPreAdmissionSync(type: number, payload: Uint8Array): boolean {
  let expected: Uint8Array | undefined;
  if (type === 0) {
    expected = EMPTY_STATE_VECTOR;
  }
  if (type === 1) {
    expected = EMPTY_UPDATE;
  }
  return Boolean(
    expected &&
    payload.length === expected.length &&
    payload.every((value, index) => value === expected[index]),
  );
}

export function requireMetadataUpdateRequest(
  documentType: BlockRoomDocumentType,
  operation: "locale" | "document",
  payload: JsonValue,
) {
  const request = metadataUpdateRequest(documentType, operation, payload);
  if (!request) {
    throw new Error("request_body_invalid");
  }
  return request;
}

function metadataUpdateRequest(
  documentType: BlockRoomDocumentType,
  operation: "locale" | "document",
  payload: JsonValue,
) {
  if (operation === "locale") {
    return parseSourceMetadataRequest(documentType, payload);
  }
  if (documentType === "post") {
    return parsePostDocumentMetadataRequest(payload);
  }
  if (documentType === "artist" || documentType === "label") {
    return parseResidentDocumentMetadataRequest(documentType, payload);
  }
  return undefined;
}

export function assertPreAdmissionSync(
  connection: Pick<Connection, "close" | "sendStateless">,
  type: number,
  payload: Uint8Array,
): void {
  if (isAllowedPreAdmissionSync(type, payload)) {
    return;
  }
  sendReload(connection);
  throw new RoomEpochMismatchError();
}
