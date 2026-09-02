import {
  Hocuspocus,
  type Document as HocuspocusDocument,
} from "@hocuspocus/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDocumentHooks } from "./document-hooks.ts";

function guardedHocuspocus(
  editSessionActive: boolean,
  metadataAiReconnectGrace: boolean,
) {
  const hooks = createDocumentHooks({
    editSessions: () => ({
      preventsUnload: vi.fn(() => editSessionActive),
    }),
    metadataAiGrace: {
      preventsUnload: vi.fn(() => metadataAiReconnectGrace),
    },
  } as never);
  return new Hocuspocus({
    beforeUnloadDocument: hooks.beforeUnloadDocument,
  });
}

function disconnectedDocument(name: string) {
  return {
    name,
    destroy: vi.fn(),
    getConnectionsCount: vi.fn(() => 0),
    saveMutex: { isLocked: vi.fn(() => false) },
  } as unknown as HocuspocusDocument;
}

describe("document unload guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["active edit session", true, false],
    ["metadata AI reconnect grace", false, true],
  ] as const)(
    "keeps the document resident without reporting %s as a hook error",
    async (_guard, editSessionActive, metadataAiReconnectGrace) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const hocuspocus = guardedHocuspocus(
        editSessionActive,
        metadataAiReconnectGrace,
      );
      const document = disconnectedDocument("post:entity-1");
      hocuspocus.documents.set(document.name, document);

      await expect(
        hocuspocus.unloadDocument(document),
      ).resolves.toBeUndefined();

      expect(hocuspocus.documents.get(document.name)).toBe(document);
      expect(document.destroy).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    },
  );
});
