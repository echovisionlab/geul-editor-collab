import {
  buildCollaborationCheckpointFailedRecord,
  buildServiceFailedRecord,
  buildServiceReadyRecord,
  buildServiceStoppingRecord,
  buildTelemetryPipelineDegradedRecord,
  correlationFromActiveContext,
  stableErrorType,
  systemLogLevel,
  type SystemRecord,
} from "@echovisionlab/geul-telemetry";
import type { EditSessionTerminalCheckpointFailure } from "./collaboration/edit-session-contributor-types.ts";
import { logger } from "./logger.ts";

const serviceComponent = "runtime";
const telemetryPipelineComponent = "otel_sdk";

export function systemMetadata(): {
  occurred_at: string;
} & ReturnType<typeof correlationFromActiveContext> {
  return {
    occurred_at: new Date().toISOString(),
    ...correlationFromActiveContext(),
  };
}

export function emitSystemRecord(buildRecord: () => SystemRecord): void {
  try {
    const record = buildRecord();
    const level = systemLogLevel(record);
    logger.system(level, record);
  } catch (error) {
    try {
      logger.error("System telemetry emission failed", { error });
    } catch {
      // Telemetry remains fail-open when the local logger is unavailable.
    }
  }
}

export function emitServiceReady(): void {
  emitSystemRecord(() =>
    buildServiceReadyRecord(systemMetadata(), serviceComponent),
  );
}

export function emitServiceStopping(): void {
  emitSystemRecord(() =>
    buildServiceStoppingRecord(systemMetadata(), serviceComponent),
  );
}

export function emitServiceFailed(error: unknown): void {
  emitSystemRecord(() =>
    buildServiceFailedRecord(systemMetadata(), serviceComponent, {
      error_code: stableErrorType(error),
    }),
  );
}

export function emitTelemetryPipelineDegraded(error: unknown): void {
  emitSystemRecord(() =>
    buildTelemetryPipelineDegradedRecord(
      systemMetadata(),
      telemetryPipelineComponent,
      {
        error_code: stableErrorType(error),
      },
    ),
  );
}

export function emitTerminalCollaborationCheckpointFailure(
  failure: EditSessionTerminalCheckpointFailure,
): void {
  emitSystemRecord(() =>
    buildCollaborationCheckpointFailedRecord(
      systemMetadata(),
      {
        entity_type: failure.entity_type,
        entity_id: failure.entity_id,
        retry_count: failure.retry_count,
      },
      failure.reason,
    ),
  );
}
