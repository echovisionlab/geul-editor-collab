import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createPageBlockFixtureSections } from "@echovisionlab/geul-common/page";
import * as Y from "yjs";
import {
  replaceGeulBlocksInYXmlFragment,
  yXmlFragmentToGeulDocument,
  type GeulRichTextSchema,
} from "./convert/tiptap-document.ts";

export interface BinaryFixtureCliDependencies {
  writeOutput(output: Uint8Array): void;
  writeError(message: string): void;
  setExitCode(code: number): void;
}

export const processBinaryFixtureCliDependencies: BinaryFixtureCliDependencies =
  {
    writeOutput: (output) => process.stdout.write(output),
    writeError: (message) => process.stderr.write(message),
    setExitCode: (code) => {
      process.exitCode = code;
    },
  };

interface BlockInput {
  id?: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown[];
  children?: BlockInput[];
}

interface PageFixtureSection {
  id: string;
  type: string;
  settings?: Record<string, unknown>;
  props?: Record<string, unknown>;
  content?: BlockInput[];
  columns?: Array<{ id: string; sections: PageFixtureSection[] }>;
}

interface PageFixtureSourceDependencies {
  readFile(path: string): string;
  fixtureSections(): unknown[];
}

const defaultPageFixtureSourceDependencies: PageFixtureSourceDependencies = {
  readFile: (path) => readFileSync(path, "utf8"),
  fixtureSections: () => createPageBlockFixtureSections(),
};

