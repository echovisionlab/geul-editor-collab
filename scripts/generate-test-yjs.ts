#!/usr/bin/env npx tsx
import { runDocumentStoreFixtureCli } from "../lib/yjs-fixture-cli.ts";

runDocumentStoreFixtureCli(process.argv.slice(2));
