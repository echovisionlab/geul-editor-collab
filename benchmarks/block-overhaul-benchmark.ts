import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, totalmem } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  create,
  fromBinary,
  fromJsonString,
  toBinary,
  toJsonString,
} from "@bufbuild/protobuf";
import * as Y from "yjs";
import {
  RichTextBlockMutationBatchSchema,
  RichTextProfile,
  type RichTextBlockMutationBatch,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import {
  replaceGeulBlocksInYXmlFragment,
  yXmlFragmentToGeulDocument,
} from "../lib/convert/tiptap-document.ts";
import {
  BlockMutationBaseline,
  type BlockMutationBatch,
  type CanonicalBlock,
  type CanonicalBlockDocument,
} from "../lib/collaboration/block-mutation-batch.ts";

const COUNTS = [1, 10, 100, 1_000] as const;
const TEXT =
  "A representative paragraph body used for repeatable Block persistence measurement.";
let sink = 0;
const yjsFixtureDirectory = process.env.BENCHMARK_YJS_FIXTURE_DIR;

interface Measurement {
  label: string;
  iterations: number;
  microsecondsPerOperation: number;
  userCpuMicrosecondsPerOperation: number;
  systemCpuMicrosecondsPerOperation: number;
}

interface ScenarioResult {
  blocks: number;
  autosaveDecodeCounts: {
    beforeFullNodes: number;
    afterAffectedNodes: number;
  };
  payloadBytes: {
    yjsRawSingleEdit: number;
    yjsRawFullReorder: number;
    yjsJsonSingleEdit: number;
    yjsJsonFullReorder: number;
    typedJsonSingleEdit: number;
    typedJsonFullReorder: number;
    typedProtoBinarySingleEdit: number;
    typedProtoBinaryFullReorder: number;
    typedProtoJsonSingleEdit: number;
    typedProtoJsonFullReorder: number;
  };
  timings: Measurement[];
}

function blockId(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

function editorBlocks(
  count: number,
  reverse = false,
  edited = false,
): unknown[] {
  const indices = Array.from({ length: count }, (_, index) => index);
  if (reverse) indices.reverse();
  return indices.map((index) => ({
    id: blockId(index),
    type: "paragraph",
    props: {
      backgroundColor: "default",
      textAlignment: "left",
      textColor: "default",
    },
    content: [
      {
        type: "text",
        text: `${TEXT} #${index}${edited && index === 0 ? " edited" : ""}`,
        styles: {},
      },
    ],
    children: [],
  }));
}

function canonicalDocument(
  count: number,
  reverse = false,
  edited = false,
): CanonicalBlockDocument {
  const order = Array.from({ length: count }, (_, index) => index);
  if (reverse) order.reverse();
  const positions = new Map(order.map((index, position) => [index, position]));
  const blocks: CanonicalBlock[] = Array.from(
    { length: count },
    (_, index) => ({
      blockId: blockId(index),
      parentBlockId: null,
      containerSlot: "body",
      position: positions.get(index)!,
      kind: "paragraph",
      baseData: {
        backgroundColor: "default",
        textAlignment: "left",
        textColor: "default",
      },
      localeData: {
        text: `${TEXT} #${index}${edited && index === 0 ? " edited" : ""}`,
      },
    }),
  );
  return {
    blockCatalogFingerprint: "benchmark-catalog-v1",
    profile: RichTextProfile.POST,
    sourceLocale: "en",
    locale: "en",
    blocks,
  };
}

function yjsState(blocks: unknown[]): Uint8Array {
  const document = new Y.Doc();
  // Yjs production client IDs are random uint32 values. Fix a five-byte
  // representative value so wire sizes are stable without unrealistically
  // benefiting from the one-byte test client ID.
  document.clientID = 3_000_000_000;
  replaceGeulBlocksInYXmlFragment(
    document.getXmlFragment("document-store"),
    blocks,
    "editor",
  );
  return Y.encodeStateAsUpdate(document);
}

function yjsDocument(state: Uint8Array): Y.Doc {
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  return document;
}

function yjsJsonBytes(state: Uint8Array): number {
  return Buffer.byteLength(
    JSON.stringify({ yjsState: Buffer.from(state).toString("base64") }),
  );
}

function typedJsonBytes(batch: BlockMutationBatch): number {
  return Buffer.byteLength(JSON.stringify({ batch }));
}

function protoEditBatch(): RichTextBlockMutationBatch {
  return create(RichTextBlockMutationBatchSchema, {
    blockCatalogFingerprint: "f".repeat(64),
    profile: RichTextProfile.POST,
    expectedRevision: "00000000-0000-4000-8000-000000000001",
    localeMutationGroups: [
      {
        locale: "en",
        mutations: [
          {
            operation: {
              case: "upsert",
              value: {
                block: {
                  blockId: blockId(0),
                  value: {
                    case: "paragraph",
                    value: {
                      content: [
                        {
                          value: {
                            case: "text",
                            value: { text: `${TEXT} #0 edited`, styles: {} },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
        ],
      },
    ],
    contributorMemberIds: ["member-1"],
  });
}

function protoReorderBatch(count: number): RichTextBlockMutationBatch {
  return create(RichTextBlockMutationBatchSchema, {
    blockCatalogFingerprint: "f".repeat(64),
    profile: RichTextProfile.POST,
    expectedRevision: "00000000-0000-4000-8000-000000000001",
    baseMutations: Array.from({ length: count }, (_, index) => ({
      operation: {
        case: "move" as const,
        value: {
          blockId: blockId(index),
          placement: { index: count - index - 1 },
        },
      },
    })),
    contributorMemberIds: ["member-1"],
  });
}

function iterationsFor(count: number): number {
  if (count >= 1_000) return 100;
  if (count >= 100) return 500;
  if (count >= 10) return 2_000;
  return 5_000;
}

function measure(
  label: string,
  iterations: number,
  operation: () => number,
): Measurement {
  const warmup = Math.min(100, iterations);
  for (let index = 0; index < warmup; index += 1) sink ^= operation();
  const cpuBefore = process.cpuUsage();
  const started = performance.now();
  for (let index = 0; index < iterations; index += 1) sink ^= operation();
  const elapsedMilliseconds = performance.now() - started;
  const cpu = process.cpuUsage(cpuBefore);
  return {
    label,
    iterations,
    microsecondsPerOperation: (elapsedMilliseconds * 1_000) / iterations,
    userCpuMicrosecondsPerOperation: cpu.user / iterations,
    systemCpuMicrosecondsPerOperation: cpu.system / iterations,
  };
}

function yjsDecodeAndValidate(state: Uint8Array): number {
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  return yXmlFragmentToGeulDocument(
    document.getXmlFragment("document-store"),
    "editor",
  ).blocks.length;
}

function mutationBatch(
  baseline: CanonicalBlockDocument,
  next: CanonicalBlockDocument,
): BlockMutationBatch {
  return new BlockMutationBaseline(baseline, "revision-1").prepareFull(next, [
    "member-1",
  ]);
}

function blockDiffMeasurement(
  count: number,
  first: CanonicalBlockDocument,
  second: CanonicalBlockDocument,
  iterations: number,
  label: string,
): Measurement {
  const baseline = new BlockMutationBaseline(first, "revision-0");
  let forward = true;
  let revision = 0;
  return measure(label, iterations, () => {
    const batch = baseline.prepareFull(forward ? second : first, ["member-1"]);
    const changed =
      batch.baseMutations.length > 0 || batch.localeMutations.length > 0;
    if (changed) {
      revision += 1;
      baseline.acknowledge({
        documentRevision: `revision-${revision}`,
        changed: true,
        sourceChanged: true,
      });
    }
    forward = !forward;
    return batch.baseMutations.length + batch.localeMutations.length;
  });
}

function affectedBlockDiffMeasurement(
  first: CanonicalBlockDocument,
  second: CanonicalBlockDocument,
  iterations: number,
): Measurement {
  const baseline = new BlockMutationBaseline(first, "revision-0");
  let forward = true;
  let revision = 0;
  return measure("typed_validate_diff_affected_single_edit", iterations, () => {
    const next = forward ? second : first;
    const affected = next.blocks[0]!;
    const batch = baseline.prepareAffected(
      {
        locale: "en",
        blocks: [affected],
        affectedBaseBlockIds: [],
        deletedBaseBlockIds: [],
        affectedLocaleBlockIds: [affected.blockId],
        deletedLocaleBlockIds: [],
      },
      ["member-1"],
    );
    revision += 1;
    baseline.acknowledge({
      documentRevision: `revision-${revision}`,
      changed: true,
      sourceChanged: true,
    });
    forward = !forward;
    return batch.localeMutations.length;
  });
}

function scenario(count: number): ScenarioResult {
  const iterations = iterationsFor(count);
  const originalBlocks = editorBlocks(count);
  const editedBlocks = editorBlocks(count, false, true);
  const reversedBlocks = editorBlocks(count, true);
  const originalState = yjsState(originalBlocks);
  const editedState = yjsState(editedBlocks);
  const reversedState = yjsState(reversedBlocks);
  if (yjsFixtureDirectory) {
    mkdirSync(yjsFixtureDirectory, { recursive: true });
    writeFileSync(
      join(yjsFixtureDirectory, `${count}-original.bin`),
      originalState,
    );
    writeFileSync(
      join(yjsFixtureDirectory, `${count}-edited.bin`),
      editedState,
    );
    writeFileSync(
      join(yjsFixtureDirectory, `${count}-reversed.bin`),
      reversedState,
    );
  }
  const originalDocument = yjsDocument(originalState);
  const editedDocument = yjsDocument(editedState);
  const reversedDocument = yjsDocument(reversedState);
  const originalTyped = canonicalDocument(count);
  const editedTyped = canonicalDocument(count, false, true);
  const reversedTyped = canonicalDocument(count, true);
  const editBatch = mutationBatch(originalTyped, editedTyped);
  const reorderBatch = mutationBatch(originalTyped, reversedTyped);
  const editProto = protoEditBatch();
  const reorderProto = protoReorderBatch(count);
  const editJson = JSON.stringify({ batch: editBatch });
  const reorderJson = JSON.stringify({ batch: reorderBatch });
  const editProtoBinary = toBinary(RichTextBlockMutationBatchSchema, editProto);
  const reorderProtoBinary = toBinary(
    RichTextBlockMutationBatchSchema,
    reorderProto,
  );
  const editProtoJson = toJsonString(
    RichTextBlockMutationBatchSchema,
    editProto,
  );
  const reorderProtoJson = toJsonString(
    RichTextBlockMutationBatchSchema,
    reorderProto,
  );

  return {
    blocks: count,
    autosaveDecodeCounts: {
      beforeFullNodes: count,
      afterAffectedNodes: 1,
    },
    payloadBytes: {
      yjsRawSingleEdit: editedState.byteLength,
      yjsRawFullReorder: reversedState.byteLength,
      yjsJsonSingleEdit: yjsJsonBytes(editedState),
      yjsJsonFullReorder: yjsJsonBytes(reversedState),
      typedJsonSingleEdit: typedJsonBytes(editBatch),
      typedJsonFullReorder: count === 1 ? 0 : typedJsonBytes(reorderBatch),
      typedProtoBinarySingleEdit: editProtoBinary.byteLength,
      typedProtoBinaryFullReorder:
        count === 1 ? 0 : reorderProtoBinary.byteLength,
      typedProtoJsonSingleEdit: Buffer.byteLength(editProtoJson),
      typedProtoJsonFullReorder:
        count === 1 ? 0 : Buffer.byteLength(reorderProtoJson),
    },
    timings: [
      measure(
        "yjs_encode_snapshot_single_edit",
        iterations,
        () => Y.encodeStateAsUpdate(editedDocument).byteLength,
      ),
      measure(
        "yjs_encode_snapshot_full_reorder",
        iterations,
        () => Y.encodeStateAsUpdate(reversedDocument).byteLength,
      ),
      measure("yjs_decode_validate_single_edit", iterations, () =>
        yjsDecodeAndValidate(editedState),
      ),
      measure("yjs_decode_validate_full_reorder", iterations, () =>
        yjsDecodeAndValidate(reversedState),
      ),
      blockDiffMeasurement(
        count,
        originalTyped,
        editedTyped,
        iterations,
        "typed_validate_diff_single_edit",
      ),
      affectedBlockDiffMeasurement(originalTyped, editedTyped, iterations),
      blockDiffMeasurement(
        count,
        originalTyped,
        reversedTyped,
        iterations,
        "typed_validate_diff_full_reorder",
      ),
      measure("typed_json_encode_single_edit", iterations, () =>
        Buffer.byteLength(JSON.stringify({ batch: editBatch })),
      ),
      measure(
        "typed_json_decode_single_edit",
        iterations,
        () => Object.keys(JSON.parse(editJson) as object).length,
      ),
      measure("typed_json_encode_full_reorder", iterations, () =>
        Buffer.byteLength(JSON.stringify({ batch: reorderBatch })),
      ),
      measure(
        "typed_json_decode_full_reorder",
        iterations,
        () => Object.keys(JSON.parse(reorderJson) as object).length,
      ),
      measure(
        "typed_proto_binary_encode_single_edit",
        iterations,
        () => toBinary(RichTextBlockMutationBatchSchema, editProto).byteLength,
      ),
      measure(
        "typed_proto_binary_decode_single_edit",
        iterations,
        () =>
          fromBinary(RichTextBlockMutationBatchSchema, editProtoBinary)
            .localeMutationGroups.length,
      ),
      measure("typed_proto_json_encode_single_edit", iterations, () =>
        Buffer.byteLength(
          toJsonString(RichTextBlockMutationBatchSchema, editProto),
        ),
      ),
      measure(
        "typed_proto_json_decode_single_edit",
        iterations,
        () =>
          fromJsonString(RichTextBlockMutationBatchSchema, editProtoJson)
            .localeMutationGroups.length,
      ),
      measure(
        "typed_proto_binary_encode_full_reorder",
        iterations,
        () =>
          toBinary(RichTextBlockMutationBatchSchema, reorderProto).byteLength,
      ),
      measure(
        "typed_proto_binary_decode_full_reorder",
        iterations,
        () =>
          fromBinary(RichTextBlockMutationBatchSchema, reorderProtoBinary)
            .baseMutations.length,
      ),
      measure("typed_proto_json_encode_full_reorder", iterations, () =>
        Buffer.byteLength(
          toJsonString(RichTextBlockMutationBatchSchema, reorderProto),
        ),
      ),
      measure(
        "typed_proto_json_decode_full_reorder",
        iterations,
        () =>
          fromJsonString(RichTextBlockMutationBatchSchema, reorderProtoJson)
            .baseMutations.length,
      ),
      measure(
        "yjs_encode_snapshot_unedited_control",
        iterations,
        () => Y.encodeStateAsUpdate(originalDocument).byteLength,
      ),
    ],
  };
}

const result = {
  environment: {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    cpu: cpus()[0]?.model ?? "unknown",
    logicalCpus: cpus().length,
    memoryBytes: totalmem(),
    command: "pnpm exec tsx benchmarks/block-overhaul-benchmark.ts",
    workload: `${TEXT.length}-character paragraph, one locale, 1/10/100/1000 flat root Blocks`,
    note: "Fresh compact Yjs snapshots with a representative uint32 client ID; production history can only increase Yjs snapshot size.",
  },
  scenarios: COUNTS.map(scenario),
  sink,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
