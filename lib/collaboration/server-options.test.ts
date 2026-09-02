import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import {
  DEFAULT_METADATA_AI_SHARED_STATE,
  METADATA_AI_MAP_NAME,
} from "@echovisionlab/geul-common/collaboration/metadata-ai";
import type { EditSessionDocumentLike } from "./edit-session-contributors.ts";
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

const mocks = vi.hoisted(() => ({
  trackerOptions: undefined as Record<string, unknown> | undefined,
  trackerInstance: undefined as
    | {
        resourceDeleted(entityDocumentName: string): Promise<void>;
        resourceInvalidated(entityDocumentName: string): Promise<void>;
        recordAcceptedStatelessChange(
          documentName: string,
          authenticatedMemberId: string,
        ): boolean;
      }
    | undefined,
  roomOwnershipLost: undefined as
    ((documentNames: string[]) => void) | undefined,
  blockRoomDependencies: undefined as
    | {
        isDocumentFenced(documentName: string): boolean;
        fenceDocument(
          error: unknown,
          documentName: string,
          document: Y.Doc,
        ): void;
        deleteEntity(entityDocumentName: string): Promise<void>;
        recordAcceptedMetadataChange(
          documentName: string,
          authenticatedMemberId: string,
        ): void;
      }
    | undefined,
  loadCollaborativeDocument: vi.fn(),
  persistCollaborativeDocument: vi.fn(),
  withCollaborativeDocumentPersistenceQueue: vi.fn(),
  loggerError: vi.fn(),
  serverConfiguration: undefined as
    Record<string, (...args: never[]) => unknown> | undefined,
}));

vi.mock("@hocuspocus/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@hocuspocus/server")>();
  class FakeServer {
    readonly requestHandler = vi.fn();
    readonly httpServer = { removeListener: vi.fn(), on: vi.fn() };
    readonly hocuspocus = {
      documents: new Map(),
      loadingDocuments: new Map(),
      handleConnection: vi.fn(),
      unloadDocument: vi.fn(),
    };

    constructor(configuration: Record<string, (...args: never[]) => unknown>) {
      mocks.serverConfiguration = configuration;
    }
  }
  return { ...original, Server: FakeServer };
});

vi.mock("./edit-session-contributors.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./edit-session-contributors.ts")>();
  class CapturingTracker extends original.EditSessionContributorTracker<EditSessionDocumentLike> {
    constructor(
      options: ConstructorParameters<
        typeof original.EditSessionContributorTracker
      >[0],
    ) {
      super(options as never);
      mocks.trackerOptions = options as unknown as Record<string, unknown>;
      mocks.trackerInstance = this;
    }
  }
  return { ...original, EditSessionContributorTracker: CapturingTracker };
});

vi.mock("./room-ownership.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("./room-ownership.ts")>();
  class CapturingRoomOwnership extends original.PostgresRoomOwnership {
    private readonly testOwned = new Set<string>();

    constructor(
      onLost: (documentNames: readonly string[], error: Error) => void,
    ) {
      super(onLost);
      mocks.roomOwnershipLost = (documentNames) => {
        for (const documentName of documentNames)
          this.testOwned.delete(documentName);
        onLost(documentNames, new Error("lock lost"));
      };
    }

    override async acquire(documentName: string): Promise<void> {
      this.testOwned.add(documentName);
    }

    override isOwned(documentName: string): boolean {
      return this.testOwned.has(documentName);
    }

    override async release(documentName: string): Promise<void> {
      this.testOwned.delete(documentName);
    }

    override async close(): Promise<void> {
      this.testOwned.clear();
    }
  }
  return { ...original, PostgresRoomOwnership: CapturingRoomOwnership };
});

vi.mock("./block-room-protocol.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./block-room-protocol.ts")>();
  class CapturingBlockRoomProtocol extends original.BlockRoomProtocol {
    constructor(
      options: ConstructorParameters<typeof original.BlockRoomProtocol>[0],
    ) {
      super(options);
      mocks.blockRoomDependencies = options;
    }
  }
  return { ...original, BlockRoomProtocol: CapturingBlockRoomProtocol };
});

