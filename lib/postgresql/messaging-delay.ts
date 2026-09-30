export function waitForAbortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timer: { handle: ReturnType<typeof setTimeout> | undefined } = {
      handle: undefined,
    };
    const cleanup = () => {
      clearTimeout(timer.handle);
      signal.removeEventListener("abort", abort);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const abort = () => finish();

    timer.handle = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
