import {
  CollaborativeDocumentType,
  createDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import { METADATA_AI_GRACE_PERIOD_MS } from "@echovisionlab/geul-common/collaboration/metadata-ai";
import { CollaborationPermission } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { OutgoingMessage, type Server } from "@hocuspocus/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { env } from "../../env.ts";

const mocks = vi.hoisted(() => ({
  serverConfiguration: undefined as unknown,
  serverListen: vi.fn(async () => undefined),
  serverDestroy: vi.fn<() => Promise<void>>(async () => undefined),
  hocuspocusHandleConnection: vi.fn<
    (
      incoming: unknown,
      request: unknown,
      context?: unknown,
    ) => { handleClose: ReturnType<typeof vi.fn> }
  >((incoming, request, context) => {
    void incoming;
    void request;
    void context;
    return { handleClose: vi.fn() };
  }),
  parseDocumentName: vi.fn((documentName?: string) => {
    void documentName;
    return {
      type: CollaborativeDocumentType.POST,
      entityId: "entity-1",
      locale: "en",
    };
  }),
  metadataState: { status: "idle", requesterMemberId: null } as {
    status: string;
    requesterMemberId: string | null;
    orphanedAt?: number | null;
    autoClearAt?: number | null;
  },
  extractMetadataState: vi.fn(),
  authorizeCollaboration: vi.fn<
    () => Promise<{
      id: string;
      nickname: string;
      avatarAsset?: { url: string };
      deleted: boolean;
    } | null>
  >(async () => ({
    id: "22222222-2222-4222-8222-222222222222",
    nickname: "Editor",
    deleted: false,
  })),
  listConnectedMemberIds: vi.fn((): string[] => []),
  persistDocument: vi.fn(async (...args: unknown[]) => {
    void args;
  }),
  withPersistenceQueue: vi.fn(),
  loadCollaborativeDocument: vi.fn(async (): Promise<Y.Doc | null> => null),
  clearMapThemeRevision: vi.fn(),
  handlerLoad: vi.fn(async (): Promise<Uint8Array | null> => null),
  residentUnload: vi.fn(),
  startEvent: vi.fn(async () => undefined),
  startContentUpdated: vi.fn(async () => undefined),
  startTranscode: vi.fn(async () => undefined),
  startTranslation: vi.fn(async () => undefined),
  startIngestProjection: vi.fn(async () => undefined),
  stopStructureLoop: vi.fn<() => Promise<void>>(async () => undefined),
  stopSharedCleanup: vi.fn<() => Promise<void>>(async () => undefined),
  startStructureLoop: vi.fn(),
  startSharedCleanup: vi.fn(),
  stopMessagingConsumers: vi.fn<() => Promise<void>>(async () => undefined),
  closeMessaging: vi.fn<() => Promise<void>>(async () => undefined),
  relayInteractiveMutation: vi.fn(async () => undefined),
  createHttpServer: vi.fn(),
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    system: vi.fn(),
  },
}));

vi.mock("@hocuspocus/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@hocuspocus/server")>();
  class FakeServer {
    readonly requestHandler = vi.fn();
    readonly httpServer = {
      removeListener: vi.fn(),
      on: vi.fn(),
    };
    readonly hocuspocus = {
      documents: new Map(),
      loadingDocuments: new Map(),
      getConnectionsCount: vi.fn(() => 2),
      getDocumentsCount: vi.fn(() => 3),
      handleConnection: mocks.hocuspocusHandleConnection,
      createDocument: vi.fn(),
      unloadDocument: vi.fn(async (document: { name?: string }) => {
        if (document.name) {
          this.hocuspocus.documents.delete(document.name);
        }
      }),
    };

    constructor(configuration: unknown) {
      mocks.serverConfiguration = configuration;
    }

    listen() {
      return mocks.serverListen();
    }

    destroy() {
      return mocks.serverDestroy();
    }
  }
  return { ...original, Server: FakeServer };
});
vi.mock(
  "@echovisionlab/geul-common/collaboration/document",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@echovisionlab/geul-common/collaboration/document")
      >();
    return {
      ...original,
      parseDocumentName: mocks.parseDocumentName,
    };
  },
);
vi.mock(
  "@echovisionlab/geul-common/collaboration/metadata-ai",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@echovisionlab/geul-common/collaboration/metadata-ai")
      >();
    return {
      ...original,
      extractMetadataAiSharedState: mocks.extractMetadataState,
    };
  },
);
vi.mock("node:http", () => ({ createServer: mocks.createHttpServer }));
vi.mock("../../events/ingest-projection-subscriber.ts", () => ({
  startIngestProjectionSubscriber: mocks.startIngestProjection,
}));
vi.mock("../../events/content-updated-subscriber.ts", () => ({
  startContentUpdatedSubscriber: mocks.startContentUpdated,
}));
vi.mock("../../events/subscriber.ts", () => ({
  startEventSubscriber: mocks.startEvent,
}));
vi.mock("../../events/transcode-subscriber.ts", () => ({
  startTranscodeSubscriber: mocks.startTranscode,
}));
vi.mock("../../events/translation-subscriber.ts", () => ({
  startTranslationSubscriber: mocks.startTranslation,
}));
vi.mock("../../handlers/map-theme.ts", () => ({
  clearMapThemeTransientRevision: mocks.clearMapThemeRevision,
}));
vi.mock("../../handlers/index.ts", () => ({
  handlers: {
    post: { load: mocks.handlerLoad, supportsVersionCheckpoints: true },
    [CollaborativeDocumentType.POST]: {
      load: mocks.handlerLoad,
      supportsVersionCheckpoints: true,
    },
    [CollaborativeDocumentType.MAP_THEME]: { load: mocks.handlerLoad },
    [CollaborativeDocumentType.RELEASE]: { load: mocks.handlerLoad },
    [CollaborativeDocumentType.FORM]: {
      load: mocks.handlerLoad,
      supportsVersionCheckpoints: true,
    },
    [CollaborativeDocumentType.EMAIL_LAYOUT]: {
      load: mocks.handlerLoad,
      supportsVersionCheckpoints: true,
    },
  },
}));
vi.mock("../api-client.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api-client.ts")>();
  return { ...original, authorizeCollaboration: mocks.authorizeCollaboration };
});
vi.mock("../api/collaboration.ts", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../api/collaboration.ts")>();
  return { ...original, authorizeCollaboration: mocks.authorizeCollaboration };
});
vi.mock("./document-persistence.ts", () => ({
  loadCollaborativeDocument: mocks.loadCollaborativeDocument,
  listConnectedMemberIds: mocks.listConnectedMemberIds,
  persistCollaborativeDocument: mocks.persistDocument,
  withCollaborativeDocumentPersistenceQueue: mocks.withPersistenceQueue,
}));
vi.mock("../postgresql/messaging.ts", () => ({
  closeMessaging: mocks.closeMessaging,
  stopMessagingConsumers: mocks.stopMessagingConsumers,
}));
vi.mock("../logger.ts", () => ({ logger: mocks.logger }));
import {
  CANONICAL_SESSION_HEADER,
  createCollabServer,
  isCanonicalSession,
  startCollabService,
  type CollabRuntime,
} from "./service.ts";
import {
  CollaborationSessionInvalidError,
  MapThemeRevisionConflictError,
} from "../api-client.ts";
import {
  CollaborationConflictError,
  CollaborationResourceNotFoundError,
} from "../api/transport.ts";
import { TransientDocumentStateMap } from "../transient-document-state.ts";
import { RoomEpochRegistry } from "./room-epoch.ts";
import type { ResidentBlockRuntime } from "./resident-block-runtime.ts";

const sessionId = "33333333-3333-4333-8333-333333333333";
const memberId = "22222222-2222-4222-8222-222222222222";
const authenticatedHeaders = {
  origin: env.SITE_ORIGIN,
  [CANONICAL_SESSION_HEADER]: sessionId,
};

type Callback = (argument: unknown) => Promise<unknown>;

let testRoomEpochs = new RoomEpochRegistry();

function createTestCollabServer() {
  testRoomEpochs = new RoomEpochRegistry();
  const residentBlocks = {
    async load(_documentName: string, document: Y.Doc) {
      const state = await mocks.handlerLoad();
      if (state?.length) Y.applyUpdate(document, state);
    },
    persistEditSession: mocks.persistDocument,
    withPersistenceQueue: mocks.withPersistenceQueue,
    unload: mocks.residentUnload,
    applyAcceptedInteractiveMutation: mocks.relayInteractiveMutation,
  } as unknown as ResidentBlockRuntime;
  return createCollabServer({
    roomEpochs: testRoomEpochs,
    residentBlocks,
    roomOwnership: {
      acquire: vi.fn().mockResolvedValue(undefined),
      isOwned: vi.fn(() => true),
      release: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    },
  });
}

function callback(name: string): Callback {
  const configured = (mocks.serverConfiguration as Record<string, Callback>)[
    name
  ]!;
  if (name !== "onAuthenticate") {
    return configured;
  }
  return (argument) => {
    const payload = argument as { documentName: string; token?: string };
    const token =
      payload.token ??
      testRoomEpochs.issueToken(payload.documentName, {
        yjsBootstrapStateVector: Uint8Array.of(0),
      });
    testRoomEpochs.markSynchronized(payload.documentName, token);
    return configured({
      connectionConfig: { isAuthenticated: false, readOnly: false },
      ...payload,
      token,
    });
  };
}

async function recordMutation(
  documentName: string,
  document: unknown,
  actorMemberId = memberId,
): Promise<void> {
  await callback("onChange")({
    documentName,
    document,
    connection: {},
    context: { member: { id: actorMemberId } },
    transactionOrigin: { source: "connection" },
  });
}

function request(headers: Record<string, string> = {}) {
  return { headers: new Headers(headers) };
}

function inboundFrame(documentName = "post:entity-1"): Uint8Array {
  return new OutgoingMessage(documentName).writeStateless("{}").toUint8Array();
}

function metadataDocument() {
  const values = new Map<string, unknown>();
  const setLocalStateField = vi.fn();
  return {
    values,
    awareness: { setLocalStateField },
    getConnections: vi.fn(() => []),
    getMap: vi.fn(() => ({
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    })),
  };
}

async function expectRejectedMapThemeFrame(
  reason: "permission_revoked" | "session_expired",
): Promise<void> {
  const sendStateless = vi.fn();
  const close = vi.fn();
  const document = new Y.Doc();
  document.getMap("theme").set("name", "accepted-before-revoke");
  const deniedFrame = new Y.Doc();
  deniedFrame.getMap("theme").set("name", "must-not-apply");
  const context = {
    member: { id: memberId, nickname: "Editor", deleted: false },
    sessionId,
    documentType: CollaborativeDocumentType.MAP_THEME,
    resourceId: "theme-1",
    locale: "und",
  };

  if (reason === "session_expired") {
    mocks.authorizeCollaboration.mockRejectedValueOnce(
      new CollaborationSessionInvalidError(),
    );
  } else {
    mocks.authorizeCollaboration.mockResolvedValueOnce(null);
  }

  const rejected = callback("beforeHandleMessage")({
    connection: { sendStateless, close },
    context,
    documentName: "map-theme:theme-1",
    update: Y.encodeStateAsUpdate(deniedFrame),
  });
  if (reason === "session_expired") {
    await expect(rejected).rejects.toBeInstanceOf(
      CollaborationSessionInvalidError,
    );
  } else {
    await expect(rejected).rejects.toThrow("permission_revoked");
  }

  expect(mocks.authorizeCollaboration).toHaveBeenCalledWith({
    sessionId,
    documentType: CollaborativeDocumentType.MAP_THEME,
    resourceId: "theme-1",
    locale: "und",
    permission: CollaborationPermission.EDIT,
  });
  expect(document.getMap("theme").get("name")).toBe("accepted-before-revoke");
  expect(sendStateless).toHaveBeenCalledWith(
    JSON.stringify({ kind: reason, reason }),
  );
  expect(sendStateless).not.toHaveBeenCalledWith(
    expect.stringContaining("reload_required"),
  );
  expect(close).toHaveBeenCalledOnce();
  expect(mocks.logger.warn).toHaveBeenCalledWith(
    reason === "session_expired"
      ? "Collaboration session expired"
      : "Collaboration permission revoked",
    expect.objectContaining({
      entity_type: CollaborativeDocumentType.MAP_THEME,
      entity_id: "theme-1",
      member_id: memberId,
    }),
  );
  expect(mocks.persistDocument).not.toHaveBeenCalled();
}

