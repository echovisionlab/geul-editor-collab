import {
  createDocumentName,
  residentBlockDocumentType,
  type CollaborativeDocumentType,
} from "@echovisionlab/geul-common/collaboration/document";
import type { AIDocumentDomain } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import type {
  InteractiveAIDocumentMutationOrigin,
  RelayInteractiveAIDocumentMutationRequest,
} from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import type { Document as HocuspocusDocument } from "@hocuspocus/server";
import type { CollabConnectionContext } from "./connection-context.ts";
import { collaborativeDocumentTypeForAIDomain } from "./interactive-mutation-document.ts";

export const INTERACTIVE_MUTATION_BEGIN_KIND = "interactive_mutation.begin";
export const INTERACTIVE_MUTATION_END_KIND = "interactive_mutation.end";

interface InteractiveMutationTransactionOrigin {
  readonly source: "local";
  readonly skipStoreHooks: true;
  readonly context: {
    readonly interactiveMutation: {
      readonly mutationId: string;
      readonly origin: InteractiveAIDocumentMutationOrigin;
      readonly actorMemberId: string;
    };
  };
}

interface InteractiveMutationRoomIdentity {
  documentName: string;
  documentType: CollaborativeDocumentType;
  entityId: string;
  locale: string;
}

interface InteractiveMutationRoomRegistry {
  documents: ReadonlyMap<string, HocuspocusDocument>;
  loadingDocuments: ReadonlyMap<string, unknown>;
}

type ResidentRoomDisposition =
  | { kind: "absent" }
  | { kind: "retire" }
  | { kind: "apply"; document: HocuspocusDocument };

export interface InteractiveMutationRelayDependencies {
  rooms: InteractiveMutationRoomRegistry;
  applyAcceptedRoom(input: {
    identity: InteractiveMutationRoomIdentity;
    document: HocuspocusDocument;
    request: RelayInteractiveAIDocumentMutationRequest;
    transactionOrigin: InteractiveMutationTransactionOrigin;
    beforeApply(): void;
  }): Promise<void>;
  retireExactRoom(identity: InteractiveMutationRoomIdentity): Promise<boolean>;
  retireOtherEntityRooms(
    identity: InteractiveMutationRoomIdentity,
  ): Promise<void>;
}

function localeLifecycleOperation(
  request: RelayInteractiveAIDocumentMutationRequest,
): "create" | "delete" | undefined {
  if (request.operations.length !== 1) return undefined;
  switch (request.operations[0]?.operation.case) {
    case "createTranslation":
      return "create";
    case "deleteTranslation":
      return "delete";
    default:
      return undefined;
  }
}

function isSourceMutation(
  request: RelayInteractiveAIDocumentMutationRequest,
): boolean {
  return (
    request.expectedTargetRevision === undefined &&
    request.acceptedTargetRevision === undefined
  );
}

function editableActorConnections(
  document: HocuspocusDocument,
  actorMemberId: string,
) {
  return document.getConnections().filter((connection) => {
    const context = connection.context as CollabConnectionContext | undefined;
    return (
      context?.member?.id === actorMemberId &&
      context.canEdit === true &&
      connection.readOnly === false
    );
  });
}

function sendMutationMarker(
  connections: ReturnType<typeof editableActorConnections>,
  marker:
    | {
        kind: typeof INTERACTIVE_MUTATION_BEGIN_KIND;
        mutationId: string;
      }
    | {
        kind: typeof INTERACTIVE_MUTATION_END_KIND;
        mutationId: string;
        outcome: "accepted" | "aborted";
      },
): void {
  const payload = JSON.stringify(marker);
  for (const connection of connections) connection.sendStateless(payload);
}

function relayRoomIdentity(
  domain: AIDocumentDomain,
  entityId: string,
  locale: string,
): InteractiveMutationRoomIdentity | undefined {
  const documentType = collaborativeDocumentTypeForAIDomain(domain);
  if (documentType === undefined) return undefined;
  return {
    documentName: createDocumentName(documentType, entityId, locale),
    documentType,
    entityId,
    locale,
  };
}

function transactionOrigin(
  request: RelayInteractiveAIDocumentMutationRequest,
): InteractiveMutationTransactionOrigin {
  return Object.freeze({
    source: "local" as const,
    skipStoreHooks: true as const,
    context: Object.freeze({
      interactiveMutation: Object.freeze({
        mutationId: request.mutationId,
        origin: request.origin,
        actorMemberId: request.actorMemberId,
      }),
    }),
  });
}

function residentRoomDisposition(
  rooms: InteractiveMutationRoomRegistry,
  identity: InteractiveMutationRoomIdentity,
  request: RelayInteractiveAIDocumentMutationRequest,
): ResidentRoomDisposition {
  const loading = rooms.loadingDocuments.has(identity.documentName);
  const document = rooms.documents.get(identity.documentName);
  if (!loading && !document) return { kind: "absent" };
  if (
    loading ||
    !document ||
    document.getConnectionsCount() === 0 ||
    localeLifecycleOperation(request) !== undefined
  ) {
    return { kind: "retire" };
  }
  return { kind: "apply", document };
}

async function requireRetired(
  dependencies: InteractiveMutationRelayDependencies,
  identity: InteractiveMutationRoomIdentity,
): Promise<void> {
  if (await dependencies.retireExactRoom(identity)) return;
  throw new Error(
    `interactive_mutation_room_retire_failed:${identity.documentName}`,
  );
}

