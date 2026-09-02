import { type JsonValue } from "@bufbuild/protobuf";
import { applyAIDocumentOperationsToBlockRoom } from "@echovisionlab/geul-common/collaboration/block-room-codec";
import {
  parseDocumentName,
  residentBlockDocumentType,
} from "@echovisionlab/geul-common/collaboration/document";
import type { AIDocumentOperation } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import type * as Y from "yjs";
import type { BlockRoomLocaleData } from "./block-room-snapshot.ts";
import {
  type ResidentBlockPersistence,
  type ResidentExternalMutationRevisionTuple,
} from "./resident-block-persistence.ts";

export interface ResidentInteractiveMutationInput extends ResidentExternalMutationRevisionTuple {
  operations: readonly AIDocumentOperation[];
  origin: object;
  beforeApply(): void;
}

type InteractiveMutationPersistence = ResidentBlockPersistence<
  JsonValue,
  BlockRoomLocaleData
>;

type InteractiveMutationMetadata = NonNullable<
  ReturnType<InteractiveMutationPersistence["snapshot"]>
>;

function assertTargetRevisionRole(
  metadata: InteractiveMutationMetadata,
  input: ResidentInteractiveMutationInput,
): void {
  if (metadata.locale === metadata.sourceLocale) {
    throw new Error("interactive_mutation_target_source_room_forbidden");
  }
  if (
    input.acceptedDocumentRevision !== input.expectedDocumentRevision ||
    input.acceptedTargetRevision === undefined
  ) {
    throw new Error("interactive_mutation_target_revision_tuple_invalid");
  }
}

function assertSourceRevisionRole(
  metadata: InteractiveMutationMetadata,
  input: ResidentInteractiveMutationInput,
): void {
  if (metadata.locale !== metadata.sourceLocale) {
    throw new Error("interactive_mutation_source_target_room_forbidden");
  }
  if (input.acceptedDocumentRevision === input.expectedDocumentRevision) {
    throw new Error("interactive_mutation_document_revision_not_advanced");
  }
}

function assertInteractiveRevisionRole(
  metadata: InteractiveMutationMetadata,
  input: ResidentInteractiveMutationInput,
): void {
  const targetMutation =
    input.expectedTargetRevision !== undefined ||
    input.acceptedTargetRevision !== undefined;
  if (targetMutation) {
    assertTargetRevisionRole(metadata, input);
    return;
  }
  assertSourceRevisionRole(metadata, input);
}

export function applyAcceptedResidentInteractiveMutation(
  persistence: InteractiveMutationPersistence,
  acceptedOrigins: WeakSet<object>,
  documentName: string,
  document: Y.Doc,
  input: ResidentInteractiveMutationInput,
): void {
  const parsed = parseDocumentName(documentName);
  const documentType = residentBlockDocumentType(parsed.type);
  if (!documentType) {
    throw new Error(`resident_block_type_required:${documentName}`);
  }
  const metadata = persistence.snapshot(documentName);
  if (!metadata) {
    throw new Error(`resident_document_not_loaded:${documentName}`);
  }
  assertInteractiveRevisionRole(metadata, input);
  persistence.assertExternalMutationReady(documentName, document, input);
  input.beforeApply();
  acceptedOrigins.add(input.origin);
  try {
    applyAIDocumentOperationsToBlockRoom(
      document,
      documentType,
      input.operations,
      { expectedRoomLocale: parsed.locale, origin: input.origin },
    );
  } finally {
    acceptedOrigins.delete(input.origin);
  }
  persistence.acceptExternalMutation(documentName, document, input);
}
