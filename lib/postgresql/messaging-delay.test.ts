import { getEventListeners, setMaxListeners } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForAbortableDelay } from "./messaging-delay.ts";

describe("abortable messaging delay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes each abort listener when 200 waits complete", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    setMaxListeners(0, controller.signal);

    for (let index = 0; index < 200; index += 1) {
      const waiting = waitForAbortableDelay(1, controller.signal);
      await vi.advanceTimersByTimeAsync(1);
      await waiting;
    }

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    controller.abort();
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });

  it("cleans up when shutdown aborts an active wait or the signal is already aborted", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    setMaxListeners(0, controller.signal);
    const waiting = waitForAbortableDelay(1_000, controller.signal);

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(1);
    controller.abort();
    await waiting;
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);

    await waitForAbortableDelay(1_000, controller.signal);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes the listener if the timer resolves as the abort event races", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    setMaxListeners(0, controller.signal);
    const waiting = waitForAbortableDelay(1, controller.signal);
    const advancing = vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await Promise.all([waiting, advancing]);

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up when shutdown races with listener registration", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    setMaxListeners(0, controller.signal);
    const addEventListener = controller.signal.addEventListener.bind(
      controller.signal,
    );
    vi.spyOn(controller.signal, "addEventListener").mockImplementation(
      (type, listener, options) => {
        addEventListener(type, listener, options);
        controller.abort();
      },
    );

    await waitForAbortableDelay(1_000, controller.signal);

    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
