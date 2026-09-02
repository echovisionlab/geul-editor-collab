import {
  decodeCanonicalBlockRoom,
  type BlockRoomBaseNodeSnapshot,
  type BlockRoomDocumentType,
  type BlockRoomNodeFamily,
} from "@echovisionlab/geul-common/collaboration/block-room-codec";
import type { JsonValue } from "@bufbuild/protobuf";
import type * as Y from "yjs";
import type {
  CanonicalBlock,
  CanonicalBlockDocument,
} from "./block-mutation-batch.ts";

export interface BlockRoomAdapterData {
  family: BlockRoomNodeFamily;
  sectionId?: string;
  columnId?: string;
}

export interface BlockRoomLocaleData {
  kind: string;
  payload: JsonValue;
}

function pageRichTextSectionId(
  node: BlockRoomBaseNodeSnapshot,
  nodes: ReadonlyMap<string, BlockRoomBaseNodeSnapshot>,
): string {
  const visited = new Set([node.id]);
  let parentId = node.parentId;
  while (parentId !== null) {
    if (visited.has(parentId)) {
      throw new Error(`block_room_invalid:base_node:${node.id}:parent_cycle`);
    }
    visited.add(parentId);
    const parent = nodes.get(parentId);
    if (!parent) {
      throw new Error(`block_room_invalid:base_node:${node.id}:missing_parent`);
    }
    if (parent.family === "page_section") return parent.id;
    parentId = parent.parentId;
  }
  throw new Error(
    `block_room_invalid:base_node:${node.id}:missing_section_parent`,
  );
}

function adapterData(
  documentType: BlockRoomDocumentType,
  node: BlockRoomBaseNodeSnapshot,
  nodes: ReadonlyMap<string, BlockRoomBaseNodeSnapshot>,
): BlockRoomAdapterData {
  return {
    family: node.family,
    ...(documentType === "page" && node.family === "rich_text"
      ? { sectionId: pageRichTextSectionId(node, nodes) }
      : {}),
    ...(node.columnId ? { columnId: node.columnId } : {}),
  };
}

export function decodeBlockRoomSnapshot(
  document: Y.Doc,
  documentType: BlockRoomDocumentType,
  sourceLocale: string,
): CanonicalBlockDocument<JsonValue, BlockRoomLocaleData> {
  const decoded = decodeCanonicalBlockRoom(document, documentType);
  const nodes = new Map(decoded.baseNodes.map((node) => [node.id, node]));
  const localeByBlock = new Map<string, BlockRoomLocaleData>();
  for (const localeNode of decoded.localeOverlay) {
    localeByBlock.set(localeNode.id, {
      kind: localeNode.kind,
      payload: localeNode.payload,
    });
  }
  const blocks: CanonicalBlock<JsonValue, BlockRoomLocaleData>[] =
    decoded.baseNodes.map((node) => ({
      blockId: node.id,
      parentBlockId: node.parentId,
      containerSlot: node.containerSlot,
      position: node.position,
      kind: node.kind,
      baseData: node.payload,
      ...(localeByBlock.has(node.id)
        ? { localeData: localeByBlock.get(node.id) }
        : {}),
      adapterData: adapterData(documentType, node, nodes),
    }));
  const profile =
    decoded.document.$typeName === "api.content.v1.LocalizedRichTextDocument"
      ? decoded.document.profile
      : undefined;
  return {
    blockCatalogFingerprint: decoded.document.blockCatalogFingerprint,
    ...(profile === undefined ? {} : { profile }),
    sourceLocale,
    locale: decoded.document.locale,
    blocks,
  };
}
