import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { CollaborationConflictError } from "../api/transport.ts";
import {
  type EditSessionContributorTrackerOptions,
  type EditSessionDocumentLike,
  type EditSessionState,
} from "./edit-session-contributor-types.ts";
import { EditSessionDocumentRegistry } from "./edit-session-documents.ts";
import { EditSessionFinalizationCoordinator } from "./edit-session-finalization.ts";
import { EditSessionEntityDeletedError } from "./edit-session-contributor-types.ts";

const document: EditSessionDocumentLike = { getConnections: () => [] };

function options(
  logFailure: (fields: Record<string, unknown>) => void,
): EditSessionContributorTrackerOptions<EditSessionDocumentLike> {
  return {
    listDocuments: () => [],
    loadDocument: async () => null,
    persistDocument: async () => undefined,
    withPersistenceQueue: async (_key, operation) =>
      operation(async () => undefined),
    unloadDocument: async () => undefined,
    supportsVersionCheckpoints: (type) =>
      type === CollaborativeDocumentType.POST,
    logFailure,
    logTerminalCheckpointFailure: vi.fn(),
  };
}

function session(retryAttempts: number): EditSessionState {
  return {
    contributors: new Set(["member"]),
    nextContributors: new Set(),
    checkpointDueAt: 0,
    finalizing: false,
    generation: 0,
    retryAttempts,
  };
}

function coordinator(
  registry: EditSessionDocumentRegistry<EditSessionDocumentLike>,
  trackerOptions: EditSessionContributorTrackerOptions<EditSessionDocumentLike>,
  currentSession: EditSessionState,
  persistWith: () => Promise<unknown> = async () => undefined,
) {
  return new EditSessionFinalizationCoordinator({
    options: trackerOptions,
    documents: registry,
    sessions: new Map([["invalid", currentSession]]),
    pendingContributors: new Map(),
    cancelTimer: vi.fn(),
    notifyEntitySettled: vi.fn(),
    persistWith,
    isShuttingDown: () => false,
  });
}

class ConflictRegistry extends EditSessionDocumentRegistry<EditSessionDocumentLike> {
  override checkpointDocuments() {
    return [{ documentName: "invalid", document }];
  }

  override async sourceDocument() {
    return { documentName: "invalid", document };
  }

  override sourceDocumentIsCurrent(): boolean {
    return true;
  }
}

