import {
  CollaborativeDocumentType,
  createDocumentName,
  type DocumentSaveOptions,
} from "@echovisionlab/geul-common/collaboration/document";
import type { Connection } from "@hocuspocus/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createConnectionHooks } from "./connection-hooks.ts";
import { createDocumentHooks } from "./document-hooks.ts";
import {
  EditSessionContributorTracker,
  EditSessionEntityDeletedError,
  type AcceptedDocumentChange,
  type EditSessionDocumentLike,
} from "./edit-session-contributors.ts";
import {
  applyInboundMutation,
  isAttributedInboundMutation,
} from "./inbound-mutation.ts";

const documentName = createDocumentName(
  CollaborativeDocumentType.POST,
  "11111111-1111-4111-8111-111111111111",
  "en",
);

type TestDocument = EditSessionDocumentLike;

const cleanups: (() => void)[] = [];

afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function contributorTracker() {
  const document: TestDocument = { getConnections: () => [] };
  const persistDocument: (
    name: string,
    value: TestDocument,
    options: DocumentSaveOptions,
  ) => Promise<unknown> = vi.fn(async () => undefined);
  const tracker = new EditSessionContributorTracker<TestDocument>({
    listDocuments: () => [[documentName, document]],
    loadDocument: async (name) => (name === documentName ? document : null),
    persistDocument,
    withPersistenceQueue: async (_key, operation) => {
      await operation((name, value, options) =>
        persistDocument(name, value, options),
      );
    },
    unloadDocument: async () => undefined,
    supportsVersionCheckpoints: () => false,
    logFailure: vi.fn(),
    logTerminalCheckpointFailure: vi.fn(),
  });
  cleanups.push(() => tracker.release());
  return { document, persistDocument, tracker };
}

function acceptedChange(
  context: unknown = { member: { id: "member-a" } },
): AcceptedDocumentChange {
  return {
    documentName,
    connection: {},
    context,
    transactionOrigin: { source: "connection" },
  };
}

describe("inbound mutation boundary guards", () => {
  it("rejects missing actors and leaves the document lane available for a no-op retry", async () => {
    const { document, tracker } = contributorTracker();
    const apply = vi.fn(() => true);

    await expect(
      tracker.applyAcceptedMutation(document, acceptedChange({}), apply),
    ).rejects.toThrow("collaboration_mutation_actor_required");
    expect(apply).not.toHaveBeenCalled();

    await tracker.applyAcceptedMutation(
      document,
      acceptedChange(),
      () => false,
    );
    expect(tracker.contributorMemberIds(documentName)).toEqual([]);
  });

  it("rejects deletion that begins before an accepted mutation applies", async () => {
    const { document, tracker } = contributorTracker();
    const apply = vi.fn(() => true);
    const deletion = vi
      .spyOn(
        tracker as unknown as { isDeletedEntity(name: string): boolean },
        "isDeletedEntity",
      )
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    await expect(
      tracker.applyAcceptedMutation(document, acceptedChange(), apply),
    ).rejects.toBeInstanceOf(EditSessionEntityDeletedError);
    expect(apply).not.toHaveBeenCalled();

    deletion.mockRestore();
    await tracker.applyAcceptedMutation(document, acceptedChange(), apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(tracker.contributorMemberIds(documentName)).toEqual(["member-a"]);
  });

  it("rechecks permission after an admitted mutation waits in the actor lane", async () => {
    const document = new Y.Doc();
    cleanups.push(() => document.destroy());
    const context = {
      blockRoomAdmissionState: "accepted",
      canEdit: true,
      member: { id: "member-a" },
    };
    const beforeSync = vi.fn();
    const applyAcceptedMutation = vi.fn(
      async (
        _document: Y.Doc,
        _change: AcceptedDocumentChange,
        apply: () => boolean,
      ) => {
        context.canEdit = false;
        apply();
      },
    );
    const hooks = createConnectionHooks({
      shutdownConnections: {} as never,
      metadataAiGrace: {} as never,
      editSessions: () => ({
        connected: vi.fn(),
        disconnected: vi.fn(),
        applyAcceptedMutation,
      }),
      blockRooms: { connected: vi.fn(), beforeSync } as never,
      isDocumentFenced: () => false,
      settlePendingRoomInvalidation: async () => undefined,
    });

    await expect(
      hooks.beforeSync!({
        connection: { document, readOnly: false } as Connection,
        context,
        documentName,
        document,
        type: 2,
        payload: Uint8Array.of(0),
      } as never),
    ).rejects.toThrow("permission_denied");
    expect(beforeSync).toHaveBeenCalledOnce();
    expect(document.share.size).toBe(0);
  });

  it("does not attribute the onChange echo of an actor-lane mutation twice", async () => {
    const document = new Y.Doc();
    const source = new Y.Doc();
    cleanups.push(
      () => document.destroy(),
      () => source.destroy(),
    );
    source.getMap("body").set("key", "value");
    const inboundUpdate = Y.encodeStateAsUpdate(source);
    let transactionOrigin: unknown;
    document.on("update", (_update, origin) => {
      transactionOrigin = origin;
    });
    expect(
      applyInboundMutation(document, {} as Connection, inboundUpdate),
    ).toBe(true);
    expect(isAttributedInboundMutation(transactionOrigin)).toBe(true);

    const recordAcceptedChange = vi.fn(() => true);
    const hooks = createDocumentHooks({
      editSessions: () => ({ recordAcceptedChange }),
    } as never);
    const basePayload = {
      documentName,
      connection: {} as Connection,
      context: { canEdit: true },
    };
    await hooks.onChange!({
      ...basePayload,
      transactionOrigin,
    } as never);
    expect(recordAcceptedChange).not.toHaveBeenCalled();

    await hooks.onChange!({
      ...basePayload,
      transactionOrigin: { source: "local" },
    } as never);
    expect(recordAcceptedChange).toHaveBeenCalledOnce();
  });
});
