#!/usr/bin/env npx tsx
import { runRichTextReadFixtureCli } from "../lib/yjs-fixture-cli.ts";

await runRichTextReadFixtureCli(process.argv.slice(2));
