import { describe, expect, it } from "vitest";
import { compactMeta, diffMetaPatch } from "./meta-patch.ts";

describe("meta patches", () => {
  it("compacts undefined fields and builds the initial patch mask", () => {
    expect(compactMeta({ title: "Title", omitted: undefined })).toEqual({
      title: "Title",
    });
    expect(diffMetaPatch(undefined, {})).toBeUndefined();
    expect(diffMetaPatch(undefined, { title: "Title" })).toEqual({
      title: "Title",
      patchMask: ["title"],
    });
  });

  it("compares primitive, nullable, typed, and structural values", () => {
    const previous: Record<string, unknown> = {
      same: "same",
      nullable: null,
      typed: 1,
      primitive: "old",
      object: { value: 1 },
      array: ["a"],
    };
    expect(diffMetaPatch(previous, { ...previous })).toBeUndefined();
    expect(
      diffMetaPatch(previous, {
        ...previous,
        nullable: "set",
        typed: "1",
        primitive: "new",
        object: { value: 2 },
        array: ["b"],
      }),
    ).toEqual({
      nullable: "set",
      typed: "1",
      primitive: "new",
      object: { value: 2 },
      array: ["b"],
      patchMask: ["nullable", "typed", "primitive", "object", "array"],
    });
  });
});
