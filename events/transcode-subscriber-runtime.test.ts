import type { Server } from "@hocuspocus/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startSignalSubscriber: vi.fn(),
  consumerCancelled: vi.fn(),
  deserializeProto: vi.fn(),
  parseRuntime: vi.fn((payload: string) => JSON.parse(payload) as unknown),
  broadcast: vi.fn(() => 1),
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/postgresql/messaging.ts", () => ({
  startSignalSubscriber: mocks.startSignalSubscriber,
}));
vi.mock("../lib/entity-document-broadcast.ts", () => ({
  broadcastStatelessToEntityDocuments: mocks.broadcast,
}));
vi.mock("../lib/logger.ts", () => ({ logger: mocks.logger }));
vi.mock(
  "@echovisionlab/geul-common/collaboration/runtime-events",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@echovisionlab/geul-common/collaboration/runtime-events")
      >();
    return { ...original, parseEditorRuntimeEventMessage: mocks.parseRuntime };
  },
);
vi.mock("@echovisionlab/geul-event", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@echovisionlab/geul-event")>();
  return { ...original, deserializeProto: mocks.deserializeProto };
});

import {
  ContentType,
  Signals,
  MediaProcessingStatus,
  TranscodeEntityType,
} from "@echovisionlab/geul-event";
import { startTranscodeSubscriber } from "./transcode-subscriber.ts";

const entityId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";
const releaseId = "33333333-3333-4333-8333-333333333333";

function lifecycle(entityType: TranscodeEntityType) {
  return {
    entityType,
    entityId,
    releaseId: entityType === TranscodeEntityType.TRACK ? releaseId : "",
    trackId: entityType === TranscodeEntityType.TRACK ? entityId : "",
    fileId,
    status: MediaProcessingStatus.PROCESSING,
    percentage: 20,
    sequenceNumber: 1n,
    timestampMs: 10n,
    correlationId: "",
  };
}

interface TestMessage {
  content: Buffer;
  fields: { routingKey?: string };
  properties: { contentType?: string; headers?: Record<string, unknown> };
}

function message(contentType: string = ContentType.protobuf): TestMessage {
  return {
    content: Buffer.from([1]),
    fields: {},
    properties: { contentType, headers: {} },
  };
}

function fixture() {
  let consumer: ((message: TestMessage | null) => Promise<void>) | undefined;
  const channel = {
    assertExchange: vi.fn(async () => undefined),
    assertQueue: vi.fn(async () => ({ queue: "media-queue" })),
    bindQueue: vi.fn(async () => undefined),
    consume: vi.fn(async (_queue, callback) => {
      consumer = callback;
      return { consumerTag: "tag" };
    }),
    ack: vi.fn(),
    nack: vi.fn(),
  };
  mocks.startSignalSubscriber.mockImplementation(async (signal, handle) => {
    consumer = async (delivery) => {
      if (!delivery) {
        mocks.consumerCancelled(signal);
        return;
      }
      if (delivery.properties.contentType !== ContentType.protobuf) {
        channel.ack(delivery);
        return;
      }
      try {
        await handle(delivery.content, {});
        channel.ack(delivery);
      } catch (error) {
        channel.nack(delivery, false, false);
        mocks.logger.error("PostgreSQL signal handler failed", {
          signal,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
  });
  const server = { hocuspocus: { documents: new Map() } } as unknown as Server;
  return { channel, getConsumer: () => consumer!, server };
}

describe("media processing subscriber runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseRuntime.mockImplementation(
      (payload) => JSON.parse(payload) as unknown,
    );
  });

  it("starts the PostgreSQL lifecycle signal subscriber", async () => {
    const state = fixture();
    await startTranscodeSubscriber(state.server);
    expect(mocks.startSignalSubscriber).toHaveBeenCalledWith(
      Signals.mediaProcessingLifecycle,
      expect.any(Function),
    );
  });

  it("broadcasts only Release Track lifecycle entities", async () => {
    const fixtureState = fixture();
    await startTranscodeSubscriber(fixtureState.server);
    const consumer = fixtureState.getConsumer();
    for (const entityType of [
      TranscodeEntityType.POST,
      TranscodeEntityType.PAGE,
      TranscodeEntityType.WORK,
      TranscodeEntityType.PROGRAM_EVENT,
      TranscodeEntityType.TRACK,
    ]) {
      mocks.deserializeProto.mockReturnValueOnce(lifecycle(entityType));
      await consumer(message());
    }
    expect(mocks.broadcast).toHaveBeenCalledOnce();
    expect(fixtureState.channel.ack).toHaveBeenCalledTimes(5);
  });

  it("acks ignored entities and unsupported encodings", async () => {
    const fixtureState = fixture();
    await startTranscodeSubscriber(fixtureState.server);
    const consumer = fixtureState.getConsumer();
    await consumer(null);
    expect(mocks.consumerCancelled).toHaveBeenCalledWith(
      Signals.mediaProcessingLifecycle,
    );
    await consumer(message("application/json"));
    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(TranscodeEntityType.FILE),
    );
    await consumer(message());
    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(9999 as TranscodeEntityType),
    );
    await consumer(message());
    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(fixtureState.channel.ack).toHaveBeenCalledTimes(3);
  });

  it("nacks runtime validation and unsupported parsed entity failures", async () => {
    const fixtureState = fixture();
    await startTranscodeSubscriber(fixtureState.server);
    const consumer = fixtureState.getConsumer();

    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(TranscodeEntityType.TRACK),
    );
    mocks.parseRuntime.mockReturnValueOnce(null);
    await consumer(message());
    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(TranscodeEntityType.TRACK),
    );
    mocks.parseRuntime.mockReturnValueOnce({ kind: "other" });
    await consumer(message());
    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(TranscodeEntityType.TRACK),
    );
    mocks.parseRuntime.mockReturnValueOnce({
      kind: "media.processing.lifecycle",
      entityType: "artist",
    });
    await consumer(message());
    mocks.deserializeProto.mockImplementationOnce(() => {
      throw "bad value";
    });
    await consumer(message());
    expect(fixtureState.channel.nack).toHaveBeenCalledTimes(4);
    expect(mocks.logger.error).toHaveBeenLastCalledWith(
      "PostgreSQL signal handler failed",
      { signal: Signals.mediaProcessingLifecycle, error: "bad value" },
    );
  });

  it("logs and rethrows startup failures for Error and non-Error values", async () => {
    mocks.startSignalSubscriber.mockRejectedValueOnce(new Error("offline"));
    await expect(startTranscodeSubscriber({} as Server)).rejects.toThrow(
      "offline",
    );
    mocks.startSignalSubscriber.mockRejectedValueOnce("offline");
    await expect(startTranscodeSubscriber({} as Server)).rejects.toBe(
      "offline",
    );
  });
});
