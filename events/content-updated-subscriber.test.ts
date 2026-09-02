import type { Server } from "@hocuspocus/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  startSignalSubscriber: vi.fn(),
  deserializeProto: vi.fn(),
  invalidateEntityRooms: vi.fn(async () => true),
  invalidateRoom: vi.fn(async () => true),
  logger: { info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/postgresql/messaging.ts", () => ({
  startSignalSubscriber: mocks.startSignalSubscriber,
}));
vi.mock("../lib/collaboration/server.ts", () => ({
  invalidateCanonicalEntityRooms: mocks.invalidateEntityRooms,
  invalidateCanonicalRoom: mocks.invalidateRoom,
}));
vi.mock("../lib/logger.ts", () => ({ logger: mocks.logger }));
vi.mock("@echovisionlab/geul-event", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@echovisionlab/geul-event")>();
  return { ...original, deserializeProto: mocks.deserializeProto };
});

import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { Signals } from "@echovisionlab/geul-event";
import {
  ContentEntityType,
  ContentUpdateSource,
} from "@echovisionlab/geul-proto/secure/events_pb.ts";
import { startContentUpdatedSubscriber } from "./content-updated-subscriber.ts";

function contentUpdated(
  entityType = ContentEntityType.POST,
  overrides: Record<string, unknown> = {},
) {
  return {
    entityType,
    entityId: "entity-1",
    source: ContentUpdateSource.MANAGE,
    changedFields: [],
    documentRevision: "11111111-1111-4111-8111-111111111111",
    contributorMemberIds: [],
    documentStateChanged: true,
    timestampMs: 1n,
    ...overrides,
  };
}

async function subscribedHandler(): Promise<
  (content: Uint8Array) => Promise<void>
> {
  let handle: ((content: Uint8Array) => Promise<void>) | undefined;
  mocks.startSignalSubscriber.mockImplementationOnce(async (_signal, next) => {
    handle = next;
  });
  await startContentUpdatedSubscriber({} as Server);
  if (!handle) throw new Error("content updated handler was not registered");
  return handle;
}

