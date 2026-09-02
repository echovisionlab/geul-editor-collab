import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { BlockRoomChangeSet } from "@echovisionlab/geul-common/collaboration/block-room-codec";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import {
  CollaborationConflictError,
  CollaborationMutationRejectionError,
  CollaborationPersistenceRejectedError,
  CollaborationResourceNotFoundError,
} from "../api/transport.ts";
import {
  ResidentBlockPersistence,
  type ResidentBlockAdapter,
} from "./resident-block-persistence.ts";
import type {
  CanonicalBlockChanges,
  CanonicalBlockDocument,
} from "./block-mutation-batch.ts";

const BLOCK_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function snapshot(text = "Source"): CanonicalBlockDocument {
  return {
    blockCatalogFingerprint: "catalog-v1",
    sourceLocale: "en",
    locale: "en",
    blocks: [
      {
        blockId: BLOCK_ID,
        parentBlockId: null,
        containerSlot: "body",
        position: 0,
        kind: "paragraph",
        baseData: {},
        localeData: { text },
      },
    ],
  };
}

function changes(text: string): CanonicalBlockChanges {
  return {
    locale: "en",
    blocks: snapshot(text).blocks,
    affectedBaseBlockIds: [],
    deletedBaseBlockIds: [],
    affectedLocaleBlockIds: [BLOCK_ID],
    deletedLocaleBlockIds: [],
  };
}

function targetSnapshot(text = "Translated"): CanonicalBlockDocument {
  return {
    ...snapshot(text),
    sourceLocale: "ko",
    locale: "en",
    blocks: [
      { ...snapshot(text).blocks[0]!, localeData: { text } },
      {
        ...snapshot().blocks[0]!,
        blockId: OTHER_ID,
        position: 1,
        localeData: undefined,
      },
    ],
  };
}

function targetChanges(text: string): CanonicalBlockChanges {
  return {
    locale: "en",
    blocks: [
      { ...targetSnapshot(text).blocks[0]!, localeData: { text } },
      targetSnapshot().blocks[1]!,
    ],
    affectedBaseBlockIds: [],
    deletedBaseBlockIds: [],
    affectedLocaleBlockIds: [BLOCK_ID],
    deletedLocaleBlockIds: [],
  };
}

function changeSet(): BlockRoomChangeSet {
  return {
    affectedBaseBlockIds: [],
    affectedLocaleBlockIds: [BLOCK_ID],
    affectedLocaleValueTargets: [],
    changedContainerOrderKeys: [],
    documentMetadataChanged: false,
    documentLayoutChanged: false,
    requiresFullDecode: false,
  };
}

function fixture() {
  const persistence = new ResidentBlockPersistence();
  const document = new Y.Doc();
  document.getMap("content").set("text", "Source");
  const decodeFull = vi.fn((doc: Y.Doc) =>
    snapshot(String(doc.getMap("content").get("text"))),
  );
  const decodeAffected = vi.fn((doc: Y.Doc) =>
    changes(String(doc.getMap("content").get("text"))),
  );
  const save = vi.fn();
  const checkpoint = vi.fn(async () => undefined);
  const ensureAuthority = vi.fn();
  const stopObserving = vi.fn();
  persistence.register(
    "post:post-1",
    document,
    {
      documentRevision: "revision-1",
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      snapshot: snapshot(),
    },
    { ensureAuthority, decodeFull, decodeAffected, save, checkpoint },
    stopObserving,
  );
  return {
    persistence,
    document,
    decodeFull,
    decodeAffected,
    save,
    checkpoint,
    ensureAuthority,
    stopObserving,
  };
}

function targetFixture(targetRevision: string | undefined) {
  const persistence = new ResidentBlockPersistence();
  const document = new Y.Doc();
  const checkpoint = vi.fn(async () => undefined);
  persistence.register(
    "post:post-1:en",
    document,
    {
      documentRevision: "document-revision-1",
      ...(targetRevision === undefined ? {} : { targetRevision }),
      sourceLocale: "ko",
      locale: "en",
      localeExists: targetRevision !== undefined,
      snapshot: targetSnapshot(),
    },
    {
      ensureAuthority: vi.fn(),
      decodeFull: vi.fn(() => targetSnapshot()),
      decodeAffected: vi.fn(() => targetChanges("Translated")),
      save: vi.fn(),
      checkpoint,
    },
  );
  return { persistence, document, checkpoint };
}

