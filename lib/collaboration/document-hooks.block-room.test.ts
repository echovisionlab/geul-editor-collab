import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { createDocumentHooks } from "./document-hooks.ts";
import { handlers } from "../../handlers/index.ts";

const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const LOAD_CONTEXT = { sessionId: SESSION_ID };

function setup() {
  const persist = vi.fn().mockResolvedValue(undefined);
  const recordAcceptedChange = vi.fn(() => false);
  const blockRooms = { handleStateless: vi.fn().mockResolvedValue(false) };
  const acquire = vi.fn().mockResolvedValue(undefined);
  const release = vi.fn().mockResolvedValue(undefined);
  const residentLoad = vi.fn().mockResolvedValue(undefined);
  const residentUnload = vi.fn();
  const retire = vi.fn();
  const unfence = vi.fn();
  const isOwned = vi.fn(() => true);
  const ownedDocuments = new Map();
  const clearPendingRoomInvalidation = vi.fn();
  const dependencies = {
    editSessions: () => ({
      persist,
      recordAcceptedChange,
      preventsUnload: vi.fn(() => false),
      documentUnloaded: vi.fn(),
    }),
    metadataAiGrace: {
      loaded: vi.fn(),
      preventsUnload: vi.fn(() => false),
    },
    revisionConflicts: {
      handle: vi.fn(() => false),
      isStale: vi.fn(() => false),
      fencedDocumentNames: new Set<string>(),
      unfence,
    },
    shutdownConnections: { releaseAdmission: vi.fn() },
    roomEpochs: { retire },
    residentBlocks: {
      load: residentLoad,
      unload: residentUnload,
    },
    blockRooms,
    roomOwnership: {
      acquire,
      isOwned,
      release,
    },
    ownedDocuments,
    clearPendingRoomInvalidation,
  };
  return {
    hooks: createDocumentHooks(dependencies as never),
    dependencies,
    persist,
    recordAcceptedChange,
    blockRooms,
    acquire,
    release,
    residentLoad,
    residentUnload,
    retire,
    unfence,
    isOwned,
    ownedDocuments,
    clearPendingRoomInvalidation,
  };
}

