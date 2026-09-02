import {
  PgmqClient,
  assertPgmqEnvelope,
  pgmqEnvelopePayload,
  type PgmqEnvelope,
  type PgmqMessage,
} from "@echovisionlab/geul-event";
import { context, type TextMapGetter } from "@opentelemetry/api";
import {
  SERVICE_EDITOR_COLLAB,
  buildQueueDeliveryFailedRecord,
  buildQueueDeliveryRequeuedRecord,
  buildQueueDeliverySucceededRecord,
  buildQueueDLQAcceptedRecord,
  buildQueueDLQFailedRecord,
  buildQueueRetryAcceptedRecord,
  buildQueueRetryFailedRecord,
  extractCorrelation,
  runWithRequestContext,
  type QueueFailureReason,
} from "@echovisionlab/geul-telemetry";
import { Client, Pool } from "pg";
import { env } from "../../env.ts";
import { logger } from "../logger.ts";
import { emitSystemRecord, systemMetadata } from "../system-logging.ts";

export interface DurableDelivery {
  transportId: bigint;
  readCount: number;
  envelope: PgmqEnvelope;
  payload: Uint8Array;
}

interface QueueConsumerOptions {
  queue: string;
  expectedMessageType: string;
  visibilityTimeoutSeconds: number;
  maxRetries: number;
  retryDelaySeconds?: number;
  retryBackoff?: number;
  workers?: number;
  handle(delivery: DurableDelivery): Promise<void>;
}

const pgmq = new PgmqClient();
const pool = new Pool({ connectionString: env.DATABASE_DSN });
const abortController = new AbortController();
const tasks = new Set<Promise<void>>();
const listeners = new Set<Client>();
let stopping = false;

const headerGetter: TextMapGetter<Record<string, string>> = {
  get: (carrier, key) => carrier[key],
  keys: Object.keys,
};

export async function startQueueConsumer(
  options: QueueConsumerOptions,
): Promise<void> {
  await pool.query("SELECT total_messages FROM pgmq.metrics($1)", [
    options.queue,
  ]);
  const workers = Math.max(1, Math.trunc(options.workers ?? 1));
  for (let index = 0; index < workers; index += 1) {
    track(runQueueWorker(options));
  }
  logger.info("PGMQ consumer started", { queue: options.queue, workers });
}

async function runQueueWorker(options: QueueConsumerOptions): Promise<void> {
  const retryBase = Math.max(1, Math.trunc(options.retryDelaySeconds ?? 1));
  while (!abortController.signal.aborted) {
    const messages = await pgmq.read(pool, options.queue, {
      visibilityTimeoutSeconds: options.visibilityTimeoutSeconds,
      batch: 1,
    });
    const message = messages[0];
    if (!message) {
      await delay(250);
      continue;
    }
    await handleQueueMessage(options, message, retryBase);
  }
}

async function handleQueueMessage(
  options: QueueConsumerOptions,
  message: PgmqMessage,
  retryBase: number,
): Promise<void> {
  return runWithQueueCorrelation(message, () =>
    processQueueMessage(options, message, retryBase),
  );
}

