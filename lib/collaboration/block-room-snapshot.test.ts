import { fromJson, toJson } from "@bufbuild/protobuf";
import {
  getBlockRoomCollaborativeText,
  hydrateCanonicalBlockRoom,
  moveRichTextBlockNode,
} from "@echovisionlab/geul-common/collaboration/block-room-codec";
import { contentBlockCatalogFingerprint } from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedPageDocumentSchema,
  PageSectionMutationBatchSchema,
  type LocalizedPageDocument,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { BlockMutationBaseline } from "./block-mutation-batch.ts";
import { createPageMutationBatch } from "./block-proto-batch.ts";
import { decodeBlockRoomSnapshot } from "./block-room-snapshot.ts";

const BLOCK_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID_2 = "11111111-1111-4111-8111-111111111112";
const SECTION_ID = "22222222-2222-4222-8222-222222222222";

function pageDocument(): LocalizedPageDocument {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: SECTION_ID,
            richText: {
              props: {},
              blocks: {
                nodes: [
                  {
                    block: { id: BLOCK_ID, paragraph: { props: {} } },
                    placement: { index: 0 },
                  },
                  {
                    block: { id: BLOCK_ID_2, divider: { props: {} } },
                    placement: { index: 1 },
                  },
                ],
              },
            },
          },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      sections: [
        {
          sectionId: SECTION_ID,
          richText: {
            props: {},
            blocks: {
              locale: "ko",
              blocks: [
                {
                  blockId: BLOCK_ID,
                  paragraph: {
                    props: {},
                    content: [{ text: { text: "본문" } }],
                  },
                },
                {
                  blockId: BLOCK_ID_2,
                  divider: { props: {} },
                },
              ],
            },
          },
        },
      ],
    },
  }) as LocalizedPageDocument;
}

describe("Block room snapshot to generated Page batch", () => {
  it("keeps Page rich descendants separate and emits a nested move", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "page", "ko", pageDocument(), []);
    const before = decodeBlockRoomSnapshot(room, "page", "ko");
    const nested = before.blocks.find((block) => block.blockId === BLOCK_ID);
    expect(nested).toMatchObject({
      parentBlockId: SECTION_ID,
      containerSlot: "content",
      adapterData: { family: "rich_text", sectionId: SECTION_ID },
    });
    const baseline = new BlockMutationBaseline(before, "revision-1");

    moveRichTextBlockNode(
      room,
      BLOCK_ID,
      { index: 1 },
      {
        pageSectionId: SECTION_ID,
      },
    );
    const batch = baseline.prepareFull(
      decodeBlockRoomSnapshot(room, "page", "ko"),
      ["member-a"],
    );
    const generated = toJson(
      PageSectionMutationBatchSchema,
      createPageMutationBatch(batch),
    );

    expect(generated).toMatchObject({
      baseMutations: expect.arrayContaining([
        {
          mutateRichTextBlock: {
            sectionId: SECTION_ID,
            mutation: { move: { blockId: BLOCK_ID, placement: { index: 1 } } },
          },
        },
      ]),
      contributorMemberIds: ["member-a"],
    });
    expect(JSON.stringify(generated)).not.toContain("upsert");
  });

  it("emits a Page rich source edit without upserting the parent section", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "page", "ko", pageDocument(), []);
    const baseline = new BlockMutationBaseline(
      decodeBlockRoomSnapshot(room, "page", "ko"),
      "revision-1",
    );
    getBlockRoomCollaborativeText(room, {
      family: "rich_text",
      id: BLOCK_ID,
      locale: true,
      path: "content[0].text.text",
    }).insert(2, "!");

    const generated = toJson(
      PageSectionMutationBatchSchema,
      createPageMutationBatch(
        baseline.prepareFull(decodeBlockRoomSnapshot(room, "page", "ko"), [
          "member-a",
        ]),
      ),
    );

    expect(generated).not.toHaveProperty("baseMutations");
    expect(generated).toMatchObject({
      localeMutationGroups: [
        {
          locale: "ko",
          mutations: [
            {
              mutateRichTextBlock: {
                sectionId: SECTION_ID,
                mutation: { upsert: { block: { blockId: BLOCK_ID } } },
              },
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(generated)).not.toContain(
      `"sectionId":"${SECTION_ID}","richText"`,
    );
  });
});