vi.mock("./document-persistence.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./document-persistence.ts")>();
  return {
    ...original,
    loadCollaborativeDocument: mocks.loadCollaborativeDocument,
    persistCollaborativeDocument: mocks.persistCollaborativeDocument,
    withCollaborativeDocumentPersistenceQueue:
      mocks.withCollaborativeDocumentPersistenceQueue,
  };
});

vi.mock("../logger.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../logger.ts")>();
  return {
    ...original,
    logger: { ...original.logger, error: mocks.loggerError },
  };
});

import {
  createCollabServer,
  invalidateCanonicalEntityRooms,
  invalidateCanonicalRoom,
} from "./server.ts";
import { createInteractiveMutationRelayReceiver } from "./interactive-mutation-server.ts";
import { CollaborationConflictError } from "../api/transport.ts";
import { MetadataAiReconnectGrace } from "./metadata-ai-reconnect-grace.ts";

const SESSION_ID = "33333333-3333-4333-8333-333333333333";

describe("collaboration server tracker wiring", () => {
  it("loads non-resident checkpoint documents and reports finalization failures", async () => {
    const loaded = Object.assign(new Y.Doc(), {
      getConnections: () => [] as never[],
    });
    mocks.loadCollaborativeDocument.mockResolvedValueOnce(loaded);
    const residentBlocks = {
      persistEditSession: vi.fn().mockResolvedValue("resident-persisted"),
      withPersistenceQueue: vi.fn().mockResolvedValue("resident-queued"),
    };
    mocks.persistCollaborativeDocument.mockResolvedValueOnce(
      "legacy-persisted",
    );
    mocks.withCollaborativeDocumentPersistenceQueue.mockResolvedValueOnce(
      "legacy-queued",
    );
    createCollabServer({ residentBlocks: residentBlocks as never });
    const options = mocks.trackerOptions as {
      loadDocument(documentName: string): Promise<typeof loaded>;
      persistDocument(
        documentName: string,
        document: typeof loaded,
        options: object,
        queueKey: string,
      ): Promise<unknown>;
      withPersistenceQueue(
        queueKey: string,
        operation: () => Promise<void>,
      ): Promise<unknown>;
      supportsVersionCheckpoints(type: number): boolean;
      logFailure(fields: Record<string, unknown>): void;
    };

    await expect(
      options.loadDocument(
        "map-theme:11111111-1111-4111-8111-111111111111:und",
      ),
    ).resolves.toBe(loaded);
    expect(mocks.loadCollaborativeDocument).toHaveBeenCalledWith(
      "map-theme:11111111-1111-4111-8111-111111111111:und",
    );
    await expect(
      options.persistDocument(
        "post:22222222-2222-4222-8222-222222222222:en",
        loaded,
        {},
        "post:22222222-2222-4222-8222-222222222222:en",
      ),
    ).resolves.toBe("resident-persisted");
    await expect(
      options.persistDocument(
        "map-theme:11111111-1111-4111-8111-111111111111:und",
        loaded,
        {},
        "map-theme:11111111-1111-4111-8111-111111111111:und",
      ),
    ).resolves.toBe("legacy-persisted");
    const operation = vi.fn();
    await expect(
      options.withPersistenceQueue(
        "post:22222222-2222-4222-8222-222222222222:en",
        operation,
      ),
    ).resolves.toBe("resident-queued");
    await expect(
      options.withPersistenceQueue(
        "map-theme:11111111-1111-4111-8111-111111111111:und",
        operation,
      ),
    ).resolves.toBe("legacy-queued");
    expect(
      options.supportsVersionCheckpoints(CollaborativeDocumentType.POST),
    ).toBe(true);
    expect(
      options.supportsVersionCheckpoints(CollaborativeDocumentType.MAP_THEME),
    ).toBe(false);
    expect(
      options.supportsVersionCheckpoints(CollaborativeDocumentType.FORM),
    ).toBe(false);
    expect(
      options.supportsVersionCheckpoints(
        CollaborativeDocumentType.EMAIL_LAYOUT,
      ),
    ).toBe(false);
    const failure = { reason: "persist_failed", retry_attempt: 1 };
    options.logFailure(failure);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "Collaboration edit session finalization failed",
      failure,
    );
  });

  it("fences rooms lost by this replica and delegates Block room conflict lifecycle", async () => {
    const server = createCollabServer();
    const documentName = "post:22222222-2222-4222-8222-222222222222:en";
    const sendStateless = vi.fn();
    const close = vi.fn();
    const document = Object.assign(new Y.Doc(), {
      getConnections: () => [{ sendStateless, close }],
    });
    server.hocuspocus.documents.set(documentName, document as never);

    mocks.roomOwnershipLost?.([
      documentName,
      "post:99999999-9999-4999-8999-999999999999:en",
    ]);

    const dependencies = mocks.blockRoomDependencies!;
    expect(dependencies.isDocumentFenced(documentName)).toBe(true);
    expect(sendStateless).toHaveBeenCalledWith(
      JSON.stringify({
        kind: "reload_required",
        reason: "reload_required",
      }),
    );
    expect(close).toHaveBeenCalledOnce();

    const conflictedName = "page:33333333-3333-4333-8333-333333333333:en";
    const conflictedDocument = Object.assign(new Y.Doc(), {
      getConnections: () => [] as never[],
    });
    dependencies.fenceDocument(
      new CollaborationConflictError("document_revision_changed"),
      conflictedName,
      conflictedDocument,
    );
    expect(dependencies.isDocumentFenced(conflictedName)).toBe(true);

    const resourceDeleted = vi
      .spyOn(mocks.trackerInstance!, "resourceDeleted")
      .mockResolvedValue(undefined);
    await dependencies.deleteEntity(documentName);
    expect(resourceDeleted).toHaveBeenCalledWith(documentName);
    const recordAcceptedStatelessChange = vi.spyOn(
      mocks.trackerInstance!,
      "recordAcceptedStatelessChange",
    );
    dependencies.recordAcceptedMetadataChange(documentName, "member-1");
    expect(recordAcceptedStatelessChange).toHaveBeenCalledWith(
      documentName,
      "member-1",
    );
  });

  it("fences a document that loses ownership while canonical load is still in flight", async () => {
    let finishLoad!: () => void;
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLoad = resolve;
        }),
    );
    const unload = vi.fn();
    createCollabServer({
      residentBlocks: { load, unload } as never,
    });
    const documentName = "post:44444444-4444-4444-8444-444444444444:en";
    const sendStateless = vi.fn();
    const close = vi.fn();
    const document = Object.assign(new Y.Doc(), {
      getConnections: () => [{ sendStateless, close }],
    });
    const onLoadDocument = mocks.serverConfiguration!.onLoadDocument!;
    const loading = onLoadDocument({
      documentName,
      document,
      context: { sessionId: SESSION_ID },
    } as never) as Promise<unknown>;
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
    expect(load).toHaveBeenCalledWith(
      documentName,
      document,
      expect.objectContaining({ sessionId: SESSION_ID }),
    );

    mocks.roomOwnershipLost?.([documentName]);
    finishLoad();

    await expect(loading).rejects.toThrow("room_ownership_lost");
    expect(sendStateless).toHaveBeenCalledWith(
      JSON.stringify({
        kind: "reload_required",
        reason: "reload_required",
      }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(unload).toHaveBeenCalledWith(documentName);
  });

  it("isolates a malformed lost room and still fences every later room", () => {
    const server = createCollabServer();
    const invalid = Object.assign(new Y.Doc(), {
      getConnections: () => [] as never[],
    });
    const throwingName = "post:77777777-7777-4777-8777-777777777777:en";
    const throwing = Object.assign(new Y.Doc(), {
      getConnections: () => {
        throw "connection enumeration failed";
      },
    });
    const validName = "post:55555555-5555-4555-8555-555555555555:en";
    const close = vi.fn();
    const valid = Object.assign(new Y.Doc(), {
      getConnections: () => [{ sendStateless: vi.fn(), close }],
    });
    server.hocuspocus.documents.set("invalid", invalid as never);
    server.hocuspocus.documents.set(throwingName, throwing as never);
    server.hocuspocus.documents.set(validName, valid as never);

    expect(() =>
      mocks.roomOwnershipLost?.(["invalid", throwingName, validName]),
    ).not.toThrow();

    expect(mocks.blockRoomDependencies!.isDocumentFenced(validName)).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it("blocks direct and queued edit-session writes after the room is fenced", async () => {
    const residentPersist = vi.fn().mockResolvedValue(undefined);
    const queuedPersist = vi.fn().mockResolvedValue(undefined);
    const residentBlocks = {
      persistEditSession: residentPersist,
      withPersistenceQueue: vi.fn(async (_key, operation) =>
        operation(queuedPersist),
      ),
    };
    createCollabServer({ residentBlocks: residentBlocks as never });
    const options = mocks.trackerOptions as {
      persistDocument(
        documentName: string,
        document: Y.Doc,
        options: object,
        queueKey: string,
      ): Promise<unknown>;
      withPersistenceQueue(
        queueKey: string,
        operation: (
          persist: (
            name: string,
            document: Y.Doc,
            options: object,
          ) => Promise<unknown>,
        ) => Promise<unknown>,
      ): Promise<unknown>;
    };
    const documentName = "post:66666666-6666-4666-8666-666666666666:en";
    const document = Object.assign(new Y.Doc(), {
      getConnections: () => [] as never[],
    });
    mocks.blockRoomDependencies!.fenceDocument(
      new CollaborationConflictError("document_revision_changed"),
      documentName,
      document,
    );

    await expect(
      options.persistDocument(documentName, document, {}, documentName),
    ).rejects.toThrow("room_ownership_lost");
    await expect(
      options.withPersistenceQueue(documentName, (persist) =>
        persist(documentName, document, {}),
      ),
    ).rejects.toThrow("room_ownership_lost");
    expect(residentPersist).not.toHaveBeenCalled();
    expect(queuedPersist).not.toHaveBeenCalled();
  });

  it("fences and discards only the canonical room after an authoritative source restore", async () => {
    const metadataAiGrace = new MetadataAiReconnectGrace();
    const server = createCollabServer({ metadataAiGrace });
    const sendStateless = vi.fn();
    const close = vi.fn();
    const documentName = "post:88888888-8888-4888-8888-888888888888:en";
    const source = Object.assign(new Y.Doc(), {
      getConnections: () => [{ sendStateless, close }],
    });
    const metadataAi = source.getMap(METADATA_AI_MAP_NAME);
    for (const [key, value] of Object.entries(
      DEFAULT_METADATA_AI_SHARED_STATE,
    )) {
      metadataAi.set(
        key,
        key === "requestedFields" ? JSON.stringify(value) : value,
      );
    }
    metadataAi.set("status", "generating");
    metadataAi.set("requesterMemberId", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    metadataAiGrace.loaded(source);
    expect(metadataAiGrace.preventsUnload(source)).toBe(true);
    const staleTargetName = `${documentName}:locale:ko`;
    const staleTarget = Object.assign(new Y.Doc(), {
      getConnections: () => [] as never[],
    });
    server.hocuspocus.documents.set(documentName, source as never);
    server.hocuspocus.documents.set(staleTargetName, staleTarget as never);
    const resourceInvalidated = vi.spyOn(
      mocks.trackerInstance!,
      "resourceInvalidated",
    );

    await expect(
      invalidateCanonicalRoom(
        server,
        CollaborativeDocumentType.POST,
        "88888888-8888-4888-8888-888888888888",
        "en",
      ),
    ).resolves.toBe(true);

    expect(sendStateless).toHaveBeenCalledWith(
      JSON.stringify({ kind: "reload_required", reason: "reload_required" }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(resourceInvalidated).toHaveBeenCalledWith(documentName);
    expect(server.hocuspocus.unloadDocument).toHaveBeenCalledWith(source);
    expect(server.hocuspocus.unloadDocument).not.toHaveBeenCalledWith(
      staleTarget,
    );
    expect(metadataAiGrace.preventsUnload(source)).toBe(false);
    expect(metadataAi.get("status")).toBe("idle");
  });

  it("leaves a non-resident restored source for the next canonical load", async () => {
    const server = createCollabServer();

    await expect(
      invalidateCanonicalRoom(
        server,
        CollaborativeDocumentType.WORK,
        "99999999-9999-4999-8999-999999999999",
        "en",
      ),
    ).resolves.toBe(false);
    await expect(
      invalidateCanonicalRoom(
        {} as never,
        CollaborativeDocumentType.WORK,
        "99999999-9999-4999-8999-999999999999",
        "en",
      ),
    ).resolves.toBe(false);
    await expect(
      invalidateCanonicalEntityRooms(
        {} as never,
        CollaborativeDocumentType.WORK,
        "99999999-9999-4999-8999-999999999999",
      ),
    ).resolves.toBe(false);
  });

  it("invalidates every resident locale room for an authoritative entity update", async () => {
    const server = createCollabServer();
    const entityId = "99999999-9999-4999-8999-999999999999";
    const sourceName = `post:${entityId}:en`;
    const targetName = `post:${entityId}:ko`;
    const unrelatedName = "post:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:en";
    const source = Object.assign(new Y.Doc(), {
      getConnections: () => [] as never[],
    });
    const target = Object.assign(new Y.Doc(), {
      getConnections: () => [] as never[],
    });
    const unrelated = Object.assign(new Y.Doc(), {
      getConnections: () => [] as never[],
    });
    server.hocuspocus.documents.set("invalid", new Y.Doc() as never);
    server.hocuspocus.documents.set(sourceName, source as never);
    server.hocuspocus.documents.set(targetName, target as never);
    server.hocuspocus.documents.set(`post:${entityId}:ja`, undefined as never);
    server.hocuspocus.documents.set(unrelatedName, unrelated as never);

    await expect(
      invalidateCanonicalEntityRooms(
        server,
        CollaborativeDocumentType.POST,
        entityId,
      ),
    ).resolves.toBe(true);

    expect(server.hocuspocus.unloadDocument).toHaveBeenCalledWith(source);
    expect(server.hocuspocus.unloadDocument).toHaveBeenCalledWith(target);
    expect(server.hocuspocus.unloadDocument).not.toHaveBeenCalledWith(
      unrelated,
    );
  });

  it("wires the interactive mutation receiver to the resident runtime", async () => {
    const entityId = "99999999-9999-4999-8999-999999999999";
    const documentName = `post:${entityId}:ko`;
    const applyAcceptedInteractiveMutation = vi.fn(
      async (
        _documentName: string,
        _document: Y.Doc,
        input: { beforeApply(): void },
      ) => {
        input.beforeApply();
      },
    );
    const server = createCollabServer({
      residentBlocks: {
        applyAcceptedInteractiveMutation,
      } as never,
    });
    const document = Object.assign(new Y.Doc(), {
      name: documentName,
      getConnections: () => [] as never[],
      getConnectionsCount: () => 1,
      flush: vi.fn(),
    });
    server.hocuspocus.documents.set(documentName, document as never);
    const request = create(RelayInteractiveAIDocumentMutationRequestSchema, {
      mutationId: "mutation-runtime-wiring",
      origin:
        InteractiveAIDocumentMutationOrigin.INTERACTIVE_AI_DOCUMENT_MUTATION_ORIGIN_MCP,
      document: create(AIDocumentReferenceSchema, {
        domain: AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST,
        reference: entityId,
      }),
      locale: create(AIDocumentLocaleSchema, { code: "ko" }),
      expectedDocumentRevision: "document-revision-1",
      acceptedDocumentRevision: "document-revision-1",
      expectedTargetRevision: "tr1_target_1",
      acceptedTargetRevision: "tr1_target_2",
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
      actorMemberId: "22222222-2222-4222-8222-222222222222",
    });

    await createInteractiveMutationRelayReceiver(server).relay(request);

    expect(applyAcceptedInteractiveMutation).toHaveBeenCalledOnce();
    expect(applyAcceptedInteractiveMutation).toHaveBeenCalledWith(
      documentName,
      document,
      expect.objectContaining({
        expectedDocumentRevision: "document-revision-1",
        acceptedDocumentRevision: "document-revision-1",
        expectedTargetRevision: "tr1_target_1",
        acceptedTargetRevision: "tr1_target_2",
        operations: request.operations,
        origin: expect.objectContaining({
          context: expect.objectContaining({
            interactiveMutation: expect.objectContaining({
              mutationId: request.mutationId,
            }),
          }),
        }),
      }),
    );
  });

  it("fences a canonical room that finishes loading after the restore signal", async () => {
    const server = createCollabServer();
    const documentName = "page:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:en";
    const sendStateless = vi.fn();
    const close = vi.fn();
    const connection = { sendStateless, close };
    const staleLoadedDocument = Object.assign(new Y.Doc(), {
      getConnections: () => [connection],
    });
    Object.assign(connection, { document: staleLoadedDocument });
    const loading = new Promise<typeof staleLoadedDocument>(() => undefined);
    server.hocuspocus.loadingDocuments.set(documentName, loading as never);

    await expect(
      invalidateCanonicalRoom(
        server,
        CollaborativeDocumentType.PAGE,
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "en",
      ),
    ).resolves.toBe(true);
    expect(server.hocuspocus.unloadDocument).not.toHaveBeenCalled();
    server.hocuspocus.loadingDocuments.delete(documentName);
    server.hocuspocus.documents.set(documentName, staleLoadedDocument as never);

    await mocks.serverConfiguration!.connected!({
      connection,
      context: {},
      documentName,
      socketId: "restored-load-socket",
    } as never);
    expect(sendStateless).toHaveBeenCalledWith(
      JSON.stringify({ kind: "reload_required", reason: "reload_required" }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(server.hocuspocus.unloadDocument).toHaveBeenCalledWith(
      staleLoadedDocument,
    );
  });

  it("clears a pending restore invalidation when the fenced load fails", async () => {
    let finishLoad!: () => void;
    const load = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishLoad = resolve;
        }),
    );
    const server = createCollabServer({
      residentBlocks: { load, unload: vi.fn() } as never,
    });
    const documentName = "work:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb:en";
    const loadingDocument = Object.assign(new Y.Doc(), {
      getConnections: () => [] as never[],
    });
    const loading = mocks.serverConfiguration!.onLoadDocument!({
      documentName,
      document: loadingDocument,
      context: { sessionId: SESSION_ID },
    } as never) as Promise<unknown>;
    server.hocuspocus.loadingDocuments.set(documentName, loading as never);
    await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());

    await expect(
      invalidateCanonicalRoom(
        server,
        CollaborativeDocumentType.WORK,
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "en",
      ),
    ).resolves.toBe(true);
    finishLoad();
    await expect(loading).rejects.toThrow("room_ownership_lost");
    server.hocuspocus.loadingDocuments.delete(documentName);

    const sendStateless = vi.fn();
    const close = vi.fn();
    const connection = { sendStateless, close, document: loadingDocument };
    mocks.blockRoomDependencies!.fenceDocument(
      new CollaborationConflictError("document_revision_changed"),
      documentName,
      loadingDocument,
    );
    await mocks.serverConfiguration!.connected!({
      connection,
      context: {},
      documentName,
      socketId: "failed-load-socket",
    } as never);

    expect(sendStateless).toHaveBeenCalledOnce();
    expect(server.hocuspocus.unloadDocument).not.toHaveBeenCalled();
  });
});
