import type { Server } from "@hocuspocus/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../../env.ts";

const mocks = vi.hoisted(() => ({
  capturedRelay: undefined as ((request: never) => Promise<void>) | undefined,
  configuredRelay: vi.fn(async () => undefined),
  receiverRelay: vi.fn(async () => undefined),
}));

vi.mock("./internal-http.ts", () => ({
  createInternalHttpHandler: vi.fn(
    (options: {
      relayInteractiveMutation: (request: never) => Promise<void>;
    }) => {
      mocks.capturedRelay = options.relayInteractiveMutation;
      return vi.fn();
    },
  ),
}));
vi.mock("./interactive-mutation-server.ts", () => ({
  createInteractiveMutationRelayReceiver: vi.fn(() => ({
    relay: mocks.receiverRelay,
  })),
}));
vi.mock("../../events/ingest-projection-subscriber.ts", () => ({
  startIngestProjectionSubscriber: vi.fn(async () => undefined),
}));
vi.mock("../../events/content-updated-subscriber.ts", () => ({
  startContentUpdatedSubscriber: vi.fn(async () => undefined),
}));
vi.mock("../../events/subscriber.ts", () => ({
  startEventSubscriber: vi.fn(async () => undefined),
}));
vi.mock("../../events/transcode-subscriber.ts", () => ({
  startTranscodeSubscriber: vi.fn(async () => undefined),
}));
vi.mock("../../events/translation-subscriber.ts", () => ({
  startTranslationSubscriber: vi.fn(async () => undefined),
}));
vi.mock("../postgresql/messaging.ts", () => ({
  closeMessaging: vi.fn(async () => undefined),
  stopMessagingConsumers: vi.fn(async () => undefined),
}));
vi.mock("../logger.ts", () => ({
  logger: { info: vi.fn() },
}));
vi.mock("../system-logging.ts", () => ({
  emitServiceFailed: vi.fn(),
  emitServiceReady: vi.fn(),
  emitServiceStopping: vi.fn(),
}));

import { startCollabService, type CollabRuntime } from "./runtime.ts";

function runtime(): CollabRuntime {
  return {
    createInternalServer: vi.fn(() => ({
      listen: vi.fn((_port: number, ready: () => void) => ready()),
      close: vi.fn((ready: (error?: Error) => void) => ready()),
    })),
    onProcessEvent: vi.fn(),
    exit: vi.fn() as never,
  };
}

function server(): Server {
  return {
    listen: vi.fn(async () => undefined),
  } as unknown as Server;
}

describe("interactive mutation runtime wiring", () => {
  beforeEach(() => {
    mocks.capturedRelay = undefined;
    mocks.configuredRelay.mockClear();
    mocks.receiverRelay.mockClear();
  });

  it("uses an explicitly configured relay without wrapping it", async () => {
    await startCollabService(runtime(), server(), mocks.configuredRelay);

    expect(mocks.capturedRelay).toBe(mocks.configuredRelay);
  });

  it("forwards the default runtime handler to the resident relay receiver", async () => {
    const request = { mutationId: "mutation-1" } as never;
    await startCollabService(runtime(), server());

    await expect(mocks.capturedRelay!(request)).resolves.toBeUndefined();
    expect(mocks.receiverRelay).toHaveBeenCalledWith(request);
  });

  it("serves the internal relay on the health port, not the WebSocket port", async () => {
    const listen = vi.fn((_port: number, ready: () => void) => ready());
    const configuredRuntime: CollabRuntime = {
      createInternalServer: vi.fn(() => ({
        listen,
        close: vi.fn((ready: (error?: Error) => void) => ready()),
      })),
      onProcessEvent: vi.fn(),
      exit: vi.fn() as never,
    };

    await startCollabService(
      configuredRuntime,
      server(),
      mocks.configuredRelay,
    );

    expect(env.HEALTH_PORT).not.toBe(env.PORT);
    expect(listen).toHaveBeenCalledWith(env.HEALTH_PORT, expect.any(Function));
    expect(listen).not.toHaveBeenCalledWith(env.PORT, expect.any(Function));
  });
});
