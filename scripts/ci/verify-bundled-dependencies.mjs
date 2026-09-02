import { readFile } from "node:fs/promises";

const bundle = await readFile(
  new URL("../../dist/index.js", import.meta.url),
  "utf8",
);
const bundledPackages = [
  "@echovisionlab/geul-common",
  "@echovisionlab/geul-event",
  "@echovisionlab/geul-proto",
  "@echovisionlab/geul-telemetry",
];
const importSpecifiers = [
  ...bundle.matchAll(
    /(?:from\s+|import\s*\()\s*["'](@echovisionlab\/geul-[^"']+)["']/gu,
  ),
].map((match) => match[1]);
const externalized = bundledPackages.filter((packageName) =>
  importSpecifiers.some(
    (specifier) =>
      specifier === packageName || specifier.startsWith(`${packageName}/`),
  ),
);

if (externalized.length > 0) {
  throw new Error(
    `Bundled TypeScript dependencies remain external: ${externalized.join(", ")}`,
  );
}

console.log("Geul TypeScript dependencies are bundled into dist/index.js");
