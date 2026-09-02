import type { Server } from "@hocuspocus/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startSignalSubscriber: vi.fn(),
  consumerCancelled: vi.fn(),
  deserializeProto: vi.fn(),
  broadcastEntity: vi.fn<(options: { payload: string }) => number>(() => 1),
  broadcastType: vi.fn<(options: { payload: string }) => number>(() => 1),
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/postgresql/messaging.ts", () => ({
  startSignalSubscriber: mocks.startSignalSubscriber,
}));
vi.mock("../lib/entity-document-broadcast.ts", () => ({
  broadcastStatelessToEntityDocuments: mocks.broadcastEntity,
  broadcastStatelessToDocumentType: mocks.broadcastType,
}));
vi.mock("../lib/logger.ts", () => ({ logger: mocks.logger }));
vi.mock("@echovisionlab/geul-event", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@echovisionlab/geul-event")>();
  return { ...original, deserializeProto: mocks.deserializeProto };
});

import {
  ContentType,
  Signals,
  OgEntityType,
  OgGenerationStatus,
} from "@echovisionlab/geul-event";
import { startEventSubscriber } from "./subscriber.ts";

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

function entityTarget(entityType: OgEntityType, entityId = "entity-1") {
  return {
    entityType,
    entityId,
    scope: { case: "entity", value: {} },
  };
}

function localeTarget(
  entityType: OgEntityType,
  locale: string,
  entityId = "entity-1",
) {
  return {
    entityType,
    entityId,
    scope: { case: "locale", value: { locale } },
  };
}

function policyTarget(entityType: OgEntityType) {
  switch (entityType) {
    case OgEntityType.POST:
    case OgEntityType.PAGE:
    case OgEntityType.FORM:
    case OgEntityType.PRIVACY:
    case OgEntityType.TERMS:
      return localeTarget(entityType, "ko");
    default:
      return entityTarget(entityType);
  }
}

function lifecycle(
  entityType: OgEntityType = OgEntityType.POST,
  status: OgGenerationStatus = OgGenerationStatus.QUEUED,
  overrides: Record<string, unknown> = {},
) {
  const statusFields: Record<string, unknown> = {};
  if (status === OgGenerationStatus.READY) {
    statusFields.asset = {
      assetId: "asset-1",
      url: "https://cdn.example/asset-1.webp",
    };
  }
  if (status === OgGenerationStatus.FAILED) {
    statusFields.errorCode = "render_failed";
    statusFields.error = "render failed";
  }
  if (status === OgGenerationStatus.SUPERSEDED) {
    statusFields.replacementGenerationId = "generation-2";
  }
  return {
    generationId: "generation-1",
    runId: "run-1",
    target: policyTarget(entityType),
    status,
    occurredAt: { seconds: 10n, nanos: 500_000_000 },
    ...statusFields,
    ...overrides,
  };
}

