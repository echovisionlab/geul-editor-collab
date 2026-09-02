import { context } from "@opentelemetry/api";
import {
  logs,
  SeverityNumber,
  type AnyValueMap,
} from "@opentelemetry/api-logs";
import {
  SERVICE_EDITOR_COLLAB,
  correlationFromActiveContext,
  normalizeLogAttributes,
  type SystemLogLevel,
  type SystemRecord,
} from "@echovisionlab/geul-telemetry";

const otelLogger = logs.getLogger(SERVICE_EDITOR_COLLAB);

const severityNumbers = {
  DEBUG: SeverityNumber.DEBUG,
  INFO: SeverityNumber.INFO,
  WARN: SeverityNumber.WARN,
  ERROR: SeverityNumber.ERROR,
} as const;

type LogLevel = keyof typeof severityNumbers;
const genericControlFields = [
  "event",
  "action",
  "outcome",
  "request_id",
  "trace_id",
  "span_id",
] as const;

function normalizedGenericAttributes(
  data?: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const attributes = normalizeLogAttributes(data);
  for (const field of genericControlFields) {
    delete attributes[field];
  }
  return attributes;
}

function emit(
  level: LogLevel,
  message: string,
  rawAttributes: Record<string, string | number | boolean>,
): void {
  const attributes: Record<string, string | number | boolean> = {
    ...rawAttributes,
    ...correlationFromActiveContext(),
  };
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...attributes,
  };
  const output = `${JSON.stringify(logEntry)}\n`;
  if (level === "ERROR") {
    process.stderr.write(output);
  } else {
    process.stdout.write(output);
  }
  otelLogger.emit({
    timestamp: Date.now(),
    severityNumber: severityNumbers[level],
    severityText: level,
    eventName:
      typeof attributes.event === "string" ? attributes.event : undefined,
    body: message,
    attributes: attributes as AnyValueMap,
    context: context.active(),
  });
}

function emitGeneric(
  level: LogLevel,
  message: string,
  data?: Record<string, unknown>,
): void {
  emit(level, message, normalizedGenericAttributes(data));
}

function emitTypedSystemRecord(
  level: SystemLogLevel,
  record: SystemRecord,
): void {
  emit(
    level.toUpperCase() as LogLevel,
    "System event",
    normalizeLogAttributes(
      record as unknown as Readonly<Record<string, unknown>>,
    ),
  );
}

export const logger = {
  debug: (message: string, data?: Record<string, unknown>) => {
    if (process.env.DEBUG) {
      emitGeneric("DEBUG", message, data);
    }
  },
  info: (message: string, data?: Record<string, unknown>) => {
    emitGeneric("INFO", message, data);
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    emitGeneric("WARN", message, data);
  },
  error: (message: string, data?: Record<string, unknown>) => {
    emitGeneric("ERROR", message, data);
  },
  system: emitTypedSystemRecord,
};
