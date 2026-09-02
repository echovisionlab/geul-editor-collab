import { create } from "@bufbuild/protobuf";
import {
  CollaborativeDocumentType,
  createDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import {
  AIDocumentCreateTranslationOperationSchema,
  AIDocumentDeleteBlockOperationSchema,
  AIDocumentDeleteTranslationOperationSchema,
  AIDocumentDomain,
  AIDocumentLocaleSchema,
  AIDocumentOperationSchema,
  AIDocumentReferenceSchema,
} from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import {
  InteractiveAIDocumentMutationOrigin,
  RelayInteractiveAIDocumentMutationRequestSchema,
  type RelayInteractiveAIDocumentMutationRequest,
} from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { Document as HocuspocusDocument } from "@hocuspocus/server";
import { describe, expect, it, vi } from "vitest";
import {
  INTERACTIVE_MUTATION_BEGIN_KIND,
  INTERACTIVE_MUTATION_END_KIND,
  InteractiveMutationRelayReceiver,
  type InteractiveMutationRelayDependencies,
} from "./interactive-mutation-relay.ts";

const DOCUMENT_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const POST_KO_ROOM = createDocumentName(
  CollaborativeDocumentType.POST,
  DOCUMENT_ID,
  "ko",
);

function sourceRequest(
  domain = AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST,
): RelayInteractiveAIDocumentMutationRequest {
  return create(RelayInteractiveAIDocumentMutationRequestSchema, {
    mutationId: "mutation-1",
    origin:
      InteractiveAIDocumentMutationOrigin.INTERACTIVE_AI_DOCUMENT_MUTATION_ORIGIN_MCP,
    document: create(AIDocumentReferenceSchema, {
      domain,
      reference: DOCUMENT_ID,
    }),
    locale: create(AIDocumentLocaleSchema, { code: "ko" }),
    expectedDocumentRevision: "document-before",
    acceptedDocumentRevision: "document-after",
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

function targetRequest(): RelayInteractiveAIDocumentMutationRequest {
  const request = sourceRequest();
  request.acceptedDocumentRevision = request.expectedDocumentRevision;
  request.expectedTargetRevision = "tr1_before";
  request.acceptedTargetRevision = "tr1_after";
  return request;
}

function lifecycleRequest(
  operation: "createTranslation" | "deleteTranslation",
): RelayInteractiveAIDocumentMutationRequest {
  const request = targetRequest();
  if (operation === "createTranslation") {
    request.expectedTargetRevision = undefined;
    request.operations = [
      create(AIDocumentOperationSchema, {
        operation: {
          case: "createTranslation",
          value: create(AIDocumentCreateTranslationOperationSchema),
        },
      }),
    ];
  } else {
    request.acceptedTargetRevision = undefined;
    request.operations = [
      create(AIDocumentOperationSchema, {
        operation: {
          case: "deleteTranslation",
          value: create(AIDocumentDeleteTranslationOperationSchema),
        },
      }),
    ];
  }
  return request;
}

function residentDocument(documentName: string, connections: number) {
  const document = new HocuspocusDocument(documentName);
  for (let index = 0; index < connections; index += 1) {
    document.addDirectConnection();
  }
  return document;
}

function relayFixture(input?: {
  document?: HocuspocusDocument;
  documentName?: string;
  loading?: boolean;
  applyAcceptedRoom?: InteractiveMutationRelayDependencies["applyAcceptedRoom"];
  retireExactRoom?: InteractiveMutationRelayDependencies["retireExactRoom"];
  retireOtherEntityRooms?: InteractiveMutationRelayDependencies["retireOtherEntityRooms"];
}) {
  const documents = new Map<string, HocuspocusDocument>();
  const documentName = input?.documentName ?? POST_KO_ROOM;
  if (input?.document) documents.set(documentName, input.document);
  const loadingDocuments = new Map<string, unknown>();
  if (input?.loading) loadingDocuments.set(documentName, Promise.resolve());
  const applyAcceptedRoom = vi.fn(
    input?.applyAcceptedRoom ??
      (async ({ beforeApply }) => {
        beforeApply();
      }),
  );
  const retireExactRoom = vi.fn(input?.retireExactRoom ?? (async () => true));
  const retireOtherEntityRooms = vi.fn(
    input?.retireOtherEntityRooms ?? (async () => undefined),
  );
  return {
    applyAcceptedRoom,
    receiver: new InteractiveMutationRelayReceiver({
      rooms: { documents, loadingDocuments },
      applyAcceptedRoom,
      retireExactRoom,
      retireOtherEntityRooms,
    }),
    retireExactRoom,
    retireOtherEntityRooms,
  };
}

describe("interactive mutation relay room dispatch", () => {
  it("does nothing when both resident and loading registries are genuinely absent", async () => {
    const fixture = relayFixture();

    await expect(
      fixture.receiver.relay(targetRequest()),
    ).resolves.toBeUndefined();

    expect(fixture.applyAcceptedRoom).not.toHaveBeenCalled();
    expect(fixture.retireExactRoom).not.toHaveBeenCalled();
    expect(fixture.retireOtherEntityRooms).not.toHaveBeenCalled();
  });

  it("does not invent a room for the unspecified domain", async () => {
    const fixture = relayFixture();
    const request = sourceRequest(
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_UNSPECIFIED,
    );
    request.document!.reference = "not-a-room-uuid";

    await expect(fixture.receiver.relay(request)).resolves.toBeUndefined();

    expect(fixture.applyAcceptedRoom).not.toHaveBeenCalled();
    expect(fixture.retireExactRoom).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid UUID", "not-a-uuid", "ko"],
    ["noncanonical locale", DOCUMENT_ID, "KO"],
  ])("rejects a supported room with %s", async (_name, reference, locale) => {
    const fixture = relayFixture();
    const request = targetRequest();
    request.document!.reference = reference;
    request.locale!.code = locale;

    await expect(fixture.receiver.relay(request)).rejects.toThrow();
    expect(fixture.applyAcceptedRoom).not.toHaveBeenCalled();
    expect(fixture.retireExactRoom).not.toHaveBeenCalled();
  });

  it("retires a loading exact room before returning success", async () => {
    const fixture = relayFixture({ loading: true });

    await expect(
      fixture.receiver.relay(targetRequest()),
    ).resolves.toBeUndefined();

    expect(fixture.applyAcceptedRoom).not.toHaveBeenCalled();
    expect(fixture.retireExactRoom).toHaveBeenCalledOnce();
    expect(fixture.retireExactRoom).toHaveBeenCalledWith({
      documentName: POST_KO_ROOM,
      documentType: CollaborativeDocumentType.POST,
      entityId: DOCUMENT_ID,
      locale: "ko",
    });
  });

  it("retires a zero-connection resident before returning success", async () => {
    const fixture = relayFixture({
      document: residentDocument(POST_KO_ROOM, 0),
    });

    await expect(
      fixture.receiver.relay(targetRequest()),
    ).resolves.toBeUndefined();

    expect(fixture.applyAcceptedRoom).not.toHaveBeenCalled();
    expect(fixture.retireExactRoom).toHaveBeenCalledOnce();
  });

  it("retires without applying when the queued room loses its last connection before the atomic boundary", async () => {
    const document = residentDocument(POST_KO_ROOM, 1);
    const sendStateless = vi.fn();
    vi.spyOn(document, "getConnections").mockReturnValue([
      {
        context: { member: { id: ACTOR_MEMBER_ID }, canEdit: true },
        readOnly: false,
        sendStateless,
      },
    ] as never);
    const connectionCount = vi
      .spyOn(document, "getConnectionsCount")
      .mockReturnValueOnce(1)
      .mockReturnValue(0);
    const applyAcceptedRoom = vi.fn(async ({ beforeApply }) => {
      beforeApply();
    });
    const fixture = relayFixture({ document, applyAcceptedRoom });

    await expect(
      fixture.receiver.relay(targetRequest()),
    ).resolves.toBeUndefined();

    expect(connectionCount).toHaveBeenCalledTimes(2);
    expect(applyAcceptedRoom).toHaveBeenCalledOnce();
    expect(sendStateless).not.toHaveBeenCalled();
    expect(document.isEmpty("document-store")).toBe(true);
    expect(fixture.retireExactRoom).toHaveBeenCalledOnce();
  });

  it.each([
    ["returns false", async () => false],
    ["rejects", async () => Promise.reject(new Error("retire failed"))],
  ])("fails when required exact-room retirement %s", async (_name, retire) => {
    const fixture = relayFixture({
      loading: true,
      retireExactRoom: retire,
    });

    await expect(fixture.receiver.relay(targetRequest())).rejects.toThrow();
    expect(fixture.applyAcceptedRoom).not.toHaveBeenCalled();
  });

  it("applies once to the exact open target room with a bounded stable local origin", async () => {
    const document = residentDocument(POST_KO_ROOM, 1);
    const fixture = relayFixture({ document });
    const request = targetRequest();

    await expect(fixture.receiver.relay(request)).resolves.toBeUndefined();

    expect(fixture.retireExactRoom).not.toHaveBeenCalled();
    expect(fixture.retireOtherEntityRooms).not.toHaveBeenCalled();
    expect(fixture.applyAcceptedRoom).toHaveBeenCalledOnce();
    const applied = fixture.applyAcceptedRoom.mock.calls[0]![0];
    expect(applied).toMatchObject({
      document,
      request,
      identity: {
        documentName: POST_KO_ROOM,
        documentType: CollaborativeDocumentType.POST,
        entityId: DOCUMENT_ID,
        locale: "ko",
      },
      transactionOrigin: {
        source: "local",
        skipStoreHooks: true,
        context: {
          interactiveMutation: {
            mutationId: request.mutationId,
            origin: request.origin,
            actorMemberId: ACTOR_MEMBER_ID,
          },
        },
      },
    });
    expect(Object.isFrozen(applied.transactionOrigin)).toBe(true);
    expect(Object.isFrozen(applied.transactionOrigin.context)).toBe(true);
    expect(
      Object.isFrozen(applied.transactionOrigin.context.interactiveMutation),
    ).toBe(true);
    expect(applied.transactionOrigin).not.toHaveProperty("member");
  });

  it("dispatches Campaign through the resident Block Room runtime", async () => {
    const campaignRoom = createDocumentName(
      CollaborativeDocumentType.CAMPAIGN,
      DOCUMENT_ID,
      "ko",
    );
    const document = residentDocument(campaignRoom, 1);
    const fixture = relayFixture({ document, documentName: campaignRoom });
    const request = targetRequest();
    request.document!.domain = AIDocumentDomain.AI_DOCUMENT_DOMAIN_CAMPAIGN;

    await fixture.receiver.relay(request);

    expect(fixture.applyAcceptedRoom).toHaveBeenCalledWith(
      expect.objectContaining({
        document,
        identity: {
          documentName: campaignRoom,
          documentType: CollaborativeDocumentType.CAMPAIGN,
          entityId: DOCUMENT_ID,
          locale: "ko",
        },
      }),
    );
  });

  it("retires sibling locale rooms and applies an accepted source mutation to the exact open room", async () => {
    const fixture = relayFixture({
      document: residentDocument(POST_KO_ROOM, 1),
    });

    await expect(
      fixture.receiver.relay(sourceRequest()),
    ).resolves.toBeUndefined();

    expect(fixture.retireOtherEntityRooms).toHaveBeenCalledOnce();
    expect(fixture.retireOtherEntityRooms).toHaveBeenCalledWith({
      documentName: POST_KO_ROOM,
      documentType: CollaborativeDocumentType.POST,
      entityId: DOCUMENT_ID,
      locale: "ko",
    });
    expect(fixture.applyAcceptedRoom).toHaveBeenCalledOnce();
    expect(fixture.retireExactRoom).not.toHaveBeenCalled();
  });

  it("retires resident sibling locales even when the exact source room is absent", async () => {
    const fixture = relayFixture();

    await expect(
      fixture.receiver.relay(sourceRequest()),
    ).resolves.toBeUndefined();

    expect(fixture.retireOtherEntityRooms).toHaveBeenCalledOnce();
    expect(fixture.applyAcceptedRoom).not.toHaveBeenCalled();
    expect(fixture.retireExactRoom).not.toHaveBeenCalled();
  });

  it("returns sibling retirement failures so the API can issue the entity fallback fence", async () => {
    const siblingError = new Error("sibling retirement failed");
    const fixture = relayFixture({
      document: residentDocument(POST_KO_ROOM, 1),
      retireOtherEntityRooms: async () => Promise.reject(siblingError),
    });

    await expect(fixture.receiver.relay(sourceRequest())).rejects.toBe(
      siblingError,
    );

    expect(fixture.applyAcceptedRoom).not.toHaveBeenCalled();
    expect(fixture.retireExactRoom).not.toHaveBeenCalled();
  });

  it.each([
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_FORM,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_EMAIL_LAYOUT,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_MENU,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST_SERIES,
  ])(
    "retires the canonical room for structured Collaboration domain %s",
    async (domain) => {
      const fixture = relayFixture();

      await expect(
        fixture.receiver.relay(sourceRequest(domain)),
      ).resolves.toBeUndefined();

      expect(fixture.applyAcceptedRoom).not.toHaveBeenCalled();
      expect(fixture.retireOtherEntityRooms).toHaveBeenCalledOnce();
      expect(fixture.retireExactRoom).toHaveBeenCalledOnce();
    },
  );

  it("brackets the flushed update only for the same Member's editable sessions", async () => {
    const document = residentDocument(POST_KO_ROOM, 0);
    const actorEditable = {
      context: { member: { id: ACTOR_MEMBER_ID }, canEdit: true },
      readOnly: false,
      sendStateless: vi.fn(),
    };
    const actorReadOnly = {
      context: { member: { id: ACTOR_MEMBER_ID }, canEdit: false },
      readOnly: true,
      sendStateless: vi.fn(),
    };
    const otherEditable = {
      context: {
        member: { id: "33333333-3333-4333-8333-333333333333" },
        canEdit: true,
      },
      readOnly: false,
      sendStateless: vi.fn(),
    };
    vi.spyOn(document, "getConnections").mockReturnValue([
      actorEditable,
      actorReadOnly,
      otherEditable,
    ] as never);
    vi.spyOn(document, "getConnectionsCount").mockReturnValue(3);
    const flush = vi.spyOn(document, "flush");
    const applyAcceptedRoom = vi.fn(async ({ beforeApply }) => {
      beforeApply();
      expect(actorEditable.sendStateless).toHaveBeenCalledWith(
        JSON.stringify({
          kind: INTERACTIVE_MUTATION_BEGIN_KIND,
          mutationId: "mutation-1",
        }),
      );
      expect(flush).not.toHaveBeenCalled();
    });
    const fixture = relayFixture({ document, applyAcceptedRoom });

    await fixture.receiver.relay(targetRequest());

    expect(flush).toHaveBeenCalledOnce();
    expect(actorEditable.sendStateless).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({
        kind: INTERACTIVE_MUTATION_END_KIND,
        mutationId: "mutation-1",
        outcome: "accepted",
      }),
    );
    expect(actorReadOnly.sendStateless).not.toHaveBeenCalled();
    expect(otherEditable.sendStateless).not.toHaveBeenCalled();
  });

  it("fails closed when the runtime returns without entering the atomic apply boundary", async () => {
    const document = residentDocument(POST_KO_ROOM, 1);
    const fixture = relayFixture({
      document,
      applyAcceptedRoom: async () => undefined,
    });

    await expect(fixture.receiver.relay(targetRequest())).rejects.toThrow(
      "interactive_mutation_apply_boundary_not_entered",
    );

    expect(fixture.retireExactRoom).toHaveBeenCalledOnce();
  });

  it.each(["createTranslation", "deleteTranslation"] as const)(
    "retires an open room for the locale lifecycle operation %s",
    async (operation) => {
      const fixture = relayFixture({
        document: residentDocument(POST_KO_ROOM, 1),
      });

      await expect(
        fixture.receiver.relay(lifecycleRequest(operation)),
      ).resolves.toBeUndefined();

      expect(fixture.applyAcceptedRoom).not.toHaveBeenCalled();
      expect(fixture.retireExactRoom).toHaveBeenCalledOnce();
    },
  );

  it("retires and reports an open-room apply failure", async () => {
    const applyError = new Error("accepted apply failed");
    const fixture = relayFixture({
      document: residentDocument(POST_KO_ROOM, 1),
      applyAcceptedRoom: async () => Promise.reject(applyError),
    });

    await expect(fixture.receiver.relay(targetRequest())).rejects.toBe(
      applyError,
    );
    expect(fixture.retireExactRoom).toHaveBeenCalledOnce();
  });

  it("reports both failures when apply and required retirement fail", async () => {
    const applyError = new Error("accepted apply failed");
    const retireError = new Error("retire failed");
    const fixture = relayFixture({
      document: residentDocument(POST_KO_ROOM, 1),
      applyAcceptedRoom: async () => Promise.reject(applyError),
      retireExactRoom: async () => Promise.reject(retireError),
    });

    await expect(fixture.receiver.relay(targetRequest())).rejects.toMatchObject(
      {
        errors: [applyError, retireError],
      },
    );
  });

  it.each(["document", "locale"] as const)(
    "rejects an unvalidated request with missing %s",
    async (field) => {
      const fixture = relayFixture();
      const request = targetRequest();
      request[field] = undefined;

      await expect(fixture.receiver.relay(request)).rejects.toThrow(
        "interactive_mutation_relay_not_validated",
      );
      expect(fixture.applyAcceptedRoom).not.toHaveBeenCalled();
    },
  );

  it("does not classify a multi-operation target mutation as a locale lifecycle", async () => {
    const document = residentDocument(POST_KO_ROOM, 1);
    const fixture = relayFixture({ document });
    const request = targetRequest();
    request.operations.push(request.operations[0]!);

    await fixture.receiver.relay(request);

    expect(fixture.applyAcceptedRoom).toHaveBeenCalledOnce();
    expect(fixture.retireExactRoom).not.toHaveBeenCalled();
  });

  it("fails and retires when the persistence queue reenters the apply boundary", async () => {
    const document = residentDocument(POST_KO_ROOM, 1);
    const fixture = relayFixture({
      document,
      applyAcceptedRoom: async ({ beforeApply }) => {
        beforeApply();
        beforeApply();
      },
    });

    await expect(fixture.receiver.relay(targetRequest())).rejects.toThrow(
      "interactive_mutation_apply_boundary_reentered",
    );
    expect(fixture.retireExactRoom).toHaveBeenCalledOnce();
  });

  it("reports both apply and aborted-marker failures before fencing the room", async () => {
    const document = residentDocument(POST_KO_ROOM, 0);
    const markerError = new Error("marker failed");
    const sendStateless = vi
      .fn()
      .mockImplementationOnce(() => undefined)
      .mockImplementation(() => {
        throw markerError;
      });
    vi.spyOn(document, "getConnections").mockReturnValue([
      {
        context: { member: { id: ACTOR_MEMBER_ID }, canEdit: true },
        readOnly: false,
        sendStateless,
      },
    ] as never);
    vi.spyOn(document, "getConnectionsCount").mockReturnValue(1);
    const applyError = new Error("apply failed");
    const fixture = relayFixture({
      document,
      applyAcceptedRoom: async ({ beforeApply }) => {
        beforeApply();
        throw applyError;
      },
    });

    await expect(fixture.receiver.relay(targetRequest())).rejects.toMatchObject(
      {
        errors: [applyError, markerError],
      },
    );
    expect(fixture.retireExactRoom).toHaveBeenCalledOnce();
  });
});
