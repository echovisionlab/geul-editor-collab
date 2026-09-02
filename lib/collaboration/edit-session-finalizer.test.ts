import { describe, expect, it, vi } from "vitest";
import { CollaborationConflictError } from "../api/transport.ts";
import {
  finalizationFailureReason,
  persistEditSessionCheckpoint,
} from "./edit-session-finalizer.ts";

function fixture(
  canContinue: () => boolean = () => true,
  sourceDocumentIsCurrent: () => boolean = () => true,
) {
  const persistWith = vi.fn(async () => undefined);
  return {
    options: {
      entityDocumentName: "post:post-1",
      sourceDocument: { documentName: "post:post-1", document: {} },
      contributorMemberIds: ["member"],
      canContinue,
      sourceDocumentIsCurrent,
      persistWith,
      withPersistenceQueue: async (
        _queueKey: string,
        operation: (persist: typeof persistWith) => Promise<void>,
      ) => operation(persistWith),
    },
    persistWith,
  };
}

describe("source-only edit session checkpoint finalizer", () => {
  it("rejects an unavailable canonical source document", async () => {
    const { options } = fixture();
    await expect(
      persistEditSessionCheckpoint({ ...options, sourceDocument: undefined }),
    ).rejects.toThrow("source_document_unavailable");
  });

  it("stops before persistence when the generation is stale", async () => {
    const { options, persistWith } = fixture(() => false);
    await expect(persistEditSessionCheckpoint(options)).resolves.toBe(false);
    expect(persistWith).not.toHaveBeenCalled();
  });

  it("stops between autosave and checkpoint when a new edit arrives", async () => {
    const canContinue = vi
      .fn()
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    const { options, persistWith } = fixture(canContinue);
    await expect(persistEditSessionCheckpoint(options)).resolves.toBe(false);
    expect(persistWith).toHaveBeenCalledOnce();
  });

  it("rejects a source document that is no longer current after checkpoint", async () => {
    const { options, persistWith } = fixture(
      () => true,
      () => false,
    );
    await expect(persistEditSessionCheckpoint(options)).rejects.toThrow(
      "source_document_unavailable",
    );
    expect(persistWith).toHaveBeenCalledTimes(2);
  });

  it("classifies typed conflicts, source absence, and generic failures", () => {
    expect(
      finalizationFailureReason(
        new CollaborationConflictError("target_revision_changed"),
      ),
    ).toBe("target_revision_changed");
    expect(
      finalizationFailureReason(
        new CollaborationConflictError("document_revision_changed"),
      ),
    ).toBe("document_revision_changed");
    expect(
      finalizationFailureReason(
        new CollaborationConflictError("room_ownership_lost" as never),
      ),
    ).toBe("persist_failed");
    expect(
      finalizationFailureReason(new Error("source_document_unavailable")),
    ).toBe("source_document_unavailable");
    expect(finalizationFailureReason("failure")).toBe("persist_failed");
  });
});
