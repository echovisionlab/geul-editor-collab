import { create, fromJson, type JsonValue } from "@bufbuild/protobuf";
import {
  PageSectionLocaleMutationSchema,
  PageSectionLocaleSchema,
  PageSectionMutationBatchSchema,
  PageSectionMutationSchema,
  PageSectionNodeSchema,
  RichTextBlockLocaleMutationSchema,
  RichTextBlockLocaleSchema,
  RichTextBlockMutationBatchSchema,
  RichTextBlockMutationSchema,
  RichTextBlockNodeSchema,
  type PageSectionLocaleMutation,
  type PageSectionMutation,
  type PageSectionMutationBatch,
  type RichTextBlockLocaleMutation,
  type RichTextBlockMutation,
  type RichTextBlockMutationBatch,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import type {
  BaseBlockMutation,
  BlockMutationBatch,
  LocaleBlockMutation,
} from "./block-mutation-batch.ts";
import type {
  BlockRoomAdapterData,
  BlockRoomLocaleData,
} from "./block-room-snapshot.ts";

type RoomBatch = BlockMutationBatch<unknown, BlockRoomLocaleData>;

function adapterData(value: unknown, reason: string): BlockRoomAdapterData {
  const data = value as Partial<BlockRoomAdapterData> | undefined;
  if (data?.family !== "page_section" && data?.family !== "rich_text") {
    throw new Error(`block_room_invalid:${reason}:family`);
  }
  return data as BlockRoomAdapterData;
}

function sectionId(data: BlockRoomAdapterData): string {
  if (!data.sectionId) throw new Error("block_room_invalid:page_rich_section");
  return data.sectionId;
}

function pageSectionBaseData(value: unknown): {
  value: JsonValue;
  settings?: JsonValue;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("block_room_invalid:page_section_payload");
  }
  const { settings, ...sectionValue } = value as Record<string, JsonValue>;
  return settings === undefined
    ? { value: sectionValue }
    : { value: sectionValue, settings };
}

function richTextPlacement(
  mutation: Extract<
    BaseBlockMutation<unknown>,
    { operation: "upsert" | "move" }
  >,
  sectionId?: string,
): { index: number; parentBlockId?: string } {
  const block = mutation.operation === "upsert" ? mutation.block : mutation;
  return {
    index: block.position,
    ...(block.parentBlockId && block.parentBlockId !== sectionId
      ? { parentBlockId: block.parentBlockId }
      : {}),
  };
}

function richTextBaseMutation(
  mutation: BaseBlockMutation<unknown>,
  sectionId?: string,
): RichTextBlockMutation {
  if (mutation.operation === "upsert") {
    const node = fromJson(RichTextBlockNodeSchema, {
      block: {
        id: mutation.block.blockId,
        [mutation.block.kind]: mutation.block.baseData as JsonValue,
      },
      placement: richTextPlacement(mutation, sectionId),
    });
    return create(RichTextBlockMutationSchema, {
      operation: { case: "upsert", value: { node } },
    });
  }
  if (mutation.operation === "move") {
    return create(RichTextBlockMutationSchema, {
      operation: {
        case: "move",
        value: {
          blockId: mutation.blockId,
          placement: richTextPlacement(mutation, sectionId),
        },
      },
    });
  }
  return create(RichTextBlockMutationSchema, {
    operation: { case: "delete", value: { blockId: mutation.blockId } },
  });
}

function richTextLocaleMutation(
  mutation: LocaleBlockMutation<BlockRoomLocaleData>,
): RichTextBlockLocaleMutation {
  if (mutation.operation === "upsert") {
    const block = fromJson(RichTextBlockLocaleSchema, {
      blockId: mutation.blockId,
      [mutation.data.kind]: mutation.data.payload,
    });
    return create(RichTextBlockLocaleMutationSchema, {
      operation: { case: "upsert", value: { block } },
    });
  }
  return create(RichTextBlockLocaleMutationSchema, {
    operation: { case: "delete", value: { blockId: mutation.blockId } },
  });
}

