import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import {
  listConnectedMemberIds,
  loadCollaborativeDocument,
  persistCollaborativeDocument,
  withCollaborativeDocumentPersistenceQueue,
} from "./document-persistence.ts";

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";
const FORM_ROOM = `form:${ENTITY_ID}:en`;
const FORM_QUEUE_ROOM = "form:22222222-2222-4222-8222-222222222222:en";
const FORM_OFFLINE_ROOM = "form:33333333-3333-4333-8333-333333333333:en";
const FORM_CLEAN_ROOM = "form:44444444-4444-4444-8444-444444444444:en";
const FORM_RECOVERY_ROOM = "form:55555555-5555-4555-8555-555555555555:en";
const EMAIL_LAYOUT_ROOM =
  "email-layout:66666666-6666-4666-8666-666666666666:en";

const { storeMock, loadMock, campaignStoreMock, campaignLoadMock, logger } =
  vi.hoisted(() => ({
    storeMock: vi.fn(),
    loadMock: vi.fn(),
    campaignStoreMock: vi.fn(),
    campaignLoadMock: vi.fn(),
    logger: { info: vi.fn() },
  }));

vi.mock("../../handlers/index.ts", () => ({
  handlers: {
    [CollaborativeDocumentType.FORM]: {
      load: loadMock,
      store: storeMock,
    },
    [CollaborativeDocumentType.EMAIL_LAYOUT]: {
      load: campaignLoadMock,
      store: campaignStoreMock,
    },
  },
}));

vi.mock("../logger.ts", () => ({ logger }));

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function readFirstDocumentElement(document: Y.Doc): Y.XmlElement {
  return document.getXmlFragment("document-store").get(0) as Y.XmlElement;
}

