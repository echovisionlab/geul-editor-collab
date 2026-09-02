import { describe, expect, it } from "vitest";
import { RoomEpochRegistry } from "./room-epoch.ts";

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `id-${index}`;
}

describe("RoomEpochRegistry", () => {
  it("keeps one epoch for a resident room and scopes tokens to its document", () => {
    const registry = new RoomEpochRegistry(
      ids("server-a", "epoch-a", "token-a", "epoch-b"),
    );
    const token = registry.issueToken("post:post-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });

    expect(registry.issue("post:post-1")).toEqual({
      serverInstanceId: "server-a",
      roomEpoch: "epoch-a",
    });
    expect(registry.validate("post:post-1", token)).toEqual({
      serverInstanceId: "server-a",
      roomEpoch: "epoch-a",
      yjsBootstrapStateVector: Uint8Array.of(0),
      requiresCanonicalSyncFence: true,
    });
    expect(registry.validate("post:post-2", token)).toBeUndefined();
    expect(registry.issue("post:post-2").roomEpoch).toBe("epoch-b");
  });

  it("rejects a pre-unload token after the room is retired", () => {
    const registry = new RoomEpochRegistry(
      ids("server-a", "epoch-a", "token-a", "epoch-b", "token-b"),
    );
    const staleToken = registry.issueToken("page:page-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });

    registry.retire("page:page-1");
    expect(registry.validate("page:page-1", staleToken)).toBeUndefined();

    const freshToken = registry.issueToken("page:page-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });
    expect(registry.validate("page:page-1", freshToken)?.roomEpoch).toBe(
      "epoch-b",
    );
  });

  it("rejects a token from a previous server process", () => {
    const previous = new RoomEpochRegistry(
      ids("server-a", "epoch-a", "token-a"),
    );
    const restarted = new RoomEpochRegistry(ids("server-b", "epoch-a"));
    const staleToken = previous.issueToken("work:work-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });

    restarted.issue("work:work-1");
    expect(restarted.validate("work:work-1", staleToken)).toBeUndefined();
  });

  it("rejects a token when its room epoch no longer matches the active room", () => {
    const registry = new RoomEpochRegistry(
      ids("server-a", "epoch-a", "token-a"),
    );
    const token = registry.issueToken("post:post-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });

    const internal = registry as unknown as {
      roomEpochs: Map<string, string>;
    };
    internal.roomEpochs.set("post:post-1", "epoch-b");

    expect(registry.validate("post:post-1", token)).toBeUndefined();
  });

  it("fails closed for malformed and forged tokens", () => {
    const registry = new RoomEpochRegistry(ids("server-a", "epoch-a"));
    registry.issue("post:post-1");

    expect(registry.validate("post:post-1", "")).toBeUndefined();
    expect(registry.validate("post:post-1", "{")).toBeUndefined();
    expect(registry.validate("post:post-1", "forged")).toBeUndefined();
  });

  it("requires a canonical first sync once, then permits same-epoch reconnects", () => {
    const registry = new RoomEpochRegistry(
      ids("server-a", "epoch-a", "token-a"),
    );
    const token = registry.issueToken("post:post-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });

    expect(
      registry.validate("post:post-1", token)?.requiresCanonicalSyncFence,
    ).toBe(true);
    expect(registry.markSynchronized("post:post-1", token)).toBe(true);
    expect(
      registry.validate("post:post-1", token)?.requiresCanonicalSyncFence,
    ).toBe(false);
    expect(registry.markSynchronized("post:post-2", token)).toBe(false);
    registry.retire("post:post-1");
    expect(registry.markSynchronized("post:post-1", token)).toBe(false);
  });
});
