import {
  CollaborativeDocumentType,
  createDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import type { Server } from "@hocuspocus/server";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createRoomInvalidation } from "./room-invalidation.ts";

describe("room invalidation", () => {
  it("preserves only the accepted exact room while retiring sibling locales", async () => {
    const entityId = "11111111-1111-4111-8111-111111111111";
    const preserved = createDocumentName(
      CollaborativeDocumentType.POST,
      entityId,
      "ko",
    );
    const sibling = createDocumentName(
      CollaborativeDocumentType.POST,
      entityId,
      "en",
    );
    const preservedDocument = new Y.Doc();
    const siblingDocument = new Y.Doc();
    const server = {
      hocuspocus: {
        loadingDocuments: new Map(),
        documents: new Map([
          [preserved, preservedDocument],
          [sibling, siblingDocument],
        ]),
      },
    } as unknown as Server;
    const requireReload = vi.fn();
    const invalidateGrace = vi.fn();
    const resourceInvalidated = vi.fn(async () => undefined);
    const invalidation = createRoomInvalidation(
      server,
      new Map(),
      { requireReload, fencePendingLoad: vi.fn() } as never,
      { invalidate: invalidateGrace } as never,
      { resourceInvalidated } as never,
    );

    await expect(
      invalidation.invalidateEntityExcept(
        CollaborativeDocumentType.POST,
        entityId,
        preserved,
      ),
    ).resolves.toBe(true);
    expect(requireReload).toHaveBeenCalledOnce();
    expect(requireReload).toHaveBeenCalledWith(
      "authoritative_document_changed",
      sibling,
      siblingDocument,
    );
    expect(invalidateGrace).toHaveBeenCalledWith(siblingDocument);
    expect(resourceInvalidated).toHaveBeenCalledWith(sibling);
  });
});
