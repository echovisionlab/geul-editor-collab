import {
  CollaborativeDocumentType,
  createDocumentName,
  type DocumentSaveOptions,
} from "@echovisionlab/geul-common/collaboration/document";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditSessionContributorTracker,
  type EditSessionDocumentLike,
} from "./edit-session-contributors.ts";
import { EditSessionDocumentRegistry } from "./edit-session-documents.ts";
import { CollaborationConflictError } from "../api/transport.ts";

interface FakeDocument extends EditSessionDocumentLike {
  connections: Array<{ context?: { member?: { id?: string } } }>;
}

function fakeDocument(...memberIds: string[]): FakeDocument {
  return {
    connections: memberIds.map((id) => ({ context: { member: { id } } })),
    getConnections() {
      return this.connections;
    },
  };
}

function acceptedChange(documentName: string, memberId: string) {
  return {
    documentName,
    context: { member: { id: memberId } },
    connection: {},
    transactionOrigin: { source: "connection" },
  };
}

describe("source-only edit session contributors", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(
    options: {
      isEntityDeleted?: (entityDocumentName: string, error: unknown) => boolean;
      onCheckpointConflict?: (
        entityDocumentName: string,
        error: unknown,
      ) => void | Promise<void>;
      onEntityDeleted?: (entityDocumentName: string) => void | Promise<void>;
      onEntitySettled?: (entityDocumentName: string) => void;
    } = {},
  ) {
    const name = createDocumentName(
      CollaborativeDocumentType.POST,
      "11111111-1111-4111-8111-111111111111",
      "en",
    );
    const source = fakeDocument();
    const documents = new Map([[name, source]]);
    const persisted: Array<{
      documentName: string;
      contributorMemberIds: string[];
      versionCheckpoint: boolean;
    }> = [];
    const persistDocument = vi.fn(
      async (
        documentName: string,
        _document: FakeDocument,
        saveOptions: DocumentSaveOptions,
      ) => {
        persisted.push({
          documentName,
          contributorMemberIds: saveOptions.contributorMemberIds ?? [],
          versionCheckpoint: saveOptions.versionCheckpoint === true,
        });
      },
    );
    const unloadDocument = vi.fn(async () => undefined);
    const logFailure = vi.fn();
    const logTerminalCheckpointFailure = vi.fn();
    const tracker = new EditSessionContributorTracker<FakeDocument>({
      listDocuments: () => documents,
      loadDocument: async (documentName) => documents.get(documentName) ?? null,
      persistDocument,
      withPersistenceQueue: async (_key, operation) => {
        await operation((documentName, value, options) =>
          persistDocument(documentName, value, options),
        );
      },
      unloadDocument,
      supportsVersionCheckpoints: (type) =>
        type === CollaborativeDocumentType.POST,
      isEntityDeleted: options.isEntityDeleted,
      onCheckpointConflict: options.onCheckpointConflict,
      onEntityDeleted: options.onEntityDeleted,
      onEntitySettled: options.onEntitySettled,
      logFailure,
      logTerminalCheckpointFailure,
    });
    return {
      documents,
      logFailure,
      logTerminalCheckpointFailure,
      name,
      persisted,
      persistDocument,
      source,
      tracker,
      unloadDocument,
    };
  }

  it("tracks contributors only on the canonical source room", () => {
    const { name, tracker } = setup();
    expect(tracker.recordAcceptedChange(acceptedChange(name, "member-1"))).toBe(
      true,
    );
    expect(
      tracker.recordAcceptedChange(
        acceptedChange(`${name}:locale:ko`, "member-2"),
      ),
    ).toBe(false);
    expect(tracker.contributorMemberIds(name)).toEqual(["member-1"]);
  });

  it("passes source contributors through ordinary persistence", async () => {
    const { name, persistDocument, source, tracker } = setup();
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    await tracker.persist(name, source);
    expect(persistDocument).toHaveBeenCalledWith(
      name,
      source,
      { contributorMemberIds: ["member-1"] },
      name,
    );
  });

  it("finalizes the canonical source room with a checkpoint", async () => {
    const { name, persistDocument, source, tracker } = setup();
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(persistDocument).toHaveBeenCalledWith(
      name,
      source,
      expect.objectContaining({
        contributorMemberIds: ["member-1"],
        versionCheckpoint: true,
      }),
    );
  });

  it("schedules a metadata-only source checkpoint for the authenticated contributor", async () => {
    const { name, persistDocument, source, tracker } = setup();
    expect(tracker.recordAcceptedStatelessChange(name, "member-1")).toBe(true);
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(persistDocument).toHaveBeenCalledWith(
      name,
      source,
      expect.objectContaining({
        contributorMemberIds: ["member-1"],
        versionCheckpoint: true,
      }),
    );
  });

  it("keeps the first 30-minute source checkpoint deadline across later edits", async () => {
    const { persisted, source, name, tracker } = setup();
    source.connections.push({ context: { member: { id: "member-1" } } });
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    await vi.advanceTimersByTimeAsync(29 * 60 * 1_000);
    await tracker.flushPendingMutationBefore(name, source, "member-2");
    tracker.recordAcceptedChange(acceptedChange(name, "member-2"));
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(persisted).toEqual([
      {
        documentName: name,
        contributorMemberIds: ["member-1"],
        versionCheckpoint: false,
      },
    ]);
    await vi.advanceTimersByTimeAsync(1);
    expect(persisted).toEqual([
      {
        documentName: name,
        contributorMemberIds: ["member-1"],
        versionCheckpoint: false,
      },
      {
        documentName: name,
        contributorMemberIds: ["member-2"],
        versionCheckpoint: false,
      },
      {
        documentName: name,
        contributorMemberIds: ["member-1", "member-2"],
        versionCheckpoint: true,
      },
    ]);
  });

  it("cancels room-close grace on reconnect and restarts it after disconnect", async () => {
    const { persisted, source, name, tracker } = setup();
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(9_000);
    source.connections.push({ context: { member: { id: "observer" } } });
    tracker.connected(name, "observer");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(persisted).toEqual([]);

    source.connections = [];
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(persisted.at(-1)).toMatchObject({ versionCheckpoint: true });
  });

  it("preserves edits accepted while an ordinary source save is in flight", async () => {
    const { name, persistDocument, source, tracker } = setup();
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    let finishSave!: () => void;
    persistDocument.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );

    const saving = tracker.persist(name, source);
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    finishSave();
    await saving;

    expect(tracker.contributorMemberIds(name)).toEqual(["member-1"]);
    await tracker.persist(name, source);
    expect(persistDocument).toHaveBeenLastCalledWith(
      name,
      source,
      { contributorMemberIds: ["member-1"] },
      name,
    );
    expect(tracker.contributorMemberIds(name)).toEqual(["member-1"]);
  });

  it("fails an actor switch when the preceding actor changes during its flush", async () => {
    const { name, persistDocument, source, tracker } = setup();
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    let finishSave!: () => void;
    persistDocument.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );

    const switching = tracker.flushPendingMutationBefore(
      name,
      source,
      "member-2",
    );
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    finishSave();

    await expect(switching).rejects.toThrow(
      "collaboration_mutation_actor_flush_incomplete",
    );
    expect(() =>
      tracker.recordAcceptedChange(acceptedChange(name, "member-2")),
    ).toThrow("collaboration_mutation_actor_mixed");
  });

  it("retains the unload guard and contributor set across a transient retry", async () => {
    const { logFailure, name, persisted, persistDocument, tracker } = setup();
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    persistDocument.mockRejectedValueOnce(new Error("dependency unavailable"));
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(tracker.preventsUnload(name)).toBe(true);
    expect(tracker.contributorMemberIds(name)).toEqual(["member-1"]);
    expect(logFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "persist_failed", retry_attempt: 1 }),
    );

    await vi.advanceTimersByTimeAsync(10_000);
    expect(persisted.at(-1)).toMatchObject({ versionCheckpoint: true });
    expect(tracker.preventsUnload(name)).toBe(false);
  });

  it("starts a fresh checkpoint window when another actor edits after finalization", async () => {
    const { name, persisted, persistDocument, source, tracker } = setup();
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    let finishSave!: () => void;
    persistDocument.mockImplementationOnce(
      async (documentName, _document, saveOptions) => {
        persisted.push({
          documentName,
          contributorMemberIds: saveOptions.contributorMemberIds ?? [],
          versionCheckpoint: saveOptions.versionCheckpoint === true,
        });
        await new Promise<void>((resolve) => {
          finishSave = resolve;
        });
      },
    );
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(10_000);
    finishSave();
    await vi.advanceTimersByTimeAsync(0);

    await tracker.flushPendingMutationBefore(name, source, "member-2");
    tracker.recordAcceptedChange(acceptedChange(name, "member-2"));
    tracker.disconnected(name);

    expect(persisted).toEqual([
      {
        documentName: name,
        contributorMemberIds: ["member-1"],
        versionCheckpoint: false,
      },
      {
        documentName: name,
        contributorMemberIds: ["member-1"],
        versionCheckpoint: true,
      },
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(persisted.at(-1)).toMatchObject({
      contributorMemberIds: ["member-2"],
      versionCheckpoint: true,
    });
  });

  it("settles a typed checkpoint conflict without spending retry budget", async () => {
    const onCheckpointConflict = vi.fn();
    const {
      logFailure,
      logTerminalCheckpointFailure,
      name,
      persistDocument,
      tracker,
    } = setup({ onCheckpointConflict });
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    persistDocument.mockRejectedValueOnce(
      new CollaborationConflictError("target_revision_changed"),
    );
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(onCheckpointConflict).toHaveBeenCalledWith(
      name,
      expect.any(CollaborationConflictError),
    );
    expect(logTerminalCheckpointFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "target_revision_changed",
        retry_count: 1,
      }),
    );
    expect(logFailure).not.toHaveBeenCalled();
    expect(tracker.preventsUnload(name)).toBe(false);
  });

  it("discards a deleted source session and rejects later contributor tracking", async () => {
    const onEntityDeleted = vi.fn();
    const { name, source, tracker, unloadDocument } = setup({
      onEntityDeleted,
    });
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    await tracker.resourceDeleted(name);

    expect(onEntityDeleted).toHaveBeenCalledWith(name);
    expect(unloadDocument).toHaveBeenCalledWith(source);
    expect(tracker.preventsUnload(name)).toBe(false);
    expect(tracker.recordAcceptedChange(acceptedChange(name, "member-2"))).toBe(
      false,
    );
  });

  it("drains a pending canonical source checkpoint during shutdown", async () => {
    const { name, persisted, tracker } = setup();
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    await tracker.drainForShutdown();

    expect(persisted.at(-1)).toEqual({
      documentName: name,
      contributorMemberIds: ["member-1"],
      versionCheckpoint: true,
    });
    expect(tracker.preventsUnload(name)).toBe(true);
    tracker.release();
    expect(tracker.preventsUnload(name)).toBe(false);
  });

  it("registry rejects a legacy locale-suffixed room name", async () => {
    const { documents, name, source } = setup();
    const otherName = createDocumentName(
      CollaborativeDocumentType.POST,
      "22222222-2222-4222-8222-222222222222",
      "ko",
    );
    const orderedDocuments = new Map<string, FakeDocument>([
      [otherName, fakeDocument()],
      ...documents,
    ]);
    const loadDocument = vi.fn(async () => source);
    const registry = new EditSessionDocumentRegistry<FakeDocument>({
      listDocuments: () => orderedDocuments,
      loadDocument,
      supportsVersionCheckpoints: () => true,
    });
    expect(registry.scope(`${name}:locale:ko`)).toBeUndefined();
    expect(registry.checkpointDocuments(name)).toEqual([
      { documentName: name, document: source },
    ]);
    await expect(registry.sourceDocument(name)).resolves.toEqual({
      documentName: name,
      document: source,
    });
    expect(loadDocument).not.toHaveBeenCalled();
  });

  it("rejects malformed, unauthenticated, server-origin, and blank stateless changes", () => {
    const { name, tracker } = setup();
    expect(tracker.recordAcceptedStatelessChange(name, "   ")).toBe(false);
    expect(tracker.recordAcceptedStatelessChange("malformed", "member")).toBe(
      false,
    );
    expect(
      tracker.recordAcceptedChange({
        ...acceptedChange(name, "member"),
        connection: undefined,
      }),
    ).toBe(false);
    expect(
      tracker.recordAcceptedChange({
        ...acceptedChange(name, "member"),
        context: {},
      }),
    ).toBe(false);
    expect(
      tracker.recordAcceptedChange(acceptedChange(name, "  member  ")),
    ).toBe(true);
    expect(tracker.contributorMemberIds(name)).toEqual(["member"]);
    expect(tracker.contributorMemberIds("malformed")).toEqual([]);
  });

  it("fails closed when deletion begins between acceptance and contributor recording", () => {
    const { name, tracker } = setup();
    vi.spyOn(
      tracker as unknown as { isDeletedEntity(name: string): boolean },
      "isDeletedEntity",
    )
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    expect(tracker.recordAcceptedChange(acceptedChange(name, "member"))).toBe(
      false,
    );
    expect(tracker.contributorMemberIds(name)).toEqual([]);
  });

  it("rejects invalid and mixed actor flush boundaries", async () => {
    const { name, source, tracker } = setup();
    await expect(
      tracker.flushPendingMutationBefore(name, source, undefined),
    ).rejects.toThrow("collaboration_mutation_actor_required");
    await expect(
      tracker.flushPendingMutationBefore("malformed", source, "member"),
    ).rejects.toThrow("collaboration_mutation_actor_required");
    const internals = tracker as unknown as {
      pendingContributors: Map<string, Map<string, number>>;
    };
    internals.pendingContributors.set(
      name,
      new Map([
        ["member-1", 1],
        ["member-2", 2],
      ]),
    );
    await expect(
      tracker.flushPendingMutationBefore(name, source, "member-3"),
    ).rejects.toThrow("collaboration_mutation_actor_mixed");
  });

  it("retries when another contributor arrives during checkpoint persistence", async () => {
    const { name, persistDocument, source, tracker } = setup();
    let finishSave!: () => void;
    persistDocument.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(10_000);

    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    finishSave();
    await vi.advanceTimersByTimeAsync(0);

    expect(tracker.contributorMemberIds(name)).toEqual(["member-1"]);
    expect(persistDocument).not.toHaveBeenCalledWith(
      name,
      source,
      expect.objectContaining({ versionCheckpoint: true }),
    );
  });

  it("ignores malformed lifecycle calls and waits while an editor remains connected", async () => {
    const { name, persistDocument, source, tracker } = setup();
    tracker.connected("malformed", undefined);
    tracker.disconnected("malformed");
    tracker.connected(name, undefined);
    tracker.disconnected(name);
    tracker.recordAcceptedChange(acceptedChange(name, "member"));
    source.connections.push({ context: { member: { id: "observer" } } });
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(persistDocument).not.toHaveBeenCalled();
    source.connections = [];
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(persistDocument).toHaveBeenCalled();
  });

  it("loads a canonical source when it is not resident and returns undefined when absent", async () => {
    const source = fakeDocument();
    const loadDocument = vi
      .fn()
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(null);
    const registry = new EditSessionDocumentRegistry<FakeDocument>({
      listDocuments: () => [],
      loadDocument,
      supportsVersionCheckpoints: () => true,
    });
    await expect(registry.sourceDocument("post:post-1")).resolves.toEqual({
      documentName: "post:post-1",
      document: source,
    });
    await expect(
      registry.sourceDocument("post:post-1"),
    ).resolves.toBeUndefined();
  });

  it("contains deletion notification and unload failures and deduplicates cleanup", async () => {
    const deleted = new Error("deleted");
    let finishCleanup!: () => void;
    const cleanup = new Promise<void>((resolve) => {
      finishCleanup = resolve;
    });
    const onEntityDeleted = vi.fn(async () => {
      await cleanup;
      throw new Error("close failed");
    });
    const {
      logFailure,
      name,
      persistDocument,
      source,
      tracker,
      unloadDocument,
    } = setup({
      isEntityDeleted: (_name, error) => error === deleted,
      onEntityDeleted,
    });
    unloadDocument.mockRejectedValue(new Error("unload failed"));
    persistDocument.mockRejectedValue(deleted);
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    const deletionInternals = tracker as unknown as {
      pendingContributors: Map<string, Map<string, number>>;
    };
    deletionInternals.pendingContributors.set(
      "post:other",
      new Map([["other", 1]]),
    );
    const first = tracker.persist(name, source);
    const second = tracker.persist(name, source);
    await vi.waitFor(() => expect(onEntityDeleted).toHaveBeenCalledOnce());
    finishCleanup();
    await expect(first).rejects.toMatchObject({
      name: "EditSessionEntityDeletedError",
    });
    await expect(second).rejects.toMatchObject({
      name: "EditSessionEntityDeletedError",
    });
    expect(logFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "connection_close_failed" }),
    );
    expect(logFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "unload_failed" }),
    );
    await expect(tracker.resourceDeleted(name)).resolves.toBeUndefined();
    expect(tracker.recordAcceptedStatelessChange(name, "member-2")).toBe(false);
    await tracker.drainForShutdown();
  });

  it("discards a restored source session without flushing stale edits or reporting deletion", async () => {
    const onEntityDeleted = vi.fn();
    const { name, persistDocument, source, tracker, unloadDocument } = setup({
      onEntityDeleted,
    });
    tracker.recordAcceptedChange(acceptedChange(name, "member-before-restore"));

    await tracker.resourceInvalidated(name);
    await vi.runAllTimersAsync();

    expect(persistDocument).not.toHaveBeenCalled();
    expect(onEntityDeleted).not.toHaveBeenCalled();
    expect(unloadDocument).toHaveBeenCalledWith(source);
    expect(tracker.contributorMemberIds(name)).toEqual([]);
  });

  it("rejects later persistence after terminal source deletion", async () => {
    const deleted = new Error("deleted");
    const { name, persistDocument, source, tracker } = setup({
      isEntityDeleted: (_name, error) => error === deleted,
    });
    persistDocument.mockRejectedValueOnce(deleted);
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    await expect(tracker.persist(name, source)).rejects.toMatchObject({
      name: "EditSessionEntityDeletedError",
    });
    await expect(tracker.persist(name, source)).rejects.toMatchObject({
      name: "EditSessionEntityDeletedError",
    });
    expect(persistDocument).toHaveBeenCalledOnce();
    tracker.documentUnloaded("malformed");
    tracker.documentUnloaded(name);
  });

  it("exhausts bounded transient retries, contains unload failure, and starts a fresh session", async () => {
    const onEntitySettled = vi.fn();
    const {
      logFailure,
      logTerminalCheckpointFailure,
      name,
      persistDocument,
      source,
      tracker,
      unloadDocument,
    } = setup({ onEntitySettled });
    persistDocument.mockRejectedValue(new Error("unavailable"));
    unloadDocument.mockRejectedValue(new Error("unload failed"));
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(logTerminalCheckpointFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "persist_failed",
        retry_count: 4,
      }),
    );
    expect(logFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "unload_failed" }),
    );
    expect(onEntitySettled).toHaveBeenCalledWith(name);
    expect(tracker.preventsUnload(name)).toBe(false);
    tracker.connected(name, "observer");
    tracker.disconnected(name);
    persistDocument.mockResolvedValue(undefined);
    tracker.recordAcceptedChange(acceptedChange(name, "member-2"));
    source.connections = [];
    tracker.disconnected(name);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(persistDocument).toHaveBeenCalled();
  });

  it("fails shutdown when the persistence queue does not execute finalization", async () => {
    const { name, tracker } = setup();
    tracker.recordAcceptedChange(acceptedChange(name, "member"));
    const internals = tracker as unknown as {
      options: { withPersistenceQueue: ReturnType<typeof vi.fn> };
    };
    internals.options.withPersistenceQueue = vi
      .fn()
      .mockResolvedValue(undefined);
    await expect(tracker.drainForShutdown()).rejects.toThrow(
      "edit_session_shutdown_drain_exhausted",
    );
  });

  it("flushes an actor switch while retaining cumulative checkpoint contributors", async () => {
    const { name, source, tracker, persistDocument } = setup();
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    tracker.disconnected(name);
    await tracker.flushPendingMutationBefore(name, source, "member-2");
    tracker.recordAcceptedChange(acceptedChange(name, "member-2"));
    expect(persistDocument).toHaveBeenLastCalledWith(
      name,
      source,
      { contributorMemberIds: ["member-1"] },
      name,
    );
    expect(tracker.contributorMemberIds(name)).toEqual([
      "member-1",
      "member-2",
    ]);
  });

  it("settles a non-versioned canonical document after its pending save clears", async () => {
    const onEntitySettled = vi.fn();
    const { documents, tracker } = setup({ onEntitySettled });
    const artist = fakeDocument();
    documents.set("artist:artist-1", artist);
    tracker.recordAcceptedChange(acceptedChange("artist:artist-1", "member-1"));
    await tracker.persist("artist:artist-1", artist);
    expect(onEntitySettled).not.toHaveBeenCalled();
    tracker.documentUnloaded("artist:artist-1");
  });

  it("keeps a canonical pending contributor from settling before its session", () => {
    const { name, tracker } = setup();
    tracker.recordAcceptedChange(acceptedChange(name, "member-1"));
    const internals = tracker as unknown as {
      sessions: Map<string, unknown>;
      pendingContributors: Map<string, Map<string, number>>;
      notifyEntitySettled(documentName: string): void;
    };
    internals.sessions.delete(name);
    const currentPending = internals.pendingContributors.get(name)!;
    internals.pendingContributors.delete(name);
    internals.pendingContributors.set(
      "post:other",
      new Map([["other-member", 2]]),
    );
    internals.pendingContributors.set(name, currentPending);
    internals.notifyEntitySettled(name);
  });

  it("skips unattributed persistence without opening an actor batch", async () => {
    const { persistDocument, tracker } = setup();
    const document = fakeDocument();
    await tracker.persist("malformed", document);
    expect(persistDocument).not.toHaveBeenCalled();
  });

  it("keeps an active-window timer when a connection notification repeats", () => {
    const { name, tracker } = setup();
    tracker.recordAcceptedChange(acceptedChange(name, "member"));
    tracker.connected(name, "member");
  });

  it("retries an immediate shutdown finalization failure within the same budget", async () => {
    const { name, persistDocument, tracker } = setup();
    persistDocument.mockRejectedValueOnce(new Error("first unavailable"));
    tracker.recordAcceptedChange(acceptedChange(name, "member"));
    await expect(tracker.drainForShutdown()).resolves.toBeUndefined();
    expect(persistDocument).toHaveBeenCalledTimes(3);
  });

  it("accepts a shutdown checkpoint that succeeds on the final allowed pass", async () => {
    const { name, persistDocument, tracker } = setup();
    persistDocument
      .mockRejectedValueOnce(new Error("first unavailable"))
      .mockRejectedValueOnce(new Error("second unavailable"))
      .mockRejectedValueOnce(new Error("third unavailable"));
    tracker.recordAcceptedChange(acceptedChange(name, "member"));

    await expect(tracker.drainForShutdown()).resolves.toBeUndefined();

    expect(persistDocument).toHaveBeenCalledTimes(5);
  });
});
