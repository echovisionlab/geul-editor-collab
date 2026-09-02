import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import {
  loadMapThemeDocument,
  MapThemeRevisionConflictError,
  saveMapThemeDocument,
  type MapThemeDocumentSnapshot,
} from "./api-client.ts";
import { CollaborationResourceNotFoundError } from "./api/transport.ts";

const fetchMock = vi.fn<typeof fetch>();

describe("Map Theme collaboration API client", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends only the typed snapshot and expected revision, then returns the accepted revision", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, revision: "8", locale: "und" }),
    );

    await expect(
      saveMapThemeDocument({
        themeId: "theme-1",
        locale: "und",
        snapshot: createSnapshot(),
        expectedRevision: 7n,
      }),
    ).resolves.toEqual({ success: true, revision: 8n, locale: "und" });

    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      themeId: "theme-1",
      locale: "und",
      snapshot: {
        name: "Theme",
        settings: {
          calloutScale: 1,
          calloutOffsetX: 2,
          calloutOffsetY: 3,
          calloutFields: ["name"],
          attributionFontSize: 11,
          showAreaLabels: true,
        },
        lightVariant: createSnapshot().lightVariant,
        darkVariant: createSnapshot().darkVariant,
      },
      expectedRevision: "7",
    });
    expect(body).not.toHaveProperty("yjsState");
    expect(body).not.toHaveProperty("meta");
  });

  it("loads one required typed snapshot and revision", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        snapshot: createSnapshot(),
        revision: "11",
        locale: "und",
      }),
    );

    await expect(
      loadMapThemeDocument({ themeId: "theme-1", locale: "und" }),
    ).resolves.toEqual({
      snapshot: createSnapshot(),
      revision: 11n,
      locale: "und",
    });
  });

  it("serializes the mutation contributor without a checkpoint payload", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, revision: "8", locale: "und" }),
    );

    await saveMapThemeDocument({
      themeId: "theme-checkpoint",
      locale: "und",
      snapshot: createSnapshot(),
      expectedRevision: 7n,
      contributorMemberIds: ["550e8400-e29b-41d4-a716-446655440001"],
    });

    const body = JSON.parse(
      String(fetchMock.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      contributorMemberIds: ["550e8400-e29b-41d4-a716-446655440001"],
    });
    expect(body).not.toHaveProperty("sourceRevisionCheckpoint");
    expect(body).not.toHaveProperty("attributes");
  });

  it("distinguishes Connect Aborted from other transport failures", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "aborted", message: "revision conflict" }, 409),
    );
    await expect(
      saveMapThemeDocument({
        themeId: "theme-1",
        locale: "und",
        snapshot: createSnapshot(),
        expectedRevision: 7n,
      }),
    ).rejects.toBeInstanceOf(MapThemeRevisionConflictError);

    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "already_exists" }, 409),
    );
    await expect(
      saveMapThemeDocument({
        themeId: "theme-1",
        locale: "und",
        snapshot: createSnapshot(),
        expectedRevision: 7n,
      }),
    ).rejects.toThrow("Failed to save map theme document: 409 Conflict");

    fetchMock.mockResolvedValueOnce(
      new Response("not-json", { status: 409, statusText: "Conflict" }),
    );
    await expect(
      saveMapThemeDocument({
        themeId: "theme-1",
        locale: "und",
        snapshot: createSnapshot(),
        expectedRevision: 7n,
      }),
    ).rejects.toThrow("Failed to save map theme document: 409 Conflict");
  });

  it("classifies a deleted Theme save as terminal not-found", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 404, statusText: "Not Found" }),
    );

    const outcome = saveMapThemeDocument({
      themeId: "theme-deleted",
      locale: "und",
      snapshot: createSnapshot(),
      expectedRevision: 7n,
    });
    await expect(outcome).rejects.toBeInstanceOf(
      CollaborationResourceNotFoundError,
    );
    await expect(outcome).rejects.toMatchObject({
      documentType: CollaborativeDocumentType.MAP_THEME,
      resourceId: "theme-deleted",
    });
  });

  it("rejects a response missing either required variant", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        snapshot: { ...createSnapshot(), darkVariant: undefined },
        revision: "1",
        locale: "und",
      }),
    );
    await expect(
      loadMapThemeDocument({ themeId: "theme-1", locale: "und" }),
    ).rejects.toThrow("Invalid map theme document response");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        snapshot: { ...createSnapshot(), name: "" },
        revision: "1",
        locale: "und",
      }),
    );
    await expect(
      loadMapThemeDocument({ themeId: "theme-1", locale: "und" }),
    ).rejects.toThrow("Invalid map theme document response");
  });

  it("rejects a failed map theme load response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("", { status: 503, statusText: "Unavailable" }),
    );
    await expect(
      loadMapThemeDocument({ themeId: "theme-1", locale: "und" }),
    ).rejects.toThrow("Failed to load map theme document: 503 Unavailable");
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    statusText: status === 200 ? "OK" : "Conflict",
    headers: { "Content-Type": "application/json" },
  });
}

function createSnapshot(): MapThemeDocumentSnapshot {
  const variant = {
    backgroundColor: "#000000",
    waterColor: "#000001",
    landColor: "#000002",
    roadColor: "#000003",
    buildingFillColor: "#000004",
    buildingStrokeEnabled: true,
    buildingStrokeColor: "#000005",
    calloutLineColor: "#000006",
    calloutHoverLineColor: "#000007",
    calloutTextColor: "#000008",
    calloutHoverTextColor: "#000009",
    calloutDescriptionColor: "#00000a",
    calloutHoverDescriptionColor: "#00000b",
    calloutBackgroundColor: "#00000c",
    calloutHoverBackgroundColor: "#00000d",
    attributionColor: "#00000e",
    labelTextColor: "#00000f",
    clusterColor: "#000010",
    clusterHoverColor: "#000011",
    clusterTextColor: "#000012",
    clusterTextHoverColor: "#000013",
  };
  return {
    name: "Theme",
    settings: {
      calloutScale: 1,
      calloutOffsetX: 2,
      calloutOffsetY: 3,
      calloutFields: ["name"],
      attributionFontSize: 11,
      showAreaLabels: true,
      showPoiLabels: false,
    },
    lightVariant: variant,
    darkVariant: variant,
  };
}