describe("Block room document hooks", () => {
  it("loads an empty canonical non-Block source document without applying an update", async () => {
    const runtime = setup();
    const load = vi
      .spyOn(handlers[CollaborativeDocumentType.MAP_THEME], "load")
      .mockResolvedValueOnce(null);
    const document = new Y.Doc();
    const documentName = "map-theme:11111111-1111-4111-8111-111111111111:und";
    await expect(
      runtime.hooks.onLoadDocument?.({
        documentName,
        document,
        context: LOAD_CONTEXT,
      } as never),
    ).resolves.toBe(document);
    expect(load).toHaveBeenCalledWith(documentName);
    load.mockResolvedValueOnce(Buffer.alloc(0));
    await expect(
      runtime.hooks.onLoadDocument?.({
        documentName: "map-theme:22222222-2222-4222-8222-222222222222:und",
        document: new Y.Doc(),
        context: LOAD_CONTEXT,
      } as never),
    ).resolves.toBeDefined();
  });
  it("lets the room protocol consume stateless commands before legacy persistence", async () => {
    const runtime = setup();
    runtime.blockRooms.handleStateless.mockResolvedValueOnce(true);
    const connection = { context: {}, sendStateless: vi.fn() };

    await runtime.hooks.onStateless?.({
      connection,
      documentName: "post:55555555-5555-4555-8555-555555555555:en",
      document: new Y.Doc(),
      payload: JSON.stringify({ kind: "block_room.snapshot" }),
    } as never);

    expect(runtime.persist).not.toHaveBeenCalled();
  });

  it("rejects persist-now before the Block room bootstrap is accepted", async () => {
    const runtime = setup();
    const connection = {
      context: { blockRoomAdmissionState: "issued" },
      sendStateless: vi.fn(),
    };

    await runtime.hooks.onStateless?.({
      connection,
      documentName: "post:55555555-5555-4555-8555-555555555555:en",
      document: new Y.Doc(),
      payload: JSON.stringify({
        kind: "persist.now.request",
        requestId: "request-1",
      }),
    } as never);

    expect(runtime.persist).not.toHaveBeenCalled();
    expect(JSON.parse(connection.sendStateless.mock.calls[0]![0])).toEqual({
      kind: "persist.now.ack",
      requestId: "request-1",
      ok: false,
      error: "reload_required",
    });
  });

  it("does not record or persist a read-only viewer change", async () => {
    const runtime = setup();
    const connection = {
      context: { canEdit: false },
      sendStateless: vi.fn(),
    };

    await runtime.hooks.onChange?.({
      documentName: "post:55555555-5555-4555-8555-555555555555:en",
      connection,
      context: connection.context,
    } as never);
    await runtime.hooks.onStateless?.({
      connection,
      documentName: "post:55555555-5555-4555-8555-555555555555:en",
      document: new Y.Doc(),
      payload: JSON.stringify({
        kind: "persist.now.request",
        requestId: "viewer-request",
      }),
    } as never);

    expect(runtime.recordAcceptedChange).not.toHaveBeenCalled();
    expect(runtime.persist).not.toHaveBeenCalled();
    expect(JSON.parse(connection.sendStateless.mock.calls[0]![0])).toEqual({
      kind: "persist.now.ack",
      requestId: "viewer-request",
      ok: false,
      error: "permission_denied",
    });
  });

  it("releases room ownership when a resident document fails to load", async () => {
    const runtime = setup();
    runtime.residentLoad.mockRejectedValueOnce(new Error("load failed"));
    const document = new Y.Doc();

    await expect(
      runtime.hooks.onLoadDocument?.({
        documentName: "post:55555555-5555-4555-8555-555555555555:en",
        document,
        context: LOAD_CONTEXT,
      } as never),
    ).rejects.toThrow("load failed");

    expect(runtime.release).toHaveBeenCalledWith(
      "post:55555555-5555-4555-8555-555555555555:en",
    );
  });

  it("acquires ownership before loading resident state", async () => {
    const runtime = setup();
    const order: string[] = [];
    runtime.acquire.mockImplementationOnce(async () => {
      order.push("acquire");
    });
    runtime.residentLoad.mockImplementationOnce(async () => {
      order.push("load");
    });

    await runtime.hooks.onLoadDocument?.({
      documentName: "post:55555555-5555-4555-8555-555555555555:en",
      document: new Y.Doc(),
      context: LOAD_CONTEXT,
    } as never);

    expect(order).toEqual(["acquire", "load"]);
    expect(runtime.residentLoad).toHaveBeenCalledWith(
      "post:55555555-5555-4555-8555-555555555555:en",
      expect.any(Y.Doc),
      expect.objectContaining({ sessionId: SESSION_ID }),
    );
    expect(runtime.release).not.toHaveBeenCalled();
    expect(
      runtime.ownedDocuments.get(
        "post:55555555-5555-4555-8555-555555555555:en",
      ),
    ).toBeDefined();
  });

  it("fences an in-flight load and refuses activation after ownership is lost", async () => {
    const runtime = setup();
    let finishLoad!: () => void;
    runtime.residentLoad.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishLoad = resolve;
        }),
    );
    const document = new Y.Doc();
    const loading = runtime.hooks.onLoadDocument?.({
      documentName: "post:44444444-4444-4444-8444-444444444444:en",
      document,
      context: LOAD_CONTEXT,
    } as never);

    await vi.waitFor(() => expect(runtime.residentLoad).toHaveBeenCalledOnce());
    expect(
      runtime.ownedDocuments.get(
        "post:44444444-4444-4444-8444-444444444444:en",
      ),
    ).toBe(document);
    runtime.isOwned.mockReturnValue(false);
    runtime.dependencies.revisionConflicts.fencedDocumentNames.add(
      "post:44444444-4444-4444-8444-444444444444:en",
    );
    finishLoad();

    await expect(loading).rejects.toThrow("room_ownership_lost");
    expect(runtime.release).toHaveBeenCalledWith(
      "post:44444444-4444-4444-8444-444444444444:en",
    );
    expect(runtime.residentUnload).toHaveBeenCalledWith(
      "post:44444444-4444-4444-8444-444444444444:en",
    );
    expect(runtime.retire).toHaveBeenCalledWith(
      "post:44444444-4444-4444-8444-444444444444:en",
    );
    expect(
      runtime.ownedDocuments.has(
        "post:44444444-4444-4444-8444-444444444444:en",
      ),
    ).toBe(false);
    expect(runtime.dependencies.metadataAiGrace.loaded).not.toHaveBeenCalled();
    expect(runtime.unfence).toHaveBeenCalledWith(
      "post:44444444-4444-4444-8444-444444444444:en",
    );
  });

  it("preserves the load error while cleaning up after ownership release also fails", async () => {
    const runtime = setup();
    runtime.residentLoad.mockRejectedValueOnce(new Error("load failed"));
    runtime.release.mockRejectedValueOnce(new Error("unlock failed"));

    await expect(
      runtime.hooks.onLoadDocument?.({
        documentName: "post:33333333-3333-4333-8333-333333333333:en",
        document: new Y.Doc(),
        context: LOAD_CONTEXT,
      } as never),
    ).rejects.toThrow("load failed");

    expect(runtime.residentUnload).toHaveBeenCalledWith(
      "post:33333333-3333-4333-8333-333333333333:en",
    );
    expect(runtime.retire).toHaveBeenCalledWith(
      "post:33333333-3333-4333-8333-333333333333:en",
    );
    expect(
      runtime.ownedDocuments.has(
        "post:33333333-3333-4333-8333-333333333333:en",
      ),
    ).toBe(false);
  });

  it("does not load or release a room rejected by the ownership authority", async () => {
    const runtime = setup();
    runtime.acquire.mockRejectedValueOnce(new Error("room_owned_elsewhere"));

    await expect(
      runtime.hooks.onLoadDocument?.({
        documentName: "post:55555555-5555-4555-8555-555555555555:en",
        document: new Y.Doc(),
        context: LOAD_CONTEXT,
      } as never),
    ).rejects.toThrow("room_owned_elsewhere");

    expect(runtime.residentLoad).not.toHaveBeenCalled();
    expect(runtime.release).not.toHaveBeenCalled();
  });

  it("retires resident state before releasing ownership and unfences last", async () => {
    const runtime = setup();
    const order: string[] = [];
    runtime.residentUnload.mockImplementationOnce(() => order.push("unload"));
    runtime.retire.mockImplementationOnce(() => order.push("retire"));
    runtime.release.mockImplementationOnce(async () => {
      order.push("release");
    });
    runtime.unfence.mockImplementationOnce(() => order.push("unfence"));

    await runtime.hooks.afterUnloadDocument?.({
      documentName: "post:55555555-5555-4555-8555-555555555555:en",
    } as never);

    expect(order).toEqual(["unload", "retire", "release", "unfence"]);
    expect(
      runtime.ownedDocuments.has(
        "post:55555555-5555-4555-8555-555555555555:en",
      ),
    ).toBe(false);
  });

  it("unfences a room even when ownership release fails", async () => {
    const runtime = setup();
    runtime.release.mockRejectedValueOnce(new Error("unlock failed"));

    await expect(
      runtime.hooks.afterUnloadDocument?.({
        documentName: "post:55555555-5555-4555-8555-555555555555:en",
      } as never),
    ).rejects.toThrow("unlock failed");

    expect(runtime.unfence).toHaveBeenCalledWith(
      "post:55555555-5555-4555-8555-555555555555:en",
    );
  });
});
