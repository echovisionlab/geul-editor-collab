import { describe, expect, it } from "vitest";
import { RoomEpochRegistry } from "./room-epoch.ts";

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `id-${index}`;
}

describe("RoomEpochRegistry token retention", () => {
  it("expires after 24 hours without a successful resume and refreshes on resume", () => {
    let now = 1_000;
    const registry = new RoomEpochRegistry(
      ids("server-a", "epoch-a", "token-a"),
      { now: () => now },
    );
    const token = registry.issueToken("post:post-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });

    now += 24 * 60 * 60 * 1_000 - 1;
    expect(registry.validate("post:post-1", token)).toBeDefined();

    now += 24 * 60 * 60 * 1_000 - 1;
    expect(registry.validate("post:post-1", token)).toBeDefined();

    now += 24 * 60 * 60 * 1_000;
    expect(registry.validate("post:post-1", token)).toBeUndefined();
  });

  it("rejects expired tokens from markSynchronized while preserving active admission", () => {
    let now = 5_000;
    const registry = new RoomEpochRegistry(
      ids("server-a", "epoch-a", "token-a"),
      { now: () => now, tokenTtlMs: 100 },
    );
    const token = registry.issueToken("page:page-1", {
      yjsBootstrapStateVector: Uint8Array.of(1, 2),
    });
    const activeAdmission = registry.validate("page:page-1", token);
    expect(activeAdmission).toBeDefined();

    now += 100;
    expect(registry.markSynchronized("page:page-1", token)).toBe(false);
    expect(registry.validate("page:page-1", token)).toBeUndefined();
    expect(registry.validateAdmission("page:page-1", activeAdmission!)).toEqual(
      activeAdmission,
    );
  });

  it("evicts the least recently validated token within its room", () => {
    const registry = new RoomEpochRegistry(
      ids("server-a", "epoch-a", "token-a", "token-b", "token-c"),
      { maxTokensPerRoom: 2 },
    );
    const tokenA = registry.issueToken("post:post-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });
    const tokenB = registry.issueToken("post:post-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });
    const activeAdmissionA = registry.validate("post:post-1", tokenA)!;
    expect(registry.markSynchronized("post:post-1", tokenA)).toBe(true);
    const synchronizedAdmissionA = registry.validate("post:post-1", tokenA)!;
    expect(registry.validate("post:post-1", tokenB)).toBeDefined();

    const tokenC = registry.issueToken("post:post-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });

    expect(registry.validate("post:post-1", tokenA)).toBeUndefined();
    expect(registry.validate("post:post-1", tokenB)).toBeDefined();
    expect(registry.validate("post:post-1", tokenC)).toBeDefined();
    expect(
      registry.validateAdmission("post:post-1", synchronizedAdmissionA),
    ).toEqual(synchronizedAdmissionA);
    expect(registry.validateAdmission("post:post-1", activeAdmissionA)).toEqual(
      activeAdmissionA,
    );
  });

  it("keeps each room's capacity and retirement independent", () => {
    const registry = new RoomEpochRegistry(
      ids(
        "server-a",
        "post-epoch",
        "post-token-a",
        "post-token-b",
        "post-token-c",
        "page-epoch",
        "page-token-a",
      ),
      { maxTokensPerRoom: 2 },
    );
    const postA = registry.issueToken("post:post-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });
    registry.issueToken("post:post-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });
    const pageA = registry.issueToken("page:page-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });
    registry.issueToken("post:post-1", {
      yjsBootstrapStateVector: Uint8Array.of(0),
    });

    expect(registry.validate("post:post-1", postA)).toBeUndefined();
    expect(registry.validate("page:page-1", pageA)).toBeDefined();

    registry.retire("post:post-1");
    expect(registry.validate("page:page-1", pageA)).toBeDefined();
  });

  it("copies bootstrap state vectors when storing and returning admissions", () => {
    const registry = new RoomEpochRegistry(
      ids("server-a", "epoch-a", "token-a"),
    );
    const sourceVector = Uint8Array.of(1, 2, 3);
    const token = registry.issueToken("work:work-1", {
      yjsBootstrapStateVector: sourceVector,
    });
    sourceVector[0] = 9;

    const firstAdmission = registry.validate("work:work-1", token)!;
    firstAdmission.yjsBootstrapStateVector[1] = 9;

    expect(
      registry.validate("work:work-1", token)?.yjsBootstrapStateVector,
    ).toEqual(Uint8Array.of(1, 2, 3));
  });
});
