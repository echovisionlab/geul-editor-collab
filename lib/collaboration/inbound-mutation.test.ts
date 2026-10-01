import {
  Connection,
  Document,
  Hocuspocus,
  IncomingMessage,
  MessageReceiver,
  OutgoingMessage,
} from "@hocuspocus/server";
import { create, fromJson } from "@bufbuild/protobuf";
import { getBlockRoomCollaborativeText } from "@echovisionlab/geul-common/collaboration/block-room-codec";
import { contentBlockCatalogFingerprint } from "@echovisionlab/geul-proto/content/block_catalog.ts";
import {
  LocalizedRichTextDocumentSchema,
  RichTextProfile,
} from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { CollaborationPrincipalSchema } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { AIDocumentFieldTargetSchema } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { EditSessionContributorTracker } from "./edit-session-contributors.ts";
import { createConnectionHooks } from "./connection-hooks.ts";
import { isAttributedInboundMutation } from "./inbound-mutation.ts";
import { createDocumentHooks } from "./document-hooks.ts";
import { ResidentBlockRuntime } from "./resident-block-runtime.ts";

const name = "post:11111111-1111-4111-8111-111111111111:en";
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function fixture() {
  const document = new Document(name);
  const persist = vi.fn(
    async (
      _name: string,
      doc: Document,
      options: { contributorMemberIds?: string[] },
    ) => ({
      actors: options.contributorMemberIds,
      body: doc.getMap("body").toJSON(),
    }),
  );
  const tracker = new EditSessionContributorTracker<Document>({
    listDocuments: () => new Map([[name, document]]),
    loadDocument: async () => document,
    persistDocument: persist,
    withPersistenceQueue: async (_key, run) => {
      await run(persist);
    },
    unloadDocument: async () => undefined,
    supportsVersionCheckpoints: () => false,
    logFailure: vi.fn(),
    logTerminalCheckpointFailure: vi.fn(),
  });
  cleanups.push(() => {
    tracker.release();
    document.destroy();
  });
  const validate = vi.fn();
  const hooks = createConnectionHooks({
    editSessions: () => tracker,
    blockRooms: { connected: vi.fn(), beforeSync: validate },
    metadataAiGrace: {} as never,
    shutdownConnections: {} as never,
    isDocumentFenced: () => false,
    settlePendingRoomInvalidation: async () => undefined,
  });
  const changes: unknown[] = [];
  document.on("update", (_update, origin) => changes.push(origin));

  function connection(memberId: string) {
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
    const context = {
      member: { id: memberId },
      canEdit: true,
      blockRoomAdmissionState: "accepted" as const,
    };
    const client = new Connection(
      socket,
      new Request("http://collab.test"),
      document,
      memberId,
      context,
    );
    client.beforeSync((connection, payload) =>
      hooks.beforeSync!({
        connection,
        context,
        documentName: name,
        document,
        ...payload,
      } as never),
    );
    return client;
  }
  return { document, tracker, persist, validate, connection, changes };
}

function update(key: string, value: string): Uint8Array {
  const source = new Y.Doc();
  source.getMap("body").set(key, value);
  const result = Y.encodeStateAsUpdate(source);
  source.destroy();
  return result;
}

async function receive(connection: Connection, payload: Uint8Array) {
  const frame = new OutgoingMessage(name)
    .createSyncMessage()
    .writeUpdate(payload)
    .toUint8Array();
  const message = new IncomingMessage(frame);
  message.readVarString();
  await new MessageReceiver(message).apply(connection.document, connection);
}

function postDocument() {
  return fromJson(LocalizedRichTextDocumentSchema, {
    blockCatalogFingerprint: contentBlockCatalogFingerprint,
    profile: RichTextProfile.POST,
    locale: "en",
    base: {
      nodes: [
        {
          block: {
            id: "22222222-2222-4222-8222-222222222222",
            paragraph: { props: {} },
          },
          placement: { index: 0 },
        },
      ],
    },
    localeOverlay: {
      locale: "en",
      blocks: [
        {
          blockId: "22222222-2222-4222-8222-222222222222",
          paragraph: { content: [{ text: { text: "seed" } }] },
        },
      ],
    },
  });
}

