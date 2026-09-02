import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CollaborationConflictError } from "../api/transport.ts";
import { RevisionConflictGuard } from "./revision-conflict-guard.ts";

const mocks = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    system: vi.fn(),
  },
}));

vi.mock("../logger.ts", () => ({ logger: mocks.logger }));

const DOCUMENT_NAME = "post:11111111-1111-4111-8111-111111111111:en";

function connectedDocument() {
  const sendStateless = vi.fn();
  const close = vi.fn();
  const document = new Y.Doc() as Y.Doc & {
    getConnections(): Iterable<{
      sendStateless: typeof sendStateless;
      close: typeof close;
    }>;
  };
  Object.defineProperty(document, "getConnections", {
    value: () => [{ sendStateless, close }],
  });
  return { close, document, sendStateless };
}

describe("RevisionConflictGuard entity fence", () => {
  it("fences the canonical source room after one typed checkpoint conflict", () => {
    const source = connectedDocument();
    const guard = new RevisionConflictGuard();
    const conflict = new CollaborationConflictError(
      "target_revision_changed",
      "api_target_revision_changed",
    );

    expect(
      guard.handleEntity(conflict, DOCUMENT_NAME, [
        { documentName: DOCUMENT_NAME, document: source.document },
      ]),
    ).toBe(true);

    for (const room of [source]) {
      expect(room.sendStateless).toHaveBeenCalledWith(
        JSON.stringify({ kind: "reload_required", reason: "reload_required" }),
      );
      expect(room.close).toHaveBeenCalledOnce();
      expect(guard.isStale(room.document)).toBe(true);
    }
    expect(guard.fencedDocumentNames).toEqual(new Set([DOCUMENT_NAME]));
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Collaboration revision conflict requires reload",
      expect.objectContaining({
        reason: "target_revision_changed",
        conflict_detail: "api_target_revision_changed",
      }),
    );
  });

  it("does not fence an ordinary persistence failure", () => {
    const shared = connectedDocument();
    const guard = new RevisionConflictGuard();

    expect(
      guard.handleEntity(new Error("database unavailable"), DOCUMENT_NAME, [
        { documentName: DOCUMENT_NAME, document: shared.document },
      ]),
    ).toBe(false);
    expect(shared.close).not.toHaveBeenCalled();
  });

  it("does not report a typed conflict as handled when no resident document exists", () => {
    const guard = new RevisionConflictGuard();

    expect(
      guard.handleEntity(
        new CollaborationConflictError("target_revision_changed"),
        DOCUMENT_NAME,
        [],
      ),
    ).toBe(false);
    expect(guard.fencedDocumentNames).toEqual(new Set());
  });

  it("requires reload when the ephemeral room owner session is lost", () => {
    const room = connectedDocument();
    const guard = new RevisionConflictGuard();

    guard.requireReload("room_ownership_lost", DOCUMENT_NAME, room.document);

    expect(room.sendStateless).toHaveBeenCalledWith(
      JSON.stringify({ kind: "reload_required", reason: "reload_required" }),
    );
    expect(room.close).toHaveBeenCalledOnce();
    expect(guard.fencedDocumentNames).toContain(DOCUMENT_NAME);
  });

  it("continues fencing remaining connections when one socket close throws", () => {
    const firstClose = vi.fn(() => {
      throw new Error("socket close failed");
    });
    const secondClose = vi.fn();
    const document = Object.assign(new Y.Doc(), {
      getConnections: () => [
        { sendStateless: vi.fn(), close: firstClose },
        { sendStateless: vi.fn(), close: secondClose },
      ],
    });
    const guard = new RevisionConflictGuard();

    expect(() =>
      guard.requireReload("room_ownership_lost", DOCUMENT_NAME, document),
    ).not.toThrow();

    expect(firstClose).toHaveBeenCalledOnce();
    expect(secondClose).toHaveBeenCalledOnce();
    expect(guard.fencedDocumentNames).toContain(DOCUMENT_NAME);
  });
});
