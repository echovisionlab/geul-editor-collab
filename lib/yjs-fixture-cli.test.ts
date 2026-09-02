import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  processBinaryFixtureCliDependencies,
  runDocumentStoreFixtureCli,
  runMapFixtureCli,
  runMapReadFixtureCli,
  runPageFixtureCli,
  runRichTextReadFixtureCli,
  type BinaryFixtureCliDependencies,
} from "./yjs-fixture-cli.ts";

function capture() {
  const outputs: Uint8Array[] = [];
  const errors: string[] = [];
  const exitCodes: number[] = [];
  const dependencies: BinaryFixtureCliDependencies = {
    writeOutput: (output) => outputs.push(output),
    writeError: (message) => errors.push(message),
    setExitCode: (code) => exitCodes.push(code),
  };
  return { dependencies, outputs, errors, exitCodes };
}

function decode(state: Uint8Array): Y.Doc {
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  return document;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Yjs fixture CLIs", () => {
  it("provides process-backed binary output, error, and exit-code dependencies", () => {
    const stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const previousExitCode = process.exitCode;

    processBinaryFixtureCliDependencies.writeOutput(Uint8Array.of(1));
    processBinaryFixtureCliDependencies.writeError("failed\n");
    processBinaryFixtureCliDependencies.setExitCode(7);

    expect(stdout).toHaveBeenCalledWith(Uint8Array.of(1));
    expect(stderr).toHaveBeenCalledWith("failed\n");
    expect(process.exitCode).toBe(7);
    process.exitCode = previousExitCode;
  });

  it("generates document-store fixtures for single and nested block arrays", () => {
    const single = capture();
    runDocumentStoreFixtureCli(
      [JSON.stringify({ type: "paragraph" })],
      single.dependencies,
    );
    expect(
      decode(single.outputs[0]!).getXmlFragment("document-store").length,
    ).toBeGreaterThan(0);

    const multiple = capture();
    runDocumentStoreFixtureCli(
      [
        JSON.stringify([
          {
            id: "parent",
            type: "paragraph",
            props: {},
            content: [],
            children: [
              {
                id: "child",
                type: "paragraph",
                props: {},
                content: [],
                children: [],
              },
            ],
          },
        ]),
      ],
      multiple.dependencies,
    );
    expect(
      decode(multiple.outputs[0]!).getXmlFragment("document-store").length,
    ).toBeGreaterThan(0);
  });

  it.each([
    [[], "Usage:"],
    [["{"], "Invalid JSON input"],
    [["null"], "every block requires a type"],
    [["1"], "every block requires a type"],
    [["{}"], "every block requires a type"],
  ] as const)("reports document-store input failures", (args, message) => {
    const result = capture();
    runDocumentStoreFixtureCli(args, result.dependencies);
    expect(result.outputs).toEqual([]);
    expect(result.errors.join("")).toContain(message);
    expect(result.exitCodes).toEqual([1]);
  });

  it("generates full and incremental map fixture updates", () => {
    const full = capture();
    runMapFixtureCli(
      ["release-fields", '{"title":"Release","tracks":[]}'],
      full.dependencies,
    );
    const fullDocument = decode(full.outputs[0]!);
    expect(fullDocument.getMap("release-fields").toJSON()).toEqual({
      title: "Release",
      tracks: [],
    });

    const base = new Y.Doc();
    base.getMap("release-fields").set("status", "draft");
    const baseState = Y.encodeStateAsUpdate(base);
    const incremental = capture();
    runMapFixtureCli(
      [
        "release-fields",
        '{"status":"published"}',
        Buffer.from(baseState).toString("base64"),
      ],
      incremental.dependencies,
    );
    const merged = new Y.Doc();
    Y.applyUpdate(merged, baseState);
    Y.applyUpdate(merged, incremental.outputs[0]!);
    expect(merged.getMap("release-fields").get("status")).toBe("published");
  });

  it.each([
    [[], "Usage:"],
    [["release-fields"], "Usage:"],
    [["release-fields", "{"], "Invalid JSON input"],
    [["release-fields", "null"], "expected an object"],
    [["release-fields", "[]"], "expected an object"],
  ] as const)("reports map fixture input failures", (args, message) => {
    const result = capture();
    runMapFixtureCli(args, result.dependencies);
    expect(result.errors.join("")).toContain(message);
    expect(result.exitCodes).toEqual([1]);
  });

  it("reads a map fixture as JSON for cross-repository assertions", () => {
    const generated = capture();
    runMapFixtureCli(
      ["release-fields", '{"tracks":"[{\\"id\\":\\"track-1\\"}]"}'],
      generated.dependencies,
    );
    const read = capture();
    runMapReadFixtureCli(
      ["release-fields", Buffer.from(generated.outputs[0]!).toString("base64")],
      read.dependencies,
    );

    expect(JSON.parse(new TextDecoder().decode(read.outputs[0]!))).toEqual({
      tracks: '[{"id":"track-1"}]',
    });
  });

  it.each([
    [[], "Usage:"],
    [["release-fields"], "Usage:"],
    [["release-fields", "not-yjs"], "Error"],
  ] as const)("reports map reader input failures", (args, message) => {
    const result = capture();
    runMapReadFixtureCli(args, result.dependencies);
    expect(result.errors.join("")).toContain(message);
    expect(result.exitCodes).toEqual([1]);
  });

  it.each([
    ["post", "document-store"],
    ["source", "document-store"],
  ] as const)(
    "reads %s rich-text blocks as JSON for cross-repository assertions",
    async (schemaName, fragmentName) => {
      const generated = capture();
      runDocumentStoreFixtureCli(
        [
          JSON.stringify({
            id: "media-1",
            type: "file",
            props: { fileId: "file-1" },
          }),
        ],
        generated.dependencies,
      );
      const read = capture();
      await runRichTextReadFixtureCli(
        [
          schemaName,
          fragmentName,
          Buffer.from(generated.outputs[0]!).toString("base64"),
        ],
        read.dependencies,
      );

      expect(JSON.parse(new TextDecoder().decode(read.outputs[0]!))).toEqual([
        expect.objectContaining({
          id: "media-1",
          type: "file",
          props: expect.objectContaining({ fileId: "file-1" }),
        }),
      ]);
    },
  );

  it("reads page rich-text blocks as JSON for cross-repository assertions", async () => {
    const generated = capture();
    runPageFixtureCli(
      [
        JSON.stringify([
          {
            id: "rich",
            type: "rich-text",
            content: [{ id: "media-1", type: "file" }],
          },
        ]),
      ],
      generated.dependencies,
    );
    const read = capture();
    await runRichTextReadFixtureCli(
      [
        "page",
        "section-rich",
        Buffer.from(generated.outputs[0]!).toString("base64"),
      ],
      read.dependencies,
    );

    expect(JSON.parse(new TextDecoder().decode(read.outputs[0]!))).toEqual([
      expect.objectContaining({ id: "media-1", type: "file" }),
    ]);
  });

  it.each([
    [[], "Usage:"],
    [["unknown", "document-store", "state"], "Unsupported rich-text schema"],
    [["post", "document-store", "not-yjs"], "Error"],
  ] as const)(
    "reports rich-text reader input failures",
    async (args, message) => {
      const result = capture();
      await runRichTextReadFixtureCli(args, result.dependencies);
      expect(result.errors.join("")).toContain(message);
      expect(result.exitCodes).toEqual([1]);
    },
  );

  it("generates raw, file-backed, fixture, and nested page section documents", () => {
    const sections = [
      {
        id: "rich",
        type: "rich-text",
        props: { align: "left" },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Page body", styles: {} }],
          },
        ],
      },
      { id: "empty-rich", type: "rich-text" },
      {
        id: "columns",
        type: "columns",
        columns: [
          {
            id: "column-1",
            sections: [
              { id: "nested", type: "rich-text", settings: {}, content: [] },
            ],
          },
        ],
      },
      { id: "empty-columns", type: "columns" },
      { id: "map", type: "map", settings: { width: "full" } },
    ];

    const raw = capture();
    runPageFixtureCli([JSON.stringify(sections)], raw.dependencies);
    const rawDocument = decode(raw.outputs[0]!);
    expect(rawDocument.getArray("sections").length).toBe(5);
    expect(rawDocument.getXmlFragment("section-rich").length).toBeGreaterThan(
      0,
    );
    expect(rawDocument.getXmlFragment("section-nested").length).toBeGreaterThan(
      0,
    );

    const directory = mkdtempSync(join(tmpdir(), "editor-yjs-fixture-"));
    const path = join(directory, "page.json");
    writeFileSync(path, JSON.stringify({ sections }));
    try {
      const file = capture();
      runPageFixtureCli(["--file", path], file.dependencies);
      expect(decode(file.outputs[0]!).getArray("sections").length).toBe(5);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }

    const fixture = capture();
    runPageFixtureCli(["--fixture", "page-blocks"], fixture.dependencies);
    expect(
      decode(fixture.outputs[0]!).getArray("sections").length,
    ).toBeGreaterThan(0);
  });

  it.each([
    [[], "Usage:"],
    [["--fixture"], "Unsupported fixture"],
    [["--fixture", "unknown"], "Unsupported fixture"],
    [["--file"], "--file requires a path"],
    [["{"], "Invalid JSON input"],
    [["{}"], "expected a sections array"],
    [["1"], "expected a sections array"],
  ] as const)("reports page fixture input failures", (args, message) => {
    const result = capture();
    runPageFixtureCli(args, result.dependencies);
    expect(result.errors.join("")).toContain(message);
    expect(result.exitCodes).toEqual([1]);
  });

  it("reports invalid JSON read through the file source", () => {
    const result = capture();
    runPageFixtureCli(["--file", "fixture.json"], result.dependencies, {
      readFile: () => "{",
      fixtureSections: () => [],
    });
    expect(result.errors.join("")).toContain("Invalid JSON file");
    expect(result.exitCodes).toEqual([1]);
  });
});