function postText(document: Y.Doc) {
  return getBlockRoomCollaborativeText(document, {
    id: "22222222-2222-4222-8222-222222222222",
    family: "rich_text",
    locale: true,
    path: "content[0].text.text",
  });
}

function deleteSet(document: Y.Doc) {
  return Y.decodeUpdate(Y.encodeStateAsUpdate(document)).ds.clients;
}

function expectStateVectorCoverage(
  acknowledgement: { stateVector: string },
  expectedStateVector: Uint8Array,
) {
  const actual = Y.decodeStateVector(
    Buffer.from(acknowledgement.stateVector, "base64"),
  );
  for (const [client, clock] of Y.decodeStateVector(expectedStateVector)) {
    expect(actual.get(client) ?? 0).toBeGreaterThanOrEqual(clock);
  }
}

function expectDeleteSetCoverage(
  acknowledgement: {
    deleted: Record<string, Array<{ clock: number; len: number }>>;
  },
  expected: Map<number, Array<{ clock: number; len: number }>>,
) {
  for (const [client, ranges] of expected) {
    const actualRanges = acknowledgement.deleted[String(client)] ?? [];
    for (const expectedRange of ranges) {
      expect(
        actualRanges.some(
          (actualRange) =>
            actualRange.clock <= expectedRange.clock &&
            actualRange.clock + actualRange.len >=
              expectedRange.clock + expectedRange.len,
        ),
      ).toBe(true);
    }
  }
}

async function residentPostFixture() {
  let revision = 1;
  const gateway = {
    load: vi.fn().mockResolvedValue({
      document: postDocument(),
      documentRevision: "revision-1",
      locale: "en",
      sourceLocale: "en",
      localeExists: true,
      presentLocaleValues: [
        create(AIDocumentFieldTargetSchema, {
          owner: {
            case: "blockHandle",
            value: "22222222-2222-4222-8222-222222222222",
          },
          fieldHandle: "content",
        }),
      ],
      sourceMetadata: { locale: "en", title: "Post" },
      localeMetadata: { locale: "en", title: "Post" },
    }),
    save: vi.fn(async () => ({
      documentRevision: `revision-${++revision}`,
      changed: true,
      sourceChanged: true,
      locale: "en",
    })),
  };
  const runtime = new ResidentBlockRuntime({ post: gateway as never });
  const principal = create(CollaborationPrincipalSchema, {
    sessionId: "33333333-3333-4333-8333-333333333333",
  });
  const documents = new Map<string, Document>();
  const tracker = new EditSessionContributorTracker<Document>({
    listDocuments: () => documents,
    loadDocument: async (documentName) => documents.get(documentName) ?? null,
    persistDocument: (documentName, savedDocument, options) =>
      runtime.persistEditSession(documentName, savedDocument, options),
    withPersistenceQueue: (queueKey, operation) =>
      runtime.withPersistenceQueue(queueKey, async (persist) => {
        await operation(persist);
      }),
    unloadDocument: async () => undefined,
    supportsVersionCheckpoints: () => false,
    logFailure: vi.fn(),
    logTerminalCheckpointFailure: vi.fn(),
  });
  const hooks = createConnectionHooks({
    editSessions: () => tracker,
    blockRooms: { connected: vi.fn(), beforeSync: vi.fn() },
    metadataAiGrace: {} as never,
    shutdownConnections: {} as never,
    isDocumentFenced: () => false,
    settlePendingRoomInvalidation: async () => undefined,
  });
  const blockRooms = { handleStateless: vi.fn().mockResolvedValue(false) };
  const documentHooks = createDocumentHooks({
    editSessions: () => tracker,
    blockRooms,
    revisionConflicts: { isStale: () => false, handle: () => false },
  } as never);
  const afterStore = vi.fn();
  const hocuspocus = new Hocuspocus({
    debounce: 2_000,
    maxDebounce: 10_000,
    onLoadDocument: async ({ document }) =>
      runtime.load(name, document, principal),
    onChange: documentHooks.onChange,
    onStoreDocument: documentHooks.onStoreDocument,
    afterStoreDocument: afterStore,
    onStateless: documentHooks.onStateless,
  });
  const document = await hocuspocus.createDocument(
    name,
    new Request("http://collab.test"),
    "server",
    { isAuthenticated: true, readOnly: false } as never,
  );
  documents.set(name, document);
  const broadcast = vi.spyOn(document, "broadcastStateless");
  const persistEditSession = vi.spyOn(runtime, "persistEditSession");
  function connection(memberId: string) {
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
    const context = {
      member: { id: memberId },
      canEdit: true,
      blockRoomAdmissionState: "accepted" as const,
    };
    const client = new Connection(
      socket,
      new Request("http://collab.test"),
      document,
      memberId,
      context,
    );
    client.beforeSync((currentConnection, payload) =>
      hooks.beforeSync!({
        connection: currentConnection,
        context,
        documentName: name,
        document,
        ...payload,
      } as never),
    );
    return client;
  }
  cleanups.push(() => {
    tracker.release();
    runtime.unload(name);
    hocuspocus.documents.delete(name);
    document.destroy();
  });
  return {
    afterStore,
    broadcast,
    connection,
    document,
    documentHooks,
    gateway,
    hocuspocus,
    persistEditSession,
  };
}

