import { describe, expect, it } from "vitest";
import { mergeMetadataValue } from "./resident-metadata-merge.ts";

describe("resident metadata deltas", () => {
  it("keeps an unseen addition when a stale author adds another ID", () => {
    expect(
      mergeMetadataValue(["base", "peer"], ["base"], ["base", "mine"]),
    ).toEqual(["base", "peer", "mine"]);
  });
  it("does not duplicate a peer-added ID repeated by a stale author", () => {
    expect(
      mergeMetadataValue(["base", "peer"], ["base"], ["base", "peer"]),
    ).toEqual(["base", "peer"]);
  });
  it("treats an absent resident ID projection as an empty list", () => {
    expect(mergeMetadataValue(undefined, [], ["local"])).toEqual(["local"]);
  });
  it("does not resurrect a peer-deleted untouched ID", () => {
    expect(mergeMetadataValue([], ["deleted"], ["deleted", "mine"])).toEqual([
      "mine",
    ]);
  });
  it("removes only IDs explicitly removed by this author", () => {
    expect(mergeMetadataValue(["base", "peer"], ["base"], [])).toEqual([
      "peer",
    ]);
  });
  it("combines separate social-link edits and applies changed keys last", () => {
    expect(
      mergeMetadataValue(
        { a: "peer", b: "peer", c: "new" },
        { a: "old", b: "old" },
        { a: "mine", b: "old" },
      ),
    ).toEqual({ a: "mine", b: "peer", c: "new" });
  });
  it("merges a record onto an absent resident projection", () => {
    expect(
      mergeMetadataValue(undefined, { old: "observed" }, { local: "added" }),
    ).toEqual({ local: "added" });
  });
  it("preserves an unseen map entry during an explicit deletion", () => {
    expect(
      mergeMetadataValue({ a: "old", b: "peer" }, { a: "old" }, {}),
    ).toEqual({ b: "peer" });
  });

  it("rejects malformed observed and current ID lists with specific errors", () => {
    expect(() => mergeMetadataValue([], [1], ["mine"])).toThrow(
      "metadata_observed_id_list_required",
    );
    expect(() => mergeMetadataValue([1], ["old"], ["mine"])).toThrow(
      "metadata_current_id_list_required",
    );
    expect(() => mergeMetadataValue([], ["old"], [1] as never)).toThrow(
      "metadata_observed_id_list_required",
    );
  });

  it("rejects incompatible canonical collection shapes", () => {
    expect(() => mergeMetadataValue(undefined, [], {})).toThrow(
      "metadata_observed_collection_required",
    );
    expect(() => mergeMetadataValue(undefined, {}, [])).toThrow(
      "metadata_observed_collection_required",
    );
  });
});