class ExitError extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

function runtimeFixture() {
  let internalListener:
    Parameters<CollabRuntime["createInternalServer"]>[0] | undefined;
  const processListeners = new Map<string, (value: unknown) => unknown>();
  const listen = vi.fn((_port: number, ready: () => void) => ready());
  const close = vi.fn((ready: (error?: Error) => void) => ready());
  const runtime: CollabRuntime = {
    createInternalServer(listener) {
      internalListener = listener;
      return { listen, close };
    },
    onProcessEvent(event, listener) {
      processListeners.set(event, listener);
    },
    exit(code): never {
      throw new ExitError(code);
    },
  };
  return {
    runtime,
    listen,
    close,
    processListeners,
    health(url: string | undefined) {
      const response = {
        writeHead:
          vi.fn<(status: number, headers?: Record<string, string>) => void>(),
        end: vi.fn<(body?: string) => void>(),
      };
      internalListener!({ url, method: "GET" } as never, response as never);
      return response;
    },
  };
}

describe("collab server callbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logger.system.mockImplementation(
      (level: "info" | "warn" | "error", record: unknown) =>
        mocks.logger[level]("System event", record),
    );
    mocks.authorizeCollaboration.mockReset();
    mocks.hocuspocusHandleConnection.mockReset();
    mocks.hocuspocusHandleConnection.mockImplementation(
      (incoming, request, context) => {
        void incoming;
        void request;
        void context;
        return { handleClose: vi.fn() };
      },
    );
    mocks.persistDocument.mockReset();
    mocks.loadCollaborativeDocument.mockReset();
    mocks.loadCollaborativeDocument.mockResolvedValue(null);
    mocks.metadataState = { status: "idle", requesterMemberId: null };
    mocks.extractMetadataState.mockImplementation(
      (reader: { get(key: string): unknown }) => {
        const valueOrFallback = <T>(key: string, fallback: T): T => {
          const value = reader.get(key);
          return (value === undefined ? fallback : value) as T;
        };
        return {
          ...mocks.metadataState,
          status: valueOrFallback("status", mocks.metadataState.status),
          requesterMemberId: valueOrFallback(
            "requesterMemberId",
            mocks.metadataState.requesterMemberId,
          ),
          orphanedAt: valueOrFallback(
            "orphanedAt",
            mocks.metadataState.orphanedAt ?? null,
          ),
          autoClearAt: valueOrFallback(
            "autoClearAt",
            mocks.metadataState.autoClearAt ?? null,
          ),
        };
      },
    );
    mocks.parseDocumentName.mockImplementation(
      (documentName = "post:entity-1") => {
        const [prefix, entityId] = documentName.split(":");
        if (!prefix || !entityId) {
          throw new Error("Invalid document name format");
        }
        const types: Record<string, CollaborativeDocumentType> = {
          post: CollaborativeDocumentType.POST,
          page: CollaborativeDocumentType.PAGE,
          work: CollaborativeDocumentType.WORK,
          "program-event": CollaborativeDocumentType.PROGRAM_EVENT,
          artist: CollaborativeDocumentType.ARTIST,
          label: CollaborativeDocumentType.LABEL,
          release: CollaborativeDocumentType.RELEASE,
          campaign: CollaborativeDocumentType.CAMPAIGN,
          "email-template": CollaborativeDocumentType.EMAIL_TEMPLATE,
          "email-layout": CollaborativeDocumentType.EMAIL_LAYOUT,
          "terms-history": CollaborativeDocumentType.TERMS_HISTORY,
          "privacy-history": CollaborativeDocumentType.PRIVACY_HISTORY,
          form: CollaborativeDocumentType.FORM,
          "map-theme": CollaborativeDocumentType.MAP_THEME,
        };
        const type = types[prefix];
        if (type === undefined) {
          throw new Error("Invalid document name format");
        }
        return {
          type,
          entityId,
          locale: type === CollaborativeDocumentType.MAP_THEME ? "und" : "en",
        };
      },
    );
    mocks.authorizeCollaboration.mockResolvedValue({
      id: memberId,
      nickname: "Editor",
      avatarAsset: { url: "https://cdn.example/avatar.webp" },
      deleted: false,
    });
    mocks.listConnectedMemberIds.mockReturnValue([]);
    mocks.withPersistenceQueue.mockImplementation(async (queueKey, operation) =>
      operation((documentName: string, document: Y.Doc, options: unknown) =>
        mocks.persistDocument(documentName, document, options, queueKey),
      ),
    );
    mocks.handlerLoad.mockResolvedValue(null);
    createTestCollabServer();
  });

  it("accepts only the Oathkeeper session and one API Member projection", async () => {
    const authenticate = callback("onAuthenticate");
    await expect(
      authenticate({ documentName: "post:entity-1", request: request() }),
    ).rejects.toThrow("Authentication required");

    await expect(
      authenticate({
        documentName: "post:entity-1",
        request: request(authenticatedHeaders),
      }),
    ).resolves.toMatchObject({
      member: {
        id: memberId,
        nickname: "Editor",
        avatarAsset: { url: "https://cdn.example/avatar.webp" },
        deleted: false,
      },
      sessionId,
      documentType: CollaborativeDocumentType.POST,
      resourceId: "entity-1",
    });
    expect(mocks.authorizeCollaboration).toHaveBeenCalledTimes(2);
    expect(mocks.authorizeCollaboration).toHaveBeenNthCalledWith(1, {
      sessionId,
      documentType: CollaborativeDocumentType.POST,
      resourceId: "entity-1",
      locale: "en",
      permission: CollaborationPermission.VIEW,
    });
    expect(mocks.authorizeCollaboration).toHaveBeenNthCalledWith(2, {
      sessionId,
      documentType: CollaborativeDocumentType.POST,
      resourceId: "entity-1",
      locale: "en",
      permission: CollaborationPermission.EDIT,
    });
    expect(mocks.logger.info).not.toHaveBeenCalledWith(
      "Client authenticated",
      expect.anything(),
    );
  });

  it("fences a stale Map Theme until exact unload, then admits a fresh load without affecting other rooms", async () => {
    const server = createTestCollabServer();
    const sendStateless = vi.fn();
    const close = vi.fn();
    const document = new Y.Doc() as Y.Doc & {
      name: string;
      getConnections(): Array<{
        sendStateless: typeof sendStateless;
        close: typeof close;
      }>;
    };
    Object.defineProperties(document, {
      name: { value: "map-theme:theme-conflict" },
      getConnections: {
        value: () => [{ sendStateless, close }],
      },
    });
    server.hocuspocus.documents.set(document.name, document as never);
    mocks.parseDocumentName.mockImplementation(
      (documentName = "") =>
        ({
          type: CollaborativeDocumentType.MAP_THEME,
          entityId: documentName.slice("map-theme:".length),
          locale: "und",
        }) as never,
    );
    mocks.persistDocument.mockRejectedValueOnce(
      new MapThemeRevisionConflictError(),
    );

    await recordMutation(document.name, document);
    await callback("onStoreDocument")({
      documentName: document.name,
      document,
    });
    await callback("onStoreDocument")({
      documentName: document.name,
      document,
    });

    expect(sendStateless).toHaveBeenCalledWith(
      JSON.stringify({ kind: "reload_required", reason: "reload_required" }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.clearMapThemeRevision).toHaveBeenCalledOnce();
    expect(mocks.clearMapThemeRevision).toHaveBeenCalledWith(
      "map-theme:theme-conflict",
    );
    expect(mocks.persistDocument).toHaveBeenCalledOnce();

    mocks.authorizeCollaboration.mockClear();
    await expect(
      callback("onAuthenticate")({
        documentName: document.name,
        request: request(authenticatedHeaders),
        socketId: "socket-before-unload",
      }),
    ).rejects.toThrow("reload_required");
    expect(mocks.authorizeCollaboration).not.toHaveBeenCalled();

    await expect(
      callback("onAuthenticate")({
        documentName: "map-theme:theme-unrelated",
        request: request(authenticatedHeaders),
        socketId: "socket-unrelated",
      }),
    ).resolves.toMatchObject({
      documentType: CollaborativeDocumentType.MAP_THEME,
      resourceId: "theme-unrelated",
    });

    await callback("afterUnloadDocument")({
      documentName: "map-theme:theme-unrelated",
    });
    await expect(
      callback("onAuthenticate")({
        documentName: document.name,
        request: request(authenticatedHeaders),
        socketId: "socket-after-unrelated-unload",
      }),
    ).rejects.toThrow("reload_required");

    server.hocuspocus.documents.delete(document.name);
    await callback("afterUnloadDocument")({ documentName: document.name });

    const freshSource = new Y.Doc();
    freshSource.getMap("theme").set("name", "fresh-from-db");
    mocks.handlerLoad.mockResolvedValueOnce(Y.encodeStateAsUpdate(freshSource));
    const freshContext = await callback("onAuthenticate")({
      documentName: document.name,
      request: request(authenticatedHeaders),
      socketId: "socket-after-unload",
    });
    const freshlyLoaded = new Y.Doc();
    await expect(
      callback("onLoadDocument")({
        documentName: document.name,
        document: freshlyLoaded,
        context: freshContext,
      }),
    ).resolves.toBe(freshlyLoaded);
    expect(freshlyLoaded.getMap("theme").get("name")).toBe("fresh-from-db");
    expect(mocks.handlerLoad).toHaveBeenCalledWith(document.name);
    expect(mocks.authorizeCollaboration).toHaveBeenCalledTimes(4);
    expect(mocks.authorizeCollaboration).toHaveBeenLastCalledWith(
      expect.objectContaining({ resourceId: "theme-conflict" }),
    );
  });

  it("rejects an in-flight Map Theme admission when the room becomes fenced during authorization", async () => {
    let resolveAuthorization!: (member: {
      id: string;
      nickname: string;
      deleted: boolean;
    }) => void;
    mocks.authorizeCollaboration.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAuthorization = resolve;
      }),
    );
    const documentName = "map-theme:theme-in-flight";
    mocks.parseDocumentName.mockReturnValue({
      type: CollaborativeDocumentType.MAP_THEME,
      entityId: "theme-in-flight",
      locale: "und",
    } as never);
    const authenticating = callback("onAuthenticate")({
      documentName,
      request: request(authenticatedHeaders),
      socketId: "socket-in-flight",
    });
    await vi.waitFor(() =>
      expect(mocks.authorizeCollaboration).toHaveBeenCalledOnce(),
    );

    const connection = { sendStateless: vi.fn(), close: vi.fn() };
    const document = new Y.Doc() as Y.Doc & {
      getConnections(): Array<typeof connection>;
    };
    Object.defineProperty(document, "getConnections", {
      value: () => [connection],
    });
    mocks.persistDocument.mockRejectedValueOnce(
      new MapThemeRevisionConflictError(),
    );
    await recordMutation(documentName, document);
    await callback("onStoreDocument")({ documentName, document });

    resolveAuthorization({
      id: memberId,
      nickname: "Editor",
      deleted: false,
    });
    await expect(authenticating).rejects.toMatchObject({
      message: "reload_required",
      reason: "reload_required",
    });
    expect(connection.sendStateless).toHaveBeenCalledWith(
      JSON.stringify({ kind: "reload_required", reason: "reload_required" }),
    );
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it("uses the same reload-required boundary for an immediate persist conflict", async () => {
    const server = createTestCollabServer();
    const connection = {
      sendStateless: vi.fn(),
      close: vi.fn(),
      context: { canEdit: true },
    };
    const document = new Y.Doc() as Y.Doc & {
      name: string;
      getConnections(): Array<typeof connection>;
    };
    Object.defineProperties(document, {
      name: { value: "map-theme:theme-immediate-conflict" },
      getConnections: { value: () => [connection] },
    });
    server.hocuspocus.documents.set(document.name, document as never);
    mocks.parseDocumentName.mockReturnValue({
      type: CollaborativeDocumentType.MAP_THEME,
      entityId: "theme-immediate-conflict",
      locale: "und",
    } as never);
    mocks.persistDocument.mockRejectedValueOnce(
      new MapThemeRevisionConflictError(),
    );

    await recordMutation(document.name, document);
    await callback("onStateless")({
      connection,
      documentName: document.name,
      document,
      payload: '{"kind":"persist.now.request","requestId":"save-1"}',
    });
    await callback("onStoreDocument")({
      documentName: document.name,
      document,
    });

    expect(connection.sendStateless).toHaveBeenCalledTimes(1);
    expect(connection.sendStateless).toHaveBeenCalledWith(
      JSON.stringify({ kind: "reload_required", reason: "reload_required" }),
    );
    expect(connection.close).toHaveBeenCalledOnce();
    expect(mocks.clearMapThemeRevision).toHaveBeenCalledWith(
      "map-theme:theme-immediate-conflict",
    );
    expect(mocks.persistDocument).toHaveBeenCalledOnce();
    expect(server.hocuspocus.documents.has(document.name)).toBe(true);
    server.hocuspocus.documents.delete(document.name);
    await callback("afterUnloadDocument")({ documentName: document.name });
  });

  it("fences the exact stale Post room until unload without affecting another Post room", async () => {
    const documentName = "post:post-conflict";
    const sendStateless = vi.fn();
    const close = vi.fn();
    const document = new Y.Doc() as Y.Doc & {
      getConnections(): Array<{
        sendStateless: typeof sendStateless;
        close: typeof close;
      }>;
    };
    Object.defineProperty(document, "getConnections", {
      value: () => [{ sendStateless, close }],
    });
    mocks.persistDocument.mockRejectedValueOnce(
      new CollaborationConflictError("document_revision_changed"),
    );

    await recordMutation(documentName, document);
    await callback("onStoreDocument")({ documentName, document });
    await callback("onStoreDocument")({ documentName, document });

    expect(sendStateless).toHaveBeenCalledOnce();
    expect(sendStateless).toHaveBeenCalledWith(
      JSON.stringify({ kind: "reload_required", reason: "reload_required" }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.persistDocument).toHaveBeenCalledOnce();
    expect(mocks.clearMapThemeRevision).not.toHaveBeenCalled();

    mocks.authorizeCollaboration.mockClear();
    await expect(
      callback("onAuthenticate")({
        documentName,
        request: request(authenticatedHeaders),
        socketId: "socket-stale-post",
      }),
    ).rejects.toThrow("reload_required");
    expect(mocks.authorizeCollaboration).not.toHaveBeenCalled();

    await expect(
      callback("onAuthenticate")({
        documentName: "post:post-unrelated",
        request: request(authenticatedHeaders),
        socketId: "socket-unrelated-post",
      }),
    ).resolves.toMatchObject({
      documentType: CollaborativeDocumentType.POST,
      resourceId: "post-unrelated",
    });

    await callback("afterUnloadDocument")({ documentName });
    await expect(
      callback("onAuthenticate")({
        documentName,
        request: request(authenticatedHeaders),
        socketId: "socket-fresh-post",
      }),
    ).resolves.toMatchObject({
      documentType: CollaborativeDocumentType.POST,
      resourceId: "post-conflict",
    });
  });

  it("fences a stale Page room and requires reload", async () => {
    const documentName = "page:page-conflict";
    const id = documentName.slice("page:".length);
    mocks.parseDocumentName.mockReturnValue({
      type: CollaborativeDocumentType.PAGE,
      entityId: id,
      locale: "en",
    } as never);
    const sendStateless = vi.fn();
    const close = vi.fn();
    const document = new Y.Doc() as Y.Doc & {
      getConnections(): Array<{
        sendStateless: typeof sendStateless;
        close: typeof close;
      }>;
    };
    Object.defineProperty(document, "getConnections", {
      value: () => [{ sendStateless, close }],
    });
    mocks.persistDocument.mockRejectedValueOnce(
      new CollaborationConflictError("document_revision_changed"),
    );

    await recordMutation(documentName, document);
    await callback("onStoreDocument")({ documentName, document });
    await callback("onStoreDocument")({ documentName, document });

    expect(sendStateless).toHaveBeenCalledOnce();
    expect(sendStateless).toHaveBeenCalledWith(
      JSON.stringify({ kind: "reload_required", reason: "reload_required" }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.persistDocument).toHaveBeenCalledOnce();
  });

  it.each(["permission_revoked", "session_expired"] as const)(
    "blocks the first Page frame after %s before apply",
    async (reason) => {
      const sendStateless = vi.fn();
      const close = vi.fn();
      const context = {
        member: { id: memberId, nickname: "Editor", deleted: false },
        sessionId,
        documentType: CollaborativeDocumentType.PAGE,
        resourceId: "page-1",
        locale: "en",
      };
      if (reason === "session_expired") {
        mocks.authorizeCollaboration.mockRejectedValueOnce(
          new CollaborationSessionInvalidError(),
        );
      } else {
        mocks.authorizeCollaboration.mockResolvedValueOnce(null);
      }

      const rejected = callback("beforeHandleMessage")({
        connection: { sendStateless, close },
        context,
        documentName: "page:page-1",
        update: inboundFrame("page:page-1"),
      });
      if (reason === "session_expired") {
        await expect(rejected).rejects.toBeInstanceOf(
          CollaborationSessionInvalidError,
        );
      } else {
        await expect(rejected).rejects.toThrow("permission_revoked");
      }

      expect(mocks.authorizeCollaboration).toHaveBeenCalledWith({
        sessionId,
        documentType: CollaborativeDocumentType.PAGE,
        resourceId: "page-1",
        locale: "en",
        permission: CollaborationPermission.EDIT,
      });
      expect(sendStateless).toHaveBeenCalledWith(
        JSON.stringify({ kind: reason, reason }),
      );
      expect(close).toHaveBeenCalledOnce();
      expect(mocks.persistDocument).not.toHaveBeenCalled();
    },
  );

  it("persists an approved Post frame, then blocks the first post-revoke frame before apply", async () => {
    const sendStateless = vi.fn();
    const close = vi.fn();
    const document = new Y.Doc();
    const context = {
      member: {
        id: memberId,
        nickname: "Editor",
        deleted: false,
      },
      sessionId,
      documentType: CollaborativeDocumentType.POST,
      resourceId: "entity-1",
      locale: "en",
    };
    mocks.authorizeCollaboration
      .mockResolvedValueOnce({
        id: memberId,
        nickname: "Editor",
        deleted: false,
      })
      .mockResolvedValueOnce(null);

    await expect(
      callback("beforeHandleMessage")({
        connection: { sendStateless, close },
        context,
        documentName: "post:entity-1",
        update: inboundFrame(),
      }),
    ).resolves.toBeUndefined();
    document.getMap("content").set("value", "accepted-before-archive");
    await callback("onChange")({
      documentName: "post:entity-1",
      document,
      connection: {},
      context,
      transactionOrigin: { source: "connection" },
    });

    await expect(
      callback("beforeHandleMessage")({
        connection: { sendStateless, close },
        context,
        documentName: "post:entity-1",
        update: inboundFrame(),
      }),
    ).rejects.toThrow("permission_revoked");

    // Hocuspocus applies a frame only after beforeHandleMessage resolves. The
    // denied second frame is intentionally not applied here.
    await callback("onStoreDocument")({
      documentName: "post:entity-1",
      document,
    });

    expect(mocks.authorizeCollaboration).toHaveBeenNthCalledWith(2, {
      sessionId,
      documentType: CollaborativeDocumentType.POST,
      resourceId: "entity-1",
      locale: "en",
      permission: CollaborationPermission.EDIT,
    });
    expect(document.getMap("content").get("value")).toBe(
      "accepted-before-archive",
    );
    expect(mocks.persistDocument).toHaveBeenCalledWith(
      "post:entity-1",
      document,
      { contributorMemberIds: [memberId] },
    );
    expect(mocks.authorizeCollaboration).toHaveBeenCalledTimes(2);
    expect(sendStateless).toHaveBeenCalledWith(
      JSON.stringify({
        kind: "permission_revoked",
        reason: "permission_revoked",
      }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Collaboration permission revoked",
      expect.objectContaining({
        reason: "permission_revoked",
        entity_id: "entity-1",
        member_id: memberId,
      }),
    );
  });

  it("fails a Post frame closed on authorization service error without revoke labeling", async () => {
    const sendStateless = vi.fn();
    const close = vi.fn();
    const unavailable = new Error("authorization unavailable");
    mocks.authorizeCollaboration.mockRejectedValueOnce(unavailable);

    await expect(
      callback("beforeHandleMessage")({
        connection: { sendStateless, close },
        context: {
          member: { id: memberId, nickname: "Editor", deleted: false },
          sessionId,
          documentType: CollaborativeDocumentType.POST,
          resourceId: "entity-1",
          locale: "en",
        },
        documentName: "post:entity-1",
        update: inboundFrame(),
      }),
    ).rejects.toBe(unavailable);

    expect(sendStateless).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(mocks.logger.warn).not.toHaveBeenCalledWith(
      "Collaboration permission revoked",
      expect.anything(),
    );
    expect(mocks.persistDocument).not.toHaveBeenCalled();
  });

  it("stops the first post-expiry frame and emits only the session-expired signal", async () => {
    const sendStateless = vi.fn();
    const close = vi.fn();
    mocks.authorizeCollaboration.mockRejectedValueOnce(
      new CollaborationSessionInvalidError(),
    );

    await expect(
      callback("beforeHandleMessage")({
        connection: { sendStateless, close },
        context: {
          member: { id: memberId, nickname: "Editor", deleted: false },
          sessionId,
          documentType: CollaborativeDocumentType.POST,
          resourceId: "entity-1",
          locale: "en",
        },
        documentName: "post:entity-1",
        update: inboundFrame(),
      }),
    ).rejects.toBeInstanceOf(CollaborationSessionInvalidError);

    expect(sendStateless).toHaveBeenCalledWith(
      JSON.stringify({ kind: "session_expired", reason: "session_expired" }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Collaboration session expired",
      expect.objectContaining({
        reason: "session_expired",
        entity_id: "entity-1",
        member_id: memberId,
      }),
    );
    expect(mocks.persistDocument).not.toHaveBeenCalled();
  });

  it("closes the session-expired connection when its signal cannot be sent", async () => {
    const sendStateless = vi.fn(() => {
      throw new Error("signal failed");
    });
    const close = vi.fn(() => {
      throw new Error("close failed");
    });
    mocks.authorizeCollaboration.mockRejectedValueOnce(
      new CollaborationSessionInvalidError(),
    );

    await expect(
      callback("beforeHandleMessage")({
        connection: { sendStateless, close },
        context: {
          member: { id: memberId, nickname: "Editor", deleted: false },
          sessionId,
          documentType: CollaborativeDocumentType.POST,
          resourceId: "entity-1",
          locale: "en",
        },
        documentName: "post:entity-1",
        update: inboundFrame(),
      }),
    ).rejects.toBeInstanceOf(CollaborationSessionInvalidError);

    expect(close).toHaveBeenCalledOnce();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Collaboration session expired",
      expect.objectContaining({
        signal_failed: true,
        close_failed: true,
      }),
    );
  });

  it("rejects the first Map Theme frame after Admin role revoke", async () => {
    await expectRejectedMapThemeFrame("permission_revoked");
  });

  it("rejects the first Map Theme frame after the Theme is deleted", async () => {
    await expectRejectedMapThemeFrame("permission_revoked");
  });

  it("rejects the first Map Theme frame after Session expiry", async () => {
    await expectRejectedMapThemeFrame("session_expired");
  });

  it("keeps accepted A and B attribution through A revoke and completes the version checkpoint", async () => {
    vi.useFakeTimers();
    try {
      const server = createTestCollabServer();
      const memberA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const memberB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
      const connections: Array<{
        context: Record<string, unknown>;
        sendStateless: ReturnType<typeof vi.fn>;
        close: ReturnType<typeof vi.fn>;
      }> = [];
      const shared = new Y.Doc() as Y.Doc & {
        name: string;
        getConnections(): typeof connections;
      };
      Object.defineProperties(shared, {
        name: { value: "post:entity-1" },
        getConnections: { value: () => connections },
      });
      server.hocuspocus.documents.set(shared.name, shared as never);

      const contextA = {
        member: { id: memberA, nickname: "A", deleted: false },
        sessionId,
        documentType: CollaborativeDocumentType.POST,
        resourceId: "entity-1",
        locale: "en",
      };
      const contextB = {
        member: { id: memberB, nickname: "B", deleted: false },
        sessionId: "44444444-4444-4444-8444-444444444444",
        documentType: CollaborativeDocumentType.POST,
        resourceId: "entity-1",
        locale: "en",
      };
      const connectionA = {
        context: contextA,
        sendStateless: vi.fn(),
        close: vi.fn(() => {
          const index = connections.indexOf(connectionA);
          if (index >= 0) connections.splice(index, 1);
        }),
      };
      const connectionB = {
        context: contextB,
        sendStateless: vi.fn(),
        close: vi.fn(() => {
          const index = connections.indexOf(connectionB);
          if (index >= 0) connections.splice(index, 1);
        }),
      };
      connections.push(connectionA, connectionB);
      mocks.authorizeCollaboration
        .mockResolvedValueOnce({ id: memberA, nickname: "A", deleted: false })
        .mockResolvedValueOnce({ id: memberB, nickname: "B", deleted: false })
        .mockResolvedValueOnce(null);

      for (const [context, connection] of [
        [contextA, connectionA],
        [contextB, connectionB],
      ] as const) {
        await callback("beforeHandleMessage")({
          connection,
          context,
          documentName: shared.name,
          update: inboundFrame(shared.name),
        });
        await callback("onChange")({
          documentName: shared.name,
          document: shared,
          connection,
          context,
          transactionOrigin: { source: "connection" },
        });
        if (context === contextA) {
          await callback("onStoreDocument")({
            documentName: shared.name,
            document: shared,
          });
        }
      }

      await expect(
        callback("beforeHandleMessage")({
          connection: connectionA,
          context: contextA,
          documentName: shared.name,
          update: inboundFrame(shared.name),
        }),
      ).rejects.toThrow("permission_revoked");

      await callback("onStoreDocument")({
        documentName: shared.name,
        document: shared,
      });
      expect(mocks.persistDocument).toHaveBeenLastCalledWith(
        shared.name,
        shared,
        { contributorMemberIds: [memberB] },
      );
      expect(mocks.authorizeCollaboration).toHaveBeenCalledTimes(3);

      connectionB.close();
      await callback("onDisconnect")({
        documentName: shared.name,
        document: shared,
        context: contextB,
        socketId: "socket-B",
      });
      await vi.advanceTimersByTimeAsync(10_000);

      expect(mocks.persistDocument).toHaveBeenLastCalledWith(
        shared.name,
        shared,
        {
          contributorMemberIds: [memberA, memberB],
          versionCheckpoint: true,
        },
        shared.name,
      );
      await expect(
        callback("beforeUnloadDocument")({
          documentName: shared.name,
          document: shared,
        }),
      ).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [CollaborativeDocumentType.FORM, "form:form-1"],
    [CollaborativeDocumentType.EMAIL_LAYOUT, "email-layout:layout-1"],
  ] as const)(
    "finalizes the canonical %s source room through the runtime checkpoint path",
    async (documentType, documentName) => {
      vi.useFakeTimers();
      try {
        const server = createTestCollabServer();
        const document = new Y.Doc() as Y.Doc & {
          name: string;
          getConnections(): [];
        };
        Object.defineProperties(document, {
          name: { value: documentName },
          getConnections: { value: () => [] },
        });
        server.hocuspocus.documents.set(documentName, document as never);
        mocks.parseDocumentName.mockReturnValue({
          type: documentType,
          entityId: documentName.slice(documentName.indexOf(":") + 1),
          locale: "en",
        });

        await callback("onChange")({
          documentName,
          document,
          context: { member: { id: memberId } },
          connection: {},
          transactionOrigin: { source: "connection" },
        });
        await callback("onDisconnect")({
          documentName,
          document,
          context: { member: { id: memberId } },
          socketId: `socket-${documentType}`,
        });
        await vi.advanceTimersByTimeAsync(10_000);

        expect(mocks.persistDocument).toHaveBeenLastCalledWith(
          documentName,
          document,
          {
            contributorMemberIds: [memberId],
            versionCheckpoint: true,
          },
          documentName,
        );
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("closes and unloads the resident aggregate on terminal Post save not-found", async () => {
    const server = createTestCollabServer();
    const sendStateless = vi.fn();
    const connection = {
      context: {
        member: { id: memberId, nickname: "Editor", deleted: false },
        sessionId,
        documentType: CollaborativeDocumentType.POST,
        resourceId: "entity-1",
        locale: "en",
      },
      sendStateless,
      close: vi.fn(),
    };
    const shared = new Y.Doc() as Y.Doc & {
      name: string;
      getConnections(): [typeof connection];
    };
    const unrelated = new Y.Doc() as Y.Doc & {
      name: string;
      getConnections(): [];
    };
    Object.defineProperties(shared, {
      name: { value: "post:entity-1" },
      getConnections: { value: () => [connection] },
    });
    Object.defineProperties(unrelated, {
      name: { value: "post:unrelated" },
      getConnections: { value: () => [] },
    });
    server.hocuspocus.documents.set(shared.name, shared as never);
    server.hocuspocus.documents.set(unrelated.name, unrelated as never);
    await callback("onChange")({
      documentName: shared.name,
      document: shared,
      connection,
      context: connection.context,
      transactionOrigin: { source: "connection" },
    });
    mocks.persistDocument.mockRejectedValueOnce(
      new CollaborationResourceNotFoundError(
        CollaborativeDocumentType.POST,
        "entity-1",
      ),
    );

    await expect(
      callback("onStoreDocument")({
        documentName: shared.name,
        document: shared,
      }),
    ).resolves.toBeUndefined();

    expect(connection.close).toHaveBeenCalledOnce();
    expect(sendStateless).toHaveBeenCalledWith(
      JSON.stringify({
        kind: "permission_revoked",
        reason: "permission_revoked",
      }),
    );
    expect(server.hocuspocus.unloadDocument).toHaveBeenCalledOnce();
    expect(server.hocuspocus.documents.size).toBe(1);
    expect(server.hocuspocus.documents.has(unrelated.name)).toBe(true);
    expect(mocks.persistDocument).toHaveBeenCalledOnce();
    await expect(
      callback("beforeUnloadDocument")({
        documentName: shared.name,
        document: shared,
      }),
    ).resolves.toBeUndefined();
  });

  it("closes and unloads an open Map Theme room on terminal save not-found", async () => {
    const server = createTestCollabServer();
    const documentName = "map-theme:theme-deleted";
    const transientState = new TransientDocumentStateMap<number>();
    transientState.set(documentName, 7);
    const context = {
      member: { id: memberId, nickname: "Editor", deleted: false },
      sessionId,
      documentType: CollaborativeDocumentType.MAP_THEME,
      resourceId: "theme-deleted",
      locale: "und",
    };
    const firstConnection = {
      context,
      sendStateless: vi.fn(() => {
        throw new Error("socket send failed");
      }),
      close: vi.fn(),
    };
    const secondConnection = {
      context,
      sendStateless: vi.fn(),
      close: vi.fn(),
    };
    const document = new Y.Doc() as Y.Doc & {
      name: string;
      getConnections(): Array<typeof firstConnection>;
    };
    Object.defineProperties(document, {
      name: { value: documentName },
      getConnections: { value: () => [firstConnection, secondConnection] },
    });
    server.hocuspocus.documents.set(documentName, document as never);
    mocks.parseDocumentName.mockReturnValue({
      type: CollaborativeDocumentType.MAP_THEME,
      entityId: "theme-deleted",
      locale: "und",
    } as never);
    await callback("onChange")({
      documentName,
      document,
      connection: firstConnection,
      context,
      transactionOrigin: { source: "connection" },
    });
    mocks.persistDocument.mockRejectedValueOnce(
      new CollaborationResourceNotFoundError(
        CollaborativeDocumentType.MAP_THEME,
        "theme-deleted",
      ),
    );

    await expect(
      callback("onStoreDocument")({ documentName, document }),
    ).resolves.toBeUndefined();

    expect(firstConnection.close).toHaveBeenCalledOnce();
    expect(secondConnection.close).toHaveBeenCalledOnce();
    expect(secondConnection.sendStateless).toHaveBeenCalledWith(
      JSON.stringify({
        kind: "permission_revoked",
        reason: "permission_revoked",
      }),
    );
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Collaboration permission revoked",
      expect.objectContaining({ signal_failed: true }),
    );
    expect(server.hocuspocus.unloadDocument).toHaveBeenCalledOnce();
    expect(server.hocuspocus.documents.size).toBe(0);
    await callback("afterUnloadDocument")({ documentName });
    expect(transientState.has(documentName)).toBe(false);
    expect(mocks.persistDocument).toHaveBeenCalledOnce();
    await expect(
      callback("beforeUnloadDocument")({ documentName, document }),
    ).resolves.toBeUndefined();
  });

  it.each([
    CollaborativeDocumentType.POST,
    CollaborativeDocumentType.PAGE,
    CollaborativeDocumentType.CAMPAIGN,
    CollaborativeDocumentType.WORK,
    CollaborativeDocumentType.EMAIL_TEMPLATE,
    CollaborativeDocumentType.EMAIL_LAYOUT,
    CollaborativeDocumentType.TERMS_HISTORY,
    CollaborativeDocumentType.PRIVACY_HISTORY,
    CollaborativeDocumentType.ARTIST,
    CollaborativeDocumentType.RELEASE,
    CollaborativeDocumentType.LABEL,
    CollaborativeDocumentType.FORM,
    CollaborativeDocumentType.MAP_THEME,
    CollaborativeDocumentType.PROGRAM_EVENT,
  ])(
    "closes a deleted %s resource on its authoritative persistence 404",
    async (type) => {
      const server = createTestCollabServer();
      const entityId = "44444444-4444-4444-8444-444444444444";
      const documentName = createDocumentName(
        type,
        entityId,
        type === CollaborativeDocumentType.MAP_THEME ? "und" : "en",
      );
      const connection = {
        context: {
          member: { id: memberId, nickname: "Editor", deleted: false },
          sessionId,
          documentType: type,
          resourceId: entityId,
          locale: type === CollaborativeDocumentType.MAP_THEME ? "und" : "en",
        },
        sendStateless: vi.fn(),
        close: vi.fn(),
      };
      const document = new Y.Doc() as Y.Doc & {
        name: string;
        getConnections(): [typeof connection];
      };
      Object.defineProperties(document, {
        name: { value: documentName },
        getConnections: { value: () => [connection] },
      });
      mocks.parseDocumentName.mockReturnValue({
        type,
        entityId,
        locale: type === CollaborativeDocumentType.MAP_THEME ? "und" : "en",
      } as never);
      server.hocuspocus.documents.set(documentName, document as never);
      mocks.persistDocument.mockRejectedValueOnce(
        new CollaborationResourceNotFoundError(type, entityId),
      );

      await recordMutation(documentName, document);
      await expect(
        callback("onStoreDocument")({ documentName, document }),
      ).resolves.toBeUndefined();

      expect(connection.sendStateless).toHaveBeenCalledWith(
        JSON.stringify({
          kind: "permission_revoked",
          reason: "permission_revoked",
        }),
      );
      expect(connection.close).toHaveBeenCalledOnce();
      expect(server.hocuspocus.documents.has(documentName)).toBe(false);
    },
  );

  it("does not close a room for a persistence dependency failure", async () => {
    const server = createTestCollabServer();
    const documentName = "post:dependency-failure";
    const connection = {
      context: {
        member: { id: memberId, nickname: "Editor", deleted: false },
        sessionId,
        documentType: CollaborativeDocumentType.POST,
        resourceId: "dependency-failure",
        locale: "en",
      },
      sendStateless: vi.fn(),
      close: vi.fn(),
    };
    const document = new Y.Doc() as Y.Doc & {
      name: string;
      getConnections(): [typeof connection];
    };
    Object.defineProperties(document, {
      name: { value: documentName },
      getConnections: { value: () => [connection] },
    });
    server.hocuspocus.documents.set(documentName, document as never);
    mocks.persistDocument.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await recordMutation(documentName, document);
    await expect(
      callback("onStoreDocument")({ documentName, document }),
    ).rejects.toThrow("database unavailable");

    expect(connection.sendStateless).not.toHaveBeenCalled();
    expect(connection.close).not.toHaveBeenCalled();
    expect(server.hocuspocus.documents.has(documentName)).toBe(true);
  });

  it("validates the Oathkeeper session header", () => {
    expect(isCanonicalSession(sessionId)).toBe(true);
    expect(isCanonicalSession("not-a-uuid")).toBe(false);
  });

  it("rejects malformed origins, failed, and denied authorization paths", async () => {
    const authenticate = callback("onAuthenticate");
    const input = {
      documentName: "post:entity-1",
      request: request(authenticatedHeaders),
    };
    for (const headers of [
      {},
      { ...authenticatedHeaders, origin: "https://evil.example" },
      { ...authenticatedHeaders, [CANONICAL_SESSION_HEADER]: "not-a-uuid" },
    ]) {
      await expect(
        authenticate({
          documentName: "post:entity-1",
          request: request(headers),
        }),
      ).rejects.toThrow("Authentication required");
    }
    expect(mocks.authorizeCollaboration).not.toHaveBeenCalled();

    mocks.parseDocumentName.mockImplementationOnce(() => {
      throw new Error("bad name");
    });
    await expect(authenticate(input)).rejects.toThrow("Invalid document name");
    mocks.parseDocumentName.mockImplementationOnce(() => {
      throw "bad name";
    });
    await expect(authenticate(input)).rejects.toThrow("Invalid document name");

    mocks.authorizeCollaboration.mockRejectedValueOnce(new Error("api down"));
    await expect(authenticate(input)).rejects.toThrow(
      "Collaboration authorization failed",
    );
    mocks.authorizeCollaboration.mockRejectedValueOnce("api down");
    await expect(authenticate(input)).rejects.toThrow(
      "Collaboration authorization failed",
    );
    mocks.authorizeCollaboration.mockRejectedValueOnce(
      new CollaborationSessionInvalidError(),
    );
    await expect(authenticate(input)).rejects.toThrow("session_expired");
    mocks.authorizeCollaboration.mockResolvedValueOnce(null);
    await expect(authenticate(input)).rejects.toThrow("Permission denied");

    mocks.authorizeCollaboration
      .mockResolvedValueOnce({
        id: memberId,
        nickname: "Editor",
        deleted: false,
      })
      .mockRejectedValueOnce(new CollaborationSessionInvalidError());
    await expect(authenticate(input)).rejects.toThrow("session_expired");

    mocks.authorizeCollaboration
      .mockResolvedValueOnce({
        id: memberId,
        nickname: "Editor",
        deleted: false,
      })
      .mockRejectedValueOnce(new Error("api down"));
    await expect(authenticate(input)).rejects.toThrow(
      "Collaboration authorization failed",
    );
  });

  it("tracks connections and rewrites each awareness state from its API MemberSummary", async () => {
    const connected = callback("connected");
    const document = metadataDocument();
    const connection = { document, readOnly: false };
    await connected({ documentName: "post:1", context: {}, connection });
    await connected({
      documentName: "post:1",
      context: {
        canEdit: false,
        member: {
          id: memberId,
          nickname: "Editor",
          avatarAsset: { url: "https://cdn.example/avatar.webp" },
        },
      },
      connection,
    });
    expect(connection.readOnly).toBe(true);
    expect(document.awareness.setLocalStateField).not.toHaveBeenCalled();

    const beforeHandleAwareness = callback("beforeHandleAwareness");
    const awarenessConnection = { document };
    const states = new Map([
      [1, { cursor: { anchor: 1 }, user: { id: "spoofed", name: "Spoofed" } }],
      [2, { cursor: { anchor: 2 } }],
    ]);
    await beforeHandleAwareness({
      states,
      context: {
        member: {
          id: memberId,
          nickname: "Editor",
          avatarAsset: { url: "https://cdn.example/avatar.webp" },
        },
      },
      transactionOrigin: {
        source: "connection",
        connection: awarenessConnection,
      },
    });
    expect(states.get(1)).toEqual(
      expect.objectContaining({
        cursor: { anchor: 1 },
        user: {
          id: memberId,
          name: "Editor",
          image: "https://cdn.example/avatar.webp",
          color: expect.any(String),
        },
      }),
    );
    const unauthenticatedStates = new Map([[3, { user: { id: "spoofed" } }]]);
    await beforeHandleAwareness({
      states: unauthenticatedStates,
      context: undefined,
      transactionOrigin: { source: "local" },
    });
    expect(unauthenticatedStates.size).toBe(0);
    await callback("onListen")({ port: 1234 });
  });

  it("keeps an archived viewer read-only and closes it when VIEW is revoked", async () => {
    const document = metadataDocument();
    const sendStateless = vi.fn();
    const close = vi.fn();
    const connection = { document, sendStateless, close, readOnly: false };
    const context = {
      canEdit: false,
      member: { id: memberId, nickname: "Viewer", deleted: false },
      sessionId,
      documentType: CollaborativeDocumentType.POST,
      resourceId: "archived-post",
      locale: "en",
    };

    await callback("connected")({
      documentName: "post:archived-post",
      context,
      connection,
    });
    expect(connection.readOnly).toBe(true);
    close.mockClear();

    mocks.authorizeCollaboration.mockResolvedValueOnce(null);
    await expect(
      callback("beforeHandleMessage")({
        connection,
        context,
        documentName: "post:archived-post",
        update: inboundFrame("post:archived-post"),
      }),
    ).rejects.toThrow("permission_revoked");
    expect(mocks.authorizeCollaboration).toHaveBeenLastCalledWith({
      sessionId,
      documentType: CollaborativeDocumentType.POST,
      resourceId: "archived-post",
      locale: "en",
      permission: CollaborationPermission.VIEW,
    });
    expect(sendStateless).toHaveBeenCalledWith(
      JSON.stringify({
        kind: "permission_revoked",
        reason: "permission_revoked",
      }),
    );
    expect(close).toHaveBeenCalledOnce();
    expect(mocks.persistDocument).not.toHaveBeenCalled();
  });

  it("keeps metadata AI state through reconnect grace and clears only after expiry", async () => {
    vi.useFakeTimers();
    try {
      const connected = callback("connected");
      const disconnect = callback("onDisconnect");
      const document = metadataDocument();
      const connection = { document };
      const base = {
        documentName: "post:1",
        document,
        connection,
        context: {},
        socketId: "socket-1",
      };

      await disconnect(base);
      mocks.metadataState = { status: "running", requesterMemberId: null };
      await disconnect(base);

      mocks.metadataState = { status: "running", requesterMemberId: memberId };
      mocks.listConnectedMemberIds.mockReturnValue([]);
      await disconnect({
        ...base,
        context: { member: { id: memberId, nickname: "Editor" } },
      });
      expect(document.values.get("status")).not.toBe("idle");
      expect(document.values.get("autoClearAt")).toBe(Date.now() + 10_000);
      await expect(
        callback("beforeUnloadDocument")({ documentName: "post:1", document }),
      ).rejects.toMatchObject({
        name: "DocumentUnloadDeferredError",
        message: "",
        reason: "metadata_ai_reconnect_grace",
      });

      await vi.advanceTimersByTimeAsync(9_999);
      expect(document.values.get("status")).not.toBe("idle");

      await connected({
        documentName: "post:1",
        context: { member: { id: memberId, nickname: "Editor" } },
        connection: { document },
      });
      expect(document.values.get("orphanedAt")).toBeNull();
      expect(document.values.get("autoClearAt")).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(document.values.get("status")).not.toBe("idle");

      await disconnect({
        ...base,
        context: { member: { id: memberId, nickname: "Editor" } },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(document.values.get("status")).toBe("idle");
      expect(document.values.get("requesterMemberId")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes, cancels, and invalidates metadata AI grace from authoritative presence", async () => {
    vi.useFakeTimers();
    try {
      const connected = callback("connected");
      const disconnect = callback("onDisconnect");
      const load = callback("onLoadDocument");

      const resumed = metadataDocument();
      mocks.metadataState = {
        status: "running",
        requesterMemberId: memberId,
        orphanedAt: Date.now() - 1,
        autoClearAt: Date.now() + 5_000,
      };
      mocks.listConnectedMemberIds.mockReturnValue([]);
      await connected({
        documentName: "post:resume",
        context: { member: { id: "other" } },
        connection: { document: resumed },
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await connected({
        documentName: "post:resume",
        context: { member: { id: memberId } },
        connection: { document: resumed },
      });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(resumed.values.get("status")).not.toBe("idle");

      const resident = new Y.Doc();
      mocks.listConnectedMemberIds.mockReturnValue([memberId]);
      await load({
        documentName: "post:resident",
        document: resident,
        context: { sessionId },
      });
      expect(resident.getMap("metadata-ai").get("autoClearAt")).toBeNull();

      const disconnected = metadataDocument();
      mocks.listConnectedMemberIds.mockReturnValue([memberId]);
      await disconnect({
        documentName: "post:connected-requester",
        document: disconnected,
        connection: { document: disconnected },
        context: { member: { id: memberId } },
        socketId: "socket-connected-requester",
      });
      expect(disconnected.values.get("autoClearAt")).toBeUndefined();

      const stale = metadataDocument();
      mocks.listConnectedMemberIds.mockReturnValue([]);
      await disconnect({
        documentName: "post:stale-grace",
        document: stale,
        connection: { document: stale },
        context: { member: { id: memberId } },
        socketId: "socket-stale",
      });
      stale.values.set("requesterMemberId", "new-requester");
      await vi.advanceTimersByTimeAsync(METADATA_AI_GRACE_PERIOD_MS);
      expect(stale.values.get("status")).not.toBe("idle");

      const reconnectedAtExpiry = metadataDocument();
      mocks.metadataState = { status: "running", requesterMemberId: memberId };
      mocks.listConnectedMemberIds.mockReturnValue([]);
      await disconnect({
        documentName: "post:expiry-reconnect",
        document: reconnectedAtExpiry,
        connection: { document: reconnectedAtExpiry },
        context: { member: { id: memberId } },
        socketId: "socket-expiry",
      });
      mocks.listConnectedMemberIds.mockReturnValue([memberId]);
      await vi.advanceTimersByTimeAsync(METADATA_AI_GRACE_PERIOD_MS);
      expect(reconnectedAtExpiry.values.get("autoClearAt")).toBeNull();

      const noDeadline = metadataDocument();
      mocks.metadataState = { status: "running", requesterMemberId: memberId };
      mocks.listConnectedMemberIds.mockReturnValue([]);
      await connected({
        documentName: "post:no-deadline",
        context: { member: { id: "other" } },
        connection: { document: noDeadline },
      });
      mocks.listConnectedMemberIds.mockReturnValue([memberId]);
      await connected({
        documentName: "post:no-deadline",
        context: { member: { id: "other" } },
        connection: { document: noDeadline },
      });
      expect(noDeadline.values.get("updatedAt")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("contains both client signaling failures when revoking a frame", async () => {
    mocks.authorizeCollaboration.mockResolvedValueOnce(null);
    const sendStateless = vi.fn(() => {
      throw new Error("signal failed");
    });
    const close = vi.fn(() => {
      throw new Error("close failed");
    });

    await expect(
      callback("beforeHandleMessage")({
        connection: { sendStateless, close },
        context: {
          member: { id: memberId, nickname: "Editor", deleted: false },
          sessionId,
          documentType: CollaborativeDocumentType.POST,
          resourceId: "post-signal-failure",
          locale: "en",
        },
        documentName: "post:post-signal-failure",
        update: inboundFrame("post:post-signal-failure"),
      }),
    ).rejects.toThrow("permission_revoked");
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Collaboration permission revoked",
      expect.objectContaining({
        signal_failed: true,
        close_failed: true,
      }),
    );
  });

  it("fences one room once even when a second resident document reports the same CAS conflict", async () => {
    const firstConnection = {
      sendStateless: vi.fn(() => {
        throw new Error("cannot signal");
      }),
      close: vi.fn(),
    };
    const secondConnection = { sendStateless: vi.fn(), close: vi.fn() };
    const first = new Y.Doc() as Y.Doc & {
      getConnections(): Array<typeof firstConnection>;
    };
    const second = new Y.Doc() as Y.Doc & {
      getConnections(): Array<typeof secondConnection>;
    };
    Object.defineProperty(first, "getConnections", {
      value: () => [firstConnection],
    });
    Object.defineProperty(second, "getConnections", {
      value: () => [secondConnection],
    });
    mocks.persistDocument
      .mockRejectedValueOnce(
        new CollaborationConflictError("document_revision_changed"),
      )
      .mockRejectedValueOnce(
        new CollaborationConflictError("document_revision_changed"),
      );

    await recordMutation("post:same-room", first);
    await callback("onStoreDocument")({
      documentName: "post:same-room",
      document: first,
    });
    await recordMutation("post:same-room", second);
    await callback("onStoreDocument")({
      documentName: "post:same-room",
      document: second,
    });

    expect(firstConnection.close).toHaveBeenCalledOnce();
    expect(secondConnection.sendStateless).not.toHaveBeenCalled();
    expect(secondConnection.close).not.toHaveBeenCalled();
    expect(mocks.logger.error).toHaveBeenCalledWith(
      "Failed to signal collaboration reload",
      expect.objectContaining({ error: "cannot signal" }),
    );
  });

  it("releases socket-scoped admissions on rejected auth, failed load, and disconnect", async () => {
    const server = createTestCollabServer();
    server.hocuspocus.handleConnection(
      {} as never,
      new Request("http://collab.test"),
      {} as never,
    );
    const scopedContext = mocks.hocuspocusHandleConnection.mock.calls.at(
      -1,
    )?.[2] as object;

    await expect(
      callback("onAuthenticate")({
        context: scopedContext,
        documentName: "post:socket-rejected",
        request: request(),
        socketId: "socket-rejected",
      }),
    ).rejects.toThrow("Authentication required");

    const authenticated = (await callback("onAuthenticate")({
      context: scopedContext,
      documentName: "post:socket-load",
      request: request(authenticatedHeaders),
      socketId: "socket-load",
    })) as object;
    const context = { ...scopedContext, ...authenticated };
    mocks.handlerLoad.mockRejectedValueOnce(new Error("load failed"));
    await expect(
      callback("onLoadDocument")({
        documentName: "post:socket-load",
        document: new Y.Doc(),
        context,
      }),
    ).rejects.toThrow("load failed");

    const connectedContext = (await callback("onAuthenticate")({
      context: scopedContext,
      documentName: "post:socket-disconnect",
      request: request(authenticatedHeaders),
      socketId: "socket-disconnect",
    })) as object;
    const connectedDocument = metadataDocument();
    const connectedConnection = {
      document: connectedDocument,
      close: vi.fn(),
    };
    await callback("connected")({
      connection: connectedConnection,
      context: { ...scopedContext, ...connectedContext },
      documentName: "post:socket-disconnect",
      socketId: "socket-disconnect",
    });
    await callback("onDisconnect")({
      documentName: "post:socket-disconnect",
      document: connectedDocument,
      context: { ...scopedContext, ...connectedContext },
      socketId: "socket-disconnect",
    });
  });

  const supportedDocumentTypes = [
    CollaborativeDocumentType.POST,
    CollaborativeDocumentType.WORK,
    CollaborativeDocumentType.RELEASE,
    CollaborativeDocumentType.LABEL,
    CollaborativeDocumentType.ARTIST,
    CollaborativeDocumentType.FORM,
    CollaborativeDocumentType.PAGE,
    CollaborativeDocumentType.CAMPAIGN,
    CollaborativeDocumentType.EMAIL_TEMPLATE,
    CollaborativeDocumentType.EMAIL_LAYOUT,
    CollaborativeDocumentType.TERMS_HISTORY,
    CollaborativeDocumentType.PRIVACY_HISTORY,
    CollaborativeDocumentType.MAP_THEME,
    CollaborativeDocumentType.PROGRAM_EVENT,
  ] as const;

  it.each(supportedDocumentTypes)(
    "reauthorizes each supported document type before applying a frame: %s",
    async (documentType) => {
      const connection = {
        document: new Y.Doc(),
        close: vi.fn(),
        sendStateless: vi.fn(),
      };
      const resourceId = "resource-1";
      mocks.authorizeCollaboration.mockResolvedValueOnce({
        id: memberId,
        nickname: "Editor",
        deleted: false,
      });

      await expect(
        callback("beforeHandleMessage")({
          connection,
          context: {
            member: { id: memberId, nickname: "Editor", deleted: false },
            sessionId,
            documentType,
            resourceId,
            locale:
              documentType === CollaborativeDocumentType.MAP_THEME
                ? "und"
                : "en",
          },
          documentName: `document:${resourceId}`,
          update: inboundFrame(),
        }),
      ).resolves.toBeUndefined();

      expect(mocks.authorizeCollaboration).toHaveBeenCalledWith({
        sessionId,
        documentType,
        resourceId,
        locale:
          documentType === CollaborativeDocumentType.MAP_THEME ? "und" : "en",
        permission: CollaborationPermission.EDIT,
      });
      expect(connection.close).not.toHaveBeenCalled();
    },
  );

  it.each(supportedDocumentTypes)(
    "rejects the next %s frame when authorization is revoked after admission",
    async (documentType) => {
      const connection = {
        document: new Y.Doc(),
        close: vi.fn(),
        sendStateless: vi.fn(),
      };
      const resourceId = "resource-1";
      const context = {
        member: { id: memberId, nickname: "Editor", deleted: false },
        sessionId,
        documentType,
        resourceId,
        locale:
          documentType === CollaborativeDocumentType.MAP_THEME ? "und" : "en",
      };
      mocks.authorizeCollaboration
        .mockResolvedValueOnce({
          id: memberId,
          nickname: "Editor",
          deleted: false,
        })
        .mockResolvedValueOnce(null);

      await expect(
        callback("beforeHandleMessage")({
          connection,
          context,
          documentName: `document:${resourceId}`,
          update: inboundFrame(),
        }),
      ).resolves.toBeUndefined();
      await expect(
        callback("beforeHandleMessage")({
          connection,
          context,
          documentName: `document:${resourceId}`,
          update: inboundFrame(),
        }),
      ).rejects.toThrow("permission_revoked");

      expect(mocks.authorizeCollaboration).toHaveBeenNthCalledWith(1, {
        sessionId,
        documentType,
        resourceId,
        locale:
          documentType === CollaborativeDocumentType.MAP_THEME ? "und" : "en",
        permission: CollaborationPermission.EDIT,
      });
      expect(mocks.authorizeCollaboration).toHaveBeenNthCalledWith(2, {
        sessionId,
        documentType,
        resourceId,
        locale:
          documentType === CollaborativeDocumentType.MAP_THEME ? "und" : "en",
        permission: CollaborationPermission.EDIT,
      });
      expect(connection.sendStateless).toHaveBeenCalledWith(
        JSON.stringify({
          kind: "permission_revoked",
          reason: "permission_revoked",
        }),
      );
      expect(connection.close).toHaveBeenCalledOnce();
    },
  );

  it("starts the Common metadata AI reconnect grace when an orphaned request loads after restart", async () => {
    vi.useFakeTimers();
    try {
      const document = new Y.Doc();
      mocks.metadataState = {
        status: "running",
        requesterMemberId: memberId,
        orphanedAt: null,
        autoClearAt: null,
      };
      mocks.listConnectedMemberIds.mockReturnValue([]);

      await callback("onLoadDocument")({
        documentName: "post:1",
        document,
        context: { sessionId },
      });

      const state = document.getMap("metadata-ai");
      expect(state.get("orphanedAt")).toBe(Date.now());
      expect(state.get("autoClearAt")).toBe(
        Date.now() + METADATA_AI_GRACE_PERIOD_MS,
      );
      await vi.advanceTimersByTimeAsync(METADATA_AI_GRACE_PERIOD_MS);
      expect(state.get("status")).toBe("idle");
      expect(state.get("requesterMemberId")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles persistence stateless commands and malformed payloads", async () => {
    const onStateless = callback("onStateless");
    const sendStateless = vi.fn();
    const base = {
      connection: { sendStateless, context: { canEdit: true } },
      documentName: "post:1",
      document: {},
    };

    await onStateless({ ...base, payload: '{"kind":"noop"}' });
    await onStateless({ ...base, payload: '{"kind":"persist.now.request"}' });
    await recordMutation(base.documentName, base.document);
    await onStateless({
      ...base,
      payload: '{"kind":"persist.now.request","requestId":"request-1"}',
    });
    expect(sendStateless).toHaveBeenLastCalledWith(
      expect.stringContaining('"ok":true'),
    );

    mocks.persistDocument.mockRejectedValueOnce(new Error("write failed"));
    await recordMutation(base.documentName, base.document);
    await onStateless({
      ...base,
      payload: '{"kind":"persist.now.request","requestId":"request-2"}',
    });
    expect(sendStateless).toHaveBeenLastCalledWith(
      expect.stringContaining("request-2"),
    );

    await onStateless({ ...base, payload: "{" });
    expect(sendStateless).toHaveBeenLastCalledWith(
      expect.stringContaining('"requestId":""'),
    );

    mocks.persistDocument.mockRejectedValueOnce("write failed");
    await recordMutation(base.documentName, base.document);
    await onStateless({
      ...base,
      payload: '{"kind":"persist.now.request","requestId":"request-3"}',
    });

    mocks.persistDocument.mockRejectedValueOnce(new Error("write failed"));
    await recordMutation(base.documentName, base.document);
    await onStateless({
      ...base,
      payload: '{"kind":"persist.now.request","requestId":42}',
    });
    expect(sendStateless).toHaveBeenLastCalledWith(
      expect.stringContaining('"requestId":""'),
    );
  });

  it("stores documents and propagates persistence errors so Hocuspocus retains them", async () => {
    const onStore = callback("onStoreDocument");
    const onLoad = callback("onLoadDocument");
    const document = {};
    await recordMutation("post:1", document);
    await onStore({ documentName: "post:1", document });
    mocks.persistDocument.mockRejectedValueOnce(new Error("store failed"));
    await recordMutation("post:1", document);
    await expect(onStore({ documentName: "post:1", document })).rejects.toThrow(
      "store failed",
    );
    mocks.persistDocument.mockRejectedValueOnce("store failed");
    await recordMutation("post:1", document);
    await expect(onStore({ documentName: "post:1", document })).rejects.toBe(
      "store failed",
    );

    const source = new Y.Doc();
    source.getMap("meta").set("value", "loaded");
    const loadedDocument = new Y.Doc();
    mocks.handlerLoad.mockResolvedValueOnce(Y.encodeStateAsUpdate(source));
    await expect(
      onLoad({
        documentName: "post:1",
        document: loadedDocument,
        context: { sessionId },
      }),
    ).resolves.toBe(loadedDocument);
    expect(loadedDocument.getMap("meta").get("value")).toBe("loaded");
    mocks.handlerLoad.mockResolvedValueOnce(null);
    await expect(
      onLoad({
        documentName: "post:1",
        document: loadedDocument,
        context: { sessionId },
      }),
    ).resolves.toBe(loadedDocument);
    mocks.handlerLoad.mockResolvedValueOnce(Buffer.alloc(0));
    await expect(
      onLoad({
        documentName: "post:1",
        document: loadedDocument,
        context: { sessionId },
      }),
    ).resolves.toBe(loadedDocument);
    expect(loadedDocument.getMap("meta").get("value")).toBe("loaded");
    mocks.handlerLoad.mockRejectedValueOnce(new Error("load failed"));
    await expect(
      onLoad({
        documentName: "post:1",
        document: loadedDocument,
        context: { sessionId },
      }),
    ).rejects.toThrow("load failed");
    mocks.handlerLoad.mockRejectedValueOnce("load failed");
    await expect(
      onLoad({
        documentName: "post:1",
        document: loadedDocument,
        context: { sessionId },
      }),
    ).rejects.toBe("load failed");
  });

  it("clears process-local handler state after a document unloads", async () => {
    const state = new TransientDocumentStateMap<string>();
    state.set("post:entity-1", "cached");

    await callback("afterUnloadDocument")({ documentName: "post:entity-1" });

    expect(state.has("post:entity-1")).toBe(false);
  });

  it("guards the resident aggregate until the active edit session is finalized", async () => {
    const beforeUnload = callback("beforeUnloadDocument");
    await expect(
      beforeUnload({ documentName: "post:entity-1" }),
    ).resolves.toBeUndefined();

    await callback("onChange")({
      documentName: "post:entity-1",
      document: new Y.Doc(),
      context: { member: { id: "member-1" } },
      connection: {},
      transactionOrigin: { source: "connection" },
    });

    await expect(
      beforeUnload({ documentName: "post:entity-1" }),
    ).rejects.toMatchObject({
      name: "DocumentUnloadDeferredError",
      message: "",
      reason: "edit_session_active",
    });
  });
});

describe("collab service lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logger.system.mockImplementation(
      (level: "info" | "warn" | "error", record: unknown) =>
        mocks.logger[level]("System event", record),
    );
    mocks.authorizeCollaboration.mockReset();
    mocks.authorizeCollaboration.mockResolvedValue({
      id: memberId,
      nickname: "Editor",
      deleted: false,
    });
    mocks.persistDocument.mockReset();
    mocks.loadCollaborativeDocument.mockReset();
    mocks.loadCollaborativeDocument.mockResolvedValue(null);
    mocks.handlerLoad.mockReset();
    mocks.handlerLoad.mockResolvedValue(null);
    mocks.serverListen.mockResolvedValue(undefined);
    mocks.serverDestroy.mockReset();
    mocks.serverDestroy.mockResolvedValue(undefined);
    mocks.metadataState = { status: "idle", requesterMemberId: null };
    mocks.listConnectedMemberIds.mockReset();
    mocks.listConnectedMemberIds.mockReturnValue([]);
    mocks.stopMessagingConsumers.mockResolvedValue(undefined);
    mocks.closeMessaging.mockResolvedValue(undefined);
    mocks.relayInteractiveMutation.mockReset();
    mocks.relayInteractiveMutation.mockResolvedValue(undefined);
    mocks.withPersistenceQueue.mockImplementation(async (queueKey, operation) =>
      operation((documentName: string, document: Y.Doc, options: unknown) =>
        mocks.persistDocument(documentName, document, options, queueKey),
      ),
    );
    mocks.stopStructureLoop.mockResolvedValue(undefined);
    mocks.stopSharedCleanup.mockResolvedValue(undefined);
    mocks.startStructureLoop.mockReturnValue(mocks.stopStructureLoop);
    mocks.startSharedCleanup.mockReturnValue(mocks.stopSharedCleanup);
    for (const start of [
      mocks.startEvent,
      mocks.startTranscode,
      mocks.startTranslation,
      mocks.startIngestProjection,
    ]) {
      start.mockResolvedValue(undefined);
    }
  });

  it("reports starting, ready, and unknown health states around ordered startup", async () => {
    let resolveListen!: () => void;
    const server = {
      listen: vi.fn(
        () => new Promise<void>((resolve) => (resolveListen = resolve)),
      ),
    } as unknown as Server;
    const fixture = runtimeFixture();
    const startup = startCollabService(fixture.runtime, server);

    const starting = fixture.health("/health");
    expect(starting.writeHead).toHaveBeenCalledWith(503, expect.any(Object));
    expect(starting.end).toHaveBeenCalledWith(
      expect.stringContaining("starting"),
    );
    const missing = fixture.health("/missing");
    expect(missing.writeHead).toHaveBeenCalledWith(404);

    resolveListen();
    await startup;
    const ready = fixture.health("/health");
    expect(ready.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(ready.end).toHaveBeenCalledWith('{"status":"ok"}');
    expect(mocks.startIngestProjection).toHaveBeenCalledOnce();
  });

  it("records server and subscriber startup failures", async () => {
    const serverFailure = runtimeFixture();
    const failedServer = {
      listen: vi.fn(async () => Promise.reject("listen failed")),
    } as unknown as Server;
    await expect(
      startCollabService(serverFailure.runtime, failedServer),
    ).rejects.toMatchObject({
      code: 1,
    });
    const failedHealth = serverFailure.health("/health");
    expect(failedHealth.end).toHaveBeenCalledWith(
      expect.stringContaining("listen failed"),
    );

    const subscriberFailure = runtimeFixture();
    mocks.startEvent.mockRejectedValueOnce(new Error("queue failed"));
    const server = {
      listen: vi.fn(async () => undefined),
    } as unknown as Server;
    await expect(
      startCollabService(subscriberFailure.runtime, server),
    ).rejects.toMatchObject({
      code: 1,
    });
    const subscriberFailedHealth = subscriberFailure.health("/health");
    expect(subscriberFailedHealth.end).toHaveBeenCalledWith(
      expect.stringContaining("queue failed"),
    );
    expect(mocks.startTranscode).not.toHaveBeenCalled();
  });

  it("records fatal process events", async () => {
    const fixture = runtimeFixture();
    const server = {
      listen: vi.fn(async () => undefined),
    } as unknown as Server;
    await startCollabService(fixture.runtime, server);
    expect(() =>
      fixture.processListeners.get("uncaughtException")!(new Error("uncaught")),
    ).toThrow(ExitError);
    expect(() =>
      fixture.processListeners.get("uncaughtException")!("uncaught"),
    ).toThrow(ExitError);
    expect(() =>
      fixture.processListeners.get("unhandledRejection")!("rejected"),
    ).toThrow(ExitError);
  });

  it("marks unhealthy, cancels queue delivery, drains loops, and destroys servers on shutdown", async () => {
    let finishConsumerDrain!: () => void;
    mocks.stopMessagingConsumers.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishConsumerDrain = resolve;
      }),
    );
    const fixture = runtimeFixture();
    const destroy = vi.fn(async () => undefined);
    const server = {
      listen: vi.fn(async () => undefined),
      destroy,
    } as unknown as Server;
    const running = await startCollabService(fixture.runtime, server);

    let stopped = false;
    const stopping = running.shutdown().then(() => {
      stopped = true;
    });
    expect(fixture.health("/health").end).toHaveBeenCalledWith(
      expect.stringContaining("stopping"),
    );
    expect(destroy).not.toHaveBeenCalled();
    expect(stopped).toBe(false);

    finishConsumerDrain();
    await stopping;
    expect(mocks.stopMessagingConsumers).toHaveBeenCalledWith(25_000);
    expect(mocks.closeMessaging).toHaveBeenCalledWith();
    expect(destroy).toHaveBeenCalledOnce();
    expect(destroy.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.closeMessaging.mock.invocationCallOrder[0]!,
    );
    expect(fixture.close).toHaveBeenCalledOnce();
    await running.shutdown();
    expect(mocks.stopMessagingConsumers).toHaveBeenCalledOnce();
    expect(mocks.closeMessaging).toHaveBeenCalledOnce();
  });

  it("drains a pending contributor session through the resident aggregate before destroy completes", async () => {
    const fixture = runtimeFixture();
    const server = createTestCollabServer();
    const shared = new Y.Doc() as Y.Doc & {
      name: string;
      getConnections(): [];
    };
    Object.defineProperties(shared, {
      name: { value: "post:shutdown-1" },
      getConnections: { value: () => [] },
    });
    server.hocuspocus.documents.set(shared.name, shared as never);

    await callback("onChange")({
      documentName: shared.name,
      document: shared,
      context: { member: { id: "A" } },
      connection: {},
      transactionOrigin: { source: "connection" },
    });

    const running = await startCollabService(fixture.runtime, server);
    await running.shutdown();

    expect(mocks.persistDocument).toHaveBeenCalledWith(
      shared.name,
      shared,
      {
        contributorMemberIds: ["A"],
        versionCheckpoint: true,
      },
      "post:shutdown-1",
    );
    expect(mocks.persistDocument.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.closeMessaging.mock.invocationCallOrder[0]!,
    );
    expect(mocks.serverDestroy).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("never loads a removed scoped source room for an aggregate checkpoint", async () => {
    vi.useFakeTimers();
    try {
      const server = createTestCollabServer();
      const shared = new Y.Doc() as Y.Doc & {
        name: string;
        getConnections(): [];
      };
      Object.defineProperties(shared, {
        name: { value: "post:load-source" },
        getConnections: { value: () => [] },
      });
      server.hocuspocus.documents.set(shared.name, shared as never);

      await callback("onChange")({
        documentName: shared.name,
        document: shared,
        context: { member: { id: "A" } },
        connection: {},
        transactionOrigin: { source: "connection" },
      });
      await callback("onDisconnect")({
        documentName: shared.name,
        document: shared,
        context: { member: { id: "A" } },
        socketId: "socket-load-source",
      });
      await vi.advanceTimersByTimeAsync(10_000);

      expect(mocks.loadCollaborativeDocument).not.toHaveBeenCalled();
      expect(mocks.persistDocument).toHaveBeenCalledWith(
        shared.name,
        shared,
        expect.objectContaining({ versionCheckpoint: true }),
        shared.name,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears metadata grace and rejects new admission once shutdown begins", async () => {
    let finishDestroy!: () => void;
    mocks.serverDestroy.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishDestroy = resolve;
      }),
    );
    const fixture = runtimeFixture();
    const server = createTestCollabServer();
    const document = metadataDocument();
    mocks.metadataState = { status: "running", requesterMemberId: memberId };
    mocks.listConnectedMemberIds.mockReturnValue([]);
    await callback("onLoadDocument")({
      documentName: "post:shutdown-metadata",
      document,
      context: { sessionId },
    });

    const running = await startCollabService(fixture.runtime, server);
    const stopping = running.shutdown();
    await vi.waitFor(() => expect(mocks.serverDestroy).toHaveBeenCalledOnce());
    expect(document.values.get("status")).toBe("idle");

    document.values.set("status", "running");
    document.values.set("requesterMemberId", memberId);
    await callback("onDisconnect")({
      documentName: "post:shutdown-metadata",
      document,
      context: { member: { id: memberId } },
      socketId: "socket-shutdown-metadata",
    });
    expect(document.values.get("status")).toBe("idle");
    await expect(
      callback("onAuthenticate")({
        documentName: "post:shutdown-rejected",
        request: request(authenticatedHeaders),
        socketId: "socket-shutdown-rejected",
      }),
    ).rejects.toThrow("Collaboration service is shutting down");

    finishDestroy();
    await stopping;
  });

  it("waits for in-flight authentication to transfer into a late connection, frame, and disconnect", async () => {
    let resolveAuthorization!: (member: {
      id: string;
      nickname: string;
      deleted: boolean;
    }) => void;
    mocks.authorizeCollaboration.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAuthorization = resolve;
      }),
    );
    const fixture = runtimeFixture();
    const server = createTestCollabServer();
    const shared = new Y.Doc() as Y.Doc & {
      name: string;
      getConnections(): [];
    };
    Object.defineProperties(shared, {
      name: { value: "post:late-auth" },
      getConnections: { value: () => [] },
    });
    server.hocuspocus.documents.set(shared.name, shared as never);
    const running = await startCollabService(fixture.runtime, server);
    const authenticating = callback("onAuthenticate")({
      documentName: shared.name,
      request: request(authenticatedHeaders),
      socketId: "socket-late-auth",
    });
    await vi.waitFor(() =>
      expect(mocks.authorizeCollaboration).toHaveBeenCalledOnce(),
    );

    const shutdown = running.shutdown();
    await vi.waitFor(() => expect(mocks.serverDestroy).toHaveBeenCalledOnce());
    expect(mocks.closeMessaging).not.toHaveBeenCalled();

    resolveAuthorization({ id: memberId, nickname: "Editor", deleted: false });
    const context = (await authenticating) as {
      member: { id: string; nickname: string };
      shutdownAdmission: unknown;
    };
    const connection = {
      socketId: "socket-late-auth",
      close: vi.fn(),
      document: shared,
    };
    await callback("connected")({
      documentName: shared.name,
      socketId: connection.socketId,
      connection,
      context,
    });
    expect(connection.close).toHaveBeenCalledOnce();

    await callback("onChange")({
      documentName: shared.name,
      document: shared,
      context,
      connection,
      transactionOrigin: { source: "connection" },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(mocks.persistDocument).not.toHaveBeenCalled();

    await callback("onDisconnect")({
      documentName: shared.name,
      document: shared,
      context,
      clientsCount: 0,
      socketId: connection.socketId,
    });
    await shutdown;

    expect(mocks.persistDocument).toHaveBeenCalledWith(
      shared.name,
      shared,
      {
        contributorMemberIds: [memberId],
        versionCheckpoint: true,
      },
      "post:late-auth",
    );
    expect(mocks.persistDocument.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.closeMessaging.mock.invocationCallOrder[0]!,
    );
  });

  it("does not retain a late connected hook after disconnect released its admission", async () => {
    mocks.authorizeCollaboration.mockResolvedValueOnce({
      id: memberId,
      nickname: "Editor",
      deleted: false,
    });
    const fixture = runtimeFixture();
    const server = createTestCollabServer();
    const running = await startCollabService(fixture.runtime, server);
    const context = await callback("onAuthenticate")({
      documentName: "post:disconnect-first",
      request: request(authenticatedHeaders),
      socketId: "socket-disconnect-first",
    });
    const document = metadataDocument();
    const connection = {
      socketId: "socket-disconnect-first",
      close: vi.fn(),
      document,
    };

    const shutdown = running.shutdown();
    await vi.waitFor(() => expect(mocks.serverDestroy).toHaveBeenCalledOnce());
    await callback("onDisconnect")({
      documentName: "post:disconnect-first",
      document,
      context,
      clientsCount: 0,
      socketId: connection.socketId,
    });
    await callback("connected")({
      documentName: "post:disconnect-first",
      socketId: connection.socketId,
      connection,
      context,
    });

    expect(connection.close).toHaveBeenCalledOnce();
    await expect(shutdown).resolves.toBeUndefined();
    expect(mocks.closeMessaging).toHaveBeenCalledOnce();
  });

  it("releases a successful authentication admission when document load fails", async () => {
    mocks.authorizeCollaboration.mockResolvedValueOnce({
      id: memberId,
      nickname: "Editor",
      deleted: false,
    });
    mocks.handlerLoad.mockRejectedValueOnce(new Error("load unavailable"));
    const fixture = runtimeFixture();
    const server = createTestCollabServer();
    const running = await startCollabService(fixture.runtime, server);
    const context = await callback("onAuthenticate")({
      documentName: "post:load-failure",
      request: request(authenticatedHeaders),
      socketId: "socket-load-failure",
    });

    await expect(
      callback("onLoadDocument")({
        documentName: "post:load-failure",
        document: new Y.Doc(),
        context,
      }),
    ).rejects.toThrow("load unavailable");
    await expect(running.shutdown()).resolves.toBeUndefined();
  });

  it("releases an in-flight admission when authorization fails during shutdown", async () => {
    let rejectAuthorization!: (error: Error) => void;
    mocks.authorizeCollaboration.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectAuthorization = reject;
      }),
    );
    const fixture = runtimeFixture();
    const server = createTestCollabServer();
    const running = await startCollabService(fixture.runtime, server);
    const authenticating = callback("onAuthenticate")({
      documentName: "post:failed-auth",
      request: request(authenticatedHeaders),
      socketId: "socket-failed-auth",
    });
    await vi.waitFor(() =>
      expect(mocks.authorizeCollaboration).toHaveBeenCalledOnce(),
    );

    const shutdown = running.shutdown();
    await vi.waitFor(() => expect(mocks.serverDestroy).toHaveBeenCalledOnce());
    rejectAuthorization(new Error("authorization unavailable"));

    await expect(authenticating).rejects.toThrow(
      "Collaboration authorization failed",
    );
    await expect(shutdown).resolves.toBeUndefined();
    expect(mocks.closeMessaging).toHaveBeenCalledOnce();
  });

  it("bounds an admission whose authorization never settles", async () => {
    vi.useFakeTimers();
    try {
      mocks.authorizeCollaboration.mockReturnValueOnce(
        new Promise(() => undefined),
      );
      const fixture = runtimeFixture();
      const server = createTestCollabServer();
      const running = await startCollabService(fixture.runtime, server);
      void callback("onAuthenticate")({
        documentName: "post:stalled-auth",
        request: request(authenticatedHeaders),
        socketId: "socket-stalled-auth",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.authorizeCollaboration).toHaveBeenCalledOnce();

      const outcome = expect(running.shutdown()).rejects.toThrow(
        "Collaboration service shutdown failed",
      );
      await vi.advanceTimersByTimeAsync(25_000);
      await outcome;

      expect(mocks.serverDestroy).toHaveBeenCalledOnce();
      expect(mocks.closeMessaging).toHaveBeenCalledOnce();
      expect(fixture.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for queued client frames and disconnect hooks before finalizing contributors", async () => {
    const fixture = runtimeFixture();
    const server = createTestCollabServer();
    const connections: Array<{ socketId: string }> = [];
    const shared = new Y.Doc() as Y.Doc & {
      name: string;
      getConnections(): Iterable<{ socketId: string }>;
    };
    Object.defineProperties(shared, {
      name: { value: "post:pending-frame" },
      getConnections: { value: () => connections },
    });
    const connection = {
      socketId: "socket-A",
      close: vi.fn(),
      document: shared,
    };
    connections.push(connection);
    server.hocuspocus.documents.set(shared.name, shared as never);
    await callback("connected")({
      documentName: shared.name,
      socketId: connection.socketId,
      connection,
      context: {},
    });

    let releasePendingFrame!: () => void;
    const pendingFrame = new Promise<void>((resolve) => {
      releasePendingFrame = resolve;
    });
    mocks.serverDestroy.mockImplementationOnce(async () => {
      await pendingFrame;
      await callback("onChange")({
        documentName: shared.name,
        document: shared,
        context: { member: { id: "A" } },
        connection,
        transactionOrigin: { source: "connection" },
      });
      connections.splice(0);
      await callback("onDisconnect")({
        documentName: shared.name,
        document: shared,
        context: { member: { id: "A" } },
        clientsCount: 0,
        socketId: connection.socketId,
        connection,
      });
    });

    const running = await startCollabService(fixture.runtime, server);
    const shutdown = running.shutdown();
    await vi.waitFor(() => expect(mocks.serverDestroy).toHaveBeenCalledOnce());
    expect(mocks.persistDocument).not.toHaveBeenCalled();

    const lateConnection = {
      socketId: "socket-B",
      close: vi.fn(),
      document: shared,
    };
    await callback("connected")({
      documentName: shared.name,
      socketId: lateConnection.socketId,
      connection: lateConnection,
      context: { member: { id: "B", nickname: "Late editor" } },
    });
    expect(lateConnection.close).toHaveBeenCalledOnce();
    await callback("onDisconnect")({
      documentName: shared.name,
      document: shared,
      context: { member: { id: "B" } },
      clientsCount: 1,
      socketId: lateConnection.socketId,
      connection: lateConnection,
    });

    releasePendingFrame();
    await shutdown;

    expect(mocks.persistDocument).toHaveBeenCalledWith(
      shared.name,
      shared,
      {
        contributorMemberIds: ["A"],
        versionCheckpoint: true,
      },
      "post:pending-frame",
    );
  });

  it("checkpoints and releases a single resident aggregate without a source room", async () => {
    const fixture = runtimeFixture();
    const server = createTestCollabServer();
    const shared = new Y.Doc() as Y.Doc & {
      name: string;
      getConnections(): [];
    };
    Object.defineProperties(shared, {
      name: { value: "post:single-room" },
      getConnections: { value: () => [] },
    });
    server.hocuspocus.documents.set(shared.name, shared as never);

    await callback("onChange")({
      documentName: shared.name,
      document: shared,
      context: { member: { id: "A" } },
      connection: {},
      transactionOrigin: { source: "connection" },
    });

    const running = await startCollabService(fixture.runtime, server);
    await expect(running.shutdown()).resolves.toBeUndefined();

    expect(mocks.persistDocument).toHaveBeenCalledWith(
      shared.name,
      shared,
      {
        contributorMemberIds: ["A"],
        versionCheckpoint: true,
      },
      shared.name,
    );
    expect(mocks.logger.error).not.toHaveBeenCalled();
    expect(server.hocuspocus.unloadDocument).toHaveBeenCalledWith(shared);
    expect(server.hocuspocus.documents.size).toBe(0);
    expect(mocks.serverDestroy).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("fences every resident entity document after a typed checkpoint conflict", async () => {
    let exposeConnections = false;
    const sharedConnection = { sendStateless: vi.fn(), close: vi.fn() };
    const shared = new Y.Doc() as Y.Doc & {
      name: string;
      getConnections(): Array<typeof sharedConnection>;
    };
    Object.defineProperties(shared, {
      name: { value: "post:typed-conflict" },
      getConnections: {
        value: () => (exposeConnections ? [sharedConnection] : []),
      },
    });
    const server = createTestCollabServer();
    server.hocuspocus.documents.set(shared.name, shared as never);
    mocks.persistDocument.mockImplementationOnce(async () => {
      exposeConnections = true;
      throw new CollaborationConflictError("document_revision_changed");
    });

    await callback("onChange")({
      documentName: shared.name,
      document: shared,
      context: { member: { id: "A" } },
      connection: {},
      transactionOrigin: { source: "connection" },
    });

    const fixture = runtimeFixture();
    const running = await startCollabService(fixture.runtime, server);
    await expect(running.shutdown()).resolves.toBeUndefined();

    expect(sharedConnection.sendStateless).toHaveBeenCalledWith(
      JSON.stringify({ kind: "reload_required", reason: "reload_required" }),
    );
    expect(sharedConnection.close).toHaveBeenCalledOnce();
  });

  it("bounds a stalled edit-session shutdown drain", async () => {
    vi.useFakeTimers();
    try {
      mocks.persistDocument.mockImplementationOnce(() => new Promise(() => {}));
      const fixture = runtimeFixture();
      const server = createTestCollabServer();
      const shared = new Y.Doc() as Y.Doc & {
        name: string;
        getConnections(): [];
      };
      Object.defineProperties(shared, {
        name: { value: "post:stalled-shutdown" },
        getConnections: { value: () => [] },
      });
      server.hocuspocus.documents.set(shared.name, shared as never);

      await callback("onChange")({
        documentName: shared.name,
        document: shared,
        context: { member: { id: "A" } },
        connection: {},
        transactionOrigin: { source: "connection" },
      });

      const running = await startCollabService(fixture.runtime, server);
      const shutdown = running.shutdown();
      const outcome = expect(shutdown).rejects.toThrow(
        "Collaboration service shutdown failed",
      );
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(25_000);
      await outcome;

      expect(server.hocuspocus.documents.size).toBe(0);
      expect(mocks.serverDestroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("attempts every shutdown boundary and reports aggregated failures", async () => {
    mocks.closeMessaging.mockRejectedValueOnce(
      new Error("postgresql messaging close failed"),
    );
    mocks.stopStructureLoop.mockRejectedValueOnce(
      new Error("structure stop failed"),
    );
    mocks.stopSharedCleanup.mockRejectedValueOnce(
      new Error("cleanup stop failed"),
    );
    const fixture = runtimeFixture();
    fixture.close.mockImplementationOnce((ready: (error?: Error) => void) =>
      ready(new Error("health close failed")),
    );
    const destroy = vi.fn(async () =>
      Promise.reject(new Error("server destroy failed")),
    );
    const server = {
      listen: vi.fn(async () => undefined),
      destroy,
    } as unknown as Server;
    const running = await startCollabService(fixture.runtime, server);

    await expect(running.shutdown()).rejects.toThrow(
      "Collaboration service shutdown failed",
    );

    expect(mocks.closeMessaging).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("exits non-zero when the health server close callback never settles", async () => {
    vi.useFakeTimers();
    try {
      const fixture = runtimeFixture();
      fixture.close.mockImplementationOnce(() => undefined);
      const exit = vi.fn();
      fixture.runtime.exit = exit as never;
      const server = {
        listen: vi.fn(async () => undefined),
        destroy: vi.fn(async () => undefined),
      } as unknown as Server;
      await startCollabService(fixture.runtime, server);

      fixture.processListeners.get("SIGTERM")!(undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(fixture.close).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(25_000);

      expect(exit).toHaveBeenCalledWith(1);
      expect(mocks.logger.error).toHaveBeenCalledWith(
        "System event",
        expect.objectContaining({ event: "service.failed", outcome: "failed" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps signal-triggered shutdown success and failure to process exit status", async () => {
    const success = runtimeFixture();
    const successExit = vi.fn();
    success.runtime.exit = successExit as never;
    const successServer = {
      listen: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
    } as unknown as Server;
    await startCollabService(success.runtime, successServer);
    success.processListeners.get("SIGTERM")!(undefined);
    await vi.waitFor(() => expect(successExit).toHaveBeenCalledWith(0));

    mocks.closeMessaging.mockRejectedValueOnce(
      new Error("postgresql messaging close failed"),
    );
    const failure = runtimeFixture();
    const failureExit = vi.fn();
    failure.runtime.exit = failureExit as never;
    const failureServer = {
      listen: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
    } as unknown as Server;
    await startCollabService(failure.runtime, failureServer);
    failure.processListeners.get("SIGINT")!(undefined);
    await vi.waitFor(() => expect(failureExit).toHaveBeenCalledWith(1));
  });

  it("adapts the default node runtime", async () => {
    let healthListener:
      Parameters<CollabRuntime["createInternalServer"]>[0] | undefined;
    mocks.createHttpServer.mockImplementation((listener) => {
      healthListener = listener;
      return { listen: (_port: number, ready: () => void) => ready() };
    });
    const on = vi.spyOn(process, "on").mockImplementation(() => process);
    const exit = vi.spyOn(process, "exit").mockImplementation(((
      code: number,
    ) => {
      throw new ExitError(code);
    }) as typeof process.exit);

    await startCollabService();
    const response = { writeHead: vi.fn(), end: vi.fn() };
    healthListener!(
      { url: "/health", method: "GET" } as never,
      response as never,
    );
    expect(response.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    const rejection = on.mock.calls.find(
      ([event]) => event === "unhandledRejection",
    )?.[1];
    expect(() => (rejection as (reason: unknown) => void)("fatal")).toThrow(
      ExitError,
    );
    expect(exit).toHaveBeenCalledWith(1);
    on.mockRestore();
    exit.mockRestore();
  });
});
