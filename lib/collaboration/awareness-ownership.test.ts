import {
  Connection,
  Document,
  IncomingMessage,
  MessageReceiver,
  OutgoingMessage,
  type WebSocketLike,
} from "@hocuspocus/server";
import { Awareness } from "y-protocols/awareness";
import {
  createEncoder,
  toUint8Array,
  writeVarString,
  writeVarUint,
  writeVarUint8Array,
} from "lib0/encoding";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { AwarenessConnectionOwnership } from "./awareness-ownership.ts";

interface Context {
  member: { id: string };
}

function connectionFixture(
  document: Document,
  socketId: string,
  memberId: string,
) {
  const webSocket: WebSocketLike = {
    readyState: 1,
    send: vi.fn(),
    close: vi.fn(),
  };
  return new Connection(
    webSocket,
    new Request("http://collab.test"),
    document,
    socketId,
    { member: { id: memberId } },
  );
}

function awarenessFrame(
  documentName: string,
  clientId: number,
  states: ReadonlyArray<Record<string, unknown> | null>,
): Uint8Array {
  const sourceDocument = new Y.Doc();
  sourceDocument.clientID = clientId;
  const awareness = new Awareness(sourceDocument);
  for (const state of states) {
    awareness.setLocalState(state);
  }
  const frame = new OutgoingMessage(documentName)
    .createAwarenessUpdateMessage(awareness, [clientId])
    .toUint8Array();
  awareness.destroy();
  sourceDocument.destroy();
  return frame;
}

function rawAwarenessFrame(
  documentName: string,
  clientId: number,
  state: unknown,
): Uint8Array {
  const update = createEncoder();
  writeVarUint(update, 1);
  writeVarUint(update, clientId);
  writeVarUint(update, 1);
  writeVarString(update, JSON.stringify(state));
  const frame = createEncoder();
  writeVarString(frame, documentName);
  writeVarUint(frame, 1); // MessageType.Awareness
  writeVarUint8Array(frame, toUint8Array(update));
  return toUint8Array(frame);
}

function nonAwarenessFrame(documentName: string): Uint8Array {
  const frame = createEncoder();
  writeVarString(frame, documentName);
  writeVarUint(frame, 0); // MessageType.Sync
  return toUint8Array(frame);
}

async function applyFrame(
  ownership: AwarenessConnectionOwnership<Context>,
  connection: Connection<Context>,
  frame: Uint8Array,
): Promise<void> {
  ownership.prepareInboundMessage(connection, frame);
  const message = new IncomingMessage(frame);
  message.readVarString();
  await new MessageReceiver(message).apply(connection.document, connection);
}

describe("awareness connection ownership", () => {
  it("binds client IDs at the real MessageReceiver boundary and rejects cross-connection updates and removals", async () => {
    const document = new Document("post:entity-1");
    const ownership = new AwarenessConnectionOwnership<Context>();
    const first = connectionFixture(document, "socket-1", "member-1");
    const second = connectionFixture(document, "socket-2", "member-2");
    document.beforeHandleAwareness((_document, states, origin) => {
      ownership.rewriteOwnedStates(states, origin, (state) => ({
        ...state,
        user: {
          id: (origin as { connection: Connection<Context> }).connection.context
            .member.id,
        },
      }));
      return Promise.resolve();
    });

    await applyFrame(
      ownership,
      first,
      awarenessFrame(document.name, 101, [
        { user: { id: "spoofed" }, cursor: 1 },
      ]),
    );
    expect(document.awareness.getStates().get(101)).toEqual({
      user: { id: "member-1" },
      cursor: 1,
    });

    const foreignUpdate = awarenessFrame(document.name, 101, [
      { cursor: 1 },
      { cursor: 2 },
    ]);
    expect(() =>
      ownership.prepareInboundMessage(second, foreignUpdate),
    ).toThrow("Awareness client ID belongs to another connection");

    const foreignRemoval = awarenessFrame(document.name, 101, [
      { cursor: 1 },
      null,
    ]);
    expect(() =>
      ownership.prepareInboundMessage(second, foreignRemoval),
    ).toThrow("Awareness client ID belongs to another connection");
    expect(document.awareness.getStates().get(101)).toEqual({
      user: { id: "member-1" },
      cursor: 1,
    });

    first.close();
    second.close();
    document.destroy();
  });

  it("applies an owned null removal before Hocuspocus scratch re-encoding can lose it", async () => {
    const document = new Document("post:entity-1");
    const ownership = new AwarenessConnectionOwnership<Context>();
    const connection = connectionFixture(document, "socket-1", "member-1");
    document.beforeHandleAwareness((_document, states, origin) => {
      ownership.rewriteOwnedStates(states, origin, (state) => state);
      return Promise.resolve();
    });

    await applyFrame(
      ownership,
      connection,
      awarenessFrame(document.name, 202, [{ cursor: 1 }]),
    );
    expect(document.awareness.getStates().has(202)).toBe(true);

    await applyFrame(
      ownership,
      connection,
      awarenessFrame(document.name, 202, [{ cursor: 1 }, null]),
    );
    expect(document.awareness.getStates().has(202)).toBe(false);
    expect(document.getClients(connection).has(202)).toBe(false);

    connection.close();
    document.destroy();
  });

  it("ignores non-awareness frames and rejects non-object awareness state", () => {
    const document = new Document("post:entity-1");
    const ownership = new AwarenessConnectionOwnership<Context>();
    const connection = connectionFixture(document, "socket-1", "member-1");

    expect(() =>
      ownership.prepareInboundMessage(
        connection,
        nonAwarenessFrame(document.name),
      ),
    ).not.toThrow();
    expect(() =>
      ownership.prepareInboundMessage(
        connection,
        rawAwarenessFrame(document.name, 303, ["invalid"]),
      ),
    ).toThrow("Invalid awareness state");
    expect(() =>
      ownership.prepareInboundMessage(
        connection,
        rawAwarenessFrame(document.name, 404, null),
      ),
    ).not.toThrow();

    connection.close();
    document.destroy();
  });

  it("clears server-origin states and releases only the disconnected connection ownership", () => {
    const document = new Document("post:entity-1");
    const ownership = new AwarenessConnectionOwnership<Context>();
    const first = connectionFixture(document, "socket-1", "member-1");
    const second = connectionFixture(document, "socket-2", "member-2");

    const serverStates = new Map([[1, { cursor: 1 }]]);
    ownership.rewriteOwnedStates(serverStates, undefined, (state) => state);
    expect(serverStates.size).toBe(0);

    ownership.rewriteOwnedStates(
      new Map([[101, { cursor: 1 }]]),
      { source: "connection", connection: first },
      (state) => state,
    );
    ownership.rewriteOwnedStates(
      new Map([[202, { cursor: 2 }]]),
      { source: "connection", connection: second },
      (state) => state,
    );
    expect(() =>
      ownership.rewriteOwnedStates(
        new Map([[101, { cursor: 3 }]]),
        { source: "connection", connection: second },
        (state) => state,
      ),
    ).toThrow("Awareness client ID belongs to another connection");

    ownership.disconnected(first);
    expect(() =>
      ownership.rewriteOwnedStates(
        new Map([[101, { cursor: 4 }]]),
        { source: "connection", connection: second },
        (state) => state,
      ),
    ).not.toThrow();
    ownership.disconnected(second);
    ownership.disconnected(second);

    first.close();
    second.close();
    document.destroy();
  });
});