export function createRichTextMutationBatch(
  batch: RoomBatch,
): RichTextBlockMutationBatch {
  if (typeof batch.profile !== "number") {
    throw new Error("block_room_invalid:rich_text_profile");
  }
  return create(RichTextBlockMutationBatchSchema, {
    blockCatalogFingerprint: batch.blockCatalogFingerprint,
    profile: batch.profile,
    expectedRevision: batch.expectedDocumentRevision,
    baseMutations: batch.baseMutations.map((mutation) =>
      richTextBaseMutation(mutation),
    ),
    localeMutationGroups:
      batch.localeMutations.length === 0
        ? []
        : [
            {
              locale: batch.locale,
              mutations: batch.localeMutations.map(richTextLocaleMutation),
            },
          ],
    contributorMemberIds: batch.contributorMemberIds,
  });
}

function pageSectionBaseMutation(
  mutation: BaseBlockMutation<unknown>,
): PageSectionMutation {
  const data = adapterData(
    mutation.operation === "upsert"
      ? mutation.block.adapterData
      : mutation.adapterData,
    `base_mutation:${mutation.operation}`,
  );
  if (data.family === "rich_text") {
    const richSectionId = sectionId(data);
    return create(PageSectionMutationSchema, {
      operation: {
        case: "mutateRichTextBlock",
        value: {
          sectionId: richSectionId,
          mutation: richTextBaseMutation(mutation, richSectionId),
        },
      },
    });
  }
  if (mutation.operation === "upsert") {
    const sectionData = pageSectionBaseData(mutation.block.baseData);
    const node = fromJson(PageSectionNodeSchema, {
      section: {
        id: mutation.block.blockId,
        ...(sectionData.settings === undefined
          ? {}
          : { settings: sectionData.settings }),
        [mutation.block.kind]: sectionData.value,
      },
      placement: {
        index: mutation.block.position,
        ...(mutation.block.parentBlockId
          ? { parentSectionId: mutation.block.parentBlockId }
          : {}),
        ...(data.columnId ? { columnId: data.columnId } : {}),
      },
    });
    return create(PageSectionMutationSchema, {
      operation: { case: "upsert", value: { node } },
    });
  }
  if (mutation.operation === "move") {
    return create(PageSectionMutationSchema, {
      operation: {
        case: "move",
        value: {
          sectionId: mutation.blockId,
          placement: {
            index: mutation.position,
            ...(mutation.parentBlockId
              ? { parentSectionId: mutation.parentBlockId }
              : {}),
            ...(data.columnId ? { columnId: data.columnId } : {}),
          },
        },
      },
    });
  }
  return create(PageSectionMutationSchema, {
    operation: { case: "delete", value: { sectionId: mutation.blockId } },
  });
}

function pageSectionLocaleMutation(
  mutation: LocaleBlockMutation<BlockRoomLocaleData>,
): PageSectionLocaleMutation {
  const data = adapterData(
    mutation.adapterData,
    `locale_mutation:${mutation.operation}`,
  );
  if (data.family === "rich_text") {
    const richSectionId = sectionId(data);
    return create(PageSectionLocaleMutationSchema, {
      operation: {
        case: "mutateRichTextBlock",
        value: {
          sectionId: richSectionId,
          mutation: richTextLocaleMutation(mutation),
        },
      },
    });
  }
  if (mutation.operation === "upsert") {
    const section = fromJson(PageSectionLocaleSchema, {
      sectionId: mutation.blockId,
      [mutation.data.kind]: mutation.data.payload,
    });
    return create(PageSectionLocaleMutationSchema, {
      operation: { case: "upsert", value: { section } },
    });
  }
  return create(PageSectionLocaleMutationSchema, {
    operation: { case: "delete", value: { sectionId: mutation.blockId } },
  });
}

export function createPageMutationBatch(
  batch: RoomBatch,
): PageSectionMutationBatch {
  return create(PageSectionMutationBatchSchema, {
    blockCatalogFingerprint: batch.blockCatalogFingerprint,
    expectedRevision: batch.expectedDocumentRevision,
    baseMutations: batch.baseMutations.map(pageSectionBaseMutation),
    localeMutationGroups:
      batch.localeMutations.length === 0
        ? []
        : [
            {
              locale: batch.locale,
              mutations: batch.localeMutations.map(pageSectionLocaleMutation),
            },
          ],
    contributorMemberIds: batch.contributorMemberIds,
  });
}
