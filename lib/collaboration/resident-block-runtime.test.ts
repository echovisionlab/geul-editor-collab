import { create, fromJson } from "@bufbuild/protobuf";
import {
  deleteBlockRoomBaseNode,
  getBlockRoomCollaborativeText,
  hydrateCanonicalBlockRoom,
  movePageSectionNode,
  moveRichTextBlockNode,
  replaceBlockRoomPayloadArray,
} from "@echovisionlab/geul-common/collaboration/block-room-codec";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { contentBlockCatalogFingerprint } from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedRichTextDocumentSchema,
  RichTextProfile,
  LocalizedPageDocumentSchema,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import {
  DocumentContentHeight,
  DocumentLayoutSchema,
} from "@echovisionlab/geul-proto/common/common_pb.ts";
import { CollaborationPrincipalSchema } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import {
  AIDocumentFieldTargetSchema,
  AIDocumentInlineContentSchema,
  AIDocumentInlineItemSchema,
  AIDocumentOperationSchema,
  AIDocumentValueSchema,
} from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  CollaborationConflictError,
  CollaborationResourceNotFoundError,
} from "../api/transport.ts";
import {
  ResidentBlockRuntime,
  type ResidentBlockDomainGateway,
} from "./resident-block-runtime.ts";

const codecSpies = vi.hoisted(() => ({
  materializeCanonicalBlockRoom: vi.fn(),
}));

vi.mock(
  "@echovisionlab/geul-common/collaboration/block-room-codec",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@echovisionlab/geul-common/collaboration/block-room-codec")
      >();
    return {
      ...original,
      materializeCanonicalBlockRoom: (
        ...args: Parameters<typeof original.materializeCanonicalBlockRoom>
      ) => {
        codecSpies.materializeCanonicalBlockRoom();
        return original.materializeCanonicalBlockRoom(...args);
      },
    };
  },
);

const BLOCK_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_2_ID = "21111111-1111-4111-8111-111111111111";
const FILE_BLOCK_ID = "31111111-1111-4111-8111-111111111111";
const FILE_ID = "41111111-1111-4111-8111-111111111111";
const PAGE_RICH_ID = "11111111-1111-4111-8111-111111111112";
const PAGE_COLUMNS_ID = "11111111-1111-4111-8111-111111111113";
const PAGE_CHILD_ID = "11111111-1111-4111-8111-111111111114";
const COLUMN_ID = "11111111-1111-4111-8111-111111111115";
const PAGE_CHILD_2_ID = "11111111-1111-4111-8111-111111111116";
const COLUMN_2_ID = "11111111-1111-4111-8111-111111111117";
const PAGE_IMMERSIVE_ID = "11111111-1111-4111-8111-111111111118";
const PAGE_IMMERSIVE_UNIT_ID = "11111111-1111-4111-8111-111111111119";
const PAGE_IMMERSIVE_UNIT_2_ID = "11111111-1111-4111-8111-111111111120";
const ENTITY_ID = "22222222-2222-4222-8222-222222222222";
const DOCUMENT_NAME = `post:${ENTITY_ID}:ko`;
const PRINCIPAL = create(CollaborationPrincipalSchema, {
  sessionId: "33333333-3333-4333-8333-333333333333",
});

function sourceDocument(profile = RichTextProfile.POST) {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile,
    locale: "ko",
    base: {
      nodes: [
        {
          block: { id: BLOCK_ID, paragraph: { props: {} } },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      blocks: [
        {
          blockId: BLOCK_ID,
          paragraph: { content: [{ text: { text: "기존" } }] },
        },
      ],
    },
  });
}

function fileSourceDocument() {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "ko",
    base: {
      nodes: [
        {
          block: {
            id: FILE_BLOCK_ID,
            file: {
              props: {
                attachment: { activeFileId: FILE_ID },
                name: "video.mp4",
              },
            },
          },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      blocks: [
        {
          blockId: FILE_BLOCK_ID,
          file: { props: { alt: "Video", caption: "Caption" } },
        },
      ],
    },
  });
}

function setParagraphText(text: string) {
  return create(AIDocumentOperationSchema, {
    operation: {
      case: "setField",
      value: {
        target: create(AIDocumentFieldTargetSchema, {
          owner: { case: "blockHandle", value: BLOCK_ID },
          fieldHandle: "content",
        }),
        value: create(AIDocumentValueSchema, {
          value: {
            case: "inline",
            value: create(AIDocumentInlineContentSchema, {
              items: [
                create(AIDocumentInlineItemSchema, {
                  item: { case: "text", value: text },
                }),
              ],
            }),
          },
        }),
      },
    },
  });
}

function targetDocument() {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "en",
    base: {
      nodes: [
        {
          block: { id: BLOCK_ID, paragraph: { props: {} } },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "en",
      blocks: [
        {
          blockId: BLOCK_ID,
          paragraph: { content: [{ text: { text: "Existing" } }] },
        },
      ],
    },
  });
}

function pageDocument(locale = "ko") {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale,
    base: { nodes: [] },
    localeOverlay: { locale, sections: [] },
  });
}

