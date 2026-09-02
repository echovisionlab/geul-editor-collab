import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

const defaultCoverageReporters = ["text", "lcov", "json-summary"] as const;
const defaultCoverageExcludes = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.stories.ts",
  "**/*.stories.tsx",
  "dist/**",
  "node_modules/**",
  // Operational entrypoints are intentionally thin wrappers around covered
  // library boundaries and require explicit operator credentials.
  "scripts/integration/**",
  "scripts/ops/**",
];

function resolveVitestMaxWorkers(
  packageEnvName: string,
  defaultMax: number,
): number | string {
  const configured =
    process.env[packageEnvName] ?? process.env.VITEST_MAX_WORKERS;

  if (configured) {
    return configured;
  }

  return Math.max(1, Math.min(defaultMax, availableParallelism()));
}

export default defineConfig({
  test: {
    env: {
      TOKEN_SIGNING_SECRET: "test-only-token-signing-secret-value",
      DATABASE_DSN: "postgres://collab:collab@127.0.0.1:5432/geul_test",
      MANAGED_MEDIA_ORIGINS: "https://example.test,http://localhost:3000",
    },
    environment: "node",
    pool: "forks",
    fileParallelism: true,
    isolate: true,
    maxWorkers: resolveVitestMaxWorkers("VITEST_COLLAB_MAX_WORKERS", 3),
    sequence: {
      concurrent: false,
    },
    include: ["**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: [...defaultCoverageReporters],
      include: [
        "env.ts",
        "events/**/*.ts",
        "handlers/**/*.ts",
        "index.ts",
        "lib/**/*.ts",
        "scripts/**/*.ts",
        "workers/**/*.ts",
      ],
      exclude: defaultCoverageExcludes,
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
