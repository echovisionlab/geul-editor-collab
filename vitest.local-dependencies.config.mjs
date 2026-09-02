import { resolve } from "node:path";
import { mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

const commonRoot = resolve(import.meta.dirname, "../geul-common/src");
const eventRoot = resolve(
  import.meta.dirname,
  "../geul-event-contracts/packages/event/src",
);
const protoRoot = resolve(
  import.meta.dirname,
  "../geul-event-contracts/packages/proto/gen/api",
);
const telemetryRoot = resolve(import.meta.dirname, "../geul-telemetry/src");

export default mergeConfig(baseConfig, {
  resolve: {
    dedupe: ["yjs"],
    alias: [
      {
        find: /^@echovisionlab\/geul-common$/,
        replacement: resolve(commonRoot, "index.ts"),
      },
      {
        find: /^@echovisionlab\/geul-common\/(.+)$/,
        replacement: `${commonRoot}/$1`,
      },
      {
        find: /^@echovisionlab\/geul-event$/,
        replacement: resolve(eventRoot, "index.ts"),
      },
      {
        find: /^@echovisionlab\/geul-telemetry$/,
        replacement: resolve(telemetryRoot, "index.ts"),
      },
      {
        find: /^@echovisionlab\/geul-proto\/common\/(.+)$/,
        replacement: `${protoRoot}/common/v1/$1`,
      },
      {
        find: /^@echovisionlab\/geul-proto\/content\/(.+)$/,
        replacement: `${protoRoot}/content/v1/$1`,
      },
      {
        find: /^@echovisionlab\/geul-proto\/intra\/(.+)$/,
        replacement: `${protoRoot}/intra/v1/$1`,
      },
      {
        find: /^@echovisionlab\/geul-proto\/public\/(.+)$/,
        replacement: `${protoRoot}/open/v1/$1`,
      },
      {
        find: /^@echovisionlab\/geul-proto\/secure\/(.+)$/,
        replacement: `${protoRoot}/manage/v1/$1`,
      },
    ],
  },
});