function immersivePageDocument() {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: PAGE_IMMERSIVE_ID,
            immersiveScene: {
              props: {},
              units: [
                { id: PAGE_IMMERSIVE_UNIT_ID, props: { name: "Opening" } },
                { id: PAGE_IMMERSIVE_UNIT_2_ID, props: { name: "Ending" } },
              ],
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
          sectionId: PAGE_IMMERSIVE_ID,
          immersiveScene: {
            props: {},
            units: [
              { unitId: PAGE_IMMERSIVE_UNIT_ID, props: { title: "처음" } },
              { unitId: PAGE_IMMERSIVE_UNIT_2_ID, props: { title: "끝" } },
            ],
          },
        },
      ],
    },
  });
}

function structuredPageDocument() {
  return fromJson(LocalizedPageDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    locale: "ko",
    base: {
      nodes: [
        {
          section: {
            id: PAGE_RICH_ID,
            richText: {
              props: {},
              blocks: {
                nodes: [
                  {
                    block: { id: BLOCK_ID, paragraph: { props: {} } },
                    placement: { index: 0 },
                  },
                  {
                    block: { id: BLOCK_2_ID, divider: { props: {} } },
                    placement: { index: 1 },
                  },
                ],
              },
            },
          },
          placement: { index: 0 },
        },
        {
          section: {
            id: PAGE_COLUMNS_ID,
            columns: {
              props: {
                columns: [
                  { id: COLUMN_ID, ratio: 1 },
                  { id: COLUMN_2_ID, ratio: 1 },
                ],
              },
            },
          },
          placement: { index: 1 },
        },
        {
          section: { id: PAGE_CHILD_ID, map: { props: {} } },
          placement: {
            parentSectionId: PAGE_COLUMNS_ID,
            columnId: COLUMN_ID,
            index: 0,
          },
        },
        {
          section: { id: PAGE_CHILD_2_ID, map: { props: {} } },
          placement: {
            parentSectionId: PAGE_COLUMNS_ID,
            columnId: COLUMN_2_ID,
            index: 0,
          },
        },
      ],
    },
    localeOverlay: {
      locale: "ko",
      sections: [
        {
          sectionId: PAGE_RICH_ID,
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
                { blockId: BLOCK_2_ID, divider: { props: {} } },
              ],
            },
          },
        },
        {
          sectionId: PAGE_COLUMNS_ID,
          columns: { props: {} },
        },
        {
          sectionId: PAGE_CHILD_ID,
          map: { props: {} },
        },
        {
          sectionId: PAGE_CHILD_2_ID,
          map: { props: {} },
        },
      ],
    },
  });
}

function loadedDocument(
  document: ReturnType<
    typeof sourceDocument | typeof targetDocument | typeof pageDocument
  >,
) {
  return {
    document,
    documentRevision: "revision-1",
    sourceMetadata: { locale: "ko", title: "Old" },
    localeMetadata: { locale: document.locale, title: "Old" },
    sourceLocale: "ko",
    locale: document.locale,
    localeExists: true,
    presentLocaleValues:
      document.$typeName === "api.content.v1.LocalizedRichTextDocument"
        ? [
            create(AIDocumentFieldTargetSchema, {
              owner: { case: "blockHandle", value: BLOCK_ID },
              fieldHandle: "content",
            }),
          ]
        : [],
  };
}