async function fenceFailedApply(
  dependencies: InteractiveMutationRelayDependencies,
  identity: InteractiveMutationRoomIdentity,
  error: unknown,
): Promise<never> {
  try {
    await requireRetired(dependencies, identity);
  } catch (retireError) {
    throw new AggregateError(
      [error, retireError],
      `interactive_mutation_apply_and_retire_failed:${identity.documentName}`,
    );
  }
  throw error;
}

function requireApplyBoundaryEntered(entered: boolean): void {
  if (!entered) {
    throw new Error("interactive_mutation_apply_boundary_not_entered");
  }
}

class InteractiveMutationRoomBecameInactiveError extends Error {
  constructor(readonly documentName: string) {
    super(`interactive_mutation_room_became_inactive:${documentName}`);
    this.name = "InteractiveMutationRoomBecameInactiveError";
  }
}

interface InteractiveMutationApplyState {
  actorConnections: ReturnType<typeof editableActorConnections>;
  boundaryEntered: boolean;
}

function beginQueuedApply(
  document: HocuspocusDocument,
  identity: InteractiveMutationRoomIdentity,
  request: RelayInteractiveAIDocumentMutationRequest,
  state: InteractiveMutationApplyState,
): void {
  if (state.boundaryEntered) {
    throw new Error("interactive_mutation_apply_boundary_reentered");
  }
  // The resident runtime serializes this callback inside the room's
  // persistence queue. Recheck liveness here, not only at dispatch:
  // a grace-resident room may lose its last browser while waiting.
  if (document.getConnectionsCount() === 0) {
    throw new InteractiveMutationRoomBecameInactiveError(identity.documentName);
  }
  state.boundaryEntered = true;
  state.actorConnections = editableActorConnections(
    document,
    request.actorMemberId,
  );
  sendMutationMarker(state.actorConnections, {
    kind: INTERACTIVE_MUTATION_BEGIN_KIND,
    mutationId: request.mutationId,
  });
}

async function handleResidentApplyFailure(
  dependencies: InteractiveMutationRelayDependencies,
  identity: InteractiveMutationRoomIdentity,
  request: RelayInteractiveAIDocumentMutationRequest,
  state: InteractiveMutationApplyState,
  error: unknown,
): Promise<void> {
  if (error instanceof InteractiveMutationRoomBecameInactiveError) {
    await requireRetired(dependencies, identity);
    return;
  }
  let failure = error;
  try {
    sendMutationMarker(state.actorConnections, {
      kind: INTERACTIVE_MUTATION_END_KIND,
      mutationId: request.mutationId,
      outcome: "aborted",
    });
  } catch (markerError) {
    failure = new AggregateError(
      [error, markerError],
      `interactive_mutation_apply_and_marker_failed:${identity.documentName}`,
    );
  }
  await fenceFailedApply(dependencies, identity, failure);
}

async function applyToResidentRoom(
  dependencies: InteractiveMutationRelayDependencies,
  identity: InteractiveMutationRoomIdentity,
  document: HocuspocusDocument,
  request: RelayInteractiveAIDocumentMutationRequest,
): Promise<void> {
  const state: InteractiveMutationApplyState = {
    actorConnections: [],
    boundaryEntered: false,
  };
  try {
    await dependencies.applyAcceptedRoom({
      identity,
      document,
      request,
      transactionOrigin: transactionOrigin(request),
      beforeApply: () => beginQueuedApply(document, identity, request, state),
    });
    requireApplyBoundaryEntered(state.boundaryEntered);
    // Hocuspocus batches Yjs broadcasts until the end of the event-loop turn.
    // Flush before the end marker so the actor's Web session observes the
    // exact order begin -> one accepted Yjs update -> end.
    document.flush();
    sendMutationMarker(state.actorConnections, {
      kind: INTERACTIVE_MUTATION_END_KIND,
      mutationId: request.mutationId,
      outcome: "accepted",
    });
  } catch (error) {
    await handleResidentApplyFailure(
      dependencies,
      identity,
      request,
      state,
      error,
    );
  }
}

export class InteractiveMutationRelayReceiver {
  constructor(
    private readonly dependencies: InteractiveMutationRelayDependencies,
  ) {}

  async relay(
    request: RelayInteractiveAIDocumentMutationRequest,
  ): Promise<void> {
    if (!request.document || !request.locale) {
      throw new Error("interactive_mutation_relay_not_validated");
    }
    const identity = relayRoomIdentity(
      request.document.domain,
      request.document.reference,
      request.locale.code,
    );
    if (!identity) return;
    if (isSourceMutation(request)) {
      await this.dependencies.retireOtherEntityRooms(identity);
    }

    // Structured rooms have their own canonical projection and cannot replay
    // the generic Block Room operation codec. Retire an open exact room so the
    // next connection reloads the accepted domain state.
    if (!residentBlockDocumentType(identity.documentType)) {
      await this.dependencies.retireExactRoom(identity);
      return;
    }

    const resident = residentRoomDisposition(
      this.dependencies.rooms,
      identity,
      request,
    );
    if (resident.kind === "absent") return;
    if (resident.kind === "retire") {
      await requireRetired(this.dependencies, identity);
      return;
    }

    await applyToResidentRoom(
      this.dependencies,
      identity,
      resident.document,
      request,
    );
  }
}
