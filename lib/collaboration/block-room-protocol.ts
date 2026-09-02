import type { Connection, onStatelessPayload } from "@hocuspocus/server";
import {
  assertBlockRoomLocaleChangeAllowed,
  BlockRoomLocaleChangeError,
  BlockRoomLocaleChangeRejectionReason,
  type BlockRoomDocumentType,
} from "@echovisionlab/geul-common/collaboration/block-room-codec";
import * as Y from "yjs";
import {
  CollaborationConflictError,
  CollaborationMutationRejectionError,
  CollaborationResourceNotFoundError,
  type CollaborationMutationRejectionReasonName,
} from "../api/transport.ts";
import { logger } from "../logger.ts";
import {
  assertPreAdmissionSync,
  decodeStateVector,
  parseClientMessage,
  parsePageLayout,
  requireMetadataUpdateRequest,
  sendBootstrap,
  sendMetadataResult,
  sendReady,
  sendReload,
  sendSnapshotResult,
  stateVectorIncludes,
  type BootstrapAckMessage,
  type MetadataMessage,
  type SnapshotMessage,
} from "./block-room-protocol-messages.ts";
import type { CollabConnectionContext } from "./connection-context.ts";
import type { ResidentBlockRuntime } from "./resident-block-runtime.ts";
import { residentBlockDocumentType } from "./resident-block-runtime.ts";
import {
  RoomEpochMismatchError,
  type RoomEpochAdmission,
  type RoomEpochRegistry,
} from "./room-epoch.ts";

export interface BlockRoomProtocolDependencies {
  roomEpochs: RoomEpochRegistry;
  residentBlocks: ResidentBlockRuntime;
  isDocumentFenced(documentName: string): boolean;
  fenceDocument(
    error: CollaborationConflictError,
    documentName: string,
    document: Y.Doc,
  ): void;
  deleteEntity(entityDocumentName: string): Promise<void>;
  recordAcceptedMetadataChange(
    documentName: string,
    authenticatedMemberId: string,
  ): void;
}

function currentAdmission(
  dependencies: BlockRoomProtocolDependencies,
  documentName: string,
  context: CollabConnectionContext,
): RoomEpochAdmission | undefined {
  if (
    context.blockRoomAdmissionState !== "accepted" ||
    dependencies.isDocumentFenced(documentName)
  ) {
    return undefined;
  }
  return dependencies.roomEpochs.validateAdmission(
    documentName,
    context as CollabConnectionContext & RoomEpochAdmission,
  );
}

function contextDocumentType(
  context: CollabConnectionContext | undefined,
): BlockRoomDocumentType | undefined {
  return context?.documentType === undefined
    ? undefined
    : residentBlockDocumentType(context.documentType);
}

const localeChangeRejectionReasons: Record<
  BlockRoomLocaleChangeRejectionReason,
  CollaborationMutationRejectionReasonName
> = {
  [BlockRoomLocaleChangeRejectionReason.NonSourceStructure]:
    "non_source_structure_forbidden",
  [BlockRoomLocaleChangeRejectionReason.RoomLocaleMismatch]:
    "room_locale_mismatch",
  [BlockRoomLocaleChangeRejectionReason.NonSourceSharedField]:
    "non_source_shared_field_forbidden",
  [BlockRoomLocaleChangeRejectionReason.NonSourceFileRelation]:
    "non_source_file_relation_forbidden",
  [BlockRoomLocaleChangeRejectionReason.NonSourceDocumentMetadata]:
    "non_source_document_metadata_forbidden",
};

function assertBlockRoomSyncAllowed(
  connection: Pick<Connection, "close" | "sendStateless">,
  document: Y.Doc,
  documentType: BlockRoomDocumentType,
  type: number,
  payload: Uint8Array,
): void {
  if (type !== 1 && type !== 2) {
    return;
  }
  const candidate = new Y.Doc();
  try {
    Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
    Y.applyUpdate(candidate, payload);
    assertBlockRoomLocaleChangeAllowed(document, candidate, documentType);
  } catch (error) {
    if (error instanceof BlockRoomLocaleChangeError) {
      sendReload(connection);
      throw new CollaborationMutationRejectionError(
        localeChangeRejectionReasons[error.reason],
      );
    }
    sendReload(connection);
    throw error;
  } finally {
    candidate.destroy();
  }
}