async function processQueueMessage(
  options: QueueConsumerOptions,
  message: PgmqMessage,
  retryBase: number,
): Promise<void> {
  const startedAt = Date.now();
  const contractError = deliveryContractError(options, message);
  if (contractError) {
    await archiveFailedDelivery(
      options.queue,
      message,
      startedAt,
      contractError,
    );
    return;
  }

  const envelope = message.envelope!;

  try {
    await options.handle({
      transportId: message.transportId,
      readCount: message.readCount,
      envelope,
      payload: pgmqEnvelopePayload(envelope),
    });
  } catch (error) {
    await retryOrArchiveDelivery(options, message, retryBase, startedAt, error);
    return;
  }

  try {
    await pgmq.complete(pool, options.queue, message.transportId);
  } catch (error) {
    emitDeliveryFailed(options.queue, message, startedAt, "completion_failed");
    logger.error("PGMQ delivery completion failed", {
      queue: options.queue,
      messageId: deliveryCommandId(message),
      retryCount: deliveryRetryCount(message),
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  emitDeliverySucceeded(options.queue, message, startedAt);
}

function deliveryContractError(
  options: QueueConsumerOptions,
  message: PgmqMessage,
): string | null {
  if (message.contractError) return message.contractError;
  if (!message.envelope) return "PGMQ envelope is missing";
  if (message.envelope.message_type !== options.expectedMessageType) {
    return `Unexpected PGMQ message_type ${message.envelope.message_type}; expected ${options.expectedMessageType}`;
  }
  return null;
}

async function retryOrArchiveDelivery(
  options: QueueConsumerOptions,
  message: PgmqMessage,
  retryBase: number,
  startedAt: number,
  error: unknown,
): Promise<void> {
  const retryCount = deliveryRetryCount(message);
  if (retryCount >= options.maxRetries) {
    await archiveFailedDelivery(options.queue, message, startedAt, error);
    return;
  }

  const nextRetryCount = retryCount + 1;
  const delaySeconds = retryBase * (options.retryBackoff ?? 2) ** retryCount;
  try {
    await pgmq.retry(pool, options.queue, message.transportId, delaySeconds);
  } catch (retryError) {
    emitHandoffFailed(
      options.queue,
      message,
      retryCount,
      "retry",
      "visibility_update_failed",
    );
    logger.error("PGMQ retry visibility update failed", {
      queue: options.queue,
      messageId: deliveryCommandId(message),
      retryCount,
      error:
        retryError instanceof Error ? retryError.message : String(retryError),
    });
    return;
  }

  emitHandoffAccepted(options.queue, message, nextRetryCount, "retry");
  emitDeliveryRequeued(options.queue, message, nextRetryCount, startedAt);
  logger.warn("PGMQ delivery scheduled for retry", {
    queue: options.queue,
    messageId: deliveryCommandId(message),
    retryCount: nextRetryCount,
    delaySeconds,
    error: error instanceof Error ? error.message : String(error),
  });
}

async function archiveFailedDelivery(
  queue: string,
  message: PgmqMessage,
  startedAt: number,
  error: unknown,
): Promise<void> {
  const retryCount = deliveryRetryCount(message);
  try {
    await pgmq.deadLetter(pool, queue, message.transportId);
  } catch (archiveError) {
    emitHandoffFailed(queue, message, retryCount, "dlq", "archive_failed");
    logger.error("PGMQ delivery archive failed", {
      queue,
      messageId: deliveryCommandId(message),
      retryCount,
      error:
        archiveError instanceof Error
          ? archiveError.message
          : String(archiveError),
    });
    return;
  }

  emitHandoffAccepted(queue, message, retryCount, "dlq");
  emitDeliveryFailed(queue, message, startedAt, "handler_failed");
  logger.error("PGMQ delivery archived", {
    queue,
    messageId: deliveryCommandId(message),
    retryCount,
    error: error instanceof Error ? error.message : String(error),
  });
}

function deliveryRetryCount(message: PgmqMessage): number {
  return Math.max(0, message.readCount - 1);
}

function deliveryMessageId(message: PgmqMessage): string {
  return (
    message.envelope?.message_id.trim() || `transport:${message.transportId}`
  );
}

function deliveryCommandId(message: PgmqMessage): string {
  return deliveryMessageId(message);
}

function deliveryContext(
  queue: string,
  message: PgmqMessage,
  retryCount: number,
  startedAt: number,
) {
  return {
    queue,
    message_id: deliveryMessageId(message),
    command_id: deliveryCommandId(message),
    retry_count: retryCount,
    duration_ms: Math.max(0, Date.now() - startedAt),
  };
}

function handoffContext(
  queue: string,
  message: PgmqMessage,
  retryCount: number,
) {
  return {
    queue,
    message_id: deliveryMessageId(message),
    command_id: deliveryCommandId(message),
    retry_count: retryCount,
  };
}

function emitDeliverySucceeded(
  queue: string,
  message: PgmqMessage,
  startedAt: number,
): void {
  emitSystemRecord(() =>
    buildQueueDeliverySucceededRecord(
      systemMetadata(),
      deliveryContext(queue, message, deliveryRetryCount(message), startedAt),
    ),
  );
}

function emitDeliveryFailed(
  queue: string,
  message: PgmqMessage,
  startedAt: number,
  reason: QueueFailureReason,
): void {
  emitSystemRecord(() =>
    buildQueueDeliveryFailedRecord(
      systemMetadata(),
      deliveryContext(queue, message, deliveryRetryCount(message), startedAt),
      reason,
    ),
  );
}

function emitDeliveryRequeued(
  queue: string,
  message: PgmqMessage,
  retryCount: number,
  startedAt: number,
): void {
  emitSystemRecord(() =>
    buildQueueDeliveryRequeuedRecord(
      systemMetadata(),
      deliveryContext(queue, message, retryCount, startedAt),
      "handler_failed",
    ),
  );
}

function emitHandoffAccepted(
  queue: string,
  message: PgmqMessage,
  retryCount: number,
  target: "retry" | "dlq",
): void {
  emitSystemRecord(() =>
    target === "retry"
      ? buildQueueRetryAcceptedRecord(
          systemMetadata(),
          handoffContext(queue, message, retryCount),
        )
      : buildQueueDLQAcceptedRecord(
          systemMetadata(),
          handoffContext(queue, message, retryCount),
        ),
  );
}

function emitHandoffFailed(
  queue: string,
  message: PgmqMessage,
  retryCount: number,
  target: "retry" | "dlq",
  reason: QueueFailureReason,
): void {
  emitSystemRecord(() =>
    target === "retry"
      ? buildQueueRetryFailedRecord(
          systemMetadata(),
          handoffContext(queue, message, retryCount),
          reason,
        )
      : buildQueueDLQFailedRecord(
          systemMetadata(),
          handoffContext(queue, message, retryCount),
          reason,
        ),
  );
}

function runWithQueueCorrelation<T>(
  message: PgmqMessage,
  callback: () => T,
): T {
  const extracted = extractCorrelation(message.headers, headerGetter, {
    kind: "system",
    serviceName: SERVICE_EDITOR_COLLAB,
  });
  return context.with(extracted.otelContext, () =>
    extracted.requestContext
      ? runWithRequestContext(extracted.requestContext, callback)
      : callback(),
  );
}

export async function startSignalSubscriber(
  signal: string,
  handle: (payload: Uint8Array, envelope: PgmqEnvelope) => Promise<void>,
): Promise<void> {
  const client = new Client({ connectionString: env.DATABASE_DSN });
  await client.connect();
  await client.query(`LISTEN "${signal.replaceAll('"', '""')}"`);
  listeners.add(client);
  let pending = Promise.resolve();
  client.on("notification", (notification) => {
    if (notification.channel !== signal || !notification.payload) return;
    pending = pending
      .then(async () => {
        const envelope: unknown = JSON.parse(notification.payload!);
        assertPgmqEnvelope(envelope);
        await handle(pgmqEnvelopePayload(envelope), envelope);
      })
      .catch((error: unknown) => {
        logger.error("PostgreSQL signal handler failed", {
          signal,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  });
  const disconnected = new Promise<void>((resolve, reject) => {
    client.once("error", reject);
    client.once("end", () => {
      if (stopping) {
        resolve();
      } else {
        reject(new Error(`PostgreSQL signal listener ended: ${signal}`));
      }
    });
  });
  track(disconnected);
  logger.info("PostgreSQL signal subscriber started", { signal });
}

export async function stopMessaging(timeoutMs: number): Promise<void> {
  await stopMessagingConsumers(timeoutMs);
  await closeMessaging();
}

export async function stopMessagingConsumers(timeoutMs: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  abortController.abort();
  await Promise.allSettled([...listeners].map((client) => client.end()));
  listeners.clear();
  await Promise.race([
    Promise.allSettled([...tasks]),
    new Promise<never>((_resolve, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`PostgreSQL messaging drain exceeded ${timeoutMs}ms`),
          ),
        timeoutMs,
      );
    }),
  ]);
}

export async function closeMessaging(): Promise<void> {
  await pool.end();
}

function track(task: Promise<void>): void {
  tasks.add(task);
  void task
    .finally(() => tasks.delete(task))
    .catch((error: unknown) => {
      if (!stopping) {
        queueMicrotask(() => {
          throw error;
        });
      }
    });
}

async function delay(milliseconds: number): Promise<void> {
  if (abortController.signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    abortController.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}
