import { beforeEach, describe, expect, it, vi } from "vitest";

type Notification = { channel: string; payload?: string };

const mocks = vi.hoisted(() => ({
  pool: {
    query: vi.fn(),
    end: vi.fn(),
  },
  client: {
    connect: vi.fn(),
    query: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    end: vi.fn(),
  },
  pgmq: {
    read: vi.fn(),
    complete: vi.fn(),
    retry: vi.fn(),
    deadLetter: vi.fn(),
  },
  assertEnvelope: vi.fn(),
  envelopePayload: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), system: vi.fn() },
  notification: undefined as ((notification: Notification) => void) | undefined,
  onceListeners: new Map<string, (...arguments_: unknown[]) => void>(),
}));

vi.mock("pg", () => ({
  Pool: vi.fn(function Pool() {
    return mocks.pool;
  }),
  Client: vi.fn(function Client() {
    return mocks.client;
  }),
}));

vi.mock("@echovisionlab/geul-event", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@echovisionlab/geul-event")>()),
  PgmqClient: vi.fn(function PgmqClient() {
    return mocks.pgmq;
  }),
  assertPgmqEnvelope: mocks.assertEnvelope,
  pgmqEnvelopePayload: mocks.envelopePayload,
}));

vi.mock("../../env.ts", () => ({ env: { DATABASE_DSN: "postgres://test" } }));
vi.mock("../logger.ts", () => ({ logger: mocks.logger }));

const envelope = {
  message_id: "command-1",
  message_type: "api.manage.v1.Command",
  schema_version: 1 as const,
  created_at: "2026-08-14T00:00:00.000Z",
  payload_base64: "AQ==",
};
const expectedMessageType = envelope.message_type;
const message = {
  transportId: 42n,
  readCount: 1,
  enqueuedAt: new Date("2026-08-14T00:00:00Z"),
  visibleAt: new Date("2026-08-14T00:01:00Z"),
  envelope,
  headers: {},
};

async function loadMessaging() {
  vi.resetModules();
  return import("./messaging.ts");
}

function configureClientListeners(): void {
  mocks.client.on.mockImplementation((event, listener) => {
    if (event === "notification") mocks.notification = listener;
    return mocks.client;
  });
  mocks.client.once.mockImplementation((event, listener) => {
    mocks.onceListeners.set(event, listener);
    return mocks.client;
  });
  mocks.client.end.mockImplementation(async () => {
    mocks.onceListeners.get("end")?.();
  });
}

function systemEvents(): string[] {
  return mocks.logger.system.mock.calls.map((call) => call[1]?.event as string);
}

async function stopWorker(
  messaging: Awaited<ReturnType<typeof loadMessaging>>,
): Promise<void> {
  await messaging.stopMessagingConsumers(1_000);
  await messaging.closeMessaging();
}

