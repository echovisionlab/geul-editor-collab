import { describe, expect, it, vi } from "vitest";
import {
  PostgresRoomOwnership,
  RoomOwnedElsewhereError,
} from "./room-ownership.ts";

function fakeClient(acquisitions: boolean[]) {
  let errorListener: ((error: Error) => void) | undefined;
  const query = vi.fn(async (text: string) => {
    if (text.includes("pg_try_advisory_lock")) {
      return { rows: [{ acquired: acquisitions.shift() ?? false }] };
    }
    return { rows: [{ released: true }] };
  });
  return {
    client: {
      connect: vi.fn().mockResolvedValue(undefined),
      query,
      on: vi.fn((_event: string, listener: (error: Error) => void) => {
        errorListener = listener;
        return undefined;
      }),
      end: vi.fn().mockResolvedValue(undefined),
    },
    query,
    fail(error = new Error("connection lost")) {
      errorListener?.(error);
    },
  };
}

describe("PostgreSQL collaboration room ownership", () => {
  it("holds one process-wide advisory-lock session and de-duplicates room acquisition", async () => {
    const database = fakeClient([true, true]);
    const ownership = new PostgresRoomOwnership(
      vi.fn(),
      () => database.client as never,
    );

    await Promise.all([
      ownership.acquire("post:one"),
      ownership.acquire("post:one"),
    ]);
    expect(ownership.isOwned("post:one")).toBe(true);
    await ownership.acquire("post:one");
    await ownership.acquire("post:two");
    await ownership.release("post:one");
    expect(ownership.isOwned("post:one")).toBe(false);

    expect(database.client.connect).toHaveBeenCalledOnce();
    expect(
      database.query.mock.calls.filter(([sql]) =>
        String(sql).includes("pg_try"),
      ),
    ).toHaveLength(2);
    expect(database.query).toHaveBeenLastCalledWith(
      expect.stringContaining("pg_advisory_unlock"),
      ["post:one", expect.any(Number)],
    );
    await ownership.close();
    expect(database.client.end).toHaveBeenCalledOnce();
  });

  it("rejects a room held by another replica without creating local state", async () => {
    const database = fakeClient([false]);
    const ownership = new PostgresRoomOwnership(
      vi.fn(),
      () => database.client as never,
    );

    await expect(ownership.acquire("post:owned")).rejects.toBeInstanceOf(
      RoomOwnedElsewhereError,
    );
    await expect(ownership.release("post:owned")).resolves.toBeUndefined();
    expect(database.query).toHaveBeenCalledOnce();
  });

  it("reports every owned room when the lock session is lost", async () => {
    const database = fakeClient([true, true]);
    const lost = vi.fn();
    const ownership = new PostgresRoomOwnership(
      lost,
      () => database.client as never,
    );
    await ownership.acquire("post:one");
    await ownership.acquire("page:two");

    database.fail();

    expect(lost).toHaveBeenCalledWith(
      ["post:one", "page:two"],
      expect.any(Error),
    );
    expect(ownership.isOwned("post:one")).toBe(false);
  });

  it("rejects acquisition after close and permits closing without a client", async () => {
    const ownership = new PostgresRoomOwnership(
      vi.fn(),
      () => fakeClient([]).client as never,
    );
    await ownership.close();
    await expect(ownership.acquire("post:closed")).rejects.toThrow(
      "room_ownership_closed",
    );
    await expect(ownership.release("post:missing")).resolves.toBeUndefined();
  });

  it("tolerates an owned marker after its session has already disappeared", async () => {
    const ownership = new PostgresRoomOwnership(
      vi.fn(),
      () => fakeClient([]).client as never,
    );
    (ownership as unknown as { owned: Set<string> }).owned.add("post:orphaned");
    await expect(ownership.release("post:orphaned")).resolves.toBeUndefined();
  });

  it.each([new Error("query failed"), "query failed"])(
    "drops the ownership session when lock acquisition throws %#",
    async (failure) => {
      const database = fakeClient([]);
      database.query.mockRejectedValueOnce(failure);
      const ownership = new PostgresRoomOwnership(
        vi.fn(),
        () => database.client as never,
      );

      await expect(ownership.acquire("post:failed")).rejects.toBe(failure);
      expect(database.client.end).toHaveBeenCalledOnce();
    },
  );

  it.each([new Error("unlock failed"), "unlock failed"])(
    "drops the ownership session when unlock throws %#",
    async (failure) => {
      const database = fakeClient([true]);
      const lost = vi.fn();
      const ownership = new PostgresRoomOwnership(
        lost,
        () => database.client as never,
      );
      await ownership.acquire("post:locked");
      database.query.mockRejectedValueOnce(failure);

      await ownership.release("post:locked");
      expect(database.client.end).toHaveBeenCalledOnce();
      expect(lost).not.toHaveBeenCalled();
    },
  );

  it("closes a client that finishes connecting after shutdown begins", async () => {
    let finishConnect!: () => void;
    const database = fakeClient([true]);
    database.client.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishConnect = resolve;
        }),
    );
    const ownership = new PostgresRoomOwnership(
      vi.fn(),
      () => database.client as never,
    );
    const acquisition = ownership.acquire("post:pending");
    await vi.waitFor(() =>
      expect(database.client.connect).toHaveBeenCalledOnce(),
    );
    const closing = ownership.close();
    finishConnect();

    await expect(acquisition).rejects.toThrow("room_ownership_closed");
    await closing;
    expect(database.client.end).toHaveBeenCalledOnce();
  });

  it("swallows an end failure reported by a lost lock session", async () => {
    const database = fakeClient([true]);
    database.client.end.mockRejectedValueOnce(new Error("end failed"));
    const ownership = new PostgresRoomOwnership(
      vi.fn(),
      () => database.client as never,
    );
    await ownership.acquire("post:one");
    database.fail();
    await Promise.resolve();
    expect(database.client.end).toHaveBeenCalledOnce();
  });

  it.each([new Error("fence callback failed"), "fence callback failed"])(
    "isolates an ownership-loss callback failure from the PostgreSQL client event %#",
    async (failure) => {
      const database = fakeClient([true]);
      const lost = vi.fn(() => {
        throw failure;
      });
      const ownership = new PostgresRoomOwnership(
        lost,
        () => database.client as never,
      );
      await ownership.acquire("post:one");

      expect(() => database.fail()).not.toThrow();
      expect(lost).toHaveBeenCalledOnce();
      expect(ownership.isOwned("post:one")).toBe(false);
    },
  );

  it("constructs the default PostgreSQL client lazily", () => {
    const ownership = new PostgresRoomOwnership(vi.fn()) as unknown as {
      createClient: () => unknown;
    };
    expect(ownership.createClient()).toBeDefined();
  });

  it("ignores a stale client error after the active client was replaced", async () => {
    const first = fakeClient([true]);
    const second = fakeClient([true]);
    let current = first;
    const ownership = new PostgresRoomOwnership(
      vi.fn(),
      () => current.client as never,
    );
    await ownership.acquire("post:first");
    first.fail();
    current = second;
    await ownership.acquire("post:second");
    first.fail(new Error("stale error"));
    expect(second.client.end).not.toHaveBeenCalled();
  });
});
