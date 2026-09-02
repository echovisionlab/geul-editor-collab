import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

const decodeCanonicalBlockRoom = vi.hoisted(() => vi.fn());
vi.mock("@echovisionlab/geul-common/collaboration/block-room-codec", () => ({
  decodeCanonicalBlockRoom,
}));

import { decodeBlockRoomSnapshot } from "./block-room-snapshot.ts";

const CHILD = "11111111-1111-4111-8111-111111111111";
const PARENT = "22222222-2222-4222-8222-222222222222";

function decoded(
  parentId: string | null,
  nodes: Array<Record<string, unknown>> = [],
) {
  return {
    document: {
      $typeName: "api.content.v1.LocalizedPageDocument",
      blockCatalogFingerprint: "catalog",
      locale: "ko",
    },
    baseNodes: [
      {
        id: CHILD,
        parentId,
        family: "rich_text",
        containerSlot: "content",
        position: 0,
        kind: "paragraph",
        payload: {},
      },
      ...nodes,
    ],
    localeOverlay: [],
  };
}

describe("block room snapshot parent validation", () => {
  it("rejects a missing Page rich-text parent", () => {
    decodeCanonicalBlockRoom.mockReturnValue(decoded(PARENT));
    expect(() => decodeBlockRoomSnapshot(new Y.Doc(), "page", "ko")).toThrow(
      `block_room_invalid:base_node:${CHILD}:missing_parent`,
    );
  });

  it("rejects a parent cycle", () => {
    decodeCanonicalBlockRoom.mockReturnValue(
      decoded(PARENT, [
        {
          id: PARENT,
          parentId: CHILD,
          family: "rich_text",
          containerSlot: "content",
          position: 0,
          kind: "paragraph",
          payload: {},
        },
      ]),
    );
    expect(() => decodeBlockRoomSnapshot(new Y.Doc(), "page", "ko")).toThrow(
      `block_room_invalid:base_node:${CHILD}:parent_cycle`,
    );
  });

  it("rejects a detached rich-text root without a Page section ancestor", () => {
    decodeCanonicalBlockRoom.mockReturnValue(decoded(null));
    expect(() => decodeBlockRoomSnapshot(new Y.Doc(), "page", "ko")).toThrow(
      `block_room_invalid:base_node:${CHILD}:missing_section_parent`,
    );
  });

  it("records the nearest Page section and column adapter identity", () => {
    decodeCanonicalBlockRoom.mockReturnValue(
      decoded(PARENT, [
        {
          id: PARENT,
          parentId: null,
          family: "page_section",
          containerSlot: "sections",
          columnId: "column-1",
          position: 0,
          kind: "rich-text",
          payload: {},
        },
      ]),
    );
    expect(decodeBlockRoomSnapshot(new Y.Doc(), "page", "ko").blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          adapterData: { family: "rich_text", sectionId: PARENT },
        }),
        expect.objectContaining({
          adapterData: {
            family: "page_section",
            columnId: "column-1",
          },
        }),
      ]),
    );
  });
});