describe("content updated locale fence subscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invalidateEntityRooms.mockResolvedValue(true);
    mocks.invalidateRoom.mockResolvedValue(true);
  });

  it("subscribes to the content updated signal", async () => {
    await startContentUpdatedSubscriber({} as Server);

    expect(mocks.startSignalSubscriber).toHaveBeenCalledWith(
      Signals.contentUpdated,
      expect.any(Function),
    );
  });

  it("fences every locale room for an authoritative shared update", async () => {
    const handle = await subscribedHandler();
    const cases = [
      [ContentEntityType.POST, CollaborativeDocumentType.POST],
      [ContentEntityType.PAGE, CollaborativeDocumentType.PAGE],
      [ContentEntityType.WORK, CollaborativeDocumentType.WORK],
      [ContentEntityType.ARTIST, CollaborativeDocumentType.ARTIST],
      [ContentEntityType.LABEL, CollaborativeDocumentType.LABEL],
      [ContentEntityType.RELEASE, CollaborativeDocumentType.RELEASE],
      [
        ContentEntityType.EMAIL_TEMPLATE,
        CollaborativeDocumentType.EMAIL_TEMPLATE,
      ],
      [ContentEntityType.EMAIL_LAYOUT, CollaborativeDocumentType.EMAIL_LAYOUT],
      [ContentEntityType.CAMPAIGN, CollaborativeDocumentType.CAMPAIGN],
      [ContentEntityType.FORM, CollaborativeDocumentType.FORM],
      [ContentEntityType.PRIVACY, CollaborativeDocumentType.PRIVACY_HISTORY],
      [ContentEntityType.TERMS, CollaborativeDocumentType.TERMS_HISTORY],
      [
        ContentEntityType.PROGRAM_EVENT,
        CollaborativeDocumentType.PROGRAM_EVENT,
      ],
      [ContentEntityType.MENU, CollaborativeDocumentType.MENU],
      [ContentEntityType.POST_SERIES, CollaborativeDocumentType.POST_SERIES],
    ] as const;

    for (const [entityType, documentType] of cases) {
      mocks.deserializeProto.mockReturnValueOnce(contentUpdated(entityType));
      await handle(new Uint8Array([1]));
      expect(mocks.invalidateEntityRooms).toHaveBeenLastCalledWith(
        expect.anything(),
        documentType,
        "entity-1",
      );
    }

    expect(mocks.invalidateEntityRooms).toHaveBeenCalledTimes(cases.length);
    expect(mocks.invalidateRoom).not.toHaveBeenCalled();
    expect(mocks.logger.info).toHaveBeenCalledTimes(cases.length);
  });

  it("fences only the exact existing target locale room", async () => {
    const handle = await subscribedHandler();
    mocks.deserializeProto.mockReturnValueOnce(
      contentUpdated(ContentEntityType.PAGE, {
        locale: "en",
        localeExists: true,
        targetRevision: "tr1_target_after",
        documentStateChanged: false,
      }),
    );

    await handle(new Uint8Array([1]));

    expect(mocks.invalidateRoom).toHaveBeenCalledWith(
      expect.anything(),
      CollaborativeDocumentType.PAGE,
      "entity-1",
      "en",
    );
    expect(mocks.invalidateEntityRooms).not.toHaveBeenCalled();
  });

  it("fences only the exact deleted target locale room", async () => {
    const handle = await subscribedHandler();
    mocks.deserializeProto.mockReturnValueOnce(
      contentUpdated(ContentEntityType.POST, {
        locale: "en",
        localeExists: false,
        documentStateChanged: false,
      }),
    );

    await handle(new Uint8Array([1]));

    expect(mocks.invalidateRoom).toHaveBeenCalledWith(
      expect.anything(),
      CollaborativeDocumentType.POST,
      "entity-1",
      "en",
    );
    expect(mocks.invalidateEntityRooms).not.toHaveBeenCalled();
  });

  it("fences every locale room for a source-locale write", async () => {
    const handle = await subscribedHandler();
    mocks.deserializeProto.mockReturnValueOnce(
      contentUpdated(ContentEntityType.WORK, {
        locale: "ko",
        localeExists: true,
        documentStateChanged: true,
      }),
    );

    await handle(new Uint8Array([1]));

    expect(mocks.invalidateEntityRooms).toHaveBeenCalledWith(
      expect.anything(),
      CollaborativeDocumentType.WORK,
      "entity-1",
    );
    expect(mocks.invalidateRoom).not.toHaveBeenCalled();
  });

  it("ignores collab self-signals before inspecting their locale tuple", async () => {
    const handle = await subscribedHandler();
    mocks.deserializeProto.mockReturnValueOnce(
      contentUpdated(ContentEntityType.POST, {
        source: ContentUpdateSource.COLLAB,
        locale: " ",
        localeExists: false,
        targetRevision: "forbidden",
      }),
    );

    await handle(new Uint8Array([1]));

    expect(mocks.invalidateEntityRooms).not.toHaveBeenCalled();
    expect(mocks.invalidateRoom).not.toHaveBeenCalled();
  });

  it("ignores revisionless non-locale and non-room signals", async () => {
    const handle = await subscribedHandler();
    const ignored = [
      contentUpdated(ContentEntityType.POST, { documentRevision: undefined }),
      contentUpdated(ContentEntityType.POST_SERIES, {
        documentRevision: undefined,
      }),
      contentUpdated(ContentEntityType.UNSPECIFIED),
    ];

    for (const event of ignored) {
      mocks.deserializeProto.mockReturnValueOnce(event);
      await handle(new Uint8Array([1]));
    }

    expect(mocks.invalidateEntityRooms).not.toHaveBeenCalled();
    expect(mocks.invalidateRoom).not.toHaveBeenCalled();
  });

  it("accepts system and AI authoritative revisions", async () => {
    const handle = await subscribedHandler();
    mocks.invalidateEntityRooms.mockResolvedValue(false);

    for (const source of [ContentUpdateSource.SYSTEM, ContentUpdateSource.AI]) {
      mocks.deserializeProto.mockReturnValueOnce(
        contentUpdated(ContentEntityType.WORK, { source }),
      );
      await handle(new Uint8Array([1]));
    }

    expect(mocks.invalidateEntityRooms).toHaveBeenCalledTimes(2);
    expect(mocks.logger.debug).toHaveBeenCalledTimes(2);
  });

  it("fails closed for malformed or forbidden locale tuples", async () => {
    const invalid = [
      contentUpdated(ContentEntityType.POST, { entityId: " " }),
      contentUpdated(ContentEntityType.POST, { documentRevision: " " }),
      contentUpdated(ContentEntityType.POST, {
        source: ContentUpdateSource.UNSPECIFIED,
      }),
      contentUpdated(ContentEntityType.POST, { locale: "en" }),
      contentUpdated(ContentEntityType.POST, { localeExists: true }),
      contentUpdated(ContentEntityType.POST, {
        targetRevision: "tr1_target",
      }),
      contentUpdated(ContentEntityType.POST, {
        locale: " ",
        localeExists: true,
      }),
      contentUpdated(ContentEntityType.POST, {
        locale: "en",
        localeExists: true,
        targetRevision: " ",
        documentStateChanged: false,
      }),
      contentUpdated(ContentEntityType.POST, {
        locale: "en",
        localeExists: false,
        targetRevision: "tr1_forbidden",
        documentStateChanged: false,
      }),
      contentUpdated(ContentEntityType.POST, {
        locale: "en",
        localeExists: true,
        documentRevision: undefined,
      }),
    ];

    for (const event of invalid) {
      const handle = await subscribedHandler();
      mocks.deserializeProto.mockReturnValueOnce(event);
      await expect(handle(new Uint8Array([1]))).rejects.toThrow();
    }
    expect(mocks.invalidateEntityRooms).not.toHaveBeenCalled();
    expect(mocks.invalidateRoom).not.toHaveBeenCalled();
  });

  it("rejects target-only tuples that masquerade as source revision advances", async () => {
    const invalid = [
      contentUpdated(ContentEntityType.POST, {
        locale: "en",
        localeExists: true,
        targetRevision: "tr1_target",
        documentStateChanged: true,
      }),
      contentUpdated(ContentEntityType.POST, {
        locale: "en",
        localeExists: false,
        documentStateChanged: true,
      }),
      contentUpdated(ContentEntityType.POST, {
        locale: "ko",
        localeExists: true,
        documentStateChanged: false,
      }),
    ];

    for (const event of invalid) {
      const handle = await subscribedHandler();
      mocks.deserializeProto.mockReturnValueOnce(event);
      await expect(handle(new Uint8Array([1]))).rejects.toThrow();
    }
    expect(mocks.invalidateEntityRooms).not.toHaveBeenCalled();
    expect(mocks.invalidateRoom).not.toHaveBeenCalled();
  });

  it("propagates subscriber startup failure", async () => {
    mocks.startSignalSubscriber.mockRejectedValueOnce(new Error("offline"));

    await expect(startContentUpdatedSubscriber({} as Server)).rejects.toThrow(
      "offline",
    );
  });
});
