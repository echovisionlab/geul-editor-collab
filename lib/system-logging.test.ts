import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    logger: {
      ...logger,
      system: vi.fn((level: "info" | "warn" | "error", record: unknown) =>
        logger[level]("System event", record),
      ),
    },
  };
});

vi.mock("./logger.ts", () => ({ logger: mocks.logger }));

import {
  emitTerminalCollaborationCheckpointFailure,
  emitServiceFailed,
  emitServiceReady,
  emitServiceStopping,
  emitSystemRecord,
  emitTelemetryPipelineDegraded,
  systemMetadata,
} from "./system-logging.ts";

describe("system logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logger.system = vi.fn(
      (level: "info" | "warn" | "error", record: unknown) =>
        mocks.logger[level]("System event", record),
    );
  });

  it("emits only canonical lifecycle and degraded records", () => {
    emitServiceReady();
    emitServiceStopping();
    emitServiceFailed(new TypeError("private detail"));
    emitTelemetryPipelineDegraded("private detail");

    expect(mocks.logger.info).toHaveBeenCalledWith(
      "System event",
      expect.objectContaining({ event: "service.ready", component: "runtime" }),
    );
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "System event",
      expect.objectContaining({
        event: "service.stopping",
        component: "runtime",
      }),
    );
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "System event",
      expect.objectContaining({
        event: "service.failed",
        component: "runtime",
        error_code: "type_error",
      }),
    );
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "System event",
      expect.objectContaining({
        event: "telemetry.pipeline.degraded",
        component: "otel_sdk",
        error_code: "reported_error",
      }),
    );
    expect(mocks.logger.warn).toHaveBeenCalledOnce();
  });

  it("adds canonical occurrence metadata", () => {
    const metadata = systemMetadata();

    expect(new Date(metadata.occurred_at).toISOString()).toBe(
      metadata.occurred_at,
    );
  });

  it("emits one redacted terminal collaboration checkpoint record", () => {
    emitTerminalCollaborationCheckpointFailure({
      reason: "persist_failed",
      entity_type: "post",
      entity_id: "post-1",
      retry_count: 4,
    });

    expect(mocks.logger.error).toHaveBeenCalledWith(
      "System event",
      expect.objectContaining({
        event: "collaboration.checkpoint.failed",
        domain: "collaboration",
        entity_type: "post",
        entity_id: "post-1",
        retry_count: 4,
        reason: "persist_failed",
      }),
    );
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain(
      "stack",
    );
  });

  it("remains fail-open when record construction or local logging fails", () => {
    emitSystemRecord(() => {
      throw new Error("builder failed");
    });
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "System telemetry emission failed",
      expect.objectContaining({ error: expect.any(Error) }),
    );

    mocks.logger.error.mockImplementationOnce(() => {
      throw new Error("logger failed");
    });
    expect(() =>
      emitSystemRecord(() => {
        throw new Error("builder failed again");
      }),
    ).not.toThrow();
  });
});