export class BlockRoomProtocol {
  constructor(private readonly dependencies: BlockRoomProtocolDependencies) {}

  connected(
    connection: Connection,
    context: CollabConnectionContext,
    documentName: string,
    document: Y.Doc,
  ): void {
    const documentType = contextDocumentType(context);
    if (!documentType || context.blockRoomAdmissionState === "accepted") {
      return;
    }
    if (
      context.blockRoomAdmissionState !== "pending" ||
      this.dependencies.isDocumentFenced(documentName)
    ) {
      sendReload(connection);
      return;
    }
    const snapshot = this.dependencies.residentBlocks.bootstrap(
      documentName,
      document,
    );
    if (!snapshot.localeExists) connection.readOnly = true;
    const update = Y.encodeStateAsUpdate(document);
    const stateVector = Y.encodeStateVector(document);
    const challenge = this.dependencies.roomEpochs.issueToken(documentName, {
      yjsBootstrapStateVector: stateVector,
    });
    const admission = this.dependencies.roomEpochs.validate(
      documentName,
      challenge,
    );
    if (!admission) {
      sendReload(connection);
      return;
    }
    Object.assign(context, admission, {
      blockRoomAdmissionState: "issued",
      bootstrapChallenge: challenge,
    });
    sendBootstrap(connection, {
      challenge,
      documentName,
      snapshot,
      serverInstanceId: admission.serverInstanceId,
      roomEpoch: admission.roomEpoch,
      update,
    });
  }

  beforeSync(
    connection: Pick<Connection, "close" | "sendStateless">,
    context: CollabConnectionContext,
    documentName: string,
    document: Y.Doc,
    type: number,
    payload: Uint8Array,
  ): void {
    const documentType = contextDocumentType(context);
    if (!documentType) {
      return;
    }
    if (context.blockRoomAdmissionState !== "accepted") {
      assertPreAdmissionSync(connection, type, payload);
      return;
    }
    if (currentAdmission(this.dependencies, documentName, context)) {
      assertBlockRoomSyncAllowed(
        connection,
        document,
        documentType,
        type,
        payload,
      );
      return;
    }
    sendReload(connection);
    throw new RoomEpochMismatchError();
  }

  async handleStateless(payload: onStatelessPayload): Promise<boolean> {
    const context = payload.connection.context as
      CollabConnectionContext | undefined;
    const documentType = contextDocumentType(context);
    if (!context || !documentType) {
      return false;
    }
    let message;
    try {
      message = parseClientMessage(payload.payload);
    } catch {
      return false;
    }
    if (message.kind === "block_room.bootstrap_ack") {
      this.acceptBootstrap(
        payload.connection,
        context,
        payload.documentName,
        message,
      );
      return true;
    }
    if (message.kind === "block_room.snapshot") {
      this.sendSnapshot(payload, context, message);
      return true;
    }
    await this.updateMetadata(payload, context, documentType, message);
    return true;
  }

  private sendSnapshot(
    { connection, documentName, document }: onStatelessPayload,
    context: CollabConnectionContext,
    message: SnapshotMessage,
  ): void {
    if (!currentAdmission(this.dependencies, documentName, context)) {
      sendSnapshotResult(connection, message.requestId, {
        ok: false,
        error: "reload_required",
      });
      sendReload(connection);
      return;
    }
    const snapshot = this.dependencies.residentBlocks.bootstrap(
      documentName,
      document,
    );
    sendSnapshotResult(connection, message.requestId, {
      ok: true,
      snapshot: {
        documentRevision: snapshot.documentRevision,
        sourceLocale: snapshot.sourceLocale,
        locale: snapshot.locale,
        localeExists: snapshot.localeExists,
        ...(snapshot.targetRevision === undefined
          ? {}
          : { targetRevision: snapshot.targetRevision }),
      },
    });
  }

