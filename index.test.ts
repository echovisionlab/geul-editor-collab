import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(async () => undefined) }));

vi.mock("./lib/telemetry.ts", () => ({}));
vi.mock("./lib/collaboration/service.ts", () => ({
  startCollabService: mocks.start,
}));

it("starts the collaboration service after telemetry initialization", async () => {
  await import("./index.ts");
  expect(mocks.start).toHaveBeenCalledOnce();
});
