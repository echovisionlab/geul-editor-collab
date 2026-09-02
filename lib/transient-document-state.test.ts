import { describe, expect, it } from "vitest";
import {
  clearTransientDocumentState,
  TransientDocumentStateMap,
} from "./transient-document-state.ts";

describe("transient document state", () => {
  it("clears only the unloaded semantic document id from every registered cache", () => {
    const first = new TransientDocumentStateMap<string>();
    const second = new TransientDocumentStateMap<number>();
    const unloaded = "post:11111111-1111-4111-8111-111111111111:en";
    const other = "post:11111111-1111-4111-8111-111111111111:ko";
    first.set(unloaded, "edit-hash");
    first.set(other, "other-hash");
    second.set(unloaded, 1);

    clearTransientDocumentState(unloaded);

    expect(first.has(unloaded)).toBe(false);
    expect(second.has(unloaded)).toBe(false);
    expect(first.get(other)).toBe("other-hash");
  });
});
