import assert from "node:assert/strict";
import test from "node:test";

import {
  createBuildManifest,
  createDependencyManifest,
} from "./docker-package-manifests.mjs";

test("Docker dependency manifest ignores release and build-only metadata", () => {
  const source = {
    name: "@echovisionlab/geul-editor-collab",
    version: "1.2.3",
    private: true,
    type: "module",
    scripts: { build: "tsup", test: "vitest run" },
    dependencies: { zod: "4.4.3" },
    devDependencies: { tsup: "8.5.1" },
    repository: { type: "git", url: "https://example.test/repository.git" },
  };

  assert.deepEqual(createDependencyManifest(source), {
    name: "@echovisionlab/geul-editor-collab",
    private: true,
    type: "module",
    dependencies: { zod: "4.4.3" },
    devDependencies: { tsup: "8.5.1" },
  });
});

test("Docker dependency manifest preserves install lifecycle semantics", () => {
  const source = {
    name: "@echovisionlab/geul-editor-collab",
    version: "1.2.3",
    scripts: { preinstall: "node preinstall.mjs", build: "tsup" },
  };

  assert.deepEqual(createDependencyManifest(source), {
    name: "@echovisionlab/geul-editor-collab",
    version: "1.2.3",
    scripts: { preinstall: "node preinstall.mjs" },
  });
});

test("Docker build manifest excludes only the release version", () => {
  const source = {
    name: "@echovisionlab/geul-editor-collab",
    version: "1.2.3",
    scripts: { build: "tsup" },
    dependencies: { zod: "4.4.3" },
  };

  assert.deepEqual(createBuildManifest(source), {
    name: "@echovisionlab/geul-editor-collab",
    scripts: { build: "tsup" },
    dependencies: { zod: "4.4.3" },
  });
  assert.equal(source.version, "1.2.3");
});