describe("PostgreSQL messaging runtime", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.onceListeners.clear();
    mocks.notification = undefined;
    mocks.pool.query.mockResolvedValue({ rows: [] });
    mocks.pool.end.mockResolvedValue(undefined);
    mocks.client.connect.mockResolvedValue(undefined);
    mocks.client.query.mockResolvedValue({ rows: [] });
    mocks.client.end.mockResolvedValue(undefined);
    mocks.pgmq.read.mockResolvedValue([]);
    mocks.pgmq.complete.mockResolvedValue(undefined);
    mocks.pgmq.retry.mockResolvedValue(undefined);
    mocks.pgmq.deadLetter.mockResolvedValue(undefined);
    mocks.envelopePayload.mockReturnValue(new Uint8Array([1]));
    configureClientListeners();
  });

  it("reads, completes, and drains a durable PGMQ delivery", async () => {
    const correlated = {
      ...message,
      headers: { "x-request-id": "123e4567-e89b-42d3-a456-426614174000" },
    };
    mocks.pgmq.read.mockResolvedValueOnce([correlated]).mockResolvedValue([]);
    const handle = vi.fn().mockResolvedValue(undefined);
    const messaging = await loadMessaging();

    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      workers: 0,
      handle,
    });
    await vi.waitFor(() =>
      expect(mocks.pgmq.complete).toHaveBeenCalledWith(
        mocks.pool,
        "work.queue",
        42n,
      ),
    );

    expect(mocks.pool.query).toHaveBeenCalledWith(
      "SELECT total_messages FROM pgmq.metrics($1)",
      ["work.queue"],
    );
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        transportId: 42n,
        readCount: 1,
        envelope,
        payload: new Uint8Array([1]),
      }),
    );
    expect(systemEvents()).toContain("queue.delivery.succeeded");
    expect(mocks.logger.system).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        request_id: "123e4567-e89b-42d3-a456-426614174000",
      }),
    );
    await stopWorker(messaging);
  });

  it("uses set_vt with bounded defaults when a handler fails", async () => {
    mocks.pgmq.read
      .mockResolvedValueOnce([{ ...message, readCount: 2 }])
      .mockResolvedValue([]);
    const handle = vi.fn().mockRejectedValue("temporary");
    const messaging = await loadMessaging();

    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      retryDelaySeconds: 0,
      retryBackoff: 3,
      handle,
    });
    await vi.waitFor(() =>
      expect(mocks.pgmq.retry).toHaveBeenCalledWith(
        mocks.pool,
        "work.queue",
        42n,
        3,
      ),
    );
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "PGMQ delivery scheduled for retry",
      expect.objectContaining({
        queue: "work.queue",
        messageId: "command-1",
        retryCount: 2,
        delaySeconds: 3,
        error: "temporary",
      }),
    );
    expect(systemEvents()).toEqual(
      expect.arrayContaining([
        "queue.retry.accepted",
        "queue.delivery.requeued",
      ]),
    );
    await stopWorker(messaging);
  });

  it("archives an exhausted non-Error delivery failure", async () => {
    mocks.pgmq.read
      .mockResolvedValueOnce([{ ...message, readCount: 4 }])
      .mockResolvedValue([]);
    const messaging = await loadMessaging();

    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      retryBackoff: 1,
      handle: vi.fn().mockRejectedValue("terminal"),
    });
    await vi.waitFor(() =>
      expect(mocks.pgmq.deadLetter).toHaveBeenCalledWith(
        mocks.pool,
        "work.queue",
        42n,
      ),
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "PGMQ delivery archived",
      expect.objectContaining({ retryCount: 3, error: "terminal" }),
    );
    expect(systemEvents()).toEqual(
      expect.arrayContaining(["queue.dlq.accepted", "queue.delivery.failed"]),
    );
    await stopWorker(messaging);
  });

  it("archives a malformed shared envelope immediately with a safe telemetry identity", async () => {
    mocks.pgmq.read
      .mockResolvedValueOnce([
        {
          ...message,
          envelope: undefined,
          contractError: "PGMQ envelope message_type is required",
        },
      ])
      .mockResolvedValue([]);
    const handle = vi.fn();
    const messaging = await loadMessaging();

    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      handle,
    });

    await vi.waitFor(() =>
      expect(mocks.pgmq.deadLetter).toHaveBeenCalledWith(
        mocks.pool,
        "work.queue",
        42n,
      ),
    );
    expect(handle).not.toHaveBeenCalled();
    expect(mocks.envelopePayload).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "PGMQ delivery archived",
      expect.objectContaining({
        messageId: "transport:42",
        error: "PGMQ envelope message_type is required",
      }),
    );
    const dlqRecord = mocks.logger.system.mock.calls
      .map((call) => call[1])
      .find((record) => record?.event === "queue.dlq.accepted");
    expect(dlqRecord).toEqual(
      expect.objectContaining({
        message_id: "transport:42",
        command_id: "transport:42",
      }),
    );
    await stopWorker(messaging);
  });

  it("archives a missing envelope even when the shared client has no contract detail", async () => {
    mocks.pgmq.read
      .mockResolvedValueOnce([
        {
          ...message,
          envelope: undefined,
        },
      ])
      .mockResolvedValue([]);
    const messaging = await loadMessaging();

    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      handle: vi.fn(),
    });

    await vi.waitFor(() =>
      expect(mocks.pgmq.deadLetter).toHaveBeenCalledWith(
        mocks.pool,
        "work.queue",
        42n,
      ),
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "PGMQ delivery archived",
      expect.objectContaining({ error: "PGMQ envelope is missing" }),
    );
    await stopWorker(messaging);
  });

  it("archives an unexpected queue message_type before protobuf decoding", async () => {
    mocks.pgmq.read
      .mockResolvedValueOnce([
        {
          ...message,
          envelope: { ...envelope, message_type: "api.manage.v1.OtherCommand" },
        },
      ])
      .mockResolvedValue([]);
    const handle = vi.fn();
    const messaging = await loadMessaging();

    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      handle,
    });

    await vi.waitFor(() =>
      expect(mocks.pgmq.deadLetter).toHaveBeenCalledOnce(),
    );
    expect(handle).not.toHaveBeenCalled();
    expect(mocks.envelopePayload).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "PGMQ delivery archived",
      expect.objectContaining({
        messageId: "command-1",
        error: expect.stringContaining("Unexpected PGMQ message_type"),
      }),
    );
    await stopWorker(messaging);
  });

  it("records completion failures without retrying an already handled delivery", async () => {
    mocks.pgmq.read.mockResolvedValueOnce([message]).mockResolvedValue([]);
    mocks.pgmq.complete.mockRejectedValueOnce(new Error("delete failed"));
    const handle = vi.fn().mockResolvedValue(undefined);
    const messaging = await loadMessaging();

    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      handle,
    });

    await vi.waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "PGMQ delivery completion failed",
        expect.objectContaining({ error: "delete failed" }),
      ),
    );
    expect(mocks.pgmq.retry).not.toHaveBeenCalled();
    expect(mocks.pgmq.deadLetter).not.toHaveBeenCalled();
    const failureRecord = mocks.logger.system.mock.calls
      .map((call) => call[1])
      .find((record) => record?.event === "queue.delivery.failed");
    expect(failureRecord).toEqual(
      expect.objectContaining({ reason: "completion_failed" }),
    );
    await stopWorker(messaging);
  });

  it("normalizes non-Error completion, retry, and archive failures", async () => {
    const completion = await loadMessaging();
    mocks.pgmq.read.mockResolvedValueOnce([message]).mockResolvedValue([]);
    mocks.pgmq.complete.mockRejectedValueOnce("delete failed");
    await completion.startQueueConsumer({
      queue: "complete.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      handle: vi.fn(),
    });
    await vi.waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "PGMQ delivery completion failed",
        expect.objectContaining({ error: "delete failed" }),
      ),
    );
    await stopWorker(completion);

    vi.clearAllMocks();
    mocks.pool.query.mockResolvedValue({ rows: [] });
    mocks.pool.end.mockResolvedValue(undefined);
    mocks.pgmq.read.mockResolvedValueOnce([message]).mockResolvedValue([]);
    mocks.pgmq.retry.mockRejectedValueOnce("set_vt failed");
    const retry = await loadMessaging();
    await retry.startQueueConsumer({
      queue: "retry.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      handle: vi.fn().mockRejectedValue(new Error("handler failed")),
    });
    await vi.waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "PGMQ retry visibility update failed",
        expect.objectContaining({ error: "set_vt failed" }),
      ),
    );
    await stopWorker(retry);

    vi.clearAllMocks();
    mocks.pool.query.mockResolvedValue({ rows: [] });
    mocks.pool.end.mockResolvedValue(undefined);
    mocks.pgmq.read
      .mockResolvedValueOnce([{ ...message, readCount: 4 }])
      .mockResolvedValue([]);
    mocks.pgmq.deadLetter.mockRejectedValueOnce("archive failed");
    const archive = await loadMessaging();
    await archive.startQueueConsumer({
      queue: "archive.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      handle: vi.fn().mockRejectedValue(new Error("handler failed")),
    });
    await vi.waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "PGMQ delivery archive failed",
        expect.objectContaining({ error: "archive failed" }),
      ),
    );
    await stopWorker(archive);
  });

  it("uses the default retry backoff for Error failures", async () => {
    mocks.pgmq.read.mockResolvedValueOnce([message]).mockResolvedValue([]);
    const messaging = await loadMessaging();

    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      handle: vi.fn().mockRejectedValue(new Error("retry error")),
    });
    await vi.waitFor(() =>
      expect(mocks.pgmq.retry).toHaveBeenCalledWith(
        mocks.pool,
        "work.queue",
        42n,
        1,
      ),
    );
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "PGMQ delivery scheduled for retry",
      expect.objectContaining({ error: "retry error", delaySeconds: 1 }),
    );
    await stopWorker(messaging);
  });

  it("records a failed retry visibility handoff", async () => {
    mocks.pgmq.read.mockResolvedValueOnce([message]).mockResolvedValue([]);
    mocks.pgmq.retry.mockRejectedValueOnce(new Error("set_vt failed"));
    const messaging = await loadMessaging();

    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      handle: vi.fn().mockRejectedValue(new Error("handler failed")),
    });

    await vi.waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "PGMQ retry visibility update failed",
        expect.objectContaining({ error: "set_vt failed" }),
      ),
    );
    const retryFailure = mocks.logger.system.mock.calls
      .map((call) => call[1])
      .find((record) => record?.event === "queue.retry.failed");
    expect(retryFailure).toEqual(
      expect.objectContaining({
        reason: "visibility_update_failed",
        retry_count: 0,
      }),
    );
    expect(systemEvents()).not.toContain("queue.delivery.requeued");
    await stopWorker(messaging);
  });

  it("records a failed archive handoff", async () => {
    mocks.pgmq.read
      .mockResolvedValueOnce([{ ...message, readCount: 4 }])
      .mockResolvedValue([]);
    mocks.pgmq.deadLetter.mockRejectedValueOnce(new Error("archive failed"));
    const messaging = await loadMessaging();

    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      handle: vi.fn().mockRejectedValue(new Error("terminal")),
    });

    await vi.waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "PGMQ delivery archive failed",
        expect.objectContaining({ error: "archive failed" }),
      ),
    );
    const archiveFailure = mocks.logger.system.mock.calls
      .map((call) => call[1])
      .find((record) => record?.event === "queue.dlq.failed");
    expect(archiveFailure).toEqual(
      expect.objectContaining({
        reason: "archive_failed",
        retry_count: 3,
      }),
    );
    expect(systemEvents()).not.toContain("queue.delivery.failed");
    await stopWorker(messaging);
  });

  it("subscribes to escaped LISTEN names and processes only matching payloads", async () => {
    const handle = vi.fn().mockResolvedValue(undefined);
    const messaging = await loadMessaging();

    await messaging.startSignalSubscriber('signal"name', handle);
    expect(mocks.client.connect).toHaveBeenCalledOnce();
    expect(mocks.client.query).toHaveBeenCalledWith('LISTEN "signal""name"');
    mocks.notification?.({
      channel: "other",
      payload: JSON.stringify(envelope),
    });
    mocks.notification?.({ channel: 'signal"name' });
    mocks.notification?.({
      channel: 'signal"name',
      payload: JSON.stringify(envelope),
    });

    await vi.waitFor(() =>
      expect(handle).toHaveBeenCalledWith(new Uint8Array([1]), envelope),
    );
    expect(mocks.assertEnvelope).toHaveBeenCalledWith(envelope);
    await messaging.stopMessaging(1_000);
    expect(mocks.client.end).toHaveBeenCalledOnce();
    expect(mocks.pool.end).toHaveBeenCalledOnce();
    await expect(
      messaging.stopMessagingConsumers(1_000),
    ).resolves.toBeUndefined();
  });

  it("logs Error and non-Error signal handler failures without breaking the chain", async () => {
    const handle = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce("second");
    const messaging = await loadMessaging();
    await messaging.startSignalSubscriber("signal", handle);

    mocks.notification?.({
      channel: "signal",
      payload: JSON.stringify(envelope),
    });
    await vi.waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "PostgreSQL signal handler failed",
        { signal: "signal", error: "first" },
      ),
    );
    mocks.notification?.({
      channel: "signal",
      payload: JSON.stringify(envelope),
    });
    await vi.waitFor(() =>
      expect(mocks.logger.error).toHaveBeenLastCalledWith(
        "PostgreSQL signal handler failed",
        { signal: "signal", error: "second" },
      ),
    );

    await messaging.stopMessaging(1_000);
  });

  it("surfaces an unexpected listener end through the tracked fatal task", async () => {
    const queued = vi.fn();
    vi.stubGlobal("queueMicrotask", queued);
    const messaging = await loadMessaging();
    await messaging.startSignalSubscriber("signal", vi.fn());

    mocks.onceListeners.get("end")?.();
    await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce());
    expect(queued.mock.calls[0]?.[0]).toEqual(expect.any(Function));
    expect(() => queued.mock.calls[0]?.[0]()).toThrow(
      "PostgreSQL signal listener ended: signal",
    );
    vi.unstubAllGlobals();
  });

  it("tracks listener errors and times out a blocked consumer drain", async () => {
    const queued = vi.fn();
    vi.stubGlobal("queueMicrotask", queued);
    const messaging = await loadMessaging();
    await messaging.startSignalSubscriber("signal", vi.fn());
    mocks.onceListeners.get("error")?.(new Error("connection lost"));
    await vi.waitFor(() => expect(queued).toHaveBeenCalledOnce());
    expect(() => queued.mock.calls[0]?.[0]()).toThrow("connection lost");
    vi.unstubAllGlobals();

    vi.useFakeTimers();
    mocks.pgmq.read.mockReturnValue(new Promise(() => undefined));
    const blocked = await loadMessaging();
    await blocked.startQueueConsumer({
      queue: "blocked.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 0,
      workers: 2,
      handle: vi.fn(),
    });
    const stopping = blocked.stopMessagingConsumers(10);
    const expectedTimeout = expect(stopping).rejects.toThrow(
      "PostgreSQL messaging drain exceeded 10ms",
    );
    await vi.advanceTimersByTimeAsync(10);
    await expectedTimeout;
  });

  it("does not resurface a worker failure after shutdown has started", async () => {
    let rejectRead: ((error: Error) => void) | undefined;
    mocks.pgmq.read.mockReturnValue(
      new Promise((_, reject) => {
        rejectRead = reject;
      }),
    );
    const queued = vi.fn();
    vi.stubGlobal("queueMicrotask", queued);
    const messaging = await loadMessaging();
    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 0,
      handle: vi.fn(),
    });

    const stopping = messaging.stopMessagingConsumers(1_000);
    rejectRead?.(new Error("stopped"));
    await stopping;

    expect(queued).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("skips the empty-queue delay when shutdown wins the read race", async () => {
    let resolveRead: ((messages: never[]) => void) | undefined;
    mocks.pgmq.read.mockReturnValue(
      new Promise((resolve) => {
        resolveRead = resolve;
      }),
    );
    const messaging = await loadMessaging();
    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 0,
      handle: vi.fn(),
    });

    const stopping = messaging.stopMessagingConsumers(1_000);
    resolveRead?.([]);
    await stopping;
  });

  it("archives exhausted Error failures as well as non-Error failures", async () => {
    mocks.pgmq.read
      .mockResolvedValueOnce([{ ...message, readCount: 4 }])
      .mockResolvedValue([]);
    const messaging = await loadMessaging();

    await messaging.startQueueConsumer({
      queue: "work.queue",
      expectedMessageType,
      visibilityTimeoutSeconds: 60,
      maxRetries: 3,
      handle: vi.fn().mockRejectedValue(new Error("terminal error")),
    });
    await vi.waitFor(() =>
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "PGMQ delivery archived",
        expect.objectContaining({ error: "terminal error" }),
      ),
    );
    await stopWorker(messaging);
  });
});
