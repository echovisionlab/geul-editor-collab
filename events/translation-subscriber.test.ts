import type { Server } from "@hocuspocus/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startSignalSubscriber: vi.fn(),
  deserializeProto: vi.fn(),
  broadcast: vi.fn((options: { payload: string }) => {
    void options;
    return 1;
  }),
  logger: { debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../lib/postgresql/messaging.ts", () => ({
  startSignalSubscriber: mocks.startSignalSubscriber,
}));
vi.mock("../lib/entity-document-broadcast.ts", () => ({
  broadcastStatelessToLocaleDocument: mocks.broadcast,
}));
vi.mock("../lib/logger.ts", () => ({ logger: mocks.logger }));
vi.mock("@echovisionlab/geul-event", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@echovisionlab/geul-event")>();
  return { ...original, deserializeProto: mocks.deserializeProto };
});

import { Signals } from "@echovisionlab/geul-event";
import {
  TranslationEntityType,
  TranslationFailureReason,
} from "@echovisionlab/geul-proto/secure/translation_pb.ts";
import { TranslationLifecycleStatus } from "@echovisionlab/geul-proto/secure/events_pb.ts";
import { startTranslationSubscriber } from "./translation-subscriber.ts";

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";

function lifecycle(
  status: TranslationLifecycleStatus,
  failureReason = TranslationFailureReason.UNSPECIFIED,
  entityType = TranslationEntityType.POST,
) {
  return {
    entityType,
    entityId: ENTITY_ID,
    targetLocale: "ko",
    status,
    failureReason,
    jobId: "job-1",
    timestampMs: 10n,
  };
}

function fixture() {
  let handle: ((content: Uint8Array) => Promise<void>) | undefined;
  mocks.startSignalSubscriber.mockImplementation(async (_signal, callback) => {
    handle = callback;
  });
  const server = {
    hocuspocus: { documents: new Map() },
  } as unknown as Server;
  return { server, handle: () => handle! };
}

describe("translation lifecycle subscriber", () => {
  beforeEach(() => vi.clearAllMocks());

  it("subscribes to the released lifecycle signal", async () => {
    const state = fixture();
    await startTranslationSubscriber(state.server);
    expect(mocks.startSignalSubscriber).toHaveBeenCalledWith(
      Signals.translationLifecycle,
      expect.any(Function),
    );
  });

  it("leaves APPLIED room invalidation to the transactional content updated signal", async () => {
    const state = fixture();
    await startTranslationSubscriber(state.server);
    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(TranslationLifecycleStatus.APPLIED),
    );

    await state.handle()(new Uint8Array([1]));

    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.logger.debug).toHaveBeenCalledWith(
      "Observed applied translation lifecycle hint",
      expect.objectContaining({
        entityId: ENTITY_ID,
        targetLocale: "ko",
        jobId: "job-1",
      }),
    );
  });

  it("broadcasts FAILED only to the exact locale room without source identity", async () => {
    const state = fixture();
    await startTranslationSubscriber(state.server);
    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(
        TranslationLifecycleStatus.FAILED,
        TranslationFailureReason.PROVIDER_UNAVAILABLE,
      ),
    );

    await state.handle()(new Uint8Array([1]));

    expect(mocks.broadcast).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: ENTITY_ID, locale: "ko" }),
    );
    const payload = JSON.parse(mocks.broadcast.mock.calls[0]![0].payload);
    expect(payload.payload).toEqual({
      jobId: "job-1",
      targetLocale: "ko",
      status: "failed",
      error: "provider_unavailable",
    });
    expect(payload.payload).not.toHaveProperty("sourceLocale");
    expect(payload.payload).not.toHaveProperty("sourceEpoch");
    expect(payload.payload).not.toHaveProperty("sourceHash");
    expect(payload.payload).not.toHaveProperty("sourceRevision");
    expect(payload.payload).not.toHaveProperty("translationSpecVersion");
  });

  it("rejects statuses outside the APPLIED/FAILED hard cut", async () => {
    const state = fixture();
    await startTranslationSubscriber(state.server);
    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(TranslationLifecycleStatus.UNSPECIFIED),
    );
    await expect(state.handle()(new Uint8Array([1]))).rejects.toThrow(
      "Unsupported translation lifecycle status",
    );
  });

  it("ignores lifecycle deliveries for an unknown translation entity", async () => {
    const state = fixture();
    await startTranslationSubscriber(state.server);
    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(
        TranslationLifecycleStatus.APPLIED,
        TranslationFailureReason.UNSPECIFIED,
        TranslationEntityType.UNSPECIFIED,
      ),
    );

    await expect(state.handle()(new Uint8Array([1]))).resolves.toBeUndefined();
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it.each([[TranslationEntityType.MENU], [TranslationEntityType.POST_SERIES]])(
    "does not invent a collaboration room for entity type %s",
    async (entityType) => {
      const state = fixture();
      await startTranslationSubscriber(state.server);
      mocks.deserializeProto.mockReturnValueOnce(
        lifecycle(
          TranslationLifecycleStatus.APPLIED,
          TranslationFailureReason.UNSPECIFIED,
          entityType,
        ),
      );
      await state.handle()(new Uint8Array([1]));
      expect(mocks.broadcast).not.toHaveBeenCalled();
    },
  );

  it("maps an unspecified failure and avoids inventing a non-collaborative room", async () => {
    const state = fixture();
    await startTranslationSubscriber(state.server);
    mocks.deserializeProto.mockReturnValueOnce(
      lifecycle(
        TranslationLifecycleStatus.FAILED,
        TranslationFailureReason.UNSPECIFIED,
        TranslationEntityType.MENU,
      ),
    );

    await state.handle()(new Uint8Array([1]));

    expect(mocks.broadcast).not.toHaveBeenCalled();
    expect(mocks.logger.debug).toHaveBeenCalledWith(
      "Broadcasted exact translation locale failure",
      expect.objectContaining({
        entityType: "menu",
        broadcastCount: 0,
      }),
    );
  });
});
