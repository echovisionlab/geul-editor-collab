import {
  assertPgmqEnvelope,
  pgmqEnvelopePayload,
  type PgmqEnvelope,
} from "@echovisionlab/geul-event";
import { Client } from "pg";
import { env } from "../../env.ts";
import { logger } from "../logger.ts";
import {
  isMessagingStopping,
  registerSignalClient,
  trackMessagingTask,
} from "./messaging-runtime.ts";

export async function startSignalSubscriber(
  signal: string,
  handle: (payload: Uint8Array, envelope: PgmqEnvelope) => Promise<void>,
): Promise<void> {
  const client = new Client({ connectionString: env.DATABASE_DSN });
  await client.connect();
  await client.query(`LISTEN "${signal.replaceAll('"', '""')}"`);
  registerSignalClient(client);
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
    trackMessagingTask(pending);
  });
  const disconnected = new Promise<void>((resolve, reject) => {
    client.once("error", reject);
    client.once("end", () => {
      if (isMessagingStopping()) {
        resolve();
      } else {
        reject(new Error(`PostgreSQL signal listener ended: ${signal}`));
      }
    });
  });
  trackMessagingTask(disconnected);
  logger.info("PostgreSQL signal subscriber started", { signal });
}
