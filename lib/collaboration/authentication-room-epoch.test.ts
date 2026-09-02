import { beforeEach, describe, expect, it, vi } from "vitest";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { env } from "../../env.ts";
import { CANONICAL_SESSION_HEADER } from "./admission.ts";
import { createAuthenticationHook } from "./authentication.ts";
import { RoomEpochRegistry } from "./room-epoch.ts";
import { ShutdownConnectionDrain } from "./shutdown-connection-drain.ts";

const mocks = vi.hoisted(() => ({ authorize: vi.fn() }));

vi.mock("../api/collaboration.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/collaboration.ts")>()),
  authorizeCollaboration: mocks.authorize,
}));

const sessionId = "33333333-3333-4333-8333-333333333333";
const entityId = "11111111-1111-4111-8111-111111111111";
const postRoom = `post:${entityId}:en`;
const pageRoom = `page:${entityId}:ko`;
const workRoom = `work:${entityId}:en`;
type AuthenticationInput = Parameters<
  ReturnType<typeof createAuthenticationHook>
>[0];

function ids(...values: string[]): () => string {
  let index = 0;
  return () => values[index++] ?? `id-${index}`;
}

function payload(documentName: string, token = "") {
  return {
    context: {},
    documentName,
    socketId: "socket-1",
    token,
    connectionConfig: { isAuthenticated: false, readOnly: false },
    request: new Request("https://collab.example", {
      headers: {
        Origin: env.SITE_ORIGIN,
        [CANONICAL_SESSION_HEADER]: sessionId,
      },
    }),
  } as unknown as AuthenticationInput & {
    connectionConfig: { isAuthenticated: boolean; readOnly: boolean };
  };
}

function binding() {
  return {
    yjsBootstrapStateVector: Uint8Array.of(0),
  };
}

describe("collaboration room epoch authentication", () => {
  beforeEach(() => {
    mocks.authorize.mockReset();
    mocks.authorize.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      nickname: "Editor",
      deleted: false,
    });
  });

  it("admits a fresh entity-room connection before issuing its socket bootstrap challenge", async () => {
    const roomEpochs = new RoomEpochRegistry(ids("server-a", "epoch-a"));
    const authenticate = createAuthenticationHook(
      new ShutdownConnectionDrain(),
      new Set(),
      roomEpochs,
    );

    await expect(authenticate(payload(postRoom))).resolves.toMatchObject({
      documentType: CollaborativeDocumentType.POST,
      resourceId: entityId,
      locale: "en",
      blockRoomAdmissionState: "pending",
      requiresCanonicalSyncFence: true,
    });
  });

  it.each([postRoom, pageRoom, workRoom])(
    "advertises a VIEW-only %s connection as read-only before the client is connected",
    async (documentName) => {
      mocks.authorize
        .mockResolvedValueOnce({
          id: "22222222-2222-4222-8222-222222222222",
          nickname: "Author",
          deleted: false,
        })
        .mockResolvedValueOnce(null);
      const authenticate = createAuthenticationHook(
        new ShutdownConnectionDrain(),
        new Set(),
        new RoomEpochRegistry(),
      );
      const input = payload(documentName);

      await expect(authenticate(input)).resolves.toMatchObject({
        canEdit: false,
      });
      expect(input.connectionConfig.readOnly).toBe(true);
    },
  );

  it("resumes only with a synchronized challenge for the same resident room", async () => {
    const roomEpochs = new RoomEpochRegistry(
      ids("server-a", "epoch-a", "token-a"),
    );
    const token = roomEpochs.issueToken(postRoom, binding());
    expect(roomEpochs.markSynchronized(postRoom, token)).toBe(true);
    const authenticate = createAuthenticationHook(
      new ShutdownConnectionDrain(),
      new Set(),
      roomEpochs,
    );

    await expect(authenticate(payload(postRoom, token))).resolves.toMatchObject(
      {
        documentType: CollaborativeDocumentType.POST,
        resourceId: entityId,
        locale: "en",
        blockRoomAdmissionState: "accepted",
        bootstrapChallenge: token,
        requiresCanonicalSyncFence: false,
        ...binding(),
      },
    );
  });

  it("rejects a forged resume token after domain authorization", async () => {
    const roomEpochs = new RoomEpochRegistry(ids("server-a", "epoch-a"));
    roomEpochs.issue(workRoom);
    const authenticate = createAuthenticationHook(
      new ShutdownConnectionDrain(),
      new Set(),
      roomEpochs,
    );

    await expect(authenticate(payload(workRoom, "forged"))).rejects.toThrow(
      "reload_required",
    );
    expect(mocks.authorize).toHaveBeenCalledTimes(2);
  });

  it("rejects removed locale rooms even if a token was issued for the old name", async () => {
    const roomEpochs = new RoomEpochRegistry(
      ids("server-a", "epoch-a", "token-a"),
    );
    const documentName = `page:${entityId}:locale:ko`;
    const token = roomEpochs.issueToken(documentName, binding());
    const authenticate = createAuthenticationHook(
      new ShutdownConnectionDrain(),
      new Set(),
      roomEpochs,
    );

    await expect(authenticate(payload(documentName, token))).rejects.toThrow(
      "Invalid document name",
    );
    expect(mocks.authorize).not.toHaveBeenCalled();
  });

  it("admits Map Theme only through its locale-neutral und room", async () => {
    const authenticate = createAuthenticationHook(
      new ShutdownConnectionDrain(),
      new Set(),
      new RoomEpochRegistry(),
    );
    await expect(
      authenticate(payload(`map-theme:${entityId}:en`)),
    ).rejects.toThrow("Invalid document name");
    expect(mocks.authorize).not.toHaveBeenCalled();

    await expect(
      authenticate(payload(`map-theme:${entityId}:und`)),
    ).resolves.toMatchObject({
      documentType: CollaborativeDocumentType.MAP_THEME,
      resourceId: entityId,
      locale: "und",
    });
  });

  it("rechecks a resume token after an in-flight permission lookup", async () => {
    let resolveAuthorization!: (member: {
      id: string;
      nickname: string;
      deleted: boolean;
    }) => void;
    mocks.authorize.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveAuthorization = resolve;
      }),
    );
    const roomEpochs = new RoomEpochRegistry(
      ids("server-a", "epoch-a", "token-a"),
    );
    const documentName = postRoom;
    const token = roomEpochs.issueToken(documentName, binding());
    expect(roomEpochs.markSynchronized(documentName, token)).toBe(true);
    const authenticate = createAuthenticationHook(
      new ShutdownConnectionDrain(),
      new Set(),
      roomEpochs,
    );
    const admission = authenticate(payload(documentName, token));
    await vi.waitFor(() => expect(mocks.authorize).toHaveBeenCalledOnce());
    roomEpochs.retire(documentName);
    resolveAuthorization({
      id: "22222222-2222-4222-8222-222222222222",
      nickname: "Editor",
      deleted: false,
    });

    await expect(admission).rejects.toThrow("reload_required");
  });
});
