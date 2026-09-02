import { createHash } from "crypto";

export function computeHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
