import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  document: vi.fn(),
  map: vi.fn(),
  readMap: vi.fn(),
  readRichText: vi.fn(),
  page: vi.fn(),
}));

vi.mock("../lib/yjs-fixture-cli.ts", () => ({
  runDocumentStoreFixtureCli: mocks.document,
  runMapFixtureCli: mocks.map,
  runMapReadFixtureCli: mocks.readMap,
  runRichTextReadFixtureCli: mocks.readRichText,
  runPageFixtureCli: mocks.page,
}));

await import("./generate-test-yjs.ts");
await import("./generate-test-yjs-map.ts");
await import("./read-test-yjs-map.ts");
await import("./read-test-rich-text-yjs.ts");
await import("./generate-test-page-yjs.ts");

it("keeps the cross-repository fixture script entrypoints executable", () => {
  expect(mocks.document).toHaveBeenCalledWith(process.argv.slice(2));
  expect(mocks.map).toHaveBeenCalledWith(process.argv.slice(2));
  expect(mocks.readMap).toHaveBeenCalledWith(process.argv.slice(2));
  expect(mocks.readRichText).toHaveBeenCalledWith(process.argv.slice(2));
  expect(mocks.page).toHaveBeenCalledWith(process.argv.slice(2));
});