describe("persistCollaborativeDocument", () => {
  beforeEach(() => {
    storeMock.mockReset();
    loadMock.mockReset();
    campaignStoreMock.mockReset();
    campaignLoadMock.mockReset();
  });

  it("rejects every resident Block domain before the legacy Yjs persistence path", async () => {
    const document = new Y.Doc();
    for (const documentType of [
      "post",
      "page",
      "work",
      "program-event",
      "artist",
      "label",
      "release",
      "campaign",
      "email-template",
      "terms-history",
      "privacy-history",
    ]) {
      await expect(
        persistCollaborativeDocument(
          `${documentType}:${ENTITY_ID}:en`,
          document,
        ),
      ).rejects.toThrow("resident_block_runtime_required");
    }
    expect(loadMock).not.toHaveBeenCalled();
    expect(storeMock).not.toHaveBeenCalled();
  });

  it("serializes saves per document and snapshots state when each save runs", async () => {
    const firstStoreFinished = deferred();
    let firstStoreStarted!: () => void;
    const firstStoreStartedPromise = new Promise<void>((resolve) => {
      firstStoreStarted = resolve;
    });
    const storedDocuments: Y.Doc[] = [];

    storeMock.mockImplementation(async (_id, document) => {
      storedDocuments.push(document);
      if (storedDocuments.length === 1) {
        firstStoreStarted();
        await firstStoreFinished.promise;
      }
    });

    const doc = new Y.Doc();
    doc.getMap("meta").set("value", "first");

    const firstPersist = persistCollaborativeDocument(FORM_ROOM, doc);
    await firstStoreStartedPromise;

    doc.getMap("meta").set("value", "second");
    const secondPersist = persistCollaborativeDocument(FORM_ROOM, doc);

    expect(storeMock).toHaveBeenCalledTimes(1);
    firstStoreFinished.resolve();

    await Promise.all([firstPersist, secondPersist]);

    expect(storeMock).toHaveBeenCalledTimes(2);
    expect(storedDocuments[0]?.getMap("meta").get("value")).toBe("first");
    expect(storedDocuments[1]?.getMap("meta").get("value")).toBe("second");
  });

  it("holds the entity queue across the canonical source finalization sequence", async () => {
    const firstStoreFinished = deferred();
    let firstStoreStarted!: () => void;
    const firstStoreStartedPromise = new Promise<void>((resolve) => {
      firstStoreStarted = resolve;
    });
    const stored: Array<{
      id: string;
      value: unknown;
      contributorMemberIds: string[];
      versionCheckpoint: boolean;
    }> = [];

    storeMock.mockImplementation(async (id, document, options) => {
      stored.push({
        id,
        value: document.getMap("meta").get("value"),
        contributorMemberIds: options.contributorMemberIds,
        versionCheckpoint: options.versionCheckpoint === true,
      });
      if (stored.length === 1) {
        firstStoreStarted();
        await firstStoreFinished.promise;
      }
    });

    const source = new Y.Doc();
    source.getMap("meta").set("value", "source-A");
    const finalizing = withCollaborativeDocumentPersistenceQueue(
      FORM_QUEUE_ROOM,
      async (persist) => {
        await persist(FORM_QUEUE_ROOM, source, {
          contributorMemberIds: ["A"],
        });
        await persist(FORM_QUEUE_ROOM, source, {
          contributorMemberIds: ["A"],
          versionCheckpoint: true,
        });
      },
    );
    await firstStoreStartedPromise;

    const laterSource = new Y.Doc();
    laterSource.getMap("meta").set("value", "source-B");
    const laterSave = persistCollaborativeDocument(
      FORM_QUEUE_ROOM,
      laterSource,
      { contributorMemberIds: ["B"] },
      FORM_QUEUE_ROOM,
    );
    firstStoreFinished.resolve();
    await Promise.all([finalizing, laterSave]);

    expect(stored).toEqual([
      {
        id: FORM_QUEUE_ROOM,
        value: "source-A",
        contributorMemberIds: ["A"],
        versionCheckpoint: false,
      },
      {
        id: FORM_QUEUE_ROOM,
        value: "source-A",
        contributorMemberIds: ["A"],
        versionCheckpoint: true,
      },
      {
        id: FORM_QUEUE_ROOM,
        value: "source-B",
        contributorMemberIds: ["B"],
        versionCheckpoint: false,
      },
    ]);
  });

  it("lists unique Member IDs only from authenticated document connections", () => {
    const withoutConnections = new Y.Doc();
    expect(listConnectedMemberIds(withoutConnections)).toEqual([]);

    const document = new Y.Doc() as Y.Doc & {
      awareness: { getStates(): Map<number, Record<string, unknown>> };
      getConnections(): Iterable<{ context?: { member?: { id?: unknown } } }>;
    };
    document.awareness = {
      getStates: () =>
        new Map([[1, { user: { id: "spoofed-awareness-member" } }]]),
    };
    document.getConnections = () => [
      {},
      { context: {} },
      { context: { member: {} } },
      { context: { member: { id: "" } } },
      { context: { member: { id: 42 } } },
      { context: { member: { id: "member-1" } } },
      { context: { member: { id: "member-1" } } },
      { context: { member: { id: "member-2" } } },
    ];

    expect(listConnectedMemberIds(document)).toEqual(["member-1", "member-2"]);
  });

  it("loads absent, empty, and materialized documents", async () => {
    loadMock.mockResolvedValueOnce(null).mockResolvedValueOnce(Buffer.alloc(0));
    await expect(loadCollaborativeDocument(FORM_ROOM)).resolves.toBeNull();
    await expect(loadCollaborativeDocument(FORM_ROOM)).resolves.toBeNull();

    const source = new Y.Doc();
    source.getMap("meta").set("value", "loaded");
    loadMock.mockResolvedValueOnce(Buffer.from(Y.encodeStateAsUpdate(source)));
    const loaded = await loadCollaborativeDocument(FORM_ROOM);
    expect(loaded?.getMap("meta").get("value")).toBe("loaded");
  });

  it("sanitizes a loaded source document before assertion and persistence", async () => {
    const source = new Y.Doc();
    source.getMap("source-meta").set("title", "Field recording");
    source.getMap("source-meta").set("summary", "Wind through the ridge");
    const audio = new Y.XmlElement("audio");
    audio.setAttribute("fileId", "audio-file");
    audio.setAttribute("allowOriginalDownload", "true");
    source.getXmlFragment("document-store").insert(0, [audio]);

    loadMock.mockResolvedValueOnce(Buffer.from(Y.encodeStateAsUpdate(source)));
    const loaded = await loadCollaborativeDocument(FORM_ROOM);
    expect(loaded).not.toBeNull();
    const liveDocument = loaded as Y.Doc & {
      awareness: { getStates(): Map<number, Record<string, unknown>> };
    };
    liveDocument.awareness = {
      getStates: () => new Map([[1, { user: { id: "member-1" } }]]),
    };

    const result = await persistCollaborativeDocument(FORM_ROOM, liveDocument, {
      contributorMemberIds: ["member-1"],
    });

    expect(storeMock).toHaveBeenCalledTimes(1);
    const [id, durableDocument, saveOptions] = storeMock.mock.calls[0]!;
    expect(id).toBe(FORM_ROOM);
    expect(durableDocument).toBeInstanceOf(Y.Doc);
    expect(durableDocument).not.toBe(liveDocument);
    expect(durableDocument.getMap("source-meta").toJSON()).toEqual({
      title: "Field recording",
      summary: "Wind through the ridge",
    });
    expect(
      readFirstDocumentElement(durableDocument).getAttribute("fileId"),
    ).toBe("audio-file");
    expect(
      readFirstDocumentElement(durableDocument).getAttribute(
        "allowOriginalDownload",
      ),
    ).toBeUndefined();

    expect(saveOptions).toEqual({ contributorMemberIds: ["member-1"] });
    expect(result).toEqual({ contributorMemberIds: ["member-1"] });
    expect(
      readFirstDocumentElement(liveDocument).getAttribute(
        "allowOriginalDownload",
      ),
    ).toBeUndefined();
  });

  it("cleans a stale offline media update from the live document idempotently", async () => {
    const seed = new Y.Doc();
    const audio = new Y.XmlElement("audio");
    audio.setAttribute("fileId", "audio-file");
    audio.setAttribute("allowOriginalDownload", "true");
    seed.getXmlFragment("document-store").insert(0, [audio]);
    const staleState = Buffer.from(Y.encodeStateAsUpdate(seed));

    const liveDocument = new Y.Doc();
    Y.applyUpdate(liveDocument, staleState);
    const offlineDocument = new Y.Doc();
    Y.applyUpdate(offlineDocument, staleState);

    await persistCollaborativeDocument(FORM_OFFLINE_ROOM, liveDocument);
    expect(
      readFirstDocumentElement(liveDocument).getAttribute(
        "allowOriginalDownload",
      ),
    ).toBeUndefined();

    readFirstDocumentElement(offlineDocument).setAttribute(
      "allowOriginalDownload",
      "false",
    );
    const offlineUpdate = Y.encodeStateAsUpdate(
      offlineDocument,
      Y.encodeStateVector(liveDocument),
    );
    Y.applyUpdate(liveDocument, offlineUpdate);
    expect(
      readFirstDocumentElement(liveDocument).getAttribute(
        "allowOriginalDownload",
      ),
    ).toBe("false");

    await persistCollaborativeDocument(FORM_OFFLINE_ROOM, liveDocument);
    expect(
      readFirstDocumentElement(liveDocument).getAttribute(
        "allowOriginalDownload",
      ),
    ).toBeUndefined();
    const secondState = Buffer.from(
      Y.encodeStateAsUpdate(storeMock.mock.calls[1]?.[1] as Y.Doc),
    );

    await persistCollaborativeDocument(FORM_OFFLINE_ROOM, liveDocument);
    const thirdState = Buffer.from(
      Y.encodeStateAsUpdate(storeMock.mock.calls[2]?.[1] as Y.Doc),
    );
    expect(thirdState).toEqual(secondState);
  });

  it("preserves clean state, metadata, and explicit contributor semantics", async () => {
    const liveDocument = new Y.Doc() as Y.Doc & {
      awareness: { getStates(): Map<number, Record<string, unknown>> };
    };
    liveDocument.getMap("meta").set("value", "clean");
    liveDocument.getMap("source-meta").set("title", "Clean title");
    liveDocument.awareness = {
      getStates: () =>
        new Map([
          [1, { user: { id: "member-1" } }],
          [2, { user: { id: "member-2" } }],
        ]),
    };
    const expectedState = Buffer.from(Y.encodeStateAsUpdate(liveDocument));

    const result = await persistCollaborativeDocument(
      FORM_CLEAN_ROOM,
      liveDocument,
      { contributorMemberIds: ["member-2", "member-1", "member-2"] },
    );

    const [id, durableDocument, saveOptions] = storeMock.mock.calls[0]!;
    expect(id).toBe(FORM_CLEAN_ROOM);
    expect(durableDocument).toBeInstanceOf(Y.Doc);
    expect(durableDocument).not.toBe(liveDocument);
    expect(durableDocument.getMap("meta").get("value")).toBe("clean");
    expect(durableDocument.getMap("source-meta").get("title")).toBe(
      "Clean title",
    );
    expect(Buffer.from(Y.encodeStateAsUpdate(durableDocument))).toEqual(
      expectedState,
    );
    expect(saveOptions).toEqual({
      contributorMemberIds: ["member-1", "member-2"],
    });
    expect(result).toEqual({
      contributorMemberIds: ["member-1", "member-2"],
    });
  });

  it("recovers the queue after a failed save", async () => {
    storeMock
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce(undefined);
    const document = new Y.Doc();
    const first = persistCollaborativeDocument(FORM_RECOVERY_ROOM, document);
    const second = persistCollaborativeDocument(FORM_RECOVERY_ROOM, document);
    await expect(first).rejects.toThrow("write failed");
    await expect(second).resolves.toEqual({ contributorMemberIds: [] });

    await expect(
      persistCollaborativeDocument(EMAIL_LAYOUT_ROOM, document),
    ).resolves.toEqual({
      contributorMemberIds: [],
    });
    expect(campaignStoreMock).toHaveBeenCalledWith(
      EMAIL_LAYOUT_ROOM,
      expect.any(Y.Doc),
      { contributorMemberIds: [] },
    );
    expect(campaignStoreMock.mock.calls[0]?.[1]).not.toBe(document);
  });
});