describe("ResidentBlockPersistence source authority", () => {
  it("persists one source mutation and advances revision/epoch on ACK", async () => {
    const save = vi.fn(async () => ({
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: true,
    }));
    const adapter: ResidentBlockAdapter = {
      ensureAuthority: vi.fn(),
      decodeFull: vi.fn(() => snapshot("Edited")),
      decodeAffected: vi.fn(() => changes("Edited")),
      save,
      checkpoint: vi.fn(),
    };
    const document = new Y.Doc();
    const persistence = new ResidentBlockPersistence();
    persistence.register(
      "post:post-1",
      document,
      {
        documentRevision: "revision-1",
        sourceLocale: "en",
        locale: "en",
        localeExists: true,
        snapshot: snapshot(),
      },
      adapter,
    );
    persistence.recordChange("post:post-1", document, changeSet());

    await expect(
      persistence.persist("post:post-1", document, ["member-1"]),
    ).resolves.toMatchObject({
      documentRevision: "revision-2",
      contributorMemberIds: ["member-1"],
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        locale: "en",
        localeMutations: [
          expect.objectContaining({ operation: "upsert", blockId: BLOCK_ID }),
        ],
      }),
    );
  });

  it("persists only the affected sparse target leaf with dual CAS", async () => {
    const save = vi.fn(
      async (batch: Parameters<ResidentBlockAdapter["save"]>[0]) => {
        void batch;
        return {
          documentRevision: "document-revision-1",
          targetRevision: "tr1_target_2",
          changed: true,
          sourceChanged: false,
          locale: "en",
        };
      },
    );
    const adapter: ResidentBlockAdapter = {
      ensureAuthority: vi.fn(),
      decodeFull: vi.fn(() => targetSnapshot("Edited")),
      decodeAffected: vi.fn(() => targetChanges("Edited")),
      save,
      checkpoint: vi.fn(),
    };
    const document = new Y.Doc();
    const persistence = new ResidentBlockPersistence();
    persistence.register(
      "post:post-1:en",
      document,
      {
        documentRevision: "document-revision-1",
        targetRevision: "tr1_target_1",
        sourceLocale: "ko",
        locale: "en",
        localeExists: true,
        snapshot: targetSnapshot(),
      },
      adapter,
    );
    persistence.recordChange("post:post-1:en", document, {
      ...changeSet(),
      affectedLocaleBlockIds: [BLOCK_ID],
    });

    await expect(
      persistence.persist("post:post-1:en", document, ["member-1"]),
    ).resolves.toMatchObject({
      documentRevision: "document-revision-1",
      targetRevision: "tr1_target_2",
      sourceLocale: "ko",
      locale: "en",
      localeExists: true,
    });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedDocumentRevision: "document-revision-1",
        expectedTargetRevision: "tr1_target_1",
        baseMutations: [],
        localeMutations: [
          expect.objectContaining({
            operation: "upsert",
            blockId: BLOCK_ID,
          }),
        ],
      }),
    );
    expect(save.mock.calls[0]?.[0].localeMutations).not.toContainEqual(
      expect.objectContaining({ blockId: OTHER_ID }),
    );
    expect(persistence.snapshot("post:post-1:en")).toMatchObject({
      documentRevision: "document-revision-1",
      targetRevision: "tr1_target_2",
      localeExists: true,
    });
  });

  it("rejects persistence for a missing target preview before an explicit create", async () => {
    const save = vi.fn();
    const document = new Y.Doc();
    const persistence = new ResidentBlockPersistence();
    persistence.register(
      "post:post-1:en",
      document,
      {
        documentRevision: "document-revision-1",
        sourceLocale: "ko",
        locale: "en",
        localeExists: false,
        snapshot: targetSnapshot(),
      },
      {
        ensureAuthority: vi.fn(),
        decodeFull: vi.fn(() => targetSnapshot("Edited")),
        decodeAffected: vi.fn(() => targetChanges("Edited")),
        save,
        checkpoint: vi.fn(),
      },
    );
    persistence.recordChange("post:post-1:en", document, {
      ...changeSet(),
      affectedLocaleBlockIds: [BLOCK_ID],
    });

    await expect(
      persistence.persist("post:post-1:en", document, ["member-1"]),
    ).rejects.toThrow("block_mutation_missing_target_revision");
    expect(save).not.toHaveBeenCalled();
  });

  it("clears target authority and requires reload when an accepted save reports deletion", async () => {
    const save = vi.fn(
      async (batch: Parameters<ResidentBlockAdapter["save"]>[0]) => {
        void batch;
        return {
          documentRevision: "document-revision-1",
          changed: true,
          sourceChanged: false,
          locale: "en",
        };
      },
    );
    const document = new Y.Doc();
    const persistence = new ResidentBlockPersistence();
    persistence.register(
      "post:post-1:en",
      document,
      {
        documentRevision: "document-revision-1",
        targetRevision: "tr1_target_1",
        sourceLocale: "ko",
        locale: "en",
        localeExists: true,
        snapshot: targetSnapshot(),
      },
      {
        ensureAuthority: vi.fn(),
        decodeFull: vi.fn(() => targetSnapshot("Edited")),
        decodeAffected: vi.fn(() => targetChanges("Edited")),
        save,
        checkpoint: vi.fn(),
      },
    );
    persistence.recordChange("post:post-1:en", document, changeSet());

    await expect(
      persistence.persist("post:post-1:en", document, ["member-1"]),
    ).rejects.toMatchObject({
      reason: "target_revision_changed",
      message: "target_locale_deleted",
    });
    expect(persistence.snapshot("post:post-1:en")).toMatchObject({
      documentRevision: "document-revision-1",
      localeExists: false,
    });
    expect(persistence.snapshot("post:post-1:en")).not.toHaveProperty(
      "targetRevision",
    );
  });

  it("checkpoints the current source revision and contributors", async () => {
    const checkpoint = vi.fn(async () => undefined);
    const adapter: ResidentBlockAdapter = {
      ensureAuthority: vi.fn(),
      decodeFull: vi.fn(() => snapshot()),
      decodeAffected: vi.fn(() => changes("Source")),
      save: vi.fn(),
      checkpoint,
    };
    const document = new Y.Doc();
    const persistence = new ResidentBlockPersistence();
    persistence.register(
      "post:post-1",
      document,
      {
        documentRevision: "revision-1",
        sourceLocale: "en",
        locale: "en",
        localeExists: true,
        snapshot: snapshot(),
      },
      adapter,
    );
    await persistence.checkpoint("post:post-1", document, ["member-1"]);
    expect(checkpoint).toHaveBeenCalledWith({
      expectedDocumentRevision: "revision-1",
      contributorMemberIds: ["member-1"],
    });
  });

  it("rejects duplicate resident instances for one canonical room", () => {
    const persistence = new ResidentBlockPersistence();
    const adapter = {
      ensureAuthority: vi.fn(),
      decodeFull: vi.fn(() => snapshot()),
      decodeAffected: vi.fn(() => changes("Source")),
      save: vi.fn(),
      checkpoint: vi.fn(),
    } satisfies ResidentBlockAdapter;
    persistence.register(
      "post:post-1",
      new Y.Doc(),
      {
        documentRevision: "revision-1",
        sourceLocale: "en",
        locale: "en",
        localeExists: true,
        snapshot: snapshot(),
      },
      adapter,
    );
    expect(() =>
      persistence.register(
        "post:post-1",
        new Y.Doc(),
        {
          documentRevision: "revision-1",
          sourceLocale: "en",
          locale: "en",
          localeExists: true,
          snapshot: snapshot(),
        },
        adapter,
      ),
    ).toThrow("resident_document_already_loaded");
  });

  it("returns the loaded snapshot and a stable unchanged persist result", async () => {
    const { persistence, document, save } = fixture();
    expect(persistence.snapshot("post:post-1")).toEqual({
      documentRevision: "revision-1",
      sourceLocale: "en",
      locale: "en",
      localeExists: true,
      blockCatalogFingerprint: "catalog-v1",
    });
    expect(persistence.snapshot("post:missing")).toBeUndefined();
    await expect(
      persistence.persist("post:post-1", document, ["b", "a", "a"]),
    ).resolves.toMatchObject({
      documentRevision: "revision-1",
      contributorMemberIds: ["a", "b"],
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects missing and mixed actors before issuing a block autosave", async () => {
    const { persistence, document, save } = fixture();
    persistence.recordChange("post:post-1", document, changeSet());
    await expect(
      persistence.persist("post:post-1", document, []),
    ).rejects.toThrow("collaboration_mutation_actor_required");
    await expect(
      persistence.persist("post:post-1", document, ["member-1", "member-2"]),
    ).rejects.toThrow("collaboration_mutation_actor_mixed");
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects stale external document and target revision tuples", () => {
    const { persistence, document } = fixture();
    expect(() =>
      persistence.assertExternalMutationReady("post:post-1", document, {
        expectedDocumentRevision: "revision-stale",
        expectedTargetRevision: undefined,
      }),
    ).toThrow("interactive_mutation_document_revision_changed");
    expect(() =>
      persistence.assertExternalMutationReady("post:post-1", document, {
        expectedDocumentRevision: "revision-1",
        expectedTargetRevision: "tr1_stale",
      }),
    ).toThrow("interactive_mutation_target_revision_changed");
  });

  it("merges change sets and uses full decode only when explicitly required", async () => {
    const { persistence, document, decodeFull, decodeAffected, save } =
      fixture();
    persistence.recordChange("post:post-1", document, changeSet());
    persistence.recordChange("post:post-1", document, {
      affectedBaseBlockIds: [],
      affectedLocaleBlockIds: [],
      affectedLocaleValueTargets: [],
      changedContainerOrderKeys: [],
      documentMetadataChanged: true,
      documentLayoutChanged: true,
      requiresFullDecode: true,
    });
    save.mockResolvedValueOnce({
      documentRevision: "revision-2",
      changed: false,
      sourceChanged: false,
    });
    await persistence.persist("post:post-1", document, ["member-1"]);
    expect(decodeFull).toHaveBeenCalledOnce();
    expect(decodeAffected).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("consumes metadata/layout-only affected changes without calling save", async () => {
    const { persistence, document, decodeFull, decodeAffected, save } =
      fixture();
    persistence.recordChange("post:post-1", document, {
      affectedBaseBlockIds: [],
      affectedLocaleBlockIds: [],
      affectedLocaleValueTargets: [],
      changedContainerOrderKeys: [],
      documentMetadataChanged: true,
      documentLayoutChanged: true,
      requiresFullDecode: false,
    });
    await persistence.persist("post:post-1", document, ["member-1"]);
    expect(decodeAffected).toHaveBeenCalledOnce();
    expect(decodeFull).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("preserves save error classification instead of manufacturing a revision conflict", async () => {
    const failures = [
      new CollaborationConflictError("target_revision_changed"),
      new CollaborationMutationRejectionError("room_locale_mismatch"),
      new CollaborationPersistenceRejectedError(401, "apply Page Block batch"),
      new CollaborationResourceNotFoundError(
        CollaborativeDocumentType.POST,
        "post-1",
      ),
      new Error("response_lost"),
    ];
    for (const failure of failures) {
      const { persistence, document, save } = fixture();
      document.getMap("content").set("text", String(Math.random()));
      persistence.recordChange("post:post-1", document, changeSet());
      save.mockRejectedValueOnce(failure);
      const promise = persistence.persist("post:post-1", document, [
        "member-1",
      ]);
      await expect(promise).rejects.toBe(failure);
    }
  });

  it("retries an unacknowledged batch before preserving later room changes", async () => {
    const { persistence, document, save } = fixture();
    const responseLost = new Error("response_lost");
    document.getMap("content").set("text", "First");
    persistence.recordChange("post:post-1", document, changeSet());
    save.mockRejectedValueOnce(responseLost);

    await expect(
      persistence.persist("post:post-1", document, ["member-1"]),
    ).rejects.toBe(responseLost);
    const unacknowledgedBatch = save.mock.calls[0]?.[0];

    document.getMap("content").set("text", "Second");
    persistence.recordChange("post:post-1", document, changeSet());
    save.mockResolvedValueOnce({
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: true,
    });
    await expect(
      persistence.persist("post:post-1", document, ["member-2"]),
    ).resolves.toMatchObject({ documentRevision: "revision-2" });
    expect(save.mock.calls[1]?.[0]).toBe(unacknowledgedBatch);

    save.mockResolvedValueOnce({
      documentRevision: "revision-3",
      changed: true,
      sourceChanged: true,
    });
    await expect(
      persistence.persist("post:post-1", document, ["member-2"]),
    ).resolves.toMatchObject({ documentRevision: "revision-3" });
    expect(save.mock.calls[2]?.[0]).toMatchObject({
      expectedDocumentRevision: "revision-2",
      contributorMemberIds: ["member-2"],
      localeMutations: [expect.objectContaining({ data: { text: "Second" } })],
    });
  });

  it("checkpoints after autosave and supports an already-acknowledged checkpoint", async () => {
    const { persistence, document, save, checkpoint } = fixture();
    document.getMap("content").set("text", "Edited");
    persistence.recordChange("post:post-1", document, changeSet());
    save.mockResolvedValueOnce({
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: true,
    });
    await persistence.persist("post:post-1", document, ["a"]);
    await persistence.checkpointAcknowledged("post:post-1", document, [
      "b",
      "a",
      "a",
    ]);
    expect(checkpoint).toHaveBeenNthCalledWith(1, {
      expectedDocumentRevision: "revision-2",
      contributorMemberIds: ["a", "b"],
    });
    await expect(
      persistence.checkpointAcknowledged("post:post-1", document, ["b", "a"]),
    ).resolves.toMatchObject({
      documentRevision: "revision-2",
      contributorMemberIds: ["a", "b"],
    });
    expect(checkpoint).toHaveBeenNthCalledWith(2, {
      expectedDocumentRevision: "revision-2",
      contributorMemberIds: ["a", "b"],
    });
  });

  it("returns target checkpoint authority without creating a version checkpoint", async () => {
    const existing = targetFixture("tr1_target_1");
    await expect(
      existing.persistence.checkpoint("post:post-1:en", existing.document, [
        "member-1",
      ]),
    ).resolves.toMatchObject({ targetRevision: "tr1_target_1" });
    await expect(
      existing.persistence.checkpointAcknowledged(
        "post:post-1:en",
        existing.document,
        ["b", "a", "b"],
      ),
    ).resolves.toMatchObject({
      targetRevision: "tr1_target_1",
      contributorMemberIds: ["a", "b"],
    });
    expect(existing.checkpoint).not.toHaveBeenCalled();

    const missing = targetFixture(undefined);
    await expect(
      missing.persistence.checkpointAcknowledged(
        "post:post-1:en",
        missing.document,
        [],
      ),
    ).resolves.not.toHaveProperty("targetRevision");
  });

  it("supports source checkpoint adapters without a checkpoint operation", async () => {
    const persistence = new ResidentBlockPersistence();
    const document = new Y.Doc();
    persistence.register(
      "artist:artist-1",
      document,
      {
        documentRevision: "revision-1",
        sourceLocale: "en",
        locale: "en",
        localeExists: true,
        snapshot: snapshot(),
      },
      {
        ensureAuthority: vi.fn(),
        decodeFull: vi.fn(() => snapshot()),
        decodeAffected: vi.fn(() => changes("Source")),
        save: vi.fn(),
      },
    );

    await expect(
      persistence.checkpoint("artist:artist-1", document, ["member-1"]),
    ).resolves.toMatchObject({ documentRevision: "revision-1" });
    await expect(
      persistence.checkpointAcknowledged("artist:artist-1", document, [
        "member-1",
      ]),
    ).resolves.toMatchObject({ documentRevision: "revision-1" });
  });

  it("acknowledges metadata revisions", () => {
    const { persistence, document } = fixture();
    persistence.acknowledgeMetadataRevision(
      "post:post-1",
      document,
      "revision-1",
      "revision-2",
    );
    expect(persistence.snapshot("post:post-1")).toMatchObject({
      documentRevision: "revision-2",
    });
    persistence.acknowledgeMetadataRevision(
      "post:post-1",
      document,
      "revision-2",
      "revision-3",
    );
    expect(persistence.snapshot("post:post-1")).toMatchObject({
      documentRevision: "revision-3",
    });
  });

  it("rejects a target token on a source metadata ACK before advancing authority", () => {
    const { persistence, document } = fixture();
    expect(() =>
      persistence.acknowledgeMetadataRevision(
        "post:post-1",
        document,
        "revision-1",
        "revision-2",
        "tr1_forbidden",
      ),
    ).toThrow("resident_source_target_revision_forbidden");
    expect(persistence.snapshot("post:post-1")).toMatchObject({
      documentRevision: "revision-1",
    });
  });

  it("rejects target metadata ACKs that advance shared authority or remove the target", () => {
    const advanced = targetFixture("tr1_target_1");
    expect(() =>
      advanced.persistence.acknowledgeMetadataRevision(
        "post:post-1:en",
        advanced.document,
        "document-revision-1",
        "document-revision-2",
        "tr1_target_2",
      ),
    ).toThrow("resident_target_document_revision_changed");

    const deleted = targetFixture("tr1_target_1");
    expect(() =>
      deleted.persistence.acknowledgeMetadataRevision(
        "post:post-1:en",
        deleted.document,
        "document-revision-1",
        "document-revision-1",
      ),
    ).toThrow("target_locale_deleted");
    expect(deleted.persistence.snapshot("post:post-1:en")).toMatchObject({
      localeExists: false,
    });
  });

  it("unregisters resident documents, invokes observer cleanup, and tolerates unknown unloads", () => {
    const { persistence, document, stopObserving } = fixture();
    persistence.unregister("post:other", document);
    expect(stopObserving).toHaveBeenCalledOnce();
    expect(() => persistence.snapshot("post:post-1")).not.toThrow();
    persistence.unregisterDocument("post:post-1");
    persistence.unregisterDocument("post:missing");
    persistence.unregister("post:missing", new Y.Doc());
    expect(persistence.snapshot("post:post-1")).toBeUndefined();
  });

  it("rejects unloaded and mismatched resident documents", async () => {
    const { persistence, document } = fixture();
    await expect(
      persistence.persist("post:other", document, []),
    ).rejects.toThrow("resident_document_not_loaded:post:other");
    await expect(
      persistence.persist("post:post-1", new Y.Doc(), []),
    ).rejects.toThrow("resident_document_not_loaded:post:post-1");
  });

  it("invokes the default observer cleanup on unregister", () => {
    const persistence = new ResidentBlockPersistence();
    const document = new Y.Doc();
    persistence.register(
      "post:default-cleanup",
      document,
      {
        documentRevision: "revision-1",
        sourceLocale: "en",
        locale: "en",
        localeExists: true,
        snapshot: snapshot(),
      },
      {
        ensureAuthority: vi.fn(),
        decodeFull: vi.fn(() => snapshot()),
        decodeAffected: vi.fn(() => changes("Source")),
        save: vi.fn(),
        checkpoint: vi.fn(),
      },
    );
    expect(() =>
      persistence.unregister("post:default-cleanup", document),
    ).not.toThrow();
  });
});