function gateway(
  overrides: Partial<ResidentBlockDomainGateway> = {},
): ResidentBlockDomainGateway {
  return {
    load: vi.fn().mockResolvedValue(loadedDocument(sourceDocument())),
    save: vi.fn().mockResolvedValue({
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: true,
      locale: "ko",
    }),
    checkpoint: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

describe("ResidentBlockRuntime source room", () => {
  it.each([
    {
      label: "Paragraph",
      document: sourceDocument(),
      blockId: BLOCK_ID,
      kind: "paragraph",
      fields: ["content"],
    },
    {
      label: "File",
      document: fileSourceDocument(),
      blockId: FILE_BLOCK_ID,
      kind: "file",
      fields: ["alt", "caption"],
    },
  ])(
    "does not forward removed locale targets when deleting a $label Block",
    async ({ document, blockId, kind, fields }) => {
      const save = vi.fn().mockResolvedValue({
        documentRevision: "revision-2",
        changed: true,
        sourceChanged: true,
        locale: "ko",
      });
      const domain = gateway({
        load: vi.fn().mockResolvedValue({
          ...loadedDocument(document),
          presentLocaleValues: fields.map((fieldHandle) =>
            create(AIDocumentFieldTargetSchema, {
              owner: { case: "blockHandle", value: blockId },
              fieldHandle,
            }),
          ),
        }),
        save,
      });
      const runtime = new ResidentBlockRuntime({ post: domain });
      const room = new Y.Doc();
      await runtime.load(DOCUMENT_NAME, room, PRINCIPAL);

      deleteBlockRoomBaseNode(room, blockId);
      await runtime.persist(DOCUMENT_NAME, room, ["member-1"]);

      expect(save).toHaveBeenCalledWith(
        ENTITY_ID,
        "ko",
        expect.objectContaining({
          baseMutations: [
            expect.objectContaining({ operation: "delete", blockId, kind }),
          ],
          localeMutations: [],
          affectedLocaleValueTargets: [],
        }),
      );
    },
  );

  it("applies an accepted source mutation without re-saving it and advances the resident baseline", async () => {
    const domain = gateway();
    const runtime = new ResidentBlockRuntime({ post: domain });
    const room = new Y.Doc();
    await runtime.load(DOCUMENT_NAME, room, PRINCIPAL);

    await runtime.applyAcceptedInteractiveMutation(DOCUMENT_NAME, room, {
      expectedDocumentRevision: "revision-1",
      acceptedDocumentRevision: "revision-2",
      operations: [setParagraphText("AI accepted")],
      origin: { interactiveMutation: "mutation-1" },
      beforeApply: vi.fn(),
    });

    expect(
      getBlockRoomCollaborativeText(room, {
        family: "rich_text",
        id: BLOCK_ID,
        locale: true,
        path: "content[0].text.text",
      }).toString(),
    ).toBe("AI accepted");
    expect(domain.save).not.toHaveBeenCalled();
    expect(runtime.persistence.snapshot(DOCUMENT_NAME)).toMatchObject({
      documentRevision: "revision-2",
    });

    getBlockRoomCollaborativeText(room, {
      family: "rich_text",
      id: BLOCK_ID,
      locale: true,
      path: "content[0].text.text",
    }).insert("AI accepted".length, "!");
    await runtime.persist(DOCUMENT_NAME, room, ["member-1"]);

    expect(domain.save).toHaveBeenCalledWith(
      ENTITY_ID,
      "ko",
      expect.objectContaining({ expectedDocumentRevision: "revision-2" }),
    );
  });

  it("applies an accepted target mutation with the exact target revision and preserves target CAS", async () => {
    const save = vi.fn().mockResolvedValue({
      documentRevision: "document-revision-1",
      targetRevision: "tr1_target_3",
      changed: true,
      sourceChanged: false,
      locale: "en",
    });
    const domain = gateway({
      load: vi.fn().mockResolvedValue({
        ...loadedDocument(targetDocument()),
        documentRevision: "document-revision-1",
        targetRevision: "tr1_target_1",
        locale: "en",
        sourceLocale: "ko",
      }),
      save,
    });
    const runtime = new ResidentBlockRuntime({ post: domain });
    const documentName = `post:${ENTITY_ID}:en`;
    const room = new Y.Doc();
    await runtime.load(documentName, room, PRINCIPAL);

    await runtime.applyAcceptedInteractiveMutation(documentName, room, {
      expectedDocumentRevision: "document-revision-1",
      acceptedDocumentRevision: "document-revision-1",
      expectedTargetRevision: "tr1_target_1",
      acceptedTargetRevision: "tr1_target_2",
      operations: [setParagraphText("Accepted target")],
      origin: { interactiveMutation: "mutation-2" },
      beforeApply: vi.fn(),
    });
    getBlockRoomCollaborativeText(room, {
      family: "rich_text",
      id: BLOCK_ID,
      locale: true,
      path: "content[0].text.text",
    }).insert("Accepted target".length, "!");
    await runtime.persist(documentName, room, ["member-1"]);

    expect(save).toHaveBeenCalledWith(
      ENTITY_ID,
      "en",
      expect.objectContaining({
        expectedDocumentRevision: "document-revision-1",
        expectedTargetRevision: "tr1_target_2",
      }),
    );
  });

  it("rejects an external apply before touching a room with pending human changes", async () => {
    const domain = gateway();
    const runtime = new ResidentBlockRuntime({ post: domain });
    const room = new Y.Doc();
    await runtime.load(DOCUMENT_NAME, room, PRINCIPAL);
    const text = getBlockRoomCollaborativeText(room, {
      family: "rich_text",
      id: BLOCK_ID,
      locale: true,
      path: "content[0].text.text",
    });
    text.insert(text.length, " human");

    await expect(
      runtime.applyAcceptedInteractiveMutation(DOCUMENT_NAME, room, {
        expectedDocumentRevision: "revision-1",
        acceptedDocumentRevision: "revision-2",
        operations: [setParagraphText("must not apply")],
        origin: { interactiveMutation: "mutation-3" },
        beforeApply: vi.fn(),
      }),
    ).rejects.toMatchObject({
      reason: "document_revision_changed",
      message: "resident_room_has_uncommitted_changes",
    });
    expect(text.toString()).toBe("기존 human");
    expect(domain.save).not.toHaveBeenCalled();
  });

  it("dispatches Campaign and Page through the same resident interactive apply boundary", async () => {
    const campaignGateway = gateway({
      load: vi
        .fn()
        .mockResolvedValue(
          loadedDocument(sourceDocument(RichTextProfile.EMAIL)),
        ),
    });
    const runtime = new ResidentBlockRuntime({ campaign: campaignGateway });
    const campaignName = `campaign:${ENTITY_ID}:ko`;
    const campaignRoom = new Y.Doc();
    await runtime.load(campaignName, campaignRoom, PRINCIPAL);

    await expect(
      runtime.applyAcceptedInteractiveMutation(campaignName, campaignRoom, {
        expectedDocumentRevision: "revision-1",
        acceptedDocumentRevision: "revision-2",
        operations: [setParagraphText("Campaign accepted")],
        origin: { interactiveMutation: "mutation-campaign" },
        beforeApply: vi.fn(),
      }),
    ).resolves.toBeUndefined();

    const pageRuntime = new ResidentBlockRuntime({
      page: gateway({
        load: vi
          .fn()
          .mockResolvedValue(loadedDocument(structuredPageDocument())),
      }),
    });
    const pageName = `page:${ENTITY_ID}:ko`;
    const pageRoom = new Y.Doc();
    await pageRuntime.load(pageName, pageRoom, PRINCIPAL);
    await expect(
      pageRuntime.applyAcceptedInteractiveMutation(pageName, pageRoom, {
        expectedDocumentRevision: "revision-1",
        acceptedDocumentRevision: "revision-2",
        operations: [setParagraphText("Page accepted")],
        origin: { interactiveMutation: "mutation-page" },
        beforeApply: vi.fn(),
      }),
    ).resolves.toBeUndefined();
    expect(
      getBlockRoomCollaborativeText(pageRoom, {
        family: "rich_text",
        id: BLOCK_ID,
        locale: true,
        path: "content[0].text.text",
      }).toString(),
    ).toBe("Page accepted");
  });

  it("loads, persists, and checkpoints one canonical source room", async () => {
    const domain = gateway();
    const runtime = new ResidentBlockRuntime({ post: domain });
    const room = new Y.Doc();
    await runtime.load(DOCUMENT_NAME, room, PRINCIPAL);
    codecSpies.materializeCanonicalBlockRoom.mockClear();
    const text = getBlockRoomCollaborativeText(room, {
      family: "rich_text",
      id: BLOCK_ID,
      locale: true,
      path: "content[0].text.text",
    });
    const origin = { provider: "mcp", memberId: "member-1" };
    const recordChange = vi.spyOn(runtime.persistence, "recordChange");
    room.transact(() => text.insert(text.length, "!"), origin);
    expect(recordChange).toHaveBeenCalledWith(
      DOCUMENT_NAME,
      room,
      expect.any(Object),
      { origin, originKind: "local" },
    );
    await runtime.persist(DOCUMENT_NAME, room, ["member-1"]);
    expect(codecSpies.materializeCanonicalBlockRoom).not.toHaveBeenCalled();
    expect(domain.save).toHaveBeenCalledWith(
      ENTITY_ID,
      "ko",
      expect.objectContaining({
        locale: "ko",
        localeMutations: [expect.objectContaining({ blockId: BLOCK_ID })],
        contributorMemberIds: ["member-1"],
      }),
    );
    await runtime.checkpoint(DOCUMENT_NAME, room, ["member-1"]);
    expect(domain.checkpoint).toHaveBeenCalledWith(ENTITY_ID, "ko", {
      expectedDocumentRevision: "revision-2",
      contributorMemberIds: ["member-1"],
    });
  });

  it.each([
    ["response", { locale: "en" }],
    ["document", { document: targetDocument() }],
  ] as const)(
    "rejects a mismatched %s locale during load",
    async (_label, override) => {
      const domain = gateway({
        load: vi.fn().mockResolvedValue({
          ...loadedDocument(sourceDocument()),
          ...override,
        }),
      });
      const runtime = new ResidentBlockRuntime({ post: domain });

      await expect(
        runtime.load(DOCUMENT_NAME, new Y.Doc(), PRINCIPAL),
      ).rejects.toThrow("resident_room_locale_mismatch");
    },
  );

  it("verifies hydrated room authority before registering persistence", async () => {
    const loaded = loadedDocument(sourceDocument());
    let sourceLocaleReads = 0;
    Object.defineProperty(loaded, "sourceLocale", {
      configurable: true,
      get: () => (sourceLocaleReads++ === 0 ? "ko" : "en"),
    });
    const runtime = new ResidentBlockRuntime({
      post: gateway({ load: vi.fn().mockResolvedValue(loaded) }),
    });

    await expect(
      runtime.load(DOCUMENT_NAME, new Y.Doc(), PRINCIPAL),
    ).rejects.toThrow("resident_room_authority_mismatch");
  });

  it("loads a resident domain without a version-checkpoint gateway", async () => {
    const runtime = new ResidentBlockRuntime({
      artist: gateway({
        checkpoint: undefined,
        load: vi
          .fn()
          .mockResolvedValue(
            loadedDocument(sourceDocument(RichTextProfile.COMPACT)),
          ),
      }),
    });

    await expect(
      runtime.load(`artist:${ENTITY_ID}:ko`, new Y.Doc(), PRINCIPAL),
    ).resolves.toBeUndefined();
  });

  it("updates the singular source metadata projection", async () => {
    const updateMetadata = vi.fn().mockResolvedValue({
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: true,
      locale: "ko",
    });
    const domain = gateway({ updateMetadata });
    const runtime = new ResidentBlockRuntime({ post: domain });
    const room = new Y.Doc();
    await runtime.load(DOCUMENT_NAME, room, PRINCIPAL);
    await runtime.updateMetadata(
      DOCUMENT_NAME,
      room,
      { type: "post", scope: "locale", title: "New", summary: null },
      ["member-1"],
    );
    expect(updateMetadata).toHaveBeenCalledWith(
      ENTITY_ID,
      "ko",
      { type: "post", scope: "locale", title: "New", summary: null },
      "revision-1",
      undefined,
      ["member-1"],
    );
    expect(runtime.bootstrap(DOCUMENT_NAME, room).sourceMetadata).toEqual({
      locale: "ko",
      title: "New",
      summary: undefined,
    });
  });

  it("rotates the target token across repeated locale metadata updates", async () => {
    const updateMetadata = vi
      .fn()
      .mockResolvedValueOnce({
        documentRevision: "document-revision-1",
        targetRevision: "tr1_target_2",
        changed: true,
        sourceChanged: false,
        locale: "en",
      })
      .mockResolvedValueOnce({
        documentRevision: "document-revision-1",
        targetRevision: "tr1_target_3",
        changed: true,
        sourceChanged: false,
        locale: "en",
      });
    const domain = gateway({
      load: vi.fn().mockResolvedValue({
        ...loadedDocument(targetDocument()),
        documentRevision: "document-revision-1",
        targetRevision: "tr1_target_1",
        locale: "en",
        sourceLocale: "ko",
        sourceMetadata: { locale: "ko", title: "Source" },
        localeMetadata: { locale: "en", title: "Target" },
      }),
      updateMetadata,
    });
    const runtime = new ResidentBlockRuntime({ post: domain });
    const roomName = `post:${ENTITY_ID}:en`;
    const room = new Y.Doc();
    await runtime.load(roomName, room, PRINCIPAL);

    await runtime.updateMetadata(
      roomName,
      room,
      { type: "post", scope: "locale", title: "First" },
      ["member-1"],
    );
    await runtime.updateMetadata(
      roomName,
      room,
      { type: "post", scope: "locale", title: "Second" },
      ["member-1"],
    );

    expect(updateMetadata).toHaveBeenNthCalledWith(
      1,
      ENTITY_ID,
      "en",
      expect.objectContaining({ title: "First" }),
      "document-revision-1",
      "tr1_target_1",
      ["member-1"],
    );
    expect(updateMetadata).toHaveBeenNthCalledWith(
      2,
      ENTITY_ID,
      "en",
      expect.objectContaining({ title: "Second" }),
      "document-revision-1",
      "tr1_target_2",
      ["member-1"],
    );
    expect(runtime.bootstrap(roomName, room)).toMatchObject({
      documentRevision: "document-revision-1",
      targetRevision: "tr1_target_3",
      localeMetadata: { locale: "en", title: "Second" },
    });
  });

  it("rejects scoped target room names before loading a domain document", async () => {
    const domain = gateway();
    const runtime = new ResidentBlockRuntime({ post: domain });
    await expect(
      runtime.load(`${DOCUMENT_NAME}:locale:en`, new Y.Doc(), PRINCIPAL),
    ).rejects.toThrow("Invalid document name format");
    expect(domain.load).not.toHaveBeenCalled();
  });

  it("hydrates a missing target fallback for VIEW while keeping persistence tokenless", async () => {
    const updateMetadata = vi.fn();
    const domain = gateway({
      load: vi.fn().mockResolvedValue({
        document: targetDocument(),
        documentRevision: "document-revision-1",
        locale: "en",
        sourceLocale: "ko",
        localeExists: false,
        presentLocaleValues: [],
        sourceMetadata: { locale: "ko", title: "Source" },
      }),
      updateMetadata,
    });
    const runtime = new ResidentBlockRuntime({ post: domain });
    const roomName = `post:${ENTITY_ID}:en`;
    const room = new Y.Doc();

    await expect(
      runtime.load(roomName, room, PRINCIPAL),
    ).resolves.toBeUndefined();

    expect(domain.load).toHaveBeenCalledWith(ENTITY_ID, "en", PRINCIPAL);
    expect(domain.save).not.toHaveBeenCalled();
    expect(runtime.persistence.snapshot(roomName)).toMatchObject({
      sourceLocale: "ko",
      locale: "en",
      localeExists: false,
    });
    expect(runtime.persistence.snapshot(roomName)).not.toHaveProperty(
      "targetRevision",
    );
    expect(runtime.bootstrap(roomName, room)).not.toHaveProperty(
      "localeMetadata",
    );
    await expect(
      runtime.updateMetadata(
        roomName,
        room,
        { type: "post", scope: "locale", title: "Forbidden" },
        ["member-1"],
      ),
    ).rejects.toMatchObject({
      reason: "target_revision_changed",
      message: "target_locale_missing",
    });
    expect(updateMetadata).not.toHaveBeenCalled();
  });

  it("rejects document-scoped metadata and Page layout updates in target rooms", async () => {
    const postRoom = new Y.Doc();
    const postName = `post:${ENTITY_ID}:en`;
    const postRuntime = new ResidentBlockRuntime({
      post: gateway({
        load: vi.fn().mockResolvedValue({
          ...loadedDocument(targetDocument()),
          documentRevision: "document-revision-1",
          targetRevision: "tr1_target_1",
          sourceLocale: "ko",
          locale: "en",
        }),
        updateMetadata: vi.fn(),
      }),
    });
    await postRuntime.load(postName, postRoom, PRINCIPAL);
    await expect(
      postRuntime.updateMetadata(
        postName,
        postRoom,
        { type: "post", scope: "document" },
        ["member-1"],
      ),
    ).rejects.toMatchObject({
      reason: "non_source_document_metadata_forbidden",
    });

    const pageRoom = new Y.Doc();
    const pageName = `page:${ENTITY_ID}:en`;
    const pageRuntime = new ResidentBlockRuntime({
      page: gateway({
        load: vi.fn().mockResolvedValue({
          ...loadedDocument(pageDocument("en")),
          documentRevision: "document-revision-1",
          targetRevision: "tr1_target_1",
          sourceLocale: "ko",
          locale: "en",
        }),
        updatePageDocumentLayout: vi.fn(),
      }),
    });
    await pageRuntime.load(pageName, pageRoom, PRINCIPAL);
    await expect(
      pageRuntime.updatePageDocumentLayout(
        pageName,
        pageRoom,
        fromJson(DocumentLayoutSchema, {}),
        ["member-1"],
      ),
    ).rejects.toMatchObject({
      reason: "non_source_document_metadata_forbidden",
    });
  });

  it("hydrates an exact target room with separate source and room locales", () => {
    const room = new Y.Doc();
    hydrateCanonicalBlockRoom(room, "post", "ko", targetDocument(), []);
    expect(room.getMap("block-document").get("sourceLocale")).toBe("ko");
    expect(room.getMap("block-document").get("roomLocale")).toBe("en");
  });

  it.each([
    ["document type", "documentType", "page"],
    ["catalog fingerprint", "blockCatalogFingerprint", "forged-catalog"],
    ["source locale", "sourceLocale", "en"],
    ["room locale", "roomLocale", "en"],
    ["profile", "profile", RichTextProfile.WORK],
  ] as const)(
    "repairs a client-authored %s root mutation without destroying the room",
    async (_label, key, value) => {
      const domain = gateway();
      const runtime = new ResidentBlockRuntime({ post: domain });
      const room = new Y.Doc();
      await runtime.load(DOCUMENT_NAME, room, PRINCIPAL);
      const root = room.getMap("block-document");
      const authoritativeValue = root.get(key);

      root.set(key, value);

      await expect(
        runtime.persist(DOCUMENT_NAME, room, ["member-1"]),
      ).resolves.toMatchObject({ documentRevision: "revision-1" });
      expect(root.get(key)).toBe(authoritativeValue);
      expect(domain.save).not.toHaveBeenCalled();
    },
  );

  it("persists a second immersive Scene unit Attribution without changing room authority", async () => {
    const domain = gateway({
      load: vi.fn().mockResolvedValue(loadedDocument(immersivePageDocument())),
    });
    const runtime = new ResidentBlockRuntime({ page: domain });
    const room = new Y.Doc();
    const documentName = `page:${ENTITY_ID}:ko`;
    await runtime.load(documentName, room, PRINCIPAL);
    const root = room.getMap("block-document");
    const authority = {
      documentType: root.get("documentType"),
      blockCatalogFingerprint: root.get("blockCatalogFingerprint"),
      sourceLocale: root.get("sourceLocale"),
      roomLocale: root.get("roomLocale"),
      hasProfile: root.has("profile"),
    };

    room.transact(() => {
      replaceBlockRoomPayloadArray(
        room,
        { family: "page_section", id: PAGE_IMMERSIVE_ID, path: "units" },
        [
          { id: PAGE_IMMERSIVE_UNIT_ID, props: { name: "Opening" } },
          {
            id: PAGE_IMMERSIVE_UNIT_2_ID,
            props: {
              name: "Ending",
              attribution:
                "Created by [Artist B](https://example.com/artists/b)",
            },
          },
        ],
      );
      root.set("blockCatalogFingerprint", "client-authored-catalog");
      root.set("profile", RichTextProfile.POST);
    }, "page-section-adapter");

    await expect(
      runtime.persist(documentName, room, ["member-1"]),
    ).resolves.toMatchObject({ documentRevision: "revision-2" });
    expect(domain.save).toHaveBeenCalledOnce();
    const batch = vi.mocked(domain.save).mock.calls[0]?.[2];
    expect(batch).toMatchObject({
      expectedDocumentRevision: "revision-1",
      contributorMemberIds: ["member-1"],
    });
    expect(JSON.stringify(batch)).toContain(
      '"attribution":"Created by [Artist B](https://example.com/artists/b)"',
    );
    expect({
      documentType: root.get("documentType"),
      blockCatalogFingerprint: root.get("blockCatalogFingerprint"),
      sourceLocale: root.get("sourceLocale"),
      roomLocale: root.get("roomLocale"),
      hasProfile: root.has("profile"),
    }).toEqual(authority);
  });

  it("serializes Page layout updates through the resident revision", async () => {
    const updatePageDocumentLayout = vi.fn().mockResolvedValue({
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: false,
      locale: "ko",
    });
    const domain = gateway({
      load: vi.fn().mockResolvedValue(loadedDocument(pageDocument())),
      updatePageDocumentLayout,
    });
    const runtime = new ResidentBlockRuntime({ page: domain });
    const room = new Y.Doc();
    const name = `page:${ENTITY_ID}:ko`;
    const layout = fromJson(DocumentLayoutSchema, {
      contentHeight: DocumentContentHeight.VIEWPORT,
    });
    await runtime.load(name, room, PRINCIPAL);
    await expect(
      runtime.updatePageDocumentLayout(name, room, layout, ["b", "a", "b"]),
    ).resolves.toMatchObject({ documentRevision: "revision-2" });
    expect(updatePageDocumentLayout).toHaveBeenCalledWith(ENTITY_ID, "ko", {
      expectedDocumentRevision: "revision-1",
      documentLayout: layout,
      contributorMemberIds: ["a", "b"],
    });
    expect(runtime.bootstrap(name, room)).toMatchObject({
      documentRevision: "revision-2",
    });
  });

  it("requires canonical resident types, loaded state, and optional metadata gateways", async () => {
    const runtime = new ResidentBlockRuntime({ post: gateway() });
    const room = new Y.Doc();
    await expect(
      runtime.load(`form:${ENTITY_ID}:ko`, room, PRINCIPAL),
    ).rejects.toThrow("resident_block_type_required");
    await expect(runtime.persist(DOCUMENT_NAME, room, [])).rejects.toThrow(
      "resident_document_not_loaded",
    );
    await expect(
      runtime.updatePageDocumentLayout(
        DOCUMENT_NAME,
        room,
        fromJson(DocumentLayoutSchema, {}),
        [],
      ),
    ).rejects.toThrow("resident_page_type_required");
    await expect(
      runtime.updateMetadata(
        DOCUMENT_NAME,
        room,
        { type: "page", title: "wrong" },
        [],
      ),
    ).rejects.toThrow("resident_metadata_type_required");
    expect(() => runtime.bootstrap(`form:${ENTITY_ID}:ko`, room)).toThrow(
      "resident_block_type_required",
    );

    await runtime.load(DOCUMENT_NAME, room, PRINCIPAL);
    await expect(
      runtime.updateMetadata(
        DOCUMENT_NAME,
        room,
        { type: "post", scope: "locale", title: "title" },
        [],
      ),
    ).rejects.toThrow("resident_metadata_gateway_required:post");
    expect(() => runtime.bootstrap(`page:${ENTITY_ID}:ko`, room)).toThrow(
      "resident_document_not_loaded",
    );

    const pageRoom = new Y.Doc();
    const pageRuntime = new ResidentBlockRuntime({
      page: gateway({
        load: vi.fn().mockResolvedValue(loadedDocument(pageDocument())),
      }),
    });
    await pageRuntime.load(`page:${ENTITY_ID}:ko`, pageRoom, PRINCIPAL);
    await expect(
      pageRuntime.updatePageDocumentLayout(
        `page:${ENTITY_ID}:ko`,
        pageRoom,
        fromJson(DocumentLayoutSchema, {}),
        [],
      ),
    ).rejects.toThrow("resident_page_metadata_gateway_required");
  });

  it.each(["metadata", "layout"] as const)(
    "preserves %s update error classification",
    async (operation) => {
      const conflict = new CollaborationConflictError(
        "document_revision_changed",
      );
      const notFound = new CollaborationResourceNotFoundError(
        operation === "layout"
          ? CollaborativeDocumentType.PAGE
          : CollaborativeDocumentType.POST,
        ENTITY_ID,
      );
      const responseLost = new Error("response_lost");
      const update = vi
        .fn()
        .mockRejectedValueOnce(conflict)
        .mockRejectedValueOnce(notFound)
        .mockRejectedValueOnce(responseLost);
      const isLayout = operation === "layout";
      const documentName = isLayout ? `page:${ENTITY_ID}:ko` : DOCUMENT_NAME;
      const room = new Y.Doc();
      const runtime = new ResidentBlockRuntime({
        [isLayout ? "page" : "post"]: gateway({
          load: vi
            .fn()
            .mockResolvedValue(
              loadedDocument(isLayout ? pageDocument() : sourceDocument()),
            ),
          ...(isLayout
            ? { updatePageDocumentLayout: update }
            : { updateMetadata: update }),
        }),
      });
      await runtime.load(documentName, room, PRINCIPAL);
      const invoke = () =>
        isLayout
          ? runtime.updatePageDocumentLayout(
              documentName,
              room,
              fromJson(DocumentLayoutSchema, {}),
              [],
            )
          : runtime.updateMetadata(
              documentName,
              room,
              { type: "post", scope: "locale" },
              [],
            );
      await expect(invoke()).rejects.toBe(conflict);
      await expect(invoke()).rejects.toBe(notFound);
      await expect(invoke()).rejects.toBe(responseLost);
    },
  );

  it.each(["metadata", "layout"] as const)(
    "rejects a %s acknowledgement for a different locale room",
    async (operation) => {
      const isLayout = operation === "layout";
      const documentName = isLayout ? `page:${ENTITY_ID}:ko` : DOCUMENT_NAME;
      const update = vi.fn().mockResolvedValue({
        documentRevision: "revision-2",
        changed: true,
        sourceChanged: false,
        locale: "en",
      });
      const room = new Y.Doc();
      const runtime = new ResidentBlockRuntime({
        [isLayout ? "page" : "post"]: gateway({
          load: vi
            .fn()
            .mockResolvedValue(
              loadedDocument(isLayout ? pageDocument() : sourceDocument()),
            ),
          ...(isLayout
            ? { updatePageDocumentLayout: update }
            : { updateMetadata: update }),
        }),
      });
      await runtime.load(documentName, room, PRINCIPAL);

      const result = isLayout
        ? runtime.updatePageDocumentLayout(
            documentName,
            room,
            fromJson(DocumentLayoutSchema, {}),
            [],
          )
        : runtime.updateMetadata(
            documentName,
            room,
            { type: "post", scope: "locale" },
            [],
          );
      await expect(result).rejects.toMatchObject({
        reason: "document_revision_changed",
        message: "collaboration_response_locale_mismatch",
      });
    },
  );

  it("queues ordinary saves and acknowledged checkpoints in order after failures", async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const domain = gateway();
    const runtime = new ResidentBlockRuntime({ post: domain });
    const room = new Y.Doc();
    await runtime.load(DOCUMENT_NAME, room, PRINCIPAL);
    moveRichTextBlockNode(room, BLOCK_ID, { index: 0 });

    const firstQueued = runtime.withPersistenceQueue(
      DOCUMENT_NAME,
      async () => {
        await first;
        throw new Error("first failed");
      },
    );
    const secondQueued = runtime.persistEditSession(DOCUMENT_NAME, room, {
      contributorMemberIds: ["member-1"],
    });
    release();
    await expect(firstQueued).rejects.toThrow("first failed");
    await expect(secondQueued).resolves.toBeDefined();
    await expect(
      runtime.persistEditSession(DOCUMENT_NAME, room, {
        contributorMemberIds: ["member-1"],
        versionCheckpoint: true,
      }),
    ).resolves.toBeDefined();
    expect(domain.checkpoint).toHaveBeenCalledWith(ENTITY_ID, "ko", {
      expectedDocumentRevision: expect.any(String),
      contributorMemberIds: ["member-1"],
    });
    runtime.unload(DOCUMENT_NAME);
    expect(() => runtime.bootstrap(DOCUMENT_NAME, room)).toThrow(
      "resident_document_not_loaded",
    );
  });

  it("supports explicit full decode and the queue-provided edit-session persister", async () => {
    const domain = gateway();
    const runtime = new ResidentBlockRuntime({ post: domain });
    const room = new Y.Doc();
    await runtime.load(DOCUMENT_NAME, room, PRINCIPAL);
    runtime.persistence.recordChange(DOCUMENT_NAME, room, {
      affectedBaseBlockIds: [],
      affectedLocaleBlockIds: [],
      affectedLocaleValueTargets: [],
      changedContainerOrderKeys: [],
      documentMetadataChanged: true,
      documentLayoutChanged: false,
      requiresFullDecode: true,
    });
    await runtime.persist(DOCUMENT_NAME, room, ["member-1"]);
    await runtime.withPersistenceQueue("separate-queue", async (persist) => {
      await persist(DOCUMENT_NAME, room, {
        contributorMemberIds: ["member-1"],
      });
    });
    await runtime.persist(DOCUMENT_NAME, room, ["member-1"]);
  });

  it("requires loaded state after finding configured metadata gateways", async () => {
    const runtime = new ResidentBlockRuntime({
      post: gateway({ updateMetadata: vi.fn() }),
      page: gateway({ updatePageDocumentLayout: vi.fn() }),
    });
    await expect(
      runtime.updateMetadata(
        DOCUMENT_NAME,
        new Y.Doc(),
        { type: "post", scope: "locale" },
        [],
      ),
    ).rejects.toThrow("resident_document_not_loaded");
    await expect(
      runtime.updatePageDocumentLayout(
        `page:${ENTITY_ID}:ko`,
        new Y.Doc(),
        fromJson(DocumentLayoutSchema, {}),
        [],
      ),
    ).rejects.toThrow("resident_document_not_loaded");
  });

  it("runs a queued save after a preceding successful operation", async () => {
    const runtime = new ResidentBlockRuntime({ post: gateway() });
    const room = new Y.Doc();
    await runtime.load(DOCUMENT_NAME, room, PRINCIPAL);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = runtime.withPersistenceQueue("success-queue", async () => {
      await barrier;
    });
    const second = runtime.withPersistenceQueue("success-queue", async () =>
      runtime.persistEditSession(DOCUMENT_NAME, room, {}),
    );
    release();
    await first;
    await second;
  });

  it("decodes affected nested Page ownership without a source overlay", async () => {
    const domain = gateway({
      load: vi.fn().mockResolvedValue({
        ...loadedDocument(structuredPageDocument()),
        presentLocaleValues: [
          create(AIDocumentFieldTargetSchema, {
            owner: { case: "blockHandle", value: BLOCK_ID },
            fieldHandle: "content",
          }),
        ],
      }),
    });
    const runtime = new ResidentBlockRuntime({ page: domain });
    const room = new Y.Doc();
    const name = `page:${ENTITY_ID}:ko`;
    await runtime.load(name, room, PRINCIPAL);
    moveRichTextBlockNode(
      room,
      BLOCK_ID,
      { index: 1 },
      { pageSectionId: PAGE_RICH_ID },
    );
    movePageSectionNode(room, PAGE_CHILD_ID, {
      parentSectionId: PAGE_COLUMNS_ID,
      columnId: COLUMN_2_ID,
      index: 1,
    });
    await runtime.persist(name, room, ["member-1"]);
    expect(domain.save).toHaveBeenCalled();
  });
});
