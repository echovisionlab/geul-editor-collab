import { Client, Pool } from "pg";
import { env } from "../../env.ts";

const abortController = new AbortController();
export const messagingPool = new Pool({ connectionString: env.DATABASE_DSN });
export const messagingAbortSignal = abortController.signal;
const tasks = new Set<Promise<void>>();
const listeners = new Set<Client>();
let stopping = false;
let stopPromise: Promise<void> | undefined;
let closePromise: Promise<void> | undefined;

export function isMessagingStopping(): boolean {
  return stopping;
}

export function registerSignalClient(client: Client): void {
  listeners.add(client);
}

export function trackMessagingTask(task: Promise<void>): void {
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

export function stopMessagingConsumers(timeoutMs: number): Promise<void> {
  if (stopPromise) return stopPromise;

  stopping = true;
  abortController.abort();
  stopPromise = (async () => {
    await Promise.allSettled([...listeners].map((client) => client.end()));
    listeners.clear();
    const drain = Promise.allSettled([...tasks]);
    const timeout = new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(`PostgreSQL messaging drain exceeded ${timeoutMs}ms`),
          ),
        timeoutMs,
      );
      void drain.then(() => clearTimeout(timer));
    });
    await Promise.race([drain, timeout]);
  })();
  return stopPromise;
}

export async function closeMessaging(): Promise<void> {
  closePromise ??= messagingPool.end();
  await closePromise;
}

export async function stopMessaging(timeoutMs: number): Promise<void> {
  await stopMessagingConsumers(timeoutMs);
  await closeMessaging();
}
