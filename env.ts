import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const parsedEnv = createEnv({
  server: {
    PORT: z.coerce.number().default(3003),
    HEALTH_PORT: z.coerce.number().default(3004),
    SHUTDOWN_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(25_000),
    DATABASE_DSN: z.string().min(1),
    API_URL: z.string().default("http://localhost:8000"),
    SITE_ORIGIN: z.string().url().default("http://localhost:3000"),
    MANAGED_MEDIA_ORIGINS: z.string().min(1),
    TOKEN_SIGNING_SECRET: z.string().min(32),
  },
  runtimeEnv: process.env,
});

export const env = parsedEnv;