function fixture() {
  let consumer: ((message: TestMessage | null) => Promise<void>) | undefined;
  const channel = {
    assertExchange: vi.fn(async () => undefined),
    assertQueue: vi.fn(async () => ({ queue: "og-lifecycle-queue" })),
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

function latestRuntimeEvent() {
  const call = mocks.broadcastEntity.mock.calls.at(-1);
  if (!call) {
    throw new Error("Expected an entity broadcast");
  }
  return JSON.parse(call[0].payload) as Record<string, unknown>;
}

describe("OG lifecycle event subscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.broadcastEntity.mockReturnValue(1);
    mocks.broadcastType.mockReturnValue(1);
  });

  it("starts the PostgreSQL lifecycle signal subscriber", async () => {
    const state = fixture();
    await startEventSubscriber(state.server);
    expect(mocks.startSignalSubscriber).toHaveBeenCalledWith(
      Signals.ogLifecycle,
      expect.any(Function),
    );
  });

  it("subscribes to the durable lifecycle exchange", async () => {
    const state = fixture();
    await startEventSubscriber(state.server);

    expect(mocks.startSignalSubscriber).toHaveBeenCalledWith(
      Signals.ogLifecycle,
      expect.any(Function),
    );
  });

  it("relays every exact lifecycle status and status-specific detail", async () => {
    const state = fixture();
    await startEventSubscriber(state.server);
    const consumer = state.getConsumer();
    const cases = [
      [OgGenerationStatus.QUEUED, "queued", {}],
      [OgGenerationStatus.PROCESSING, "processing", {}],
      [
        OgGenerationStatus.READY,
        "ready",
        { assetId: "asset-1", assetUrl: "https://cdn.example/asset-1.webp" },
      ],
      [
        OgGenerationStatus.FAILED,
        "failed",
        { errorCode: "render_failed", error: "render failed" },
      ],
      [
        OgGenerationStatus.SUPERSEDED,
        "superseded",
        { replacementGenerationId: "generation-2" },
      ],
      [OgGenerationStatus.CANCELLED, "cancelled", {}],
    ] as const;

    for (const [protoStatus, runtimeStatus, detail] of cases) {
      mocks.deserializeProto.mockReturnValueOnce(
        lifecycle(OgEntityType.WORK, protoStatus),
      );
      await consumer(message());
      expect(latestRuntimeEvent()).toEqual({
        version: 1,
        kind: "og.lifecycle",
        entityType: "work",
        entityId: "entity-1",
        correlationId: "generation-1",
        timestampMs: 10_500,
        payload: {
          generationId: "generation-1",
          runId: "run-1",
          status: runtimeStatus,
          ...detail,
        },
      });
    }

    expect(mocks.broadcastEntity).toHaveBeenCalledTimes(cases.length);
    expect(state.channel.ack).toHaveBeenCalledTimes(cases.length);
  });

  it("preserves retry errors on a queued lifecycle event", async () => {
    const state = fixture();
    await startEventSubscriber(state.server);
    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(OgEntityType.WORK, OgGenerationStatus.QUEUED, {
        errorCode: "lease_expired",
        error: "worker lease expired",
      }),
    );

    await state.getConsumer()(message());

    expect(latestRuntimeEvent()).toMatchObject({
      payload: {
        status: "queued",
        errorCode: "lease_expired",
        error: "worker lease expired",
      },
    });
    expect(state.channel.ack).toHaveBeenCalledOnce();
  });

  it("omits an optional asset URL when the backend sends it blank", async () => {
    const state = fixture();
    await startEventSubscriber(state.server);
    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(OgEntityType.WORK, OgGenerationStatus.READY, {
        asset: { assetId: "asset-1", url: "   " },
      }),
    );

    await state.getConsumer()(message());

    expect(latestRuntimeEvent()).toMatchObject({
      payload: { assetId: "asset-1" },
    });
    expect(latestRuntimeEvent().payload).not.toHaveProperty("assetUrl");
  });

  it("preserves the concrete locale target in the runtime envelope", async () => {
    const state = fixture();
    await startEventSubscriber(state.server);
    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(OgEntityType.PAGE, OgGenerationStatus.PROCESSING, {
        target: localeTarget(OgEntityType.PAGE, "ko", "page-1"),
      }),
    );

    await state.getConsumer()(message());

    expect(latestRuntimeEvent()).toMatchObject({
      entityType: "page",
      entityId: "page-1",
      locale: "ko",
      correlationId: "generation-1",
      payload: {
        generationId: "generation-1",
        runId: "run-1",
        status: "processing",
      },
    });
  });

  it("routes every entity that has a collaborative provider", async () => {
    const state = fixture();
    await startEventSubscriber(state.server);
    const consumer = state.getConsumer();
    const providerEntities = [
      OgEntityType.POST,
      OgEntityType.PAGE,
      OgEntityType.WORK,
      OgEntityType.LABEL,
      OgEntityType.ARTIST,
      OgEntityType.RELEASE,
      OgEntityType.FORM,
      OgEntityType.PRIVACY,
      OgEntityType.TERMS,
    ];

    for (const entityType of providerEntities) {
      mocks.deserializeProto.mockReturnValueOnce(lifecycle(entityType));
      await consumer(message());
    }

    expect(mocks.broadcastEntity).toHaveBeenCalledTimes(7);
    expect(mocks.broadcastType).toHaveBeenCalledTimes(2);
    expect(state.channel.ack).toHaveBeenCalledTimes(providerEntities.length);
  });

  it("acks site and series events for Web polling without inventing providers", async () => {
    const state = fixture();
    await startEventSubscriber(state.server);
    const consumer = state.getConsumer();

    mocks.deserializeProto.mockReturnValueOnce(lifecycle(OgEntityType.SITE));
    await consumer(message());
    mocks.deserializeProto.mockReturnValueOnce(lifecycle(OgEntityType.SERIES));
    await consumer(message());

    expect(mocks.broadcastEntity).not.toHaveBeenCalled();
    expect(mocks.broadcastType).not.toHaveBeenCalled();
    expect(state.channel.ack).toHaveBeenCalledTimes(2);
    expect(mocks.logger.debug).toHaveBeenCalledWith(
      "Skipping OG lifecycle broadcast - Web polling owns this entity",
      expect.objectContaining({ entityType: "site" }),
    );
    expect(mocks.logger.debug).toHaveBeenCalledWith(
      "Skipping OG lifecycle broadcast - Web polling owns this entity",
      expect.objectContaining({ entityType: "series" }),
    );
  });

  it("fails fast on consumer cancellation and acks irrelevant encodings and disconnected broadcasts", async () => {
    const state = fixture();
    await startEventSubscriber(state.server);
    const consumer = state.getConsumer();

    await consumer(null);
    await consumer(message("application/json"));
    mocks.broadcastEntity.mockReturnValueOnce(0);
    mocks.deserializeProto.mockReturnValueOnce(lifecycle());
    await consumer(message());

    expect(state.channel.ack).toHaveBeenCalledTimes(2);
    expect(mocks.consumerCancelled).toHaveBeenCalledWith(Signals.ogLifecycle);
    expect(mocks.logger.debug).toHaveBeenCalledWith(
      "No connected entity documents for OG lifecycle event",
      expect.objectContaining({ generationId: "generation-1" }),
    );
  });

  it("poisons malformed protobuf and invalid lifecycle contracts without requeue", async () => {
    const state = fixture();
    await startEventSubscriber(state.server);
    const consumer = state.getConsumer();
    const invalidEvents = [
      lifecycle(OgEntityType.POST, OgGenerationStatus.QUEUED, {
        target: undefined,
      }),
      lifecycle(OgEntityType.POST, OgGenerationStatus.QUEUED, {
        target: {
          ...entityTarget(OgEntityType.POST),
          scope: { case: undefined },
        },
      }),
      lifecycle(OgEntityType.POST, OgGenerationStatus.QUEUED, {
        target: entityTarget(OgEntityType.POST),
      }),
      lifecycle(OgEntityType.WORK, OgGenerationStatus.QUEUED, {
        target: localeTarget(OgEntityType.WORK, "ko"),
      }),
      lifecycle(OgEntityType.UNSPECIFIED),
      lifecycle(9999 as OgEntityType),
      lifecycle(OgEntityType.POST, OgGenerationStatus.UNSPECIFIED),
      lifecycle(OgEntityType.POST, OgGenerationStatus.READY, {
        asset: undefined,
      }),
      lifecycle(OgEntityType.POST, OgGenerationStatus.READY, {
        asset: { assetId: "", url: "" },
      }),
      lifecycle(OgEntityType.POST, OgGenerationStatus.FAILED, {
        errorCode: undefined,
        error: undefined,
      }),
      lifecycle(OgEntityType.POST, OgGenerationStatus.SUPERSEDED, {
        replacementGenerationId: undefined,
      }),
      lifecycle(OgEntityType.PAGE, OgGenerationStatus.QUEUED, {
        target: localeTarget(OgEntityType.PAGE, ""),
      }),
      lifecycle(OgEntityType.POST, OgGenerationStatus.QUEUED, {
        asset: { assetId: "asset-1", url: "https://cdn.example/asset-1.webp" },
      }),
      lifecycle(OgEntityType.POST, OgGenerationStatus.QUEUED, {
        errorCode: "",
      }),
      lifecycle(OgEntityType.POST, OgGenerationStatus.QUEUED, {
        occurredAt: undefined,
      }),
      lifecycle(OgEntityType.POST, OgGenerationStatus.QUEUED, {
        occurredAt: { seconds: 10n, nanos: 0.5 },
      }),
      lifecycle(OgEntityType.POST, OgGenerationStatus.QUEUED, {
        occurredAt: { seconds: 10n, nanos: -1 },
      }),
      lifecycle(OgEntityType.POST, OgGenerationStatus.QUEUED, {
        occurredAt: { seconds: 10n, nanos: 1_000_000_000 },
      }),
      lifecycle(OgEntityType.POST, OgGenerationStatus.QUEUED, {
        occurredAt: { seconds: BigInt(Number.MAX_SAFE_INTEGER), nanos: 0 },
      }),
    ];

    mocks.deserializeProto.mockImplementationOnce(() => {
      throw new Error("bad protobuf");
    });
    await consumer(message());
    for (const invalidEvent of invalidEvents) {
      mocks.deserializeProto.mockReturnValueOnce(invalidEvent);
      await consumer(message());
    }
    mocks.deserializeProto.mockImplementationOnce(() => {
      throw "bad value";
    });
    await consumer(message());

    expect(state.channel.nack).toHaveBeenCalledTimes(invalidEvents.length + 2);
    for (const call of (
      state.channel.nack as unknown as ReturnType<typeof vi.fn>
    ).mock.calls) {
      expect(call.slice(1)).toEqual([false, false]);
    }
    expect(mocks.logger.error).toHaveBeenLastCalledWith(
      "PostgreSQL signal handler failed",
      {
        signal: Signals.ogLifecycle,
        error: "bad value",
      },
    );
  });

  it("logs and rethrows startup failures for the service fatal path", async () => {
    mocks.startSignalSubscriber.mockRejectedValueOnce(new Error("offline"));
    await expect(startEventSubscriber({} as Server)).rejects.toThrow("offline");
    mocks.startSignalSubscriber.mockRejectedValueOnce("offline");
    await expect(startEventSubscriber({} as Server)).rejects.toBe("offline");
  });
});
