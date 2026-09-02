import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createDocumentHooks } from "./document-hooks.ts";

const SESSION_ID = "33333333-3333-4333-8333-333333333333";

describe("resident document load hook", () => {
  it("delegates resident Block documents to the aggregate runtime", async () => {
    const load = vi.fn().mockResolvedValue(undefined);
    const loaded = vi.fn();
    const hooks = createDocumentHooks({
      editSessions: () => ({
        persist: vi.fn(),
        recordAcceptedChange: vi.fn(),
        preventsUnload: vi.fn(),
        documentUnloaded: vi.fn(),
      }),
      metadataAiGrace: { loaded } as never,
      revisionConflicts: {
        isStale: vi.fn(() => false),
        fencedDocumentNames: new Set<string>(),
        unfence: vi.fn(),
      } as never,
      shutdownConnections: { releaseAdmission: vi.fn() } as never,
      roomEpochs: { retire: vi.fn() } as never,
      residentBlocks: { load, unload: vi.fn() } as never,
      blockRooms: {} as never,
      roomOwnership: {
        acquire: vi.fn(),
        isOwned: vi.fn(() => true),
        release: vi.fn(),
        close: vi.fn(),
      },
      ownedDocuments: new Map(),
      clearPendingRoomInvalidation: vi.fn(),
    });
    const document = new Y.Doc();
    const documentName = `post:11111111-1111-4111-8111-111111111111:ko`;
    await expect(
      hooks.onLoadDocument!({
        documentName,
        document,
        context: { sessionId: SESSION_ID },
      } as never),
    ).resolves.toBe(document);
    expect(load).toHaveBeenCalledWith(
      documentName,
      document,
      expect.objectContaining({ sessionId: SESSION_ID }),
    );
    expect(loaded).toHaveBeenCalledWith(document);
    expect(CollaborativeDocumentType.POST).toBeDefined();
  });

  it.each([
    ["missing", {}],
    ["invalid", { sessionId: "not-a-uuid" }],
    ["null", null],
    ["non-object", "not-an-object"],
  ])("refuses a resident load with a %s session", async (_name, context) => {
    const load = vi.fn().mockResolvedValue(undefined);
    const hooks = createDocumentHooks({
      editSessions: () => ({
        persist: vi.fn(),
        recordAcceptedChange: vi.fn(),
        preventsUnload: vi.fn(),
        documentUnloaded: vi.fn(),
      }),
      metadataAiGrace: { loaded: vi.fn() } as never,
      revisionConflicts: {
        isStale: vi.fn(() => false),
        fencedDocumentNames: new Set<string>(),
        unfence: vi.fn(),
      } as never,
      shutdownConnections: { releaseAdmission: vi.fn() } as never,
      roomEpochs: { retire: vi.fn() } as never,
      residentBlocks: { load, unload: vi.fn() } as never,
      blockRooms: {} as never,
      roomOwnership: {
        acquire: vi.fn(),
        isOwned: vi.fn(() => true),
        release: vi.fn(),
        close: vi.fn(),
      },
      ownedDocuments: new Map(),
      clearPendingRoomInvalidation: vi.fn(),
    });

    await expect(
      hooks.onLoadDocument?.({
        documentName: "post:11111111-1111-4111-8111-111111111111:ko",
        document: new Y.Doc(),
        context,
      } as never),
    ).rejects.toThrow("collaboration_session_required");
    expect(load).not.toHaveBeenCalled();
  });
});
