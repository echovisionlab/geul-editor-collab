import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

const originals = new Map(
  [
    "TOKEN_SIGNING_SECRET",
    "DATABASE_DSN",
    "SITE_ORIGIN",
    "MANAGED_MEDIA_ORIGINS",
  ].map((name) => [name, process.env[name]]),
);

describe("environment contract", () => {
  afterEach(() => {
    for (const name of originals.keys()) {
      const original = originals.get(name);
      if (original === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = original;
      }
    }
    vi.resetModules();
  });

  it("uses one explicit runtime token-signing secret for caller trust", async () => {
    process.env.TOKEN_SIGNING_SECRET = "configured-token-signing-secret-value";
    process.env.SITE_ORIGIN = "https://site.example.com";
    vi.resetModules();

    const { env } = await import("./env.ts");

    expect(env.TOKEN_SIGNING_SECRET).toBe(
      "configured-token-signing-secret-value",
    );
    expect(env.SHUTDOWN_TIMEOUT_MS).toBe(25_000);
    expect(env.DATABASE_DSN).toBeTruthy();
    expect(env.SITE_ORIGIN).toBe("https://site.example.com");
    expect(env.MANAGED_MEDIA_ORIGINS).toBe(
      "https://example.test,http://localhost:3000",
    );
    process.env.MANAGED_MEDIA_ORIGINS = " , https://example.test/media";
    vi.resetModules();

    await expect(import("./lib/durable-media/constants.ts")).rejects.toThrow(
      "MANAGED_MEDIA_ORIGINS must contain absolute HTTP(S) origins",
    );
  });

  it("maps only the canonical deployment secret into the container", async () => {
    const compose = await readFile(
      new URL("./compose/collab.yml", import.meta.url),
      "utf8",
    );

    expect(compose).toContain(
      "TOKEN_SIGNING_SECRET: ${GEUL_BACKEND_TOKEN_SIGNING_SECRET:?set GEUL_BACKEND_TOKEN_SIGNING_SECRET for trusted backend calls}",
    );
    expect(compose).toContain(
      "SHUTDOWN_TIMEOUT_MS: ${GEUL_COLLAB_SHUTDOWN_TIMEOUT_MS:-25000}",
    );
    expect(compose).toContain("DATABASE_DSN: ${GEUL_COLLAB_DATABASE_DSN");
    expect(compose).toContain("SITE_ORIGIN: ${GEUL_SITE_ORIGIN");
    expect(compose).toContain(
      "MANAGED_MEDIA_ORIGINS: ${GEUL_MANAGED_MEDIA_ORIGINS:?set GEUL_MANAGED_MEDIA_ORIGINS to comma-separated absolute media origins}",
    );
    expect(compose).toContain(
      "stop_grace_period: ${GEUL_COLLAB_STOP_GRACE_PERIOD:-180s}",
    );
  });
});
