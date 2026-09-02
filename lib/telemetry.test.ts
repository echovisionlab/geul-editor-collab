import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setLogger: vi.fn(),
  traceExporter: vi.fn(),
  metricExporter: vi.fn(),
  metricReader: vi.fn(),
  instrumentations: vi.fn(() => ["instrumentation"]),
  sdkOptions: undefined as unknown,
  start: vi.fn((): Promise<void> => Promise.resolve()),
  shutdown: vi.fn((): Promise<void> => Promise.resolve()),
  telemetryDegraded: vi.fn(),
}));

vi.mock("./system-logging.ts", () => ({
  emitTelemetryPipelineDegraded: mocks.telemetryDegraded,
}));

vi.mock("@opentelemetry/api", () => ({
  diag: { setLogger: mocks.setLogger },
  DiagConsoleLogger: class DiagConsoleLogger {},
  DiagLogLevel: { INFO: 30 },
}));
vi.mock("@opentelemetry/auto-instrumentations-node", () => ({
  getNodeAutoInstrumentations: mocks.instrumentations,
}));
vi.mock("@opentelemetry/exporter-metrics-otlp-http", () => ({
  OTLPMetricExporter: class OTLPMetricExporter {
    constructor() {
      mocks.metricExporter();
    }
  },
}));
vi.mock("@opentelemetry/exporter-trace-otlp-http", () => ({
  OTLPTraceExporter: class OTLPTraceExporter {
    constructor() {
      mocks.traceExporter();
    }
  },
}));
vi.mock("@opentelemetry/sdk-metrics", () => ({
  PeriodicExportingMetricReader: class PeriodicExportingMetricReader {
    constructor(options: unknown) {
      mocks.metricReader(options);
    }
  },
}));
vi.mock("@opentelemetry/sdk-node", () => ({
  NodeSDK: class NodeSDK {
    constructor(options: unknown) {
      mocks.sdkOptions = options;
    }

    start() {
      return mocks.start();
    }

    shutdown() {
      return mocks.shutdown();
    }
  },
}));

const otelVariables = [
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_DEBUG",
] as const;

async function loadTelemetry() {
  vi.resetModules();
  await import("./telemetry.ts");
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("telemetry bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.start.mockResolvedValue(undefined);
    mocks.shutdown.mockResolvedValue(undefined);
    for (const name of otelVariables) {
      delete process.env[name];
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does nothing without any OTLP endpoint", async () => {
    await loadTelemetry();
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("starts with the default service through the common endpoint", async () => {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://otel";
    const listeners = new Map<string, () => void>();
    vi.spyOn(process, "once").mockImplementation((event, listener) => {
      listeners.set(String(event), listener as () => void);
      return process;
    });
    mocks.start.mockRejectedValueOnce("start failed");
    mocks.shutdown
      .mockRejectedValueOnce(new Error("shutdown failed"))
      .mockResolvedValueOnce(undefined);

    await loadTelemetry();
    expect(mocks.sdkOptions).toMatchObject({ serviceName: "geul-collab" });
    expect(mocks.traceExporter).toHaveBeenCalledOnce();
    expect(mocks.metricExporter).toHaveBeenCalledOnce();
    expect(mocks.telemetryDegraded).toHaveBeenCalledWith("start failed");

    listeners.get("SIGTERM")!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    listeners.get("SIGINT")!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.telemetryDegraded).toHaveBeenCalledWith(expect.any(Error));
  });

  it("enables diagnostics through the traces endpoint without changing the canonical service", async () => {
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://traces";
    process.env.OTEL_DEBUG = "true";
    const listeners = new Map<string, () => void>();
    vi.spyOn(process, "once").mockImplementation((event, listener) => {
      listeners.set(String(event), listener as () => void);
      return process;
    });
    mocks.start.mockRejectedValueOnce(new Error("start error"));
    mocks.shutdown.mockRejectedValueOnce("shutdown error");

    await loadTelemetry();
    expect(mocks.setLogger).toHaveBeenCalledOnce();
    expect(mocks.sdkOptions).toMatchObject({ serviceName: "geul-collab" });
    listeners.get("SIGTERM")!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.telemetryDegraded).toHaveBeenCalledWith("shutdown error");
  });

  it("accepts the metrics-specific endpoint", async () => {
    process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT = "http://metrics";
    vi.spyOn(process, "once").mockImplementation(() => process);
    await loadTelemetry();
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it("accepts the logs-specific endpoint", async () => {
    process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = "http://logs";
    vi.spyOn(process, "once").mockImplementation(() => process);
    await loadTelemetry();
    expect(mocks.start).toHaveBeenCalledOnce();
  });
});
