import {
  Connection,
  Document,
  IncomingMessage,
  MessageReceiver,
  OutgoingMessage,
} from "@hocuspocus/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { EditSessionContributorTracker } from "./edit-session-contributors.ts";
import { createConnectionHooks } from "./connection-hooks.ts";
import { isAttributedInboundMutation } from "./inbound-mutation.ts";

const name = "post:11111111-1111-4111-8111-111111111111:en";
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function fixture() {
  const document = new Document(name);
  const persist = vi.fn(
    async (
      _name: string,
      doc: Document,
      options: { contributorMemberIds?: string[] },
    ) => ({
      actors: options.contributorMemberIds,
      body: doc.getMap("body").toJSON(),
    }),
  );
  const tracker = new EditSessionContributorTracker<Document>({
    listDocuments: () => new Map([[name, document]]),
    loadDocument: async () => document,
    persistDocument: persist,
    withPersistenceQueue: async (_key, run) => {
      await run(persist);
    },
    unloadDocument: async () => undefined,
    supportsVersionCheckpoints: () => false,
    logFailure: vi.fn(),
    logTerminalCheckpointFailure: vi.fn(),
  });
  cleanups.push(() => {
    tracker.release();
    document.destroy();
  });
  const validate = vi.fn();
  const hooks = createConnectionHooks({
    editSessions: () => tracker,
    blockRooms: { connected: vi.fn(), beforeSync: validate },
    metadataAiGrace: {} as never,
    shutdownConnections: {} as never,
    isDocumentFenced: () => false,
    settlePendingRoomInvalidation: async () => undefined,
  });
  const changes: unknown[] = [];
  document.on("update", (_update, origin) => changes.push(origin));

  function connection(memberId: string) {
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
    const context = {
      member: { id: memberId },
      canEdit: true,
      blockRoomAdmissionState: "accepted" as const,
    };
    const client = new Connection(
      socket,
      new Request("http://collab.test"),
      document,
      memberId,
      context,
    );
    client.beforeSync((connection, payload) =>
      hooks.beforeSync!({
        connection,
        context,
        documentName: name,
        document,
        ...payload,
      } as never),
    );
    return client;
  }
  return { document, tracker, persist, validate, connection, changes };
}

function update(key: string, value: string): Uint8Array {
  const source = new Y.Doc();
  source.getMap("body").set(key, value);
  const result = Y.encodeStateAsUpdate(source);
  source.destroy();
  return result;
}

async function receive(connection: Connection, payload: Uint8Array) {
  const frame = new OutgoingMessage(name)
    .createSyncMessage()
    .writeUpdate(payload)
    .toUint8Array();
  const message = new IncomingMessage(frame);
  message.readVarString();
  await new MessageReceiver(message).apply(connection.document, connection);
}

describe("inbound document actor lane at the Hocuspocus MessageReceiver boundary", () => {
  it("persists the first actor before applying a simultaneously arriving second socket update", async () => {
    const { document, tracker, persist, connection, changes } = fixture();
    const first = connection("member-A");
    const second = connection("member-B");
    await Promise.all([
      receive(first, update("A", "first")),
      receive(second, update("B", "second")),
    ]);

    expect(persist).toHaveBeenCalledOnce();
    expect(await persist.mock.results[0]!.value).toEqual({
      actors: ["member-A"],
      body: { A: "first" },
    });
    expect(document.getMap("body").toJSON()).toEqual({
      A: "first",
      B: "second",
    });
    expect(changes).toHaveLength(2); // Receiver's normal duplicate replay never reapplies the mutation.
    expect(changes.every(isAttributedInboundMutation)).toBe(true);
    await tracker.persist(name, document);
    expect(await persist.mock.results[1]!.value).toEqual({
      actors: ["member-B"],
      body: { A: "first", B: "second" },
    });
  });

  it("keeps the second actor out while the first actor's durable write is pending", async () => {
    const { document, persist, connection } = fixture();
    let finish!: () => void;
    persist.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ actors: ["member-A"], body: {} });
        }),
    );
    await receive(connection("member-A"), update("A", "first"));
    const second = receive(connection("member-B"), update("B", "second"));
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(document.getMap("body").has("B")).toBe(false);
    finish();
    await second;
    expect(document.getMap("body").get("B")).toBe("second");
  });

  it("rejects a failed actor flush before apply and permits a later retry", async () => {
    const { document, persist, connection } = fixture();
    await receive(connection("member-A"), update("A", "first"));
    const second = connection("member-B");
    const secondUpdate = update("B", "second");
    persist.mockRejectedValueOnce(new Error("offline"));
    await expect(receive(second, secondUpdate)).rejects.toThrow("offline");
    expect(document.getMap("body").has("B")).toBe(false);
    await receive(second, secondUpdate);
    expect(document.getMap("body").get("B")).toBe("second");
  });

  it("does not attribute rejected or duplicate updates and revalidates after waiting", async () => {
    const { document, tracker, persist, connection, validate } = fixture();
    const first = connection("member-A");
    const payload = update("A", "first");
    validate.mockImplementationOnce(() => {
      throw new Error("invalid locale mutation");
    });
    await expect(receive(first, payload)).rejects.toThrow(
      "invalid locale mutation",
    );
    expect(document.getMap("body").size).toBe(0);
    await tracker.persist(name, document);
    expect(persist).not.toHaveBeenCalled();
    await receive(first, payload);
    await tracker.persist(name, document);
    persist.mockClear();
    await receive(connection("member-B"), payload);
    await tracker.persist(name, document);
    expect(persist).not.toHaveBeenCalled();
  });
});