describe("inbound document actor lane at the Hocuspocus MessageReceiver boundary", () => {
  it("persists the first actor before applying a simultaneously arriving second socket update", async () => {
    const { document, tracker, persist, connection, changes } = fixture();
    const first = connection("member-A");
    const second = connection("member-B");
    await Promise.all([
      receive(first, update("A", "first")),
      receive(second, update("B", "second")),
    ]);

    expect(persist).toHaveBeenCalledOnce();
    expect(await persist.mock.results[0]!.value).toEqual({
      actors: ["member-A"],
      body: { A: "first" },
    });
    expect(document.getMap("body").toJSON()).toEqual({
      A: "first",
      B: "second",
    });
    expect(changes).toHaveLength(2); // Receiver's normal duplicate replay never reapplies the mutation.
    expect(changes.every(isAttributedInboundMutation)).toBe(true);
    await tracker.persist(name, document);
    expect(await persist.mock.results[1]!.value).toEqual({
      actors: ["member-B"],
      body: { A: "first", B: "second" },
    });
  });

  it.each([
    {
      label: "the same actor",
      actorB: "member-A",
      actorA: "member-A",
      expectedContributors: ["member-A"],
      expectedAcknowledgements: 1,
    },
    {
      label: "different actors",
      actorB: "member-B",
      actorA: "member-A",
      expectedContributors: ["member-B", "member-A"],
      expectedAcknowledgements: 2,
    },
  ])(
    "acknowledges the B insert and A peer delete for $label",
    async ({
      actorA,
      actorB,
      expectedAcknowledgements,
      expectedContributors,
    }) => {
      const {
        afterStore,
        broadcast,
        connection,
        document,
        gateway,
        persistEditSession,
      } = await residentPostFixture();
      const clientB = new Y.Doc();
      const clientA = new Y.Doc();
      const initialUpdate = Y.encodeStateAsUpdate(document);
      Y.applyUpdate(clientB, initialUpdate);
      Y.applyUpdate(clientA, initialUpdate);

      const beforeB = Y.encodeStateVector(document);
      const bText = postText(clientB);
      bText.insert(bText.length, " B");
      const bStateVector = Y.encodeStateVector(clientB);
      const bUpdate = Y.encodeStateAsUpdate(clientB, beforeB);
      await receive(connection(actorB), bUpdate);

      const beforeA = Y.encodeStateVector(document);
      Y.applyUpdate(clientA, bUpdate);
      postText(clientA).delete("seed".length, " B".length);
      const aDelete = Y.encodeStateAsUpdate(clientA, beforeA);
      await receive(connection(actorA), aDelete);

      if (actorA !== actorB) {
        const insertAcknowledgement = JSON.parse(
          String(broadcast.mock.calls[0]?.[0]),
        ) as {
          stateVector: string;
          deleted: Record<string, Array<{ clock: number; len: number }>>;
        };
        expectStateVectorCoverage(insertAcknowledgement, bStateVector);
        expect(insertAcknowledgement.deleted).toEqual({});
      }

      await vi.waitFor(() => expect(afterStore).toHaveBeenCalledOnce(), {
        timeout: 3_000,
      });

      const acknowledgements = broadcast.mock.calls.map(
        ([payload]) =>
          JSON.parse(String(payload)) as {
            stateVector: string;
            deleted: Record<string, Array<{ clock: number; len: number }>>;
          },
      );
      expect(acknowledgements).toHaveLength(expectedAcknowledgements);
      expect(
        persistEditSession.mock.calls.map(
          ([, , options]) => options.contributorMemberIds,
        ),
      ).toEqual(expectedContributors.map((memberId) => [memberId]));
      expect(Y.decodeStateVector(bStateVector).size).toBeGreaterThan(0);

      const expectedDeleted = deleteSet(document);
      expect(expectedDeleted.size).toBeGreaterThan(0);
      const deleteAcknowledgement = acknowledgements.at(-1)!;
      expectStateVectorCoverage(deleteAcknowledgement, bStateVector);
      expectDeleteSetCoverage(deleteAcknowledgement, expectedDeleted);
      expect(gateway.save).toHaveBeenCalledTimes(actorA === actorB ? 0 : 2);

      clientA.destroy();
      clientB.destroy();
    },
  );

  it("keeps an un-attributed autosave and persist-now from claiming a durable ACK", async () => {
    const {
      afterStore,
      broadcast,
      connection,
      document,
      documentHooks,
      gateway,
      persistEditSession,
    } = await residentPostFixture();
    const client = connection("member-A");

    document.transact(() => postText(document).insert(4, " local"), {
      source: "local",
    });
    await vi.waitFor(() => expect(afterStore).toHaveBeenCalledOnce(), {
      timeout: 3_000,
    });

    expect(gateway.save).not.toHaveBeenCalled();
    expect(persistEditSession).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();

    const sendStateless = vi
      .spyOn(client, "sendStateless")
      .mockImplementation(() => undefined);
    await documentHooks.onStateless!({
      connection: client,
      documentName: name,
      document,
      payload: JSON.stringify({
        kind: "persist.now.request",
        requestId: "44444444-4444-4444-8444-444444444444",
      }),
    } as never);

    expect(sendStateless).toHaveBeenCalledWith(
      JSON.stringify({
        kind: "persist.now.ack",
        requestId: "44444444-4444-4444-8444-444444444444",
        ok: true,
      }),
    );
    expect(gateway.save).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("keeps the second actor out while the first actor's durable write is pending", async () => {
    const { document, persist, connection } = fixture();
    let finish!: () => void;
    persist.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ actors: ["member-A"], body: {} });
        }),
    );
    await receive(connection("member-A"), update("A", "first"));
    const second = receive(connection("member-B"), update("B", "second"));
    await vi.waitFor(() => expect(persist).toHaveBeenCalledOnce());
    expect(document.getMap("body").has("B")).toBe(false);
    finish();
    await second;
    expect(document.getMap("body").get("B")).toBe("second");
  });

  it("rejects a failed actor flush before apply and permits a later retry", async () => {
    const { document, persist, connection } = fixture();
    await receive(connection("member-A"), update("A", "first"));
    const second = connection("member-B");
    const secondUpdate = update("B", "second");
    persist.mockRejectedValueOnce(new Error("offline"));
    await expect(receive(second, secondUpdate)).rejects.toThrow("offline");
    expect(document.getMap("body").has("B")).toBe(false);
    await receive(second, secondUpdate);
    expect(document.getMap("body").get("B")).toBe("second");
  });

  it("does not attribute rejected or duplicate updates and revalidates after waiting", async () => {
    const { document, tracker, persist, connection, validate } = fixture();
    const first = connection("member-A");
    const payload = update("A", "first");
    validate.mockImplementationOnce(() => {
      throw new Error("invalid locale mutation");
    });
    await expect(receive(first, payload)).rejects.toThrow(
      "invalid locale mutation",
    );
    expect(document.getMap("body").size).toBe(0);
    await tracker.persist(name, document);
    expect(persist).not.toHaveBeenCalled();
    await receive(first, payload);
    await tracker.persist(name, document);
    persist.mockClear();
    await receive(connection("member-B"), payload);
    await tracker.persist(name, document);
    expect(persist).not.toHaveBeenCalled();
  });
});
