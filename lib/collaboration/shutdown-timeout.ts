import { env } from "../../env.ts";

export async function withShutdownTimeout<T>(
  promise: Promise<T>,
  operation: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${operation} timed out`)),
      env.SHUTDOWN_TIMEOUT_MS,
    );
    timer.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
