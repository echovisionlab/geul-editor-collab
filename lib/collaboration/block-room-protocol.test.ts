import { create, fromJson } from "@bufbuild/protobuf";
import {
  canonicalBlockRoomLocaleValueTargetKey,
  getBlockRoomCollaborativeText,
  hydrateCanonicalBlockRoom,
  insertRichTextBlockLocale,
  insertRichTextBlockNode,
} from "@echovisionlab/geul-common/collaboration/block-room-codec";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { contentBlockCatalogFingerprint } from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedPageDocumentSchema,
  LocalizedRichTextDocumentSchema,
  RichTextBlockLocaleSchema,
  RichTextBlockNodeSchema,
  RichTextProfile,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { AIDocumentFieldTargetSchema } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  CollaborationConflictError,
  CollaborationResourceNotFoundError,
} from "../api/transport.ts";
import type { CollabConnectionContext } from "./connection-context.ts";
import { BlockRoomProtocol } from "./block-room-protocol.ts";
import { RoomEpochRegistry } from "./room-epoch.ts";

const DOCUMENT_NAME = "post:22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "55555555-5555-4555-8555-555555555555";
const INSERTED_BLOCK_ID = "66666666-6666-4666-8666-666666666666";

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `id-${index}`;
}

function context(
  documentType = CollaborativeDocumentType.POST,
): CollabConnectionContext {
  return {
    member: {
      id: "33333333-3333-4333-8333-333333333333",
      nickname: "Editor",
      deleted: false,
    } as never,
    sessionId: "44444444-4444-4444-8444-444444444444",
    documentType,
    resourceId: "22222222-2222-4222-8222-222222222222",
    blockRoomAdmissionState: "pending",
  };
}

function setup(
  options: {
    page?: boolean;
    fenced?: boolean;
    target?: boolean;
    missingTarget?: boolean;
    emptyLocaleContent?: boolean;
  } = {},
) {
  const roomEpochs = new RoomEpochRegistry(
    ids("server-a", "epoch-a", "challenge-a"),
  );
  const updateMetadata = vi.fn().mockResolvedValue({
    documentRevision: "revision-2",
    changed: true,
    sourceChanged: true,
    changedLocales: ["ko"],
    locale: "ko",
  });
  const updatePageDocumentLayout = vi.fn().mockResolvedValue({
    documentRevision: "revision-2",
    changed: true,
    sourceChanged: false,
  });
  const locale = options.target ? "en" : "ko";
  const localizedDocument = options.page
    ? fromJson(LocalizedPageDocumentSchema, {
        blockCatalogFingerprint: contentBlockCatalogFingerprint,
        locale,
        base: { nodes: [] },
        localeOverlay: { locale, sections: [] },
      })
    : fromJson(LocalizedRichTextDocumentSchema, {
        blockCatalogFingerprint: contentBlockCatalogFingerprint,
        profile: RichTextProfile.POST,
        locale,
        base: {
          nodes: [
            {
              block: { id: BLOCK_ID, paragraph: { props: {} } },
              placement: { index: 0 },
            },
          ],
        },
        localeOverlay: {
          locale,
          blocks: [
            {
              blockId: BLOCK_ID,
              paragraph: {
                content: options.emptyLocaleContent
                  ? []
                  : [{ text: { text: "Text" } }],
              },
            },
          ],
        },
      });
  const document = new Y.Doc();
  hydrateCanonicalBlockRoom(
    document,
    options.page ? "page" : "post",
    "ko",
    localizedDocument,
    options.page
      ? []
      : [
          create(AIDocumentFieldTargetSchema, {
            owner: { case: "blockHandle", value: BLOCK_ID },
            fieldHandle: "content",
          }),
        ],
  );
  const sendStateless = vi.fn();
  const close = vi.fn();
  const recordAcceptedMetadataChange = vi.fn();
  const connection = {
    context: {},
    document,
    sendStateless,
    close,
  };
  const protocol = new BlockRoomProtocol({
    roomEpochs,
    residentBlocks: {
      bootstrap: vi.fn(() => ({
        documentName: DOCUMENT_NAME,
        documentType: options.page ? "page" : "post",
        document: localizedDocument,
        documentRevision: "revision-1",
        sourceLocale: "ko",
        locale,
        localeExists: !options.missingTarget,
        ...(options.target && !options.missingTarget
          ? { targetRevision: "tr1_target" }
          : {}),
        presentLocaleValues: options.page
          ? []
          : [
              create(AIDocumentFieldTargetSchema, {
                owner: { case: "blockHandle", value: BLOCK_ID },
                fieldHandle: "content",
              }),
            ],
        sourceMetadata: { locale: "ko", title: "제목" },
        ...(options.missingTarget
          ? {}
          : {
              localeMetadata: {
                locale,
                title: options.target ? "Title" : "제목",
              },
            }),
        blockCatalogFingerprint: contentBlockCatalogFingerprint,
      })),
      updateMetadata,
      updatePageDocumentLayout,
    } as never,
    isDocumentFenced: vi.fn(() => options.fenced ?? false),
    fenceDocument: vi.fn(),
    deleteEntity: vi.fn().mockResolvedValue(undefined),
    recordAcceptedMetadataChange,
  });
  const dependencies = (
    protocol as unknown as {
      dependencies: {
        residentBlocks: { bootstrap: ReturnType<typeof vi.fn> };
        isDocumentFenced: ReturnType<typeof vi.fn>;
        fenceDocument: ReturnType<typeof vi.fn>;
        deleteEntity: ReturnType<typeof vi.fn>;
      };
    }
  ).dependencies;
  return {
    protocol,
    roomEpochs,
    document,
    connection,
    sendStateless,
    close,
    updateMetadata,
    updatePageDocumentLayout,
    recordAcceptedMetadataChange,
    dependencies,
  };
}