describe("EditSessionFinalizationCoordinator invalid internal scope fallback", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("logs an exhausted invalid internal entity through the generic diagnostic", async () => {
    const logFailure = vi.fn();
    const trackerOptions = options(logFailure);
    const registry = new EditSessionDocumentRegistry(trackerOptions);
    const currentSession = session(3);
    const finalization = coordinator(registry, trackerOptions, currentSession);

    finalization.schedule("invalid", currentSession, 0, "room-close");
    await vi.runAllTimersAsync();

    expect(logFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "source_document_unavailable",
        retry_attempt: 4,
        terminal: true,
      }),
    );
  });

  it("logs a typed conflict without canonical entity identity through the generic diagnostic", async () => {
    const logFailure = vi.fn();
    const trackerOptions = options(logFailure);
    const registry = new ConflictRegistry(trackerOptions);
    const currentSession = session(0);
    const finalization = coordinator(
      registry,
      trackerOptions,
      currentSession,
      async () => {
        throw new CollaborationConflictError("target_revision_changed");
      },
    );

    finalization.schedule("invalid", currentSession, 0, "room-close");
    await vi.runAllTimersAsync();

    expect(logFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "target_revision_changed",
        retry_attempt: 1,
        terminal: true,
      }),
    );
  });

  it("reschedules room-close finalization if an editor reconnects without a lifecycle callback", async () => {
    const name = "post:11111111-1111-4111-8111-111111111111:en";
    const connected: EditSessionDocumentLike = { getConnections: () => [{}] };
    const trackerOptions = {
      ...options(vi.fn()),
      listDocuments: () =>
        [[name, connected]] as Array<[string, EditSessionDocumentLike]>,
    };
    const registry = new EditSessionDocumentRegistry(trackerOptions);
    const currentSession = session(0);
    const finalization = new EditSessionFinalizationCoordinator({
      options: trackerOptions,
      documents: registry,
      sessions: new Map([[name, currentSession]]),
      pendingContributors: new Map(),
      cancelTimer: vi.fn(),
      notifyEntitySettled: vi.fn(),
      persistWith: async () => undefined,
      isShuttingDown: () => false,
    });
    finalization.schedule(name, currentSession, 0, "room-close");
    await vi.advanceTimersByTimeAsync(0);
    expect(currentSession.timerMode).toBe("active-window");
  });

  it.each([false, true])(
    "rolls next contributors into a %s-connected source checkpoint window",
    async (connected) => {
      const name = "post:11111111-1111-4111-8111-111111111111:en";
      const source: EditSessionDocumentLike = {
        getConnections: () => (connected ? [{}] : []),
      };
      const currentSession = session(0);
      let sourceCurrentChecks = 0;
      class NextContributorRegistry extends EditSessionDocumentRegistry<EditSessionDocumentLike> {
        override sourceDocumentIsCurrent(): boolean {
          sourceCurrentChecks += 1;
          currentSession.nextContributors.add("next-member");
          return true;
        }
      }
      const trackerOptions = {
        ...options(vi.fn()),
        listDocuments: () =>
          [[name, source]] as Array<[string, EditSessionDocumentLike]>,
      };
      const registry = new NextContributorRegistry(trackerOptions);
      const sessions = new Map([[name, currentSession]]);
      const finalization = new EditSessionFinalizationCoordinator({
        options: trackerOptions,
        documents: registry,
        sessions,
        pendingContributors: new Map(),
        cancelTimer: vi.fn(),
        notifyEntitySettled: vi.fn(),
        persistWith: async (persist, documentName, value, saveOptions) =>
          persist(documentName, value, saveOptions),
        isShuttingDown: () => false,
      });
      finalization.schedule(name, currentSession, 0, "active-window");
      await vi.advanceTimersByTimeAsync(0);
      expect(sourceCurrentChecks).toBe(1);
      expect([...currentSession.contributors]).toEqual(["next-member"]);
      expect(currentSession.timerMode).toBe(
        connected ? "active-window" : "room-close",
      );
    },
  );

  it("ignores entity-deleted finalization errors", async () => {
    const name = "post:11111111-1111-4111-8111-111111111111:en";
    const source: EditSessionDocumentLike = { getConnections: () => [] };
    const trackerOptions = {
      ...options(vi.fn()),
      listDocuments: () =>
        [[name, source]] as Array<[string, EditSessionDocumentLike]>,
    };
    const currentSession = session(0);
    const finalization = new EditSessionFinalizationCoordinator({
      options: trackerOptions,
      documents: new EditSessionDocumentRegistry(trackerOptions),
      sessions: new Map([[name, currentSession]]),
      pendingContributors: new Map(),
      cancelTimer: vi.fn(),
      notifyEntitySettled: vi.fn(),
      persistWith: async () => {
        throw new EditSessionEntityDeletedError(name);
      },
      isShuttingDown: () => false,
    });
    finalization.schedule(name, currentSession, 0, "room-close");
    await vi.advanceTimersByTimeAsync(0);
    expect(currentSession.retryAttempts).toBe(0);
  });

  it("ignores stale exhausted-finalization state", async () => {
    const logFailure = vi.fn();
    const trackerOptions = options(logFailure);
    const registry = new EditSessionDocumentRegistry(trackerOptions);
    const currentSession = session(0);
    const finalization = coordinator(registry, trackerOptions, currentSession);
    await finalization.settleExhaustedFinalization("invalid", session(0));
    expect(logFailure).not.toHaveBeenCalled();
  });

  it("merges a concurrent contributor after a failed source autosave", async () => {
    const name = "post:11111111-1111-4111-8111-111111111111:en";
    const source: EditSessionDocumentLike = { getConnections: () => [] };
    const trackerOptions = {
      ...options(vi.fn()),
      listDocuments: () =>
        [[name, source]] as Array<[string, EditSessionDocumentLike]>,
    };
    const currentSession = session(0);
    const finalization = new EditSessionFinalizationCoordinator({
      options: trackerOptions,
      documents: new EditSessionDocumentRegistry(trackerOptions),
      sessions: new Map([[name, currentSession]]),
      pendingContributors: new Map(),
      cancelTimer: vi.fn(),
      notifyEntitySettled: vi.fn(),
      persistWith: async () => {
        currentSession.nextContributors.add("next-member");
        throw new Error("transient");
      },
      isShuttingDown: () => false,
    });
    finalization.schedule(name, currentSession, 0, "room-close");
    await vi.advanceTimersByTimeAsync(0);
    expect([...currentSession.contributors].sort()).toEqual([
      "member",
      "next-member",
    ]);
  });

  it("contains a source reconnect during final unload", async () => {
    const name = "post:11111111-1111-4111-8111-111111111111:en";
    let connected = false;
    const source: EditSessionDocumentLike = {
      getConnections: () => (connected ? [{}] : []),
    };
    class ReconnectingRegistry extends EditSessionDocumentRegistry<EditSessionDocumentLike> {
      override sourceDocumentIsCurrent(): boolean {
        connected = true;
        return true;
      }
    }
    const trackerOptions = {
      ...options(vi.fn()),
      listDocuments: () =>
        [[name, source]] as Array<[string, EditSessionDocumentLike]>,
      unloadDocument: vi.fn(),
    };
    const currentSession = session(0);
    const finalization = new EditSessionFinalizationCoordinator({
      options: trackerOptions,
      documents: new ReconnectingRegistry(trackerOptions),
      sessions: new Map([[name, currentSession]]),
      pendingContributors: new Map(),
      cancelTimer: vi.fn(),
      notifyEntitySettled: vi.fn(),
      persistWith: async (persist, documentName, value, saveOptions) =>
        persist(documentName, value, saveOptions),
      isShuttingDown: () => false,
    });
    finalization.schedule(name, currentSession, 0, "room-close");
    await vi.advanceTimersByTimeAsync(0);
    expect(trackerOptions.unloadDocument).not.toHaveBeenCalled();
  });

  it("uses the active-window retry mode while an editor remains connected", async () => {
    const name = "post:11111111-1111-4111-8111-111111111111:en";
    const source: EditSessionDocumentLike = { getConnections: () => [{}] };
    const trackerOptions = {
      ...options(vi.fn()),
      listDocuments: () =>
        [[name, source]] as Array<[string, EditSessionDocumentLike]>,
    };
    const currentSession = session(0);
    const finalization = new EditSessionFinalizationCoordinator({
      options: trackerOptions,
      documents: new EditSessionDocumentRegistry(trackerOptions),
      sessions: new Map([[name, currentSession]]),
      pendingContributors: new Map(),
      cancelTimer: vi.fn(),
      notifyEntitySettled: vi.fn(),
      persistWith: async () => {
        throw new Error("transient");
      },
      isShuttingDown: () => false,
    });
    finalization.schedule(name, currentSession, 0, "active-window");
    await vi.advanceTimersByTimeAsync(0);
    expect(currentSession.timerMode).toBe("active-window");
  });

  it("clears only pending contributors scoped to an exhausted source entity", async () => {
    const name = "post:11111111-1111-4111-8111-111111111111:en";
    const source: EditSessionDocumentLike = { getConnections: () => [] };
    const trackerOptions = {
      ...options(vi.fn()),
      listDocuments: () =>
        [[name, source]] as Array<[string, EditSessionDocumentLike]>,
    };
    const currentSession = session(0);
    const pending = new Map([
      [name, new Map([["member", 1]])],
      ["post:22222222-2222-4222-8222-222222222222:en", new Map([["other", 2]])],
    ]);
    const finalization = new EditSessionFinalizationCoordinator({
      options: trackerOptions,
      documents: new EditSessionDocumentRegistry(trackerOptions),
      sessions: new Map([[name, currentSession]]),
      pendingContributors: pending,
      cancelTimer: vi.fn(),
      notifyEntitySettled: vi.fn(),
      persistWith: async () => undefined,
      isShuttingDown: () => true,
    });
    await finalization.settleExhaustedFinalization(name, currentSession);
    expect(pending.has(name)).toBe(false);
    expect(pending.has("post:22222222-2222-4222-8222-222222222222:en")).toBe(
      true,
    );
  });
});
