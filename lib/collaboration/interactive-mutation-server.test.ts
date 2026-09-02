import { create } from "@bufbuild/protobuf";
import {
  CollaborativeDocumentType,
  createDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import {
  AIDocumentDeleteBlockOperationSchema,
  AIDocumentDomain,
  AIDocumentLocaleSchema,
  AIDocumentOperationSchema,
  AIDocumentReferenceSchema,
} from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import {
  InteractiveAIDocumentMutationOrigin,
  RelayInteractiveAIDocumentMutationRequestSchema,
} from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import {
  Document as HocuspocusDocument,
  type Server,
} from "@hocuspocus/server";
import { describe, expect, it, vi } from "vitest";
import {
  createInteractiveMutationRelayReceiver,
  registerInteractiveMutationRuntime,
} from "./interactive-mutation-server.ts";
import {
  registerRoomInvalidation,
  type RoomInvalidation,
} from "./room-invalidation.ts";
import type { ResidentBlockRuntime } from "./resident-block-runtime.ts";

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_NAME = createDocumentName(
  CollaborativeDocumentType.POST,
  ENTITY_ID,
  "ko",
);

function request(target: boolean) {
  return create(RelayInteractiveAIDocumentMutationRequestSchema, {
    mutationId: "mutation-1",
    origin:
      InteractiveAIDocumentMutationOrigin.INTERACTIVE_AI_DOCUMENT_MUTATION_ORIGIN_MCP,
    document: create(AIDocumentReferenceSchema, {
      domain: AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST,
      reference: ENTITY_ID,
    }),
    locale: create(AIDocumentLocaleSchema, { code: "ko" }),
    expectedDocumentRevision: "document-before",
    acceptedDocumentRevision: target ? "document-before" : "document-after",
    ...(target
      ? {
          expectedTargetRevision: "target-before",
          acceptedTargetRevision: "target-after",
        }
      : {}),
    operations: [
      create(AIDocumentOperationSchema, {
        operation: {
          case: "deleteBlock",
          value: create(AIDocumentDeleteBlockOperationSchema, {
            blockHandle: "block-1",
          }),
        },
      }),
    ],
    actorMemberId: ACTOR_MEMBER_ID,
  });
}

function serverWithDocument(connections: number): {
  server: Server;
  document: HocuspocusDocument;
} {
  const document = new HocuspocusDocument(DOCUMENT_NAME);
  for (let index = 0; index < connections; index += 1)
    document.addDirectConnection();
  const server = {
    hocuspocus: {
      documents: new Map([[DOCUMENT_NAME, document]]),
      loadingDocuments: new Map(),
    },
  } as unknown as Server;
  return { document, server };
}

function invalidation(
  overrides: Partial<RoomInvalidation> = {},
): RoomInvalidation {
  return {
    invalidate: vi.fn(async () => true),
    invalidateEntity: vi.fn(async () => true),
    invalidateEntityExcept: vi.fn(async () => true),
    settleConnected: vi.fn(async () => undefined),
    clearPending: vi.fn(),
    ...overrides,
  };
}

describe("interactive mutation relay runtime wiring", () => {
  it("fails closed when an open resident room has no registered runtime", async () => {
    const { server } = serverWithDocument(1);
    registerRoomInvalidation(server, invalidation());

    await expect(
      createInteractiveMutationRelayReceiver(server).relay(request(true)),
    ).rejects.toThrow("interactive_mutation_resident_runtime_unavailable");
  });

  it.each([true, false])(
    "passes the accepted revision tuple to the resident runtime (target=%s)",
    async (target) => {
      const { server } = serverWithDocument(1);
      const applyAcceptedInteractiveMutation = vi.fn(
        async (
          _documentName: string,
          _document: HocuspocusDocument,
          input: { beforeApply(): void },
        ) => input.beforeApply(),
      );
      registerInteractiveMutationRuntime(server, {
        applyAcceptedInteractiveMutation,
      } as unknown as ResidentBlockRuntime);
      const roomInvalidation = invalidation();
      registerRoomInvalidation(server, roomInvalidation);
      const accepted = request(target);

      await createInteractiveMutationRelayReceiver(server).relay(accepted);

      const input = applyAcceptedInteractiveMutation.mock.calls[0]![2];
      expect(input).toMatchObject({
        expectedDocumentRevision: accepted.expectedDocumentRevision,
        acceptedDocumentRevision: accepted.acceptedDocumentRevision,
        operations: accepted.operations,
      });
      expect(input).toEqual(
        target
          ? expect.objectContaining({
              expectedTargetRevision: "target-before",
              acceptedTargetRevision: "target-after",
            })
          : expect.not.objectContaining({
              expectedTargetRevision: expect.anything(),
              acceptedTargetRevision: expect.anything(),
            }),
      );
      if (!target) {
        expect(roomInvalidation.invalidateEntityExcept).toHaveBeenCalledWith(
          CollaborativeDocumentType.POST,
          ENTITY_ID,
          DOCUMENT_NAME,
        );
      }
    },
  );

  it("fails a source relay when entity-room invalidation is unavailable", async () => {
    const { server } = serverWithDocument(1);
    registerInteractiveMutationRuntime(server, {
      applyAcceptedInteractiveMutation: vi.fn(),
    } as unknown as ResidentBlockRuntime);

    await expect(
      createInteractiveMutationRelayReceiver(server).relay(request(false)),
    ).rejects.toThrow("interactive_mutation_room_invalidator_unavailable");
  });

  it("routes zero-connection exact-room retirement through room invalidation", async () => {
    const { server } = serverWithDocument(0);
    const roomInvalidation = invalidation();
    registerRoomInvalidation(server, roomInvalidation);

    await createInteractiveMutationRelayReceiver(server).relay(request(true));

    expect(roomInvalidation.invalidate).toHaveBeenCalledWith(
      CollaborativeDocumentType.POST,
      ENTITY_ID,
      "ko",
    );
  });
});
