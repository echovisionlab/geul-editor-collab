export default {
  entry: {
    index: "index.ts",
  },
  format: ["esm"],
  target: "node24",
  outDir: "dist",
  clean: true,
  noExternal: [
    "@echovisionlab/geul-common",
    "@echovisionlab/geul-event",
    "@echovisionlab/geul-proto",
    "@echovisionlab/geul-telemetry",
  ],
  external: ["pg"],
};
