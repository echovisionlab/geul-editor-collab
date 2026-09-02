import type { Server } from "@hocuspocus/server";
import { InteractiveMutationRelayReceiver } from "./interactive-mutation-relay.ts";
import type { ResidentBlockRuntime } from "./resident-block-runtime.ts";
import {
  invalidateCanonicalRoom,
  roomInvalidationFor,
} from "./room-invalidation.ts";

const residentBlockRuntimes = new WeakMap<Server, ResidentBlockRuntime>();

export function registerInteractiveMutationRuntime(
  server: Server,
  residentBlocks: ResidentBlockRuntime,
): void {
  residentBlockRuntimes.set(server, residentBlocks);
}

export function createInteractiveMutationRelayReceiver(
  server: Server,
): InteractiveMutationRelayReceiver {
  return new InteractiveMutationRelayReceiver({
    rooms: server.hocuspocus,
    async applyAcceptedRoom({
      identity,
      document,
      request,
      transactionOrigin,
      beforeApply,
    }) {
      const residentBlocks = residentBlockRuntimes.get(server);
      if (!residentBlocks) {
        throw new Error("interactive_mutation_resident_runtime_unavailable");
      }
      await residentBlocks.applyAcceptedInteractiveMutation(
        identity.documentName,
        document,
        {
          expectedDocumentRevision: request.expectedDocumentRevision,
          acceptedDocumentRevision: request.acceptedDocumentRevision,
          ...(request.expectedTargetRevision === undefined
            ? {}
            : { expectedTargetRevision: request.expectedTargetRevision }),
          ...(request.acceptedTargetRevision === undefined
            ? {}
            : { acceptedTargetRevision: request.acceptedTargetRevision }),
          operations: request.operations,
          origin: transactionOrigin,
          beforeApply,
        },
      );
    },
    retireExactRoom: (identity) =>
      invalidateCanonicalRoom(
        server,
        identity.documentType,
        identity.entityId,
        identity.locale,
      ),
    async retireOtherEntityRooms(identity) {
      const invalidation = roomInvalidationFor(server);
      if (!invalidation) {
        throw new Error("interactive_mutation_room_invalidator_unavailable");
      }
      await invalidation.invalidateEntityExcept(
        identity.documentType,
        identity.entityId,
        identity.documentName,
      );
    },
  });
}
