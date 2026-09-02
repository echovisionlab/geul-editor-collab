import { MessageType, Server, type WebSocketLike } from "@hocuspocus/server";
import {
  createEncoder,
  toUint8Array,
  writeVarString,
  writeVarUint,
} from "lib0/encoding";
import { describe, expect, it, vi } from "vitest";
import {
  bindShutdownAdmissionsToHocuspocus,
  ShutdownConnectionDrain,
  ShutdownSocketAdmissionScope,
  shutdownSocketAdmissionScopeFromContext,
} from "./shutdown-connection-drain.ts";

interface FakeConnection {
  socketId: string;
}

function nextImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function authenticationFrame(documentName: string): Uint8Array {
  const encoder = createEncoder();
  writeVarString(encoder, documentName);
  writeVarUint(encoder, MessageType.Auth);
  writeVarUint(encoder, 0); // AuthMessageType.Token
  writeVarString(encoder, "test-token");
  return toUint8Array(encoder);
}

describe("ShutdownConnectionDrain", () => {
  it("drains an empty snapshot and returns the same drain promise on repeated begin", async () => {
    const drain = new ShutdownConnectionDrain<FakeConnection>();
    drain.disconnected("post:1", "unknown");

    const first = drain.begin([]);
    const second = drain.begin([]);

    expect(second).toBe(first);
    await expect(first).resolves.toBeUndefined();
  });

  it("deduplicates a tracked connection that is also present in the shutdown snapshot", async () => {
    const drain = new ShutdownConnectionDrain<FakeConnection>();
    const connection = { socketId: "socket-1" };
    expect(drain.connected("post:1", connection.socketId, connection)).toBe(
      false,
    );

    let completed = false;
    const draining = drain
      .begin([{ name: "post:1", getConnections: () => [connection] }])
      .then(() => {
        completed = true;
      });
    await nextImmediate();
    expect(completed).toBe(false);

    drain.disconnected("post:1", connection.socketId);
    await draining;
    expect(completed).toBe(true);
  });

  it("includes late connections and every connection sharing a socket key", async () => {
    const drain = new ShutdownConnectionDrain<FakeConnection>();
    const draining = drain.begin([]);
    const first = { socketId: "socket-1" };
    const second = { socketId: "socket-1" };

    expect(drain.connected("post:1", first.socketId, first)).toBe(true);
    expect(drain.connected("post:1", second.socketId, second)).toBe(true);
    await nextImmediate();

    let completed = false;
    void draining.then(() => {
      completed = true;
    });
    drain.disconnected("post:1", first.socketId);
    await nextImmediate();
    expect(completed).toBe(false);

    drain.disconnected("post:1", second.socketId);
    await draining;
    expect(completed).toBe(true);
  });

  it("waits for an in-flight admission to transfer into a late connection and disconnect", async () => {
    const drain = new ShutdownConnectionDrain<FakeConnection>();
    const admission = drain.beginAdmission("post:1", "socket-1");
    expect(admission).not.toBeNull();

    let completed = false;
    const draining = drain.begin([]).then(() => {
      completed = true;
    });
    await nextImmediate();
    expect(completed).toBe(false);

    const connection = { socketId: "socket-1" };
    expect(
      drain.connected("post:1", connection.socketId, connection, admission!),
    ).toBe(true);
    await nextImmediate();
    expect(completed).toBe(false);

    drain.disconnected("post:1", connection.socketId);
    await draining;
    expect(completed).toBe(true);
  });

  it("releases failed admissions and rejects new admissions after shutdown begins", async () => {
    const drain = new ShutdownConnectionDrain<FakeConnection>();
    const admission = drain.beginAdmission("post:1", "socket-1");
    expect(admission).not.toBeNull();
    const draining = drain.begin([]);
    expect(drain.beginAdmission("post:2", "socket-2")).toBeNull();

    drain.releaseAdmission(admission!);
    await expect(draining).resolves.toBeUndefined();
  });

  it("does not track a late connected hook after its admission was already released", async () => {
    const drain = new ShutdownConnectionDrain<FakeConnection>();
    const admission = drain.beginAdmission("post:1", "socket-1");
    expect(admission).not.toBeNull();
    const draining = drain.begin([]);

    drain.releaseAdmission(admission!);
    drain.disconnected("post:1", "socket-1");
    const connection = { socketId: "socket-1" };
    expect(
      drain.connected("post:1", connection.socketId, connection, admission!),
    ).toBe(true);

    await expect(draining).resolves.toBeUndefined();
  });

  it("releases an admission when the real Hocuspocus ClientConnection closes before authentication", async () => {
    let authenticationStarted!: () => void;
    let finishAuthentication!: () => void;
    const started = new Promise<void>((resolve) => {
      authenticationStarted = resolve;
    });
    const authenticationBarrier = new Promise<void>((resolve) => {
      finishAuthentication = resolve;
    });
    const onDisconnect = vi.fn();
    const drain = new ShutdownConnectionDrain<FakeConnection>();
    const server = new Server({
      quiet: true,
      stopOnSignals: false,
      async onAuthenticate({ context, documentName, socketId }) {
        const scope =
          shutdownSocketAdmissionScopeFromContext<FakeConnection>(context);
        expect(scope).toBeDefined();
        expect(scope!.beginAdmission(documentName, socketId)).not.toBeNull();
        authenticationStarted();
        await authenticationBarrier;
        return {};
      },
      async onDisconnect() {
        onDisconnect();
      },
    });
    bindShutdownAdmissionsToHocuspocus(server.hocuspocus, drain);

    let readyState = 1;
    const webSocket: WebSocketLike = {
      get readyState() {
        return readyState;
      },
      send: vi.fn(),
      close: vi.fn(() => {
        readyState = 3;
      }),
    };
    const clientConnection = server.hocuspocus.handleConnection(
      webSocket,
      new Request("http://collab.test"),
    );
    clientConnection.handleMessage(authenticationFrame("post:pre-auth-close"));
    await started;

    let completed = false;
    const draining = drain.begin([]).then(() => {
      completed = true;
    });
    await nextImmediate();
    expect(completed).toBe(false);

    readyState = 3;
    clientConnection.handleClose({ code: 1000, reason: "test close" });
    await draining;

    expect(completed).toBe(true);
    expect(onDisconnect).not.toHaveBeenCalled();

    finishAuthentication();
    await nextImmediate();
  });

  it("scopes release, connection transfer, and idempotent close to one physical socket", async () => {
    const drain = new ShutdownConnectionDrain<FakeConnection>();
    const scope = new ShutdownSocketAdmissionScope(drain);

    scope.releaseAdmission();
    const released = scope.beginAdmission("post:released", "socket-released");
    expect(released).not.toBeNull();
    scope.releaseAdmission(released!);

    const transferred = scope.beginAdmission(
      "post:connected",
      "socket-connected",
    );
    expect(transferred).not.toBeNull();
    const connection = { socketId: "socket-connected" };
    expect(
      scope.connected(
        "post:connected",
        connection.socketId,
        connection,
        transferred!,
      ),
    ).toBe(false);

    const pending = scope.beginAdmission("post:pending", "socket-pending");
    expect(pending).not.toBeNull();
    const draining = drain.begin([]);
    scope.close();
    scope.close();
    expect(scope.beginAdmission("post:closed", "socket-closed")).toBeNull();

    let completed = false;
    void draining.then(() => {
      completed = true;
    });
    await nextImmediate();
    expect(completed).toBe(false);
    drain.disconnected("post:connected", connection.socketId);
    await expect(draining).resolves.toBeUndefined();
  });

  it("reads admission scopes only from object contexts", () => {
    expect(shutdownSocketAdmissionScopeFromContext(undefined)).toBeUndefined();
    expect(shutdownSocketAdmissionScopeFromContext(null)).toBeUndefined();
    expect(shutdownSocketAdmissionScopeFromContext("context")).toBeUndefined();
    expect(shutdownSocketAdmissionScopeFromContext({})).toBeUndefined();
  });

  it("forwards absent admissions and an underlying drain rejection through the socket scope", async () => {
    const drain = new ShutdownConnectionDrain<FakeConnection>();
    const scope = new ShutdownSocketAdmissionScope(drain);
    const connection = { socketId: "socket-1" };
    expect(scope.connected("post:1", connection.socketId, connection)).toBe(
      false,
    );
    const draining = drain.begin([]);
    expect(scope.beginAdmission("post:2", "socket-2")).toBeNull();
    drain.disconnected("post:1", connection.socketId);
    await draining;
  });
});
