import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { SERVICE_EDITOR_COLLAB } from "@echovisionlab/geul-telemetry";
import { emitTelemetryPipelineDegraded } from "./system-logging.ts";

const hasOtelEndpoint = Boolean(
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
  process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT ||
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
  process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
);

function startTelemetry(): void {
  if (process.env.OTEL_DEBUG === "true") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const sdk = new NodeSDK({
    serviceName: SERVICE_EDITOR_COLLAB,
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  });

  Promise.resolve(sdk.start()).catch((error: unknown) => {
    emitTelemetryPipelineDegraded(error);
  });

  const shutdown = () => {
    void sdk.shutdown().catch((error: unknown) => {
      emitTelemetryPipelineDegraded(error);
    });
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (hasOtelEndpoint) {
  startTelemetry();
}
