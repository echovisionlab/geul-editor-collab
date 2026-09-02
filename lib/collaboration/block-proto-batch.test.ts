import { toJson, type JsonValue } from "@bufbuild/protobuf";
import {
  PageSectionMutationBatchSchema,
  RichTextBlockMutationBatchSchema,
  RichTextProfile,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { describe, expect, it } from "vitest";
import type { BlockMutationBatch } from "./block-mutation-batch.ts";
import {
  createPageMutationBatch,
  createRichTextMutationBatch,
} from "./block-proto-batch.ts";
import type { BlockRoomLocaleData } from "./block-room-snapshot.ts";

const BLOCK_ID = "11111111-1111-4111-8111-111111111111";
const SECTION_ID = "22222222-2222-4222-8222-222222222222";

function batch(): BlockMutationBatch<JsonValue, BlockRoomLocaleData> {
  return {
    expectedDocumentRevision: "revision-1",
    blockCatalogFingerprint: "catalog-v1",
    profile: RichTextProfile.POST,
    baseMutations: [],
    locale: "en",
    localeMutations: [
      {
        operation: "upsert",
        blockId: BLOCK_ID,
        kind: "paragraph",
        data: { kind: "paragraph", payload: { content: [] } },
        adapterData: { family: "rich_text" },
      },
    ],
    affectedLocaleValueTargets: [],
    contributorMemberIds: ["member-1"],
  };
}

describe("source Block protobuf batches", () => {
  it("serializes exactly one source overlay group for rich text", () => {
    const result = createRichTextMutationBatch(batch());
    expect(result.localeMutationGroups).toHaveLength(1);
    expect(result.localeMutationGroups[0]?.locale).toBe("en");
    expect(result.localeMutationGroups[0]?.mutations).toHaveLength(1);
  });

  it("serializes no overlay group when source text did not change", () => {
    const input = batch();
    input.localeMutations = [];
    expect(createRichTextMutationBatch(input).localeMutationGroups).toEqual([]);
  });

  it("uses the same authoritative source group for Page", () => {
    const input = batch();
    input.localeMutations[0]!.adapterData = { family: "page_section" };
    if (input.localeMutations[0]!.operation === "upsert") {
      input.localeMutations[0]!.data = { kind: "map", payload: { props: {} } };
      input.localeMutations[0]!.kind = "map";
    }
    const result = createPageMutationBatch(input);
    expect(result.localeMutationGroups).toHaveLength(1);
    expect(result.localeMutationGroups[0]?.locale).toBe("en");
  });

  it("maps every standalone RichText mutation operation to generated oneofs", () => {
    const input = batch();
    input.baseMutations = [
      {
        operation: "upsert",
        block: {
          blockId: BLOCK_ID,
          parentBlockId: null,
          containerSlot: "content",
          position: 0,
          kind: "paragraph",
          baseData: { props: {} },
          adapterData: { family: "rich_text" },
        },
      },
      {
        operation: "move",
        blockId: BLOCK_ID,
        parentBlockId: SECTION_ID,
        containerSlot: "children",
        position: 1,
        kind: "paragraph",
      },
      { operation: "delete", blockId: SECTION_ID, kind: "paragraph" },
    ];
    input.localeMutations.push({
      operation: "delete",
      blockId: SECTION_ID,
      kind: "paragraph",
    });
    expect(
      toJson(
        RichTextBlockMutationBatchSchema,
        createRichTextMutationBatch(input),
      ),
    ).toMatchObject({
      baseMutations: [
        { upsert: { node: { block: { id: BLOCK_ID, paragraph: {} } } } },
        {
          move: {
            blockId: BLOCK_ID,
            placement: { index: 1, parentBlockId: SECTION_ID },
          },
        },
        { delete: { blockId: SECTION_ID } },
      ],
      localeMutationGroups: [
        {
          locale: "en",
          mutations: [
            { upsert: { block: { blockId: BLOCK_ID, paragraph: {} } } },
            { delete: { blockId: SECTION_ID } },
          ],
        },
      ],
    });
  });

  it("rejects a RichText batch without its generated profile", () => {
    const input = batch();
    input.profile = undefined;
    expect(() => createRichTextMutationBatch(input)).toThrow(
      "block_room_invalid:rich_text_profile",
    );
  });

  it("maps Page section upsert, move, delete, and source mutations", () => {
    const input = batch();
    input.profile = undefined;
    input.baseMutations = [
      {
        operation: "upsert",
        block: {
          blockId: SECTION_ID,
          parentBlockId: BLOCK_ID,
          containerSlot: "sections",
          position: 2,
          kind: "externalVideo",
          baseData: { props: {} },
          adapterData: { family: "page_section", columnId: "column-1" },
        },
      },
      {
        operation: "move",
        blockId: BLOCK_ID,
        parentBlockId: SECTION_ID,
        containerSlot: "sections",
        position: 3,
        kind: "externalVideo",
        adapterData: { family: "page_section", columnId: "column-1" },
      },
      {
        operation: "delete",
        blockId: SECTION_ID,
        kind: "externalVideo",
        adapterData: { family: "page_section" },
      },
    ];
    input.localeMutations = [
      {
        operation: "upsert",
        blockId: SECTION_ID,
        kind: "externalVideo",
        data: { kind: "externalVideo", payload: { props: {} } },
        adapterData: { family: "page_section" },
      },
      {
        operation: "delete",
        blockId: BLOCK_ID,
        kind: "externalVideo",
        adapterData: { family: "page_section" },
      },
    ];
    expect(
      toJson(PageSectionMutationBatchSchema, createPageMutationBatch(input)),
    ).toMatchObject({
      baseMutations: [
        {
          upsert: {
            node: {
              placement: {
                index: 2,
                parentSectionId: BLOCK_ID,
                columnId: "column-1",
              },
            },
          },
        },
        {
          move: {
            sectionId: BLOCK_ID,
            placement: {
              index: 3,
              parentSectionId: SECTION_ID,
              columnId: "column-1",
            },
          },
        },
        { delete: { sectionId: SECTION_ID } },
      ],
      localeMutationGroups: [
        {
          locale: "en",
          mutations: [
            { upsert: { section: { sectionId: SECTION_ID } } },
            { delete: { sectionId: BLOCK_ID } },
          ],
        },
      ],
    });
  });

  it("maps nested Page RichText base and source mutations through the owning section", () => {
    const input = batch();
    input.profile = undefined;
    input.baseMutations = [
      {
        operation: "move",
        blockId: BLOCK_ID,
        parentBlockId: SECTION_ID,
        containerSlot: "content",
        position: 2,
        kind: "paragraph",
        adapterData: { family: "rich_text", sectionId: SECTION_ID },
      },
    ];
    input.localeMutations = [
      {
        operation: "delete",
        blockId: BLOCK_ID,
        kind: "paragraph",
        adapterData: { family: "rich_text", sectionId: SECTION_ID },
      },
    ];
    expect(
      toJson(PageSectionMutationBatchSchema, createPageMutationBatch(input)),
    ).toMatchObject({
      baseMutations: [
        {
          mutateRichTextBlock: {
            sectionId: SECTION_ID,
            mutation: {
              move: { blockId: BLOCK_ID, placement: { index: 2 } },
            },
          },
        },
      ],
      localeMutationGroups: [
        {
          mutations: [
            {
              mutateRichTextBlock: {
                sectionId: SECTION_ID,
                mutation: { delete: { blockId: BLOCK_ID } },
              },
            },
          ],
        },
      ],
    });
  });

  it("maps root Page placement without optional parent or column", () => {
    const input = batch();
    input.profile = undefined;
    input.localeMutations = [];
    input.baseMutations = [
      {
        operation: "upsert",
        block: {
          blockId: SECTION_ID,
          parentBlockId: null,
          containerSlot: "sections",
          position: 0,
          kind: "map",
          baseData: { props: {} },
          adapterData: { family: "page_section" },
        },
      },
      {
        operation: "move",
        blockId: SECTION_ID,
        parentBlockId: null,
        containerSlot: "sections",
        position: 1,
        kind: "map",
        adapterData: { family: "page_section" },
      },
    ];
    const result = createPageMutationBatch(input);
    expect(result.baseMutations[0]?.operation).toMatchObject({
      case: "upsert",
      value: { node: { placement: { index: 0 } } },
    });
    expect(result.baseMutations[1]?.operation).toMatchObject({
      case: "move",
      value: { placement: { index: 1 } },
    });
  });

  it("maps Page settings beside the section value instead of into RichText", () => {
    const input = batch();
    input.profile = undefined;
    input.localeMutations = [];
    input.baseMutations = [
      {
        operation: "upsert",
        block: {
          blockId: SECTION_ID,
          parentBlockId: null,
          containerSlot: "sections",
          position: 0,
          kind: "richText",
          baseData: {
            props: {},
            settings: { maxWidth: "MAX_WIDTH_NARROW" },
          },
          adapterData: { family: "page_section" },
        },
      },
    ];

    expect(
      toJson(PageSectionMutationBatchSchema, createPageMutationBatch(input)),
    ).toMatchObject({
      baseMutations: [
        {
          upsert: {
            node: {
              section: {
                settings: { maxWidth: "MAX_WIDTH_NARROW" },
                richText: { props: {} },
              },
            },
          },
        },
      ],
    });
  });

  it.each([null, [], "invalid"])(
    "rejects a non-object Page section payload: %j",
    (baseData) => {
      const input = batch();
      input.profile = undefined;
      input.localeMutations = [];
      input.baseMutations = [
        {
          operation: "upsert",
          block: {
            blockId: SECTION_ID,
            parentBlockId: null,
            containerSlot: "sections",
            position: 0,
            kind: "richText",
            baseData,
            adapterData: { family: "page_section" },
          },
        },
      ];

      expect(() => createPageMutationBatch(input)).toThrow(
        "block_room_invalid:page_section_payload",
      );
    },
  );

  it("rejects unknown Page adapter families and missing RichText ownership", () => {
    const input = batch();
    input.profile = undefined;
    input.localeMutations = [];
    input.baseMutations = [
      {
        operation: "delete",
        blockId: BLOCK_ID,
        kind: "paragraph",
        adapterData: {},
      },
    ];
    expect(() => createPageMutationBatch(input)).toThrow(
      "block_room_invalid:base_mutation:delete:family",
    );
    input.baseMutations[0] = {
      operation: "delete",
      blockId: BLOCK_ID,
      kind: "paragraph",
      adapterData: { family: "rich_text" },
    };
    expect(() => createPageMutationBatch(input)).toThrow(
      "block_room_invalid:page_rich_section",
    );
    input.baseMutations = [];
    input.localeMutations = [
      {
        operation: "delete",
        blockId: BLOCK_ID,
        kind: "paragraph",
        adapterData: {},
      },
    ];
    expect(() => createPageMutationBatch(input)).toThrow(
      "block_room_invalid:locale_mutation:delete:family",
    );
  });
});
