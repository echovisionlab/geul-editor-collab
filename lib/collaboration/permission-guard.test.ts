import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { CollaborationPermission } from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";
import { describe, expect, it, vi } from "vitest";
import {
  CollaborationPermissionGuard,
  CollaborationPermissionRevokedError,
  type CollaborationPermissionContext,
} from "./permission-guard.ts";
import type { AuthorizedCollaborationMember } from "../api-client.ts";

const memberId = "22222222-2222-4222-8222-222222222222";
const session = "33333333-3333-4333-8333-333333333333";

function member(id = memberId): AuthorizedCollaborationMember {
  return {
    id,
    nickname: "Editor",
    deleted: false,
  } as AuthorizedCollaborationMember;
}

function context(
  overrides: Partial<CollaborationPermissionContext> = {},
): CollaborationPermissionContext {
  return {
    member: member(),
    sessionId: session,
    documentType: CollaborativeDocumentType.POST,
    resourceId: "post-1",
    locale: "en",
    ...overrides,
  };
}

describe("CollaborationPermissionGuard", () => {
  it("uses the API-returned canonical Member for a fresh connection check", async () => {
    const current = member();
    const authorize = vi.fn(async () => current);
    const guard = new CollaborationPermissionGuard(authorize);

    await expect(guard.authorizeFrame(context())).resolves.toBe(current);
    expect(authorize).toHaveBeenCalledWith({
      sessionId: session,
      documentType: CollaborativeDocumentType.POST,
      resourceId: "post-1",
      locale: "en",
      permission: CollaborationPermission.EDIT,
    });
  });

  it("rechecks EDIT for editors and VIEW for read-only viewers", async () => {
    const authorize = vi.fn(async () => member());
    const guard = new CollaborationPermissionGuard(authorize);

    await expect(
      guard.authorizeFrame(context({ canEdit: true })),
    ).resolves.toEqual(member());
    await expect(
      guard.authorizeFrame(context({ canEdit: false })),
    ).resolves.toEqual(member());

    expect(authorize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        permission: CollaborationPermission.EDIT,
      }),
    );
    expect(authorize).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        permission: CollaborationPermission.VIEW,
      }),
    );
  });

  it("classifies denied, missing, and mismatched canonical actors as revoked", async () => {
    const denied = new CollaborationPermissionGuard(vi.fn(async () => null));
    await expect(denied.authorizeFrame(context())).rejects.toBeInstanceOf(
      CollaborationPermissionRevokedError,
    );

    const mismatched = new CollaborationPermissionGuard(
      vi.fn(async () => member("33333333-3333-4333-8333-333333333333")),
    );
    await expect(mismatched.authorizeFrame(context())).rejects.toBeInstanceOf(
      CollaborationPermissionRevokedError,
    );
    await expect(mismatched.authorizeFrame({})).rejects.toBeInstanceOf(
      CollaborationPermissionRevokedError,
    );
  });

  it("propagates an authorization service error without labeling it as a revoke", async () => {
    const unavailable = new Error("authorization unavailable");
    const authorize = vi.fn(async () => {
      throw unavailable;
    });
    const guard = new CollaborationPermissionGuard(authorize);

    await expect(guard.authorizeFrame(context())).rejects.toBe(unavailable);
    await expect(
      guard.authorizeFrame(context({ member: undefined })),
    ).rejects.toBeInstanceOf(CollaborationPermissionRevokedError);
  });
});
