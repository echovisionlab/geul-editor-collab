import { afterEach, describe, expect, it, vi } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import {
  CollaborationConflictDetailSchema,
  CollaborationConflictReason,
  CollaborationMutationRejectionDetailSchema,
  CollaborationMutationRejectionReason,
} from "@echovisionlab/geul-proto/intra/collaboration_pb.ts";

const mocks = vi.hoisted(() => ({
  injectCorrelation: vi.fn(),
  env: {
    API_URL: "http://api.internal",
    TOKEN_SIGNING_SECRET: "internal-secret",
  },
}));

vi.mock("../../env.ts", () => ({ env: mocks.env }));
vi.mock("@echovisionlab/geul-telemetry", () => ({
  injectCorrelation: mocks.injectCorrelation,
}));

import {
  CollaborationConflictError,
  CollaborationMutationRejectionError,
  postInternalApi,
} from "./transport.ts";

describe("internal API transport correlation", () => {
  afterEach(() => {
    mocks.injectCorrelation.mockReset();
    vi.unstubAllGlobals();
  });

  it("forwards only the active request and W3C correlation supplied by telemetry", async () => {
    mocks.injectCorrelation.mockImplementation((carrier, setter) => {
      setter.set(
        carrier,
        "X-Request-ID",
        "018f47a2-8a3d-4e17-9d42-6f12c89b1234",
      );
      setter.set(
        carrier,
        "traceparent",
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      );
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await postInternalApi("/internal", { value: true });

    expect(fetchMock).toHaveBeenCalledWith("http://api.internal/internal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service": "internal-secret",
        "X-Request-ID": "018f47a2-8a3d-4e17-9d42-6f12c89b1234",
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      },
      body: JSON.stringify({ value: true }),
      signal: undefined,
    });
  });

  it("does not invent a request ID when telemetry has no active request context", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await postInternalApi("/background", { value: true });

    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service": "internal-secret",
      },
    });
    expect(
      (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)[
        "X-Request-ID"
      ],
    ).toBeUndefined();
  });

  it("turns only the typed collaboration detail into a bounded conflict", async () => {
    const detail = create(CollaborationConflictDetailSchema, {
      reason: CollaborationConflictReason.TARGET_REVISION_CHANGED,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        {
          code: "failed_precondition",
          message: "diagnostic text is not an API",
          details: [
            {
              type: "api.intra.v1.CollaborationConflictDetail",
              value: Buffer.from(
                toBinary(CollaborationConflictDetailSchema, detail),
              ).toString("base64"),
            },
          ],
        },
        { status: 400 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(postInternalApi("/conflict", {})).rejects.toEqual(
      expect.objectContaining<Partial<CollaborationConflictError>>({
        name: "CollaborationConflictError",
        reason: "target_revision_changed",
      }),
    );
  });

  it("turns an exact typed target mutation rejection into a bounded error", async () => {
    const detail = create(CollaborationMutationRejectionDetailSchema, {
      reason:
        CollaborationMutationRejectionReason.NON_SOURCE_FILE_RELATION_FORBIDDEN,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "invalid_argument",
            details: [
              {
                type: "api.intra.v1.CollaborationMutationRejectionDetail",
                value: Buffer.from(
                  toBinary(CollaborationMutationRejectionDetailSchema, detail),
                ).toString("base64"),
              },
            ],
          },
          { status: 400 },
        ),
      ),
    );

    await expect(postInternalApi("/mutation-rejection", {})).rejects.toEqual(
      expect.objectContaining<Partial<CollaborationMutationRejectionError>>({
        name: "CollaborationMutationRejectionError",
        reason: "non_source_file_relation_forbidden",
      }),
    );
  });

  it("leaves an untyped failed precondition to the owning caller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "failed_precondition",
            message: "file is pending deletion",
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      postInternalApi("/ordinary-precondition", {}),
    ).resolves.toMatchObject({
      status: 400,
    });
  });

  it.each([
    ["non-conflict status", new Response(null, { status: 409 })],
    ["invalid JSON", new Response("{", { status: 400 })],
    [
      "wrong code",
      Response.json({ code: "invalid_argument", details: [] }, { status: 400 }),
    ],
    [
      "non-array details",
      Response.json(
        { code: "failed_precondition", details: {} },
        { status: 400 },
      ),
    ],
    [
      "primitive detail",
      Response.json(
        { code: "failed_precondition", details: [null] },
        { status: 400 },
      ),
    ],
    [
      "wrong detail shape",
      Response.json(
        { code: "failed_precondition", details: [{}] },
        { status: 400 },
      ),
    ],
    [
      "wrong detail type",
      Response.json(
        {
          code: "failed_precondition",
          details: [{ type: "other.Detail", value: "" }],
        },
        { status: 400 },
      ),
    ],
  ])(
    "does not promote %s into a collaboration conflict",
    async (_name, response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(postInternalApi("/not-collaboration", {})).resolves.toBe(
        response,
      );
    },
  );

  it("skips unrelated details before decoding the typed collaboration detail", async () => {
    const detail = create(CollaborationConflictDetailSchema, {
      reason: CollaborationConflictReason.LOCALE_OWNERSHIP_CHANGED,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "failed_precondition",
            details: [
              { type: "other.Detail", value: "" },
              {
                type: "api.intra.v1.CollaborationConflictDetail",
                value: Buffer.from(
                  toBinary(CollaborationConflictDetailSchema, detail),
                ).toString("base64"),
              },
            ],
          },
          { status: 400 },
        ),
      ),
    );

    await expect(postInternalApi("/typed-conflict", {})).rejects.toMatchObject({
      reason: "locale_ownership_changed",
    });
  });

  it("ignores malformed and unspecified mutation rejection details", async () => {
    const unspecified = create(CollaborationMutationRejectionDetailSchema, {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "invalid_argument",
            details: [
              null,
              {},
              {
                type: "api.intra.v1.CollaborationMutationRejectionDetail",
                value: 1,
              },
              { type: "other.Detail", value: "" },
              {
                type: "api.intra.v1.CollaborationMutationRejectionDetail",
                value: Buffer.from(
                  toBinary(
                    CollaborationMutationRejectionDetailSchema,
                    unspecified,
                  ),
                ).toString("base64"),
              },
            ],
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      postInternalApi("/unspecified-rejection", {}),
    ).resolves.toMatchObject({ status: 400 });
  });
});
