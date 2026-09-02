import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { describe, expect, it } from "vitest";
import { handlers } from "./index.ts";

describe("handler registry", () => {
  it("maps every collaborative document type and rejects unspecified documents", async () => {
    expect(Object.keys(handlers)).toHaveLength(
      Object.keys(CollaborativeDocumentType).length / 2,
    );
    const unsupported = handlers[CollaborativeDocumentType.UNSPECIFIED];
    await expect(
      unsupported.store("", null as never, {
        contributorMemberIds: [],
      }),
    ).rejects.toThrow("Unsupported document type");
    await expect(unsupported.load("")).rejects.toThrow(
      "Unsupported document type",
    );
  });

  it("declares Version checkpoint support only on reviewed source adapters", () => {
    const versioned = Object.entries(handlers)
      .filter(([, handler]) => handler.supportsVersionCheckpoints === true)
      .map(([type]) => Number(type))
      .sort((left, right) => left - right);

    expect(versioned).toEqual(
      [
        CollaborativeDocumentType.POST,
        CollaborativeDocumentType.PAGE,
        CollaborativeDocumentType.WORK,
      ].sort((left, right) => left - right),
    );
  });

  it("rejects direct persistence through resident Block compatibility handlers", async () => {
    const resident = handlers[CollaborativeDocumentType.POST];
    await expect(
      resident.store("post-1", null as never, {
        contributorMemberIds: [],
      }),
    ).rejects.toThrow("resident_block_runtime_required");
    await expect(resident.load("post-1")).rejects.toThrow(
      "resident_block_runtime_required",
    );
  });
});
