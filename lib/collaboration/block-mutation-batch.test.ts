import { describe, expect, it } from "vitest";
import {
  BlockMutationBaseline,
  type CanonicalBlock,
  type CanonicalBlockDocument,
} from "./block-mutation-batch.ts";

const BLOCK_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

function block(overrides: Partial<CanonicalBlock> = {}): CanonicalBlock {
  return {
    blockId: BLOCK_ID,
    parentBlockId: null,
    containerSlot: "body",
    position: 0,
    kind: "paragraph",
    baseData: { alignment: "left" },
    localeData: { text: "Source" },
    ...overrides,
  };
}

function snapshot(
  blocks: CanonicalBlock[] = [block()],
): CanonicalBlockDocument {
  return {
    blockCatalogFingerprint: "catalog-v1",
    profile: 1,
    sourceLocale: "en",
    locale: "en",
    blocks,
  };
}

describe("BlockMutationBaseline", () => {
  it("emits one server-authoritative source mutation set", () => {
    const baseline = new BlockMutationBaseline(snapshot(), "revision-1");
    const next = block({ localeData: { text: "Edited" } });
    const batch = baseline.prepareAffected(
      {
        locale: "en",
        blocks: [next],
        affectedBaseBlockIds: [],
        deletedBaseBlockIds: [],
        affectedLocaleBlockIds: [BLOCK_ID],
        deletedLocaleBlockIds: [],
      },
      ["member-2", "member-1", "member-2"],
    );
    expect(batch).toMatchObject({
      expectedDocumentRevision: "revision-1",
      locale: "en",
      contributorMemberIds: ["member-1", "member-2"],
      localeMutations: [
        { operation: "upsert", blockId: BLOCK_ID, data: { text: "Edited" } },
      ],
    });
  });

  it("keeps sparse target fallback units absent when another locale leaf changes", () => {
    const targetSnapshot = {
      ...snapshot([
        block({ localeData: { text: "Translated" } }),
        block({ blockId: OTHER_ID, position: 1, localeData: undefined }),
      ]),
      sourceLocale: "ko",
      locale: "en",
    };
    const baseline = new BlockMutationBaseline(
      targetSnapshot,
      "document-revision-1",
      "tr1_target_1",
    );
    const batch = baseline.prepareAffected(
      {
        locale: "en",
        blocks: [
          block({ localeData: { text: "Edited" } }),
          block({
            blockId: OTHER_ID,
            position: 1,
            localeData: undefined,
          }),
        ],
        affectedBaseBlockIds: [],
        deletedBaseBlockIds: [],
        affectedLocaleBlockIds: [BLOCK_ID],
        deletedLocaleBlockIds: [],
      },
      ["member-1"],
    );

    expect(batch).toMatchObject({
      expectedDocumentRevision: "document-revision-1",
      expectedTargetRevision: "tr1_target_1",
      locale: "en",
      baseMutations: [],
      localeMutations: [
        { operation: "upsert", blockId: BLOCK_ID, data: { text: "Edited" } },
      ],
    });
    expect(batch.localeMutations).not.toContainEqual(
      expect.objectContaining({ blockId: OTHER_ID }),
    );
    baseline.acknowledge({
      documentRevision: "document-revision-1",
      targetRevision: "tr1_target_2",
      changed: true,
      sourceChanged: false,
    });
    expect(
      baseline.prepareFull(
        {
          ...targetSnapshot,
          blocks: [
            block({ localeData: { text: "Edited" } }),
            block({
              blockId: OTHER_ID,
              position: 1,
              localeData: undefined,
            }),
          ],
        },
        [],
      ),
    ).toMatchObject({
      expectedTargetRevision: "tr1_target_2",
      baseMutations: [],
      localeMutations: [],
    });
  });

  it("requires dual target CAS and keeps the shared document revision stable", () => {
    const targetSnapshot = {
      ...snapshot(),
      sourceLocale: "ko",
      locale: "en",
    };
    const baseline = new BlockMutationBaseline(
      targetSnapshot,
      "document-revision-1",
      "tr1_target_1",
    );
    baseline.prepareFull(
      {
        ...targetSnapshot,
        blocks: [block({ localeData: { text: "Edited" } })],
      },
      [],
    );
    expect(() =>
      baseline.acknowledge({
        documentRevision: "document-revision-2",
        targetRevision: "tr1_target_2",
        changed: true,
        sourceChanged: false,
      }),
    ).toThrow("block_mutation_target_document_revision_changed");
  });

  it("rejects a room locale change", () => {
    const baseline = new BlockMutationBaseline(snapshot(), "revision-1");
    expect(() =>
      baseline.prepareAffected(
        {
          locale: "ko",
          blocks: [block()],
          affectedBaseBlockIds: [],
          deletedBaseBlockIds: [],
          affectedLocaleBlockIds: [BLOCK_ID],
          deletedLocaleBlockIds: [],
        },
        [],
      ),
    ).toThrow("block_document_locale_changed");
  });

  it("emits source deletion and advances only after acknowledgement", () => {
    const baseline = new BlockMutationBaseline(snapshot(), "revision-1");
    const batch = baseline.prepareFull(
      snapshot([block({ localeData: undefined })]),
      [],
    );
    expect(batch.localeMutations).toEqual([
      { operation: "delete", blockId: BLOCK_ID, kind: "paragraph" },
    ]);
    expect(baseline.revision).toBe("revision-1");
    baseline.acknowledge({
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: true,
    });
    expect(baseline.revision).toBe("revision-2");
    expect(
      baseline.prepareFull(snapshot([block({ localeData: undefined })]), []),
    ).toMatchObject({ baseMutations: [], localeMutations: [] });
  });

  it("keeps structural mutation ordering deterministic", () => {
    const baseline = new BlockMutationBaseline(snapshot(), "revision-1");
    const batch = baseline.prepareFull(
      snapshot([
        block({ position: 1 }),
        block({ blockId: CHILD_ID, position: 0, localeData: undefined }),
      ]),
      [],
    );
    expect(batch.baseMutations.map(({ operation }) => operation)).toEqual([
      "move",
      "upsert",
    ]);
  });

  it("diffs insert, update, delete, move, and source changes from the last ACKed snapshot", () => {
    const baseline = new BlockMutationBaseline(
      snapshot([
        block(),
        block({
          blockId: CHILD_ID,
          parentBlockId: BLOCK_ID,
          containerSlot: "children",
          localeData: undefined,
        }),
        block({ blockId: OTHER_ID, position: 1 }),
      ]),
      "revision-1",
    );
    const insertedId = "44444444-4444-4444-8444-444444444444";
    const batch = baseline.prepareFull(
      snapshot([
        block({ position: 1, baseData: { alignment: "right" } }),
        block({ blockId: CHILD_ID, localeData: undefined }),
        block({ blockId: insertedId, position: 2, localeData: undefined }),
      ]),
      ["member-b", "member-a", "member-a"],
    );

    expect(batch.baseMutations).toEqual([
      expect.objectContaining({ operation: "move", blockId: CHILD_ID }),
      expect.objectContaining({ operation: "upsert" }),
      expect.objectContaining({
        operation: "upsert",
        block: expect.objectContaining({ blockId: insertedId }),
      }),
      { operation: "delete", blockId: OTHER_ID, kind: "paragraph" },
    ]);
    expect(batch.localeMutations).toEqual([]);
    expect(batch.contributorMemberIds).toEqual(["member-a", "member-b"]);
  });

  it("keeps a pending batch immutable and validates acknowledgement authority", () => {
    const baseline = new BlockMutationBaseline(snapshot(), "revision-1");
    const first = baseline.prepareFull(
      snapshot([block({ baseData: { alignment: "center" } })]),
      ["member-a"],
    );
    expect(
      baseline.prepareFull(
        snapshot([block({ baseData: { alignment: "right" } })]),
        ["member-b"],
      ),
    ).toBe(first);
    expect(() =>
      baseline.acknowledge({
        documentRevision: "",
        changed: true,
        sourceChanged: false,
      }),
    ).toThrow("block_mutation_ack_missing_authority");
    baseline.acknowledge({
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: false,
    });
    expect(baseline.revision).toBe("revision-2");
  });

  it("treats array order as irrelevant when structural positions are unchanged", () => {
    const baseline = new BlockMutationBaseline(
      snapshot([block(), block({ blockId: OTHER_ID, position: 1 })]),
      "revision-1",
    );
    expect(
      baseline.prepareFull(
        snapshot([block({ blockId: OTHER_ID, position: 1 }), block()]),
        [],
      ),
    ).toMatchObject({ baseMutations: [], localeMutations: [] });
  });

  it("re-upserts the authoritative source overlay after a kind change", () => {
    const baseline = new BlockMutationBaseline(snapshot(), "revision-1");
    const batch = baseline.prepareFull(
      snapshot([block({ kind: "heading" })]),
      [],
    );
    expect(batch.baseMutations).toHaveLength(1);
    expect(batch.localeMutations).toEqual([
      {
        operation: "upsert",
        blockId: BLOCK_ID,
        kind: "heading",
        data: { text: "Source" },
      },
    ]);
  });

  it("covers affected-only deletion, insertion, movement, and stale identities", () => {
    const baseline = new BlockMutationBaseline(snapshot(), "r1");
    const inserted = block({
      blockId: OTHER_ID,
      position: 1,
      localeData: undefined,
      adapterData: { family: "rich_text" },
    });
    const batch = baseline.prepareAffected(
      {
        locale: "en",
        blocks: [inserted, block({ position: 2 })],
        affectedBaseBlockIds: [OTHER_ID, BLOCK_ID, CHILD_ID],
        deletedBaseBlockIds: [CHILD_ID],
        affectedLocaleBlockIds: [OTHER_ID, CHILD_ID],
        deletedLocaleBlockIds: [CHILD_ID],
      },
      [],
    );
    expect(batch.baseMutations).toEqual([
      expect.objectContaining({ operation: "move", blockId: BLOCK_ID }),
      expect.objectContaining({
        operation: "upsert",
        block: expect.objectContaining({ blockId: OTHER_ID }),
      }),
    ]);
    expect(batch.localeMutations).toEqual([]);
  });

  it("commits affected source upserts and deletions without replacing base data", () => {
    const baseline = new BlockMutationBaseline(
      snapshot([block(), block({ blockId: OTHER_ID, position: 1 })]),
      "r1",
    );
    baseline.prepareAffected(
      {
        locale: "en",
        blocks: [
          block({ localeData: { text: "After" } }),
          block({
            blockId: OTHER_ID,
            position: 1,
            localeData: undefined,
          }),
        ],
        affectedBaseBlockIds: [],
        deletedBaseBlockIds: [],
        affectedLocaleBlockIds: [BLOCK_ID, OTHER_ID, CHILD_ID],
        deletedLocaleBlockIds: [OTHER_ID],
      },
      [],
    );
    baseline.acknowledge({
      documentRevision: "r2",
      changed: true,
      sourceChanged: true,
    });
    expect(
      baseline.prepareFull(
        snapshot([
          block({ localeData: { text: "After" } }),
          block({
            blockId: OTHER_ID,
            position: 1,
            localeData: undefined,
          }),
        ]),
        [],
      ),
    ).toMatchObject({ baseMutations: [], localeMutations: [] });
  });

  it("fails closed for malformed snapshots", () => {
    const invalid = [
      [snapshot([block({ blockId: "legacy-id" })]), "invalid_block_id"],
      [snapshot([block({ parentBlockId: "bad-parent" })]), "invalid_parent_id"],
      [snapshot([block({ containerSlot: "" })]), "invalid_structure"],
      [snapshot([block({ kind: "" })]), "invalid_structure"],
      [snapshot([block({ position: -1 })]), "invalid_structure"],
      [snapshot([block({ position: 1.5 })]), "invalid_structure"],
      [
        snapshot([block(), block({ blockId: BLOCK_ID, position: 1 })]),
        "duplicate_block_id",
      ],
      [snapshot([block(), block({ blockId: OTHER_ID })]), "duplicate_position"],
      [snapshot([block({ parentBlockId: OTHER_ID })]), "missing_parent"],
      [
        snapshot([
          block({ parentBlockId: CHILD_ID }),
          block({ blockId: CHILD_ID, parentBlockId: BLOCK_ID }),
        ]),
        "parent_cycle",
      ],
      [{ ...snapshot([]), blockCatalogFingerprint: "" }, "missing_catalog"],
      [{ ...snapshot([]), sourceLocale: " " }, "missing_source_locale"],
    ] as const;
    for (const [document, error] of invalid) {
      expect(() => new BlockMutationBaseline(document, "r")).toThrow(error);
    }
  });

  it("fails closed for non-JSON source and base values", () => {
    const baseline = new BlockMutationBaseline(snapshot(), "r");
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Symbol("bad")]) {
      expect(() =>
        baseline.prepareFull(snapshot([block({ baseData: { value } })]), []),
      ).toThrow(/block_document_(non_finite_number|non_json_value)/);
    }
    expect(() =>
      baseline.prepareFull(
        snapshot([block({ localeData: { values: [undefined] } })]),
        [],
      ),
    ).toThrow("block_document_non_json_value");
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(() =>
      baseline.prepareFull(snapshot([block({ baseData: cyclic })]), []),
    ).toThrow("block_document_cyclic_json");
  });

  it("guards direct revision advancement and ACK order", () => {
    const baseline = BlockMutationBaseline.fromSnapshot(snapshot(), "r1");
    expect(() =>
      baseline.acknowledge({
        documentRevision: "r2",
        changed: false,
        sourceChanged: false,
      }),
    ).toThrow("block_mutation_ack_without_request");
    expect(() => baseline.advanceDocumentRevision("stale", "r2")).toThrow(
      "block_mutation_revision_advance_stale",
    );
    expect(() => baseline.advanceDocumentRevision("r1", "")).toThrow(
      "block_mutation_revision_advance_missing",
    );
    baseline.advanceDocumentRevision("r1", "r2");
    baseline.prepareFull(snapshot([block({ position: 1 })]), []);
    expect(() => baseline.advanceDocumentRevision("r2", "r3")).toThrow(
      "block_mutation_revision_advance_pending",
    );
    expect(() => baseline.advanceTargetRevision("tr1_pending")).toThrow(
      "block_mutation_target_revision_advance_pending",
    );
  });

  it("rejects target authority on source acknowledgements and direct advances", () => {
    const baseline = new BlockMutationBaseline(snapshot(), "r1");
    expect(() => baseline.advanceTargetRevision("tr1_forbidden")).toThrow(
      "block_mutation_source_target_revision_forbidden",
    );
    baseline.prepareFull(
      snapshot([block({ localeData: { text: "Edited" } })]),
      [],
    );
    expect(() =>
      baseline.acknowledge({
        documentRevision: "r2",
        targetRevision: "tr1_forbidden",
        changed: true,
        sourceChanged: true,
      }),
    ).toThrow("block_mutation_source_target_revision_forbidden");
  });

  it("requires a locale in every canonical snapshot", () => {
    expect(
      () => new BlockMutationBaseline({ ...snapshot([]), locale: " " }, "r1"),
    ).toThrow("block_document_missing_locale");
  });

  it("rejects structural mutations in an exact target room", () => {
    const baseline = new BlockMutationBaseline(
      { ...snapshot(), sourceLocale: "ko", locale: "en" },
      "r1",
      "tr1_target",
    );
    expect(() =>
      baseline.prepareFull(snapshot([block({ position: 1 })]), []),
    ).toThrow("block_mutation_target_structure_forbidden");
  });

  it("canonicalizes finite numeric changes and applies acknowledged base deletion", () => {
    const numeric = new BlockMutationBaseline(
      snapshot([block({ baseData: { value: 1 } })]),
      "r1",
    );
    expect(
      numeric.prepareFull(snapshot([block({ baseData: { value: 2 } })]), [])
        .baseMutations,
    ).toHaveLength(1);

    const deleting = new BlockMutationBaseline(snapshot(), "r1");
    deleting.prepareFull(snapshot([]), []);
    deleting.acknowledge({
      documentRevision: "r2",
      changed: true,
      sourceChanged: true,
    });
    expect(deleting.prepareFull(snapshot([]), [])).toMatchObject({
      baseMutations: [],
      localeMutations: [],
    });
  });
});
