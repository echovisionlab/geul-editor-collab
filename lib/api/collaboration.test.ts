import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { CollaborationPermission } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeCollaboration,
  CollaborationSessionInvalidError,
} from "./collaboration.ts";
import { postInternalApi } from "./transport.ts";

vi.mock("./transport.ts", () => ({ postInternalApi: vi.fn() }));

const validMember = {
  id: "11111111-1111-4111-8111-111111111111",
  nickname: "Editor",
  deleted: false,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Broken",
  });
}

describe("collaboration authorization API", () => {
  beforeEach(() => {
    vi.mocked(postInternalApi)
      .mockReset()
      .mockResolvedValue(
        response({
          authorized: true,
          denialReason: "COLLABORATION_AUTHORIZATION_DENIAL_REASON_UNSPECIFIED",
          member: validMember,
          locale: "ko",
        }),
      );
  });

  it.each(
    Object.values(CollaborativeDocumentType).filter(
      (value): value is CollaborativeDocumentType =>
        typeof value === "number" && value !== 0,
    ),
  )(
    "maps document type %s to the authorization resource",
    async (documentType) => {
      await expect(
        authorizeCollaboration({
          sessionId: "session-1",
          documentType,
          resourceId: "resource-1",
          locale: "ko",
          permission: CollaborationPermission.EDIT,
        }),
      ).resolves.toMatchObject(validMember);
    },
  );

  it("forwards the requested VIEW or EDIT permission without a legacy default", async () => {
    await authorizeCollaboration({
      sessionId: "session-1",
      documentType: CollaborativeDocumentType.POST,
      resourceId: "post-1",
      locale: "ko",
      permission: CollaborationPermission.VIEW,
    });

    expect(postInternalApi).toHaveBeenCalledWith(
      "/api.intra.v1.InternalCollaborationAuthorizationService/AuthorizeCollaboration",
      expect.objectContaining({
        permission: "COLLABORATION_PERMISSION_VIEW",
        resource: expect.objectContaining({ locale: "ko" }),
      }),
    );
  });

  it("rejects unsupported resource types and failed HTTP responses", async () => {
    await expect(
      authorizeCollaboration({
        sessionId: "session-1",
        documentType: 999 as CollaborativeDocumentType,
        resourceId: "resource-1",
        locale: "ko",
        permission: CollaborationPermission.EDIT,
      }),
    ).rejects.toThrow("Unsupported collaboration resource type");
    vi.mocked(postInternalApi).mockResolvedValueOnce(response({}, 500));
    await expect(
      authorizeCollaboration({
        sessionId: "session-1",
        documentType: CollaborativeDocumentType.POST,
        resourceId: "post-1",
        locale: "ko",
        permission: CollaborationPermission.EDIT,
      }),
    ).rejects.toThrow("Failed to authorize collaboration: 500 Broken");
  });

  it("handles permission denial and invalid sessions explicitly", async () => {
    vi.mocked(postInternalApi).mockResolvedValueOnce(
      response({
        authorized: false,
        denialReason:
          "COLLABORATION_AUTHORIZATION_DENIAL_REASON_PERMISSION_DENIED",
      }),
    );
    await expect(
      authorizeCollaboration({
        sessionId: "session-1",
        documentType: CollaborativeDocumentType.POST,
        resourceId: "post-1",
        locale: "ko",
        permission: CollaborationPermission.EDIT,
      }),
    ).resolves.toBeNull();

    vi.mocked(postInternalApi).mockResolvedValueOnce(
      response({
        authorized: false,
        denialReason:
          "COLLABORATION_AUTHORIZATION_DENIAL_REASON_SESSION_INVALID",
      }),
    );
    await expect(
      authorizeCollaboration({
        sessionId: "session-1",
        documentType: CollaborativeDocumentType.POST,
        resourceId: "post-1",
        locale: "ko",
        permission: CollaborationPermission.EDIT,
      }),
    ).rejects.toBeInstanceOf(CollaborationSessionInvalidError);
  });

  it.each([
    { authorized: true, locale: "ko" },
    { authorized: false, member: validMember, locale: "ko" },
    { authorized: false, locale: "ko" },
    { authorized: true, member: { ...validMember, id: "bad" }, locale: "ko" },
    {
      authorized: true,
      member: { ...validMember, deleted: true },
      locale: "ko",
    },
    {
      authorized: true,
      member: { ...validMember, nickname: " " },
      locale: "ko",
    },
  ])("rejects malformed authorization response %#", async (body) => {
    vi.mocked(postInternalApi).mockResolvedValueOnce(response(body));
    await expect(
      authorizeCollaboration({
        sessionId: "session-1",
        documentType: CollaborativeDocumentType.POST,
        resourceId: "post-1",
        locale: "ko",
        permission: CollaborationPermission.EDIT,
      }),
    ).rejects.toThrow("Invalid collaboration authorization response");
  });

  it("rejects authorization for a different locale room", async () => {
    vi.mocked(postInternalApi).mockResolvedValueOnce(
      response({ authorized: true, member: validMember, locale: "en" }),
    );
    await expect(
      authorizeCollaboration({
        sessionId: "session-1",
        documentType: CollaborativeDocumentType.POST,
        resourceId: "post-1",
        locale: "ko",
        permission: CollaborationPermission.EDIT,
      }),
    ).rejects.toThrow("Invalid collaboration authorization locale");
  });

  it("rejects non-JSON response bodies", async () => {
    vi.mocked(postInternalApi).mockResolvedValueOnce(
      new Response("{", { status: 200 }),
    );
    await expect(
      authorizeCollaboration({
        sessionId: "session-1",
        documentType: CollaborativeDocumentType.POST,
        resourceId: "post-1",
        locale: "ko",
        permission: CollaborationPermission.EDIT,
      }),
    ).rejects.toThrow("Invalid collaboration authorization response");
  });
});