  private acceptBootstrap(
    connection: Connection,
    context: CollabConnectionContext,
    documentName: string,
    message: BootstrapAckMessage,
  ): void {
    const admission = this.dependencies.roomEpochs.validate(
      documentName,
      message.challenge,
    );
    let clientStateVector: Uint8Array;
    let includesBootstrapState = false;
    try {
      clientStateVector = decodeStateVector(message.stateVector);
      if (admission) {
        includesBootstrapState = stateVectorIncludes(
          clientStateVector,
          admission.yjsBootstrapStateVector,
        );
      }
    } catch {
      sendReload(connection);
      return;
    }
    if (
      context.blockRoomAdmissionState !== "issued" ||
      message.challenge !== context.bootstrapChallenge ||
      !admission ||
      !includesBootstrapState ||
      !this.dependencies.roomEpochs.markSynchronized(
        documentName,
        message.challenge,
      )
    ) {
      sendReload(connection);
      return;
    }
    context.requiresCanonicalSyncFence = false;
    context.blockRoomAdmissionState = "accepted";
    sendReady(connection, message.challenge);
  }

  private async updateMetadata(
    { connection, documentName, document }: onStatelessPayload,
    context: CollabConnectionContext,
    documentType: BlockRoomDocumentType,
    message: MetadataMessage,
  ): Promise<void> {
    if (context.canEdit === false) {
      sendMetadataResult(connection, message.requestId, {
        ok: false,
        error: "permission_denied",
      });
      return;
    }
    if (!currentAdmission(this.dependencies, documentName, context)) {
      this.rejectMetadataForReload(connection, message.requestId);
      return;
    }
    const memberId = context.member?.id;
    if (!memberId) {
      this.rejectMetadataForReload(connection, message.requestId);
      return;
    }
    try {
      const result = await this.applyMetadata(
        documentName,
        document,
        documentType,
        message,
        memberId,
      );
      if (result.changed) {
        this.dependencies.recordAcceptedMetadataChange(documentName, memberId);
      }
      sendMetadataResult(connection, message.requestId, {
        ok: true,
        ack: result,
      });
    } catch (error) {
      await this.handleMetadataError(
        error,
        connection,
        documentName,
        document,
        message.requestId,
      );
    }
  }

  private rejectMetadataForReload(
    connection: Pick<Connection, "close" | "sendStateless">,
    requestId: string,
  ): void {
    sendMetadataResult(connection, requestId, {
      ok: false,
      error: "reload_required",
    });
    sendReload(connection);
  }

  private async applyMetadata(
    documentName: string,
    document: Y.Doc,
    documentType: BlockRoomDocumentType,
    message: MetadataMessage,
    memberId: string,
  ): Promise<{ changed: boolean }> {
    if (message.operation !== "page_layout") {
      const request = requireMetadataUpdateRequest(
        documentType,
        message.operation,
        message.payload,
      );
      return this.dependencies.residentBlocks.updateMetadata(
        documentName,
        document,
        request.update,
        [memberId],
      );
    }
    if (documentType !== "page") {
      throw new Error("request_body_invalid");
    }
    const result =
      await this.dependencies.residentBlocks.updatePageDocumentLayout(
        documentName,
        document,
        parsePageLayout(message.payload),
        [memberId],
      );
    return result;
  }

  private async handleMetadataError(
    error: unknown,
    connection: Pick<Connection, "sendStateless">,
    documentName: string,
    document: Y.Doc,
    requestId: string,
  ): Promise<void> {
    if (error instanceof CollaborationResourceNotFoundError) {
      await this.dependencies.deleteEntity(documentName);
      sendMetadataResult(connection, requestId, {
        ok: false,
        error: "not_found",
      });
      return;
    }
    if (error instanceof CollaborationConflictError) {
      this.dependencies.fenceDocument(error, documentName, document);
      sendMetadataResult(connection, requestId, {
        ok: false,
        error: "reload_required",
      });
      return;
    }
    if (error instanceof Error && error.message === "request_body_invalid") {
      sendMetadataResult(connection, requestId, {
        ok: false,
        error: "invalid_request",
      });
      return;
    }
    logger.error("Failed to update collaboration metadata", {
      documentName,
      error: error instanceof Error ? error.message : String(error),
    });
    sendMetadataResult(connection, requestId, {
      ok: false,
      error: "metadata_update_failed",
    });
  }
}
