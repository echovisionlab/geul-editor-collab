import { describe, expect, it, vi } from "vitest";
import { createConnectionHooks } from "./connection-hooks.ts";

function hooks(fenced = false) {
  const blockRooms = {
    connected: vi.fn(),
    beforeSync: vi.fn(),
  };
  const editSessions = {
    connected: vi.fn(),
    disconnected: vi.fn(),
    flushPendingMutationBefore: vi.fn(async () => undefined),
  };
  const metadataAiGrace = { connected: vi.fn(), disconnected: vi.fn() };
  const settlePendingRoomInvalidation = vi.fn(async () => undefined);
  const result = createConnectionHooks({
    shutdownConnections: { connected: vi.fn(() => false) } as never,
    metadataAiGrace: metadataAiGrace as never,
    editSessions: () => editSessions,
    blockRooms: blockRooms as never,
    isDocumentFenced: vi.fn(() => fenced),
    settlePendingRoomInvalidation,
  });
  return {
    result,
    blockRooms,
    editSessions,
    metadataAiGrace,
    settlePendingRoomInvalidation,
  };
}

describe("Block room connection hooks", () => {
  it("delegates sync admission to the room protocol", async () => {
    const { result, blockRooms } = hooks();
    const payload = new Uint8Array([1, 2, 3]);
    const document = {};
    const connection = { document };
    const context = { blockRoomAdmissionState: "pending" };

    await result.beforeSync?.({
      connection,
      context,
      documentName: "post:one",
      document,
      type: 2,
      payload,
    } as never);

    expect(blockRooms.beforeSync).toHaveBeenCalledWith(
      connection,
      context,
      "post:one",
      document,
      2,
      payload,
    );
  });

  it("flushes a prior mutation actor before an admitted actor sync update", async () => {
    const { result, blockRooms, editSessions } = hooks();
    const document = {};
    const connection = { document, readOnly: false };
    const context = {
      blockRoomAdmissionState: "accepted",
      canEdit: true,
      member: { id: "member-2" },
    };

    await result.beforeSync?.({
      connection,
      context,
      documentName: "post:one",
      document,
      type: 2,
      payload: new Uint8Array([1]),
    } as never);

    expect(editSessions.flushPendingMutationBefore).toHaveBeenCalledWith(
      "post:one",
      document,
      "member-2",
    );
    expect(
      editSessions.flushPendingMutationBefore.mock.invocationCallOrder[0],
    ).toBeLessThan(blockRooms.beforeSync.mock.invocationCallOrder[0]!);
  });

  it("never opens a mutation actor lane for read-only presence sync", async () => {
    const { result, editSessions } = hooks();
    const document = {};
    await result.beforeSync?.({
      connection: { document, readOnly: true },
      context: {
        blockRoomAdmissionState: "accepted",
        canEdit: false,
        member: { id: "member-view" },
      },
      documentName: "post:one",
      document,
      type: 2,
      payload: new Uint8Array([1]),
    } as never);
    expect(editSessions.flushPendingMutationBefore).not.toHaveBeenCalled();
  });

  it("drops awareness before admission and accepts it after admission", async () => {
    const { result } = hooks();
    const pending = new Map([[1, { cursor: { anchor: 1 } }]]);
    await result.beforeHandleAwareness?.({
      context: {
        member: { id: "member-1", nickname: "Editor" },
        blockRoomAdmissionState: "issued",
      },
      states: pending,
      transactionOrigin: { source: "local" },
    } as never);
    expect(pending.size).toBe(0);

    const connection = { document: {} };
    const accepted = new Map([[1, { cursor: { anchor: 1 } }]]);
    await result.beforeHandleAwareness?.({
      context: {
        member: { id: "member-1", nickname: "Editor" },
        blockRoomAdmissionState: "accepted",
      },
      states: accepted,
      transactionOrigin: { source: "connection", connection },
    } as never);
    expect(accepted.size).toBe(1);
    expect(accepted.get(1)).toMatchObject({
      cursor: { anchor: 1 },
      user: { id: "member-1", name: "Editor" },
    });
  });

  it("refuses a connection fenced while its document was loading", async () => {
    const {
      result,
      blockRooms,
      editSessions,
      metadataAiGrace,
      settlePendingRoomInvalidation,
    } = hooks(true);
    const connection = {
      close: vi.fn(),
      sendStateless: vi.fn(),
      document: {},
    };

    await result.connected?.({
      connection,
      context: {},
      documentName: "post:lost-during-load",
      socketId: "socket-1",
    } as never);

    expect(connection.sendStateless).toHaveBeenCalledWith(
      JSON.stringify({
        kind: "reload_required",
        reason: "reload_required",
      }),
    );
    expect(connection.close).toHaveBeenCalledOnce();
    expect(blockRooms.connected).not.toHaveBeenCalled();
    expect(editSessions.connected).not.toHaveBeenCalled();
    expect(metadataAiGrace.connected).not.toHaveBeenCalled();
    expect(settlePendingRoomInvalidation).toHaveBeenCalledWith(
      "post:lost-during-load",
      connection.document,
    );
  });
});
