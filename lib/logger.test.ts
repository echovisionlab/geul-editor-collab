import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  correlationFromActiveContext: vi.fn(() => ({})),
}));

vi.mock("@echovisionlab/geul-telemetry", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@echovisionlab/geul-telemetry")>();
  return {
    ...original,
    correlationFromActiveContext: mocks.correlationFromActiveContext,
  };
});

import { logger } from "./logger.ts";

describe("structured logger", () => {
  afterEach(() => {
    delete process.env.DEBUG;
    vi.restoreAllMocks();
  });

  it("suppresses debug output unless enabled", () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    logger.debug("hidden");
    expect(write).not.toHaveBeenCalled();
    process.env.DEBUG = "1";
    logger.debug("visible", { camelCase: "value" });
    expect(write).toHaveBeenCalledWith(
      expect.stringContaining('"camel_case":"value"'),
    );
  });

  it("drops untyped nested data for info, warn, and error output", () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const data = {
      "spaced-key": {
        nestedValue: [{ anotherKey: 1 }, null, "value"],
      },
    };
    logger.info("info", data);
    logger.warn("warn");
    logger.error("error", data);
    expect(stdout).not.toHaveBeenCalledWith(
      expect.stringContaining('"spaced_key"'),
    );
    expect(stdout).not.toHaveBeenCalledWith(
      expect.stringContaining('"another_key":1'),
    );
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining('"level":"ERROR"'),
    );
    expect(String(stdout.mock.calls[0]?.[0])).not.toContain('"event"');
  });

  it("does not let generic callers claim typed System controls", () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    logger.info("diagnostic", {
      event: "service.ready",
      action: "member.updated",
      outcome: "ready",
      requestId: "018f47a2-8a3d-4e17-9d42-6f12c89b1234",
      traceId: "1".repeat(32),
      spanId: "2".repeat(16),
    });

    const output = String(stdout.mock.calls[0]?.[0]);
    expect(output).not.toContain('"event"');
    expect(output).not.toContain('"action"');
    expect(output).not.toContain('"outcome"');
    expect(output).not.toContain('"request_id"');
    expect(output).not.toContain('"trace_id"');
    expect(output).not.toContain('"span_id"');
  });

  it("preserves controls only through the typed System logger", () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    logger.system("info", {
      occurred_at: "2026-08-11T00:00:00.000Z",
      event: "service.ready",
      outcome: "ready",
      component: "runtime",
    });

    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('"event":"service.ready"'),
    );
    expect(stdout).toHaveBeenCalledWith(
      expect.stringContaining('"outcome":"ready"'),
    );
  });

  it("drops forbidden values and classifies errors without serializing details", () => {
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    logger.error("delivery failed", {
      commandId: "command-1",
      recipient: "person@example.com",
      displayName: "Private Display Name",
      memberName: "Private Member Name",
      nickname: "Private Nickname",
      requesterNickname: "Private Requester Nickname",
      tokenPrefix: "secret",
      sourcePath: "/private/source",
      error: new Error("person@example.com was rejected"),
    });
    const output = String(stderr.mock.calls[0]?.[0]);
    expect(output).toContain('"command_id":"command-1"');
    expect(output).toContain('"error_type":"error"');
    expect(output).not.toContain("person@example.com");
    expect(output).not.toContain("Private Display Name");
    expect(output).not.toContain("Private Member Name");
    expect(output).not.toContain("Private Nickname");
    expect(output).not.toContain("Private Requester Nickname");
    expect(output).not.toContain("token_prefix");
    expect(output).not.toContain("source_path");
    expect(output).not.toContain("stack");
  });

  it("drops nested errors and circular values while classifying a top-level report", () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const unnamedError = new Error("private unnamed detail");
    unnamedError.name = "";

    logger.info("normalized", {
      nestedError: new TypeError("private detail"),
      unnamedError,
      err: "provider rejected",
      circular,
    });

    const output = String(stdout.mock.calls[0]?.[0]);
    expect(output).toContain('"error_type":"reported_error"');
    expect(output).not.toContain("nested_error");
    expect(output).not.toContain("unnamed_error");
    expect(output).not.toContain("circular");
    expect(output).not.toContain("private detail");
    expect(output).not.toContain("private unnamed detail");
    expect(output).not.toContain("provider rejected");
  });

  it("adds canonical active correlation and replaces caller-supplied identifiers", () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    mocks.correlationFromActiveContext.mockReturnValue({
      trace_id: "1".repeat(32),
      span_id: "2".repeat(16),
    });

    logger.info("traced");
    logger.info("explicit trace", {
      traceId: "3".repeat(32),
      spanId: "4".repeat(16),
    });

    expect(String(stdout.mock.calls[0]?.[0])).toContain(
      `"trace_id":"${"1".repeat(32)}"`,
    );
    expect(String(stdout.mock.calls[0]?.[0])).toContain(
      `"span_id":"${"2".repeat(16)}"`,
    );
    expect(String(stdout.mock.calls[1]?.[0])).toContain(
      `"trace_id":"${"1".repeat(32)}"`,
    );
    expect(String(stdout.mock.calls[1]?.[0])).toContain(
      `"span_id":"${"2".repeat(16)}"`,
    );
  });
});