function parseJson(input: string, label: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${String(error)}`);
  }
}

function runBinaryFixtureCli(
  generate: () => Uint8Array,
  dependencies: BinaryFixtureCliDependencies,
): void {
  try {
    dependencies.writeOutput(generate());
  } catch (error) {
    dependencies.writeError(`${String(error)}\n`);
    dependencies.setExitCode(1);
  }
}

function normalizeBlock(block: BlockInput): Required<BlockInput> {
  return {
    id: block.id ?? `block-${randomUUID()}`,
    type: block.type,
    props: block.props ?? {},
    content: block.content ?? [],
    children: (block.children ?? []).map(normalizeBlock),
  };
}

function parseBlocks(input: string): BlockInput[] {
  const parsed = parseJson(input, "JSON input");
  const blocks = Array.isArray(parsed) ? parsed : [parsed];
  if (
    blocks.some(
      (block) =>
        !block ||
        typeof block !== "object" ||
        typeof (block as BlockInput).type !== "string",
    )
  ) {
    throw new Error("Invalid JSON input: every block requires a type");
  }
  return blocks as BlockInput[];
}

function generateDocumentStoreState(input: string): Uint8Array {
  const document = new Y.Doc();
  replaceGeulBlocksInYXmlFragment(
    document.getXmlFragment("document-store"),
    parseBlocks(input).map(normalizeBlock),
    "editor",
  );
  return Y.encodeStateAsUpdate(document);
}

export function runDocumentStoreFixtureCli(
  args: readonly string[],
  dependencies: BinaryFixtureCliDependencies = processBinaryFixtureCliDependencies,
): void {
  runBinaryFixtureCli(() => {
    if (!args[0]) {
      throw new Error("Usage: generate-test-yjs.ts <block-json>");
    }
    return generateDocumentStoreState(args[0]);
  }, dependencies);
}

function parseMapFields(input: string): Record<string, unknown> {
  const parsed = parseJson(input, "JSON input");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid JSON input: expected an object");
  }
  return parsed as Record<string, unknown>;
}

function generateMapState(
  mapName: string,
  fieldsInput: string,
  baseStateBase64?: string,
): Uint8Array {
  const document = new Y.Doc();
  if (baseStateBase64) {
    Y.applyUpdate(document, Buffer.from(baseStateBase64, "base64"));
  }
  const before = baseStateBase64 ? Y.encodeStateVector(document) : undefined;
  const map = document.getMap(mapName);
  document.transact(() => {
    for (const [key, value] of Object.entries(parseMapFields(fieldsInput))) {
      map.set(key, value);
    }
  });
  return before
    ? Y.encodeStateAsUpdate(document, before)
    : Y.encodeStateAsUpdate(document);
}

export function runMapFixtureCli(
  args: readonly string[],
  dependencies: BinaryFixtureCliDependencies = processBinaryFixtureCliDependencies,
): void {
  runBinaryFixtureCli(() => {
    const [mapName, fieldsInput, baseStateBase64] = args;
    if (!mapName || !fieldsInput) {
      throw new Error(
        "Usage: generate-test-yjs-map.ts <map-name> <field-json> [base64-state]",
      );
    }
    return generateMapState(mapName, fieldsInput, baseStateBase64);
  }, dependencies);
}

export function runMapReadFixtureCli(
  args: readonly string[],
  dependencies: BinaryFixtureCliDependencies = processBinaryFixtureCliDependencies,
): void {
  runBinaryFixtureCli(() => {
    const [mapName, stateBase64] = args;
    if (!mapName || !stateBase64) {
      throw new Error("Usage: read-test-yjs-map.ts <map-name> <base64-state>");
    }
    const document = new Y.Doc();
    Y.applyUpdate(document, Buffer.from(stateBase64, "base64"));
    return new TextEncoder().encode(
      JSON.stringify(document.getMap(mapName).toJSON()),
    );
  }, dependencies);
}

export async function runRichTextReadFixtureCli(
  args: readonly string[],
  dependencies: BinaryFixtureCliDependencies = processBinaryFixtureCliDependencies,
): Promise<void> {
  try {
    const [schemaName, fragmentName, stateBase64] = args;
    if (!schemaName || !fragmentName || !stateBase64) {
      throw new Error(
        "Usage: read-test-rich-text-yjs.ts <post|source|page> <fragment-name> <base64-state>",
      );
    }

    const richTextSchema: GeulRichTextSchema = (() => {
      switch (schemaName) {
        case "post":
          return "post";
        case "source":
          return "editor";
        case "page":
          return "page";
        default:
          throw new Error(`Unsupported rich-text schema: ${schemaName}`);
      }
    })();
    const document = new Y.Doc();
    Y.applyUpdate(document, Buffer.from(stateBase64, "base64"));
    const { blocks } = yXmlFragmentToGeulDocument(
      document.getXmlFragment(fragmentName),
      richTextSchema,
    );
    dependencies.writeOutput(new TextEncoder().encode(JSON.stringify(blocks)));
  } catch (error) {
    dependencies.writeError(`${String(error)}\n`);
    dependencies.setExitCode(1);
  }
}

function normalizePageSection(
  section: PageFixtureSection,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    id: section.id,
    type: section.type,
    settings: section.settings ?? {},
  };
  if (section.props) {
    normalized.props = section.props;
  }
  if (section.type === "columns" && section.columns) {
    normalized.columns = section.columns.map((column) => ({
      id: column.id,
      sections: column.sections.map(normalizePageSection),
    }));
  }
  return normalized;
}

function writePageRichTextFragments(
  document: Y.Doc,
  sections: PageFixtureSection[],
): void {
  for (const section of sections) {
    if (section.type === "rich-text") {
      replaceGeulBlocksInYXmlFragment(
        document.getXmlFragment(`section-${section.id}`),
        (section.content ?? []).map(normalizeBlock),
        "page",
      );
    }
    if (section.type === "columns" && section.columns) {
      for (const column of section.columns) {
        writePageRichTextFragments(document, column.sections);
      }
    }
  }
}

function parsePageSections(value: unknown): PageFixtureSection[] {
  let sections: unknown;
  if (Array.isArray(value)) {
    sections = value;
  } else if (value && typeof value === "object") {
    sections = (value as { sections?: unknown }).sections;
  }
  if (!Array.isArray(sections)) {
    throw new Error("Invalid page JSON: expected a sections array");
  }
  return sections as PageFixtureSection[];
}

function loadPageSections(
  args: readonly string[],
  sources: PageFixtureSourceDependencies,
): PageFixtureSection[] {
  if (args[0] === "--fixture" && args[1] !== "page-blocks") {
    throw new Error(`Unsupported fixture: ${args[1] ?? ""}`);
  }
  if (args[0] === "--fixture") {
    return parsePageSections(sources.fixtureSections());
  }
  if (args[0] === "--file" && !args[1]) {
    throw new Error("--file requires a path");
  }
  if (args[0] === "--file") {
    return parsePageSections(parseJson(sources.readFile(args[1]), "JSON file"));
  }
  if (!args[0]) {
    throw new Error(
      "Usage: generate-test-page-yjs.ts <sections-json|--file path|--fixture page-blocks>",
    );
  }
  return parsePageSections(parseJson(args[0], "JSON input"));
}

function generatePageState(
  args: readonly string[],
  sources: PageFixtureSourceDependencies,
): Uint8Array {
  const sections = loadPageSections(args, sources);
  const document = new Y.Doc();
  document.transact(() => {
    document.getArray("sections").push(sections.map(normalizePageSection));
    writePageRichTextFragments(document, sections);
  });
  return Y.encodeStateAsUpdate(document);
}

export function runPageFixtureCli(
  args: readonly string[],
  dependencies: BinaryFixtureCliDependencies = processBinaryFixtureCliDependencies,
  sources: PageFixtureSourceDependencies = defaultPageFixtureSourceDependencies,
): void {
  runBinaryFixtureCli(() => generatePageState(args, sources), dependencies);
}