async function admit(
  runtime: ReturnType<typeof setup>,
  admission = context(),
): Promise<CollabConnectionContext> {
  runtime.connection.context = admission;
  runtime.protocol.connected(
    runtime.connection as never,
    admission,
    DOCUMENT_NAME,
    runtime.document,
  );
  await runtime.protocol.handleStateless({
    connection: runtime.connection,
    documentName: DOCUMENT_NAME,
    document: runtime.document,
    payload: JSON.stringify({
      kind: "block_room.bootstrap_ack",
      protocolVersion: 1,
      challenge: "challenge-a",
      stateVector: Buffer.from(Y.encodeStateVector(runtime.document)).toString(
        "base64",
      ),
    }),
  } as never);
  return admission;
}

describe("resident Block room WebSocket protocol", () => {
  it("issues the canonical bootstrap on the accepted socket and waits for its state-vector ACK", () => {
    const { protocol, document, connection, sendStateless } = setup();
    const admission = context();

    protocol.connected(connection as never, admission, DOCUMENT_NAME, document);

    const bootstrap = JSON.parse(sendStateless.mock.calls[0]![0]) as Record<
      string,
      unknown
    >;
    expect(bootstrap).toMatchObject({
      kind: "block_room.bootstrap",
      protocolVersion: 1,
      bootstrapChallenge: "challenge-a",
      documentName: DOCUMENT_NAME,
      documentType: "post",
      documentRevision: "revision-1",
      sourceLocale: "ko",
      locale: "ko",
      localeExists: true,
      sourceMetadata: { locale: "ko", title: "제목" },
      localeMetadata: { locale: "ko", title: "제목" },
      blockCatalogFingerprint: contentBlockCatalogFingerprint,
      serverInstanceId: "server-a",
      roomEpoch: "epoch-a",
    });
    expect(
      Buffer.from(bootstrap.yjsBootstrapUpdate as string, "base64"),
    ).toEqual(Buffer.from(Y.encodeStateAsUpdate(document)));
    expect(admission).toMatchObject({
      blockRoomAdmissionState: "issued",
      bootstrapChallenge: "challenge-a",
    });
  });

  it("permits only an empty initial sync before the bootstrap ACK", () => {
    const { protocol, document, connection, close } = setup();
    const admission = context();
    const empty = new Y.Doc();
    try {
      expect(() =>
        protocol.beforeSync(
          connection as never,
          admission,
          DOCUMENT_NAME,
          document,
          0,
          Y.encodeStateVector(empty),
        ),
      ).not.toThrow();
      expect(() =>
        protocol.beforeSync(
          connection as never,
          admission,
          DOCUMENT_NAME,
          document,
          2,
          Y.encodeStateAsUpdate(document),
        ),
      ).toThrow("reload_required");
      expect(close).toHaveBeenCalledOnce();
    } finally {
      empty.destroy();
    }
  });

  it("accepts the matching bootstrap ACK and serializes metadata on the same room", async () => {
    const {
      protocol,
      document,
      connection,
      sendStateless,
      updateMetadata,
      recordAcceptedMetadataChange,
    } = setup();
    const admission = context();
    connection.context = admission;
    protocol.connected(connection as never, admission, DOCUMENT_NAME, document);

    await protocol.handleStateless({
      connection,
      documentName: DOCUMENT_NAME,
      document,
      payload: JSON.stringify({
        kind: "block_room.bootstrap_ack",
        protocolVersion: 1,
        challenge: "challenge-a",
        stateVector: Buffer.from(Y.encodeStateVector(document)).toString(
          "base64",
        ),
      }),
    } as never);

    expect(admission.blockRoomAdmissionState).toBe("accepted");
    expect(JSON.parse(sendStateless.mock.calls.at(-1)![0])).toEqual({
      kind: "block_room.ready",
      protocolVersion: 1,
      bootstrapChallenge: "challenge-a",
    });

    await protocol.handleStateless({
      connection,
      documentName: DOCUMENT_NAME,
      document,
      payload: JSON.stringify({
        kind: "block_room.snapshot",
        protocolVersion: 1,
        requestId: "11111111-1111-4111-8111-111111111112",
      }),
    } as never);
    expect(JSON.parse(sendStateless.mock.calls.at(-1)![0])).toMatchObject({
      kind: "block_room.snapshot_result",
      ok: true,
      snapshot: {
        documentRevision: "revision-1",
        sourceLocale: "ko",
        locale: "ko",
        localeExists: true,
      },
    });

    await protocol.handleStateless({
      connection,
      documentName: DOCUMENT_NAME,
      document,
      payload: JSON.stringify({
        kind: "block_room.metadata",
        protocolVersion: 1,
        requestId: REQUEST_ID,
        operation: "locale",
        payload: { title: "변경" },
      }),
    } as never);

    expect(updateMetadata).toHaveBeenCalledWith(
      DOCUMENT_NAME,
      document,
      expect.objectContaining({ type: "post", scope: "locale", title: "변경" }),
      ["33333333-3333-4333-8333-333333333333"],
    );
    expect(recordAcceptedMetadataChange).toHaveBeenCalledWith(
      DOCUMENT_NAME,
      "33333333-3333-4333-8333-333333333333",
    );
    expect(JSON.parse(sendStateless.mock.calls.at(-1)![0])).toMatchObject({
      kind: "block_room.metadata_result",
      requestId: REQUEST_ID,
      ok: true,
      ack: {
        documentRevision: "revision-2",
        changed: true,
        sourceChanged: true,
        changedLocales: ["ko"],
        locale: "ko",
      },
    });
  });

  it("rejects an ACK from another socket or room epoch", async () => {
    const { protocol, document, connection, close } = setup();
    const admission = context();
    connection.context = admission;
    protocol.connected(connection as never, admission, DOCUMENT_NAME, document);

    await protocol.handleStateless({
      connection,
      documentName: DOCUMENT_NAME,
      document,
      payload: JSON.stringify({
        kind: "block_room.bootstrap_ack",
        protocolVersion: 1,
        challenge: "forged",
        stateVector: Buffer.from(Y.encodeStateVector(document)).toString(
          "base64",
        ),
      }),
    } as never);

    expect(admission.blockRoomAdmissionState).toBe("issued");
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not open a checkpoint window for a successful metadata no-op", async () => {
    const runtime = setup();
    runtime.updateMetadata.mockResolvedValueOnce({
      documentRevision: "revision-1",
      changed: false,
      sourceChanged: false,
    });
    await admit(runtime);

    await runtime.protocol.handleStateless({
      connection: runtime.connection,
      documentName: DOCUMENT_NAME,
      document: runtime.document,
      payload: JSON.stringify({
        kind: "block_room.metadata",
        protocolVersion: 1,
        requestId: REQUEST_ID,
        operation: "locale",
        payload: { title: "제목" },
      }),
    } as never);

    expect(runtime.recordAcceptedMetadataChange).not.toHaveBeenCalled();
    expect(
      JSON.parse(runtime.sendStateless.mock.calls.at(-1)![0]),
    ).toMatchObject({ ok: true, ack: { changed: false } });
  });

  it("ignores non-Block documents and already admitted sockets", () => {
    const runtime = setup();
    runtime.protocol.connected(
      runtime.connection as never,
      context(CollaborativeDocumentType.MAP_THEME),
      DOCUMENT_NAME,
      runtime.document,
    );
    const accepted = context();
    accepted.blockRoomAdmissionState = "accepted";
    runtime.protocol.connected(
      runtime.connection as never,
      accepted,
      DOCUMENT_NAME,
      runtime.document,
    );
    runtime.protocol.beforeSync(
      runtime.connection as never,
      context(CollaborativeDocumentType.MAP_THEME),
      DOCUMENT_NAME,
      runtime.document,
      2,
      new Uint8Array([1]),
    );
    expect(runtime.sendStateless).not.toHaveBeenCalled();
  });

  it("fences invalid bootstrap states and a missing issued admission", () => {
    const invalid = setup();
    const invalidContext = context();
    invalidContext.blockRoomAdmissionState = undefined;
    invalid.protocol.connected(
      invalid.connection as never,
      invalidContext,
      DOCUMENT_NAME,
      invalid.document,
    );
    expect(invalid.close).toHaveBeenCalledOnce();

    const fenced = setup({ fenced: true });
    fenced.protocol.connected(
      fenced.connection as never,
      context(),
      DOCUMENT_NAME,
      fenced.document,
    );
    expect(fenced.close).toHaveBeenCalledOnce();

    const missingAdmission = setup();
    vi.spyOn(missingAdmission.roomEpochs, "validate").mockReturnValue(
      undefined,
    );
    missingAdmission.protocol.connected(
      missingAdmission.connection as never,
      context(),
      DOCUMENT_NAME,
      missingAdmission.document,
    );
    expect(missingAdmission.close).toHaveBeenCalledOnce();
  });

  it("serializes Page bootstrap and page layout metadata", async () => {
    const runtime = setup({ page: true });
    const admission = context(CollaborativeDocumentType.PAGE);
    await admit(runtime, admission);
    expect(JSON.parse(runtime.sendStateless.mock.calls[0]![0])).toMatchObject({
      documentType: "page",
      sourceLocale: "ko",
      locale: "ko",
      localeExists: true,
      document: { locale: "ko" },
    });

    await runtime.protocol.handleStateless({
      connection: runtime.connection,
      documentName: DOCUMENT_NAME,
      document: runtime.document,
      payload: JSON.stringify({
        kind: "block_room.metadata",
        protocolVersion: 1,
        requestId: REQUEST_ID,
        operation: "page_layout",
        payload: { documentLayout: {} },
      }),
    } as never);

    expect(runtime.updatePageDocumentLayout).toHaveBeenCalledWith(
      DOCUMENT_NAME,
      runtime.document,
      expect.any(Object),
      ["33333333-3333-4333-8333-333333333333"],
    );
    expect(
      JSON.parse(runtime.sendStateless.mock.calls.at(-1)![0]),
    ).toMatchObject({
      ok: true,
      ack: { documentRevision: "revision-2", sourceChanged: false },
    });
  });

  it("accepts both empty pre-admission sync frames and fences stale accepted rooms", async () => {
    const runtime = setup();
    const admission = context();
    const empty = new Y.Doc();
    try {
      runtime.protocol.beforeSync(
        runtime.connection as never,
        admission,
        DOCUMENT_NAME,
        runtime.document,
        1,
        Y.encodeStateAsUpdate(empty),
      );
      await admit(runtime, admission);
      runtime.protocol.beforeSync(
        runtime.connection as never,
        admission,
        DOCUMENT_NAME,
        runtime.document,
        2,
        Y.encodeStateAsUpdate(empty),
      );
      runtime.roomEpochs.retire(DOCUMENT_NAME);
      expect(() =>
        runtime.protocol.beforeSync(
          runtime.connection as never,
          admission,
          DOCUMENT_NAME,
          runtime.document,
          2,
          new Uint8Array([1]),
        ),
      ).toThrow("reload_required");
    } finally {
      empty.destroy();
    }
  });

  it("accepts target locale leaves and rejects target document authority changes", async () => {
    const allowed = setup({ target: true });
    const allowedAdmission = await admit(allowed);
    const edited = new Y.Doc();
    try {
      Y.applyUpdate(edited, Y.encodeStateAsUpdate(allowed.document));
      const text = getBlockRoomCollaborativeText(edited, {
        family: "rich_text",
        id: BLOCK_ID,
        locale: true,
        path: "content[0].text.text",
      });
      text.insert(text.length, "!");
      expect(() =>
        allowed.protocol.beforeSync(
          allowed.connection as never,
          allowedAdmission,
          DOCUMENT_NAME,
          allowed.document,
          2,
          Y.encodeStateAsUpdate(edited, Y.encodeStateVector(allowed.document)),
        ),
      ).not.toThrow();
    } finally {
      edited.destroy();
    }

    const rejected = setup({ target: true });
    const rejectedAdmission = await admit(rejected);
    const forged = new Y.Doc();
    try {
      Y.applyUpdate(forged, Y.encodeStateAsUpdate(rejected.document));
      forged
        .getMap("block-document")
        .set("blockCatalogFingerprint", "forged-catalog");
      expect(() =>
        rejected.protocol.beforeSync(
          rejected.connection as never,
          rejectedAdmission,
          DOCUMENT_NAME,
          rejected.document,
          2,
          Y.encodeStateAsUpdate(forged, Y.encodeStateVector(rejected.document)),
        ),
      ).toThrow(
        expect.objectContaining({
          reason: "non_source_document_metadata_forbidden",
        }),
      );
      expect(rejected.close).toHaveBeenCalledOnce();
    } finally {
      forged.destroy();
    }
  });

  it("rejects source-room removal of an explicit-empty locale presence key", async () => {
    const runtime = setup({ emptyLocaleContent: true });
    const admission = await admit(runtime);
    const forged = new Y.Doc();
    try {
      Y.applyUpdate(forged, Y.encodeStateAsUpdate(runtime.document));
      const target = create(AIDocumentFieldTargetSchema, {
        owner: { case: "blockHandle", value: BLOCK_ID },
        fieldHandle: "content",
      });
      const key = canonicalBlockRoomLocaleValueTargetKey(forged, target);
      const presence = forged
        .getMap<unknown>("block-document")
        .get("localePresence");
      if (!(presence instanceof Y.Map)) {
        throw new Error("expected source room locale presence map");
      }
      expect(presence.get(key)).toBe(true);
      presence.delete(key);

      expect(() =>
        runtime.protocol.beforeSync(
          runtime.connection as never,
          admission,
          DOCUMENT_NAME,
          runtime.document,
          2,
          Y.encodeStateAsUpdate(forged, Y.encodeStateVector(runtime.document)),
        ),
      ).toThrow(
        expect.objectContaining({
          reason: "non_source_shared_field_forbidden",
        }),
      );
      expect(runtime.close).toHaveBeenCalledOnce();
    } finally {
      forged.destroy();
    }
  });

  it("allows a canonical source-room shared graph insertion", async () => {
    const runtime = setup();
    const admission = await admit(runtime);
    const edited = new Y.Doc();
    try {
      Y.applyUpdate(edited, Y.encodeStateAsUpdate(runtime.document));
      insertRichTextBlockNode(
        edited,
        fromJson(RichTextBlockNodeSchema, {
          block: { id: INSERTED_BLOCK_ID, paragraph: { props: {} } },
          placement: { index: 1 },
        }),
      );
      insertRichTextBlockLocale(
        edited,
        fromJson(RichTextBlockLocaleSchema, {
          blockId: INSERTED_BLOCK_ID,
          paragraph: { content: [{ text: { text: "New" } }] },
        }),
      );

      expect(() =>
        runtime.protocol.beforeSync(
          runtime.connection as never,
          admission,
          DOCUMENT_NAME,
          runtime.document,
          2,
          Y.encodeStateAsUpdate(edited, Y.encodeStateVector(runtime.document)),
        ),
      ).not.toThrow();
      expect(runtime.close).not.toHaveBeenCalled();
    } finally {
      edited.destroy();
    }
  });

  it("ignores non-update sync frames and reloads after a malformed Yjs update", async () => {
    const runtime = setup();
    const admission = await admit(runtime);

    expect(() =>
      runtime.protocol.beforeSync(
        runtime.connection as never,
        admission,
        DOCUMENT_NAME,
        runtime.document,
        0,
        new Uint8Array(),
      ),
    ).not.toThrow();
    expect(() =>
      runtime.protocol.beforeSync(
        runtime.connection as never,
        admission,
        DOCUMENT_NAME,
        runtime.document,
        2,
        Uint8Array.of(255),
      ),
    ).toThrow();
    expect(
      JSON.parse(runtime.sendStateless.mock.calls.at(-1)![0]),
    ).toMatchObject({ kind: "reload_required", reason: "reload_required" });
  });

  it("sends exact target authority and keeps a missing target preview read-only", async () => {
    const existing = setup({ target: true });
    await admit(existing);
    expect(JSON.parse(existing.sendStateless.mock.calls[0]![0])).toMatchObject({
      sourceLocale: "ko",
      locale: "en",
      localeExists: true,
      targetRevision: "tr1_target",
      sourceMetadata: { locale: "ko", title: "제목" },
      localeMetadata: { locale: "en", title: "Title" },
    });
    await existing.protocol.handleStateless({
      connection: existing.connection,
      documentName: DOCUMENT_NAME,
      document: existing.document,
      payload: JSON.stringify({
        kind: "block_room.snapshot",
        protocolVersion: 1,
        requestId: "11111111-1111-4111-8111-111111111112",
      }),
    } as never);
    expect(
      JSON.parse(existing.sendStateless.mock.calls.at(-1)![0]),
    ).toMatchObject({
      snapshot: {
        documentRevision: "revision-1",
        sourceLocale: "ko",
        locale: "en",
        localeExists: true,
        targetRevision: "tr1_target",
      },
    });

    const missing = setup({ target: true, missingTarget: true });
    missing.protocol.connected(
      missing.connection as never,
      context(),
      DOCUMENT_NAME,
      missing.document,
    );
    const bootstrap = JSON.parse(missing.sendStateless.mock.calls[0]![0]);
    expect(bootstrap).toMatchObject({
      sourceLocale: "ko",
      locale: "en",
      localeExists: false,
      sourceMetadata: { locale: "ko", title: "제목" },
    });
    expect(bootstrap).not.toHaveProperty("localeMetadata");
    expect(bootstrap).not.toHaveProperty("targetRevision");
    expect(missing.connection).toMatchObject({ readOnly: true });
  });

  it.each([
    "",
    "null",
    "[]",
    '"text"',
    "{}",
    JSON.stringify({
      kind: "block_room.snapshot",
      protocolVersion: 1,
      requestId: "bad",
    }),
    JSON.stringify({
      kind: "block_room.bootstrap_ack",
      protocolVersion: 1,
      challenge: "",
      stateVector: "",
    }),
    JSON.stringify({
      kind: "block_room.metadata",
      protocolVersion: 1,
      requestId: REQUEST_ID,
      operation: "bad",
      payload: {},
    }),
  ])("ignores malformed stateless payload %#", async (message) => {
    const runtime = setup();
    runtime.connection.context = context();
    await expect(
      runtime.protocol.handleStateless({
        connection: runtime.connection,
        documentName: DOCUMENT_NAME,
        document: runtime.document,
        payload: message,
      } as never),
    ).resolves.toBe(false);
  });

  it("rejects oversized messages and non-Block contexts", async () => {
    const runtime = setup();
    runtime.connection.context = context(CollaborativeDocumentType.MAP_THEME);
    await expect(
      runtime.protocol.handleStateless({
        connection: runtime.connection,
        documentName: DOCUMENT_NAME,
        document: runtime.document,
        payload: "{}",
      } as never),
    ).resolves.toBe(false);
    runtime.connection.context = context();
    await expect(
      runtime.protocol.handleStateless({
        connection: runtime.connection,
        documentName: DOCUMENT_NAME,
        document: runtime.document,
        payload: "x".repeat(16 * 1024 + 1),
      } as never),
    ).resolves.toBe(false);
  });

  it("fences malformed, underspecified, and unsynchronized bootstrap ACKs", async () => {
    for (const stateVector of [
      "AQ==",
      Buffer.from(Y.encodeStateVector(new Y.Doc())).toString("base64"),
    ]) {
      const runtime = setup();
      const admission = context();
      runtime.connection.context = admission;
      runtime.protocol.connected(
        runtime.connection as never,
        admission,
        DOCUMENT_NAME,
        runtime.document,
      );
      await runtime.protocol.handleStateless({
        connection: runtime.connection,
        documentName: DOCUMENT_NAME,
        document: runtime.document,
        payload: JSON.stringify({
          kind: "block_room.bootstrap_ack",
          protocolVersion: 1,
          challenge: "challenge-a",
          stateVector,
        }),
      } as never);
      expect(runtime.close).toHaveBeenCalledOnce();
    }

    const markFailure = setup();
    const admission = context();
    markFailure.connection.context = admission;
    markFailure.protocol.connected(
      markFailure.connection as never,
      admission,
      DOCUMENT_NAME,
      markFailure.document,
    );
    vi.spyOn(markFailure.roomEpochs, "markSynchronized").mockReturnValue(false);
    await markFailure.protocol.handleStateless({
      connection: markFailure.connection,
      documentName: DOCUMENT_NAME,
      document: markFailure.document,
      payload: JSON.stringify({
        kind: "block_room.bootstrap_ack",
        protocolVersion: 1,
        challenge: "challenge-a",
        stateVector: Buffer.from(
          Y.encodeStateVector(markFailure.document),
        ).toString("base64"),
      }),
    } as never);
    expect(markFailure.close).toHaveBeenCalledOnce();
  });

  it("rejects snapshot and metadata commands after admission is lost", async () => {
    const runtime = setup();
    const admission = await admit(runtime);
    runtime.roomEpochs.retire(DOCUMENT_NAME);

    for (const message of [
      {
        kind: "block_room.snapshot",
        protocolVersion: 1,
        requestId: REQUEST_ID,
      },
      {
        kind: "block_room.metadata",
        protocolVersion: 1,
        requestId: REQUEST_ID,
        operation: "locale",
        payload: {},
      },
    ]) {
      runtime.close.mockClear();
      await runtime.protocol.handleStateless({
        connection: runtime.connection,
        documentName: DOCUMENT_NAME,
        document: runtime.document,
        payload: JSON.stringify(message),
      } as never);
      expect(runtime.close).toHaveBeenCalledOnce();
    }
    expect(admission.blockRoomAdmissionState).toBe("accepted");
  });

  it("rejects a snapshot while the Block room is still pending", async () => {
    const runtime = setup();
    runtime.connection.context = context();
    await runtime.protocol.handleStateless({
      connection: runtime.connection,
      documentName: DOCUMENT_NAME,
      document: runtime.document,
      payload: JSON.stringify({
        kind: "block_room.snapshot",
        protocolVersion: 1,
        requestId: REQUEST_ID,
      }),
    } as never);
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it("rejects metadata without an authenticated Member", async () => {
    const runtime = setup();
    const admission = await admit(runtime);
    admission.member = undefined;
    await runtime.protocol.handleStateless({
      connection: runtime.connection,
      documentName: DOCUMENT_NAME,
      document: runtime.document,
      payload: JSON.stringify({
        kind: "block_room.metadata",
        protocolVersion: 1,
        requestId: REQUEST_ID,
        operation: "locale",
        payload: {},
      }),
    } as never);
    expect(runtime.close).toHaveBeenCalledOnce();
  });

  it.each([
    [CollaborativeDocumentType.POST, { categoryIds: [], tagIds: [] }],
    [CollaborativeDocumentType.ARTIST, { slug: "artist" }],
    [CollaborativeDocumentType.LABEL, { slug: "label" }],
  ])(
    "routes typed document metadata for document type %#",
    async (documentType, body) => {
      const runtime = setup();
      await admit(runtime, context(documentType));
      await runtime.protocol.handleStateless({
        connection: runtime.connection,
        documentName: DOCUMENT_NAME,
        document: runtime.document,
        payload: JSON.stringify({
          kind: "block_room.metadata",
          protocolVersion: 1,
          requestId: REQUEST_ID,
          operation: "document",
          payload: body,
        }),
      } as never);
      expect(runtime.updateMetadata).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["page_layout", {}, "invalid_request"],
    ["document", {}, "invalid_request"],
  ])(
    "rejects invalid %s metadata payloads",
    async (operation, body, expectedError) => {
      const runtime = setup();
      await admit(runtime);
      await runtime.protocol.handleStateless({
        connection: runtime.connection,
        documentName: DOCUMENT_NAME,
        document: runtime.document,
        payload: JSON.stringify({
          kind: "block_room.metadata",
          protocolVersion: 1,
          requestId: REQUEST_ID,
          operation,
          payload: body,
        }),
      } as never);
      expect(
        JSON.parse(runtime.sendStateless.mock.calls.at(-1)![0]),
      ).toMatchObject({
        ok: false,
        error: expectedError,
      });
    },
  );

  it.each([null, "bad", [], {}])(
    "rejects invalid Page layout payload %#",
    async (body) => {
      const runtime = setup({ page: true });
      await admit(runtime, context(CollaborativeDocumentType.PAGE));
      await runtime.protocol.handleStateless({
        connection: runtime.connection,
        documentName: DOCUMENT_NAME,
        document: runtime.document,
        payload: JSON.stringify({
          kind: "block_room.metadata",
          protocolVersion: 1,
          requestId: REQUEST_ID,
          operation: "page_layout",
          payload: body,
        }),
      } as never);
      expect(
        JSON.parse(runtime.sendStateless.mock.calls.at(-1)![0]),
      ).toMatchObject({
        ok: false,
        error: "invalid_request",
      });
    },
  );

  it("rejects unsupported Page document metadata", async () => {
    const runtime = setup({ page: true });
    await admit(runtime, context(CollaborativeDocumentType.PAGE));
    await runtime.protocol.handleStateless({
      connection: runtime.connection,
      documentName: DOCUMENT_NAME,
      document: runtime.document,
      payload: JSON.stringify({
        kind: "block_room.metadata",
        protocolVersion: 1,
        requestId: REQUEST_ID,
        operation: "document",
        payload: {},
      }),
    } as never);
    expect(
      JSON.parse(runtime.sendStateless.mock.calls.at(-1)![0]),
    ).toMatchObject({
      ok: false,
      error: "invalid_request",
    });
  });

  it("rejects viewer metadata without invoking the durable update", async () => {
    const runtime = setup();
    const viewer = context();
    viewer.canEdit = false;
    await admit(runtime, viewer);

    await runtime.protocol.handleStateless({
      connection: runtime.connection,
      documentName: DOCUMENT_NAME,
      document: runtime.document,
      payload: JSON.stringify({
        kind: "block_room.metadata",
        protocolVersion: 1,
        requestId: REQUEST_ID,
        operation: "locale",
        payload: {},
      }),
    } as never);

    expect(runtime.updateMetadata).not.toHaveBeenCalled();
    expect(
      JSON.parse(runtime.sendStateless.mock.calls.at(-1)![0]),
    ).toMatchObject({
      ok: false,
      error: "permission_denied",
    });
  });

  it.each([
    [
      new CollaborationResourceNotFoundError(
        CollaborativeDocumentType.POST,
        "22222222-2222-4222-8222-222222222222",
      ),
      "not_found",
    ],
    [
      new CollaborationConflictError("target_revision_changed"),
      "reload_required",
    ],
    [new Error("dependency_failed"), "metadata_update_failed"],
    ["non_error_failure", "metadata_update_failed"],
  ])("maps metadata failure %# to %s", async (failure, expectedError) => {
    const runtime = setup();
    runtime.updateMetadata.mockRejectedValueOnce(failure);
    await admit(runtime);
    await runtime.protocol.handleStateless({
      connection: runtime.connection,
      documentName: DOCUMENT_NAME,
      document: runtime.document,
      payload: JSON.stringify({
        kind: "block_room.metadata",
        protocolVersion: 1,
        requestId: REQUEST_ID,
        operation: "locale",
        payload: {},
      }),
    } as never);
    expect(
      JSON.parse(runtime.sendStateless.mock.calls.at(-1)![0]),
    ).toMatchObject({
      ok: false,
      error: expectedError,
    });
    if (failure instanceof CollaborationResourceNotFoundError) {
      expect(runtime.dependencies.deleteEntity).toHaveBeenCalledWith(
        DOCUMENT_NAME,
      );
    }
    if (failure instanceof CollaborationConflictError) {
      expect(runtime.dependencies.fenceDocument).toHaveBeenCalledWith(
        failure,
        DOCUMENT_NAME,
        runtime.document,
      );
    }
  });
});
