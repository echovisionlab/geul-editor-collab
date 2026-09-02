import {
  getMapThemeVariantMapName,
  MAP_THEME_META_MAP_NAME,
  MAP_THEME_SETTINGS_MAP_NAME,
  type MapThemeDocumentSnapshot,
} from "@echovisionlab/geul-common/collaboration/map-theme";
import {
  CollaborativeDocumentType,
  createDocumentName,
  type DocumentHandler,
} from "@echovisionlab/geul-common/collaboration/document";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  loadMapThemeDocument,
  saveMapThemeDocument,
} from "../lib/api/map-theme.ts";
import {
  clearMapThemeTransientRevision as clearCanonicalMapThemeTransientRevision,
  mapThemeHandler as canonicalMapThemeHandler,
} from "./map-theme.ts";

vi.mock("../lib/api/map-theme.ts", () => ({
  saveMapThemeDocument: vi.fn(),
  loadMapThemeDocument: vi.fn(),
}));

const ids = new Map<string, string>();
function entityId(key: string): string {
  let value = ids.get(key);
  if (!value) {
    value = `20000000-0000-4000-8000-${String(ids.size + 1).padStart(12, "0")}`;
    ids.set(key, value);
  }
  return value;
}

function room(key: string): string {
  return createDocumentName(
    CollaborativeDocumentType.MAP_THEME,
    entityId(key),
    "und",
  );
}

const mapThemeHandler: DocumentHandler = {
  ...canonicalMapThemeHandler,
  load: (id) => canonicalMapThemeHandler.load(room(id)),
  store: (id, ...args) => canonicalMapThemeHandler.store(room(id), ...args),
};

function clearMapThemeTransientRevision(key: string): void {
  clearCanonicalMapThemeTransientRevision(room(key));
}

describe("mapThemeHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("materializes the required DB snapshot into transient Yjs maps", async () => {
    vi.mocked(loadMapThemeDocument).mockResolvedValue({
      snapshot: createSnapshot(),
      revision: 7n,
      locale: "und",
    });

    const state = await mapThemeHandler.load("theme-load");
    const doc = decode(state);

    expect(loadMapThemeDocument).toHaveBeenCalledWith({
      themeId: entityId("theme-load"),
      locale: "und",
    });
    expect(doc.getMap(MAP_THEME_META_MAP_NAME).toJSON()).toEqual({
      name: "Theme A",
    });
    expect(doc.getMap(MAP_THEME_SETTINGS_MAP_NAME).get("calloutFields")).toBe(
      '["name","address"]',
    );
    expect(
      doc.getMap(getMapThemeVariantMapName("light")).get("backgroundColor"),
    ).toBe("#ffffff");
    expect(
      doc.getMap(getMapThemeVariantMapName("dark")).get("backgroundColor"),
    ).toBe("#0b0b0b");
    expect(saveMapThemeDocument).not.toHaveBeenCalled();
  });

  it("saves one complete snapshot with the loaded revision and advances it", async () => {
    vi.mocked(loadMapThemeDocument).mockResolvedValue({
      snapshot: createSnapshot(),
      revision: 7n,
      locale: "und",
    });
    vi.mocked(saveMapThemeDocument)
      .mockResolvedValueOnce({ success: true, revision: 8n, locale: "und" })
      .mockResolvedValueOnce({ success: true, revision: 9n, locale: "und" });
    const doc = decode(await mapThemeHandler.load("theme-save"));
    doc.getMap(MAP_THEME_META_MAP_NAME).set("name", " Updated ");

    const options = { contributorMemberIds: [contributorMemberId] };
    await mapThemeHandler.store("theme-save", doc, options);
    await mapThemeHandler.store("theme-save", doc, options);

    expect(saveMapThemeDocument).toHaveBeenNthCalledWith(1, {
      themeId: entityId("theme-save"),
      locale: "und",
      snapshot: { ...createSnapshot(), name: "Updated" },
      expectedRevision: 7n,
      contributorMemberIds: [contributorMemberId],
    });
    expect(saveMapThemeDocument).toHaveBeenNthCalledWith(2, {
      themeId: entityId("theme-save"),
      locale: "und",
      snapshot: { ...createSnapshot(), name: "Updated" },
      expectedRevision: 8n,
      contributorMemberIds: [contributorMemberId],
    });
  });

  it("sends the accepted mutation contributor with every Map Theme save", async () => {
    vi.mocked(loadMapThemeDocument).mockResolvedValue({
      snapshot: createSnapshot(),
      revision: 7n,
      locale: "und",
    });
    vi.mocked(saveMapThemeDocument).mockResolvedValue({
      success: true,
      revision: 8n,
      locale: "und",
    });
    const doc = decode(await mapThemeHandler.load("theme-checkpoint"));
    await mapThemeHandler.store("theme-checkpoint", doc, {
      contributorMemberIds: [contributorMemberId],
    });

    expect(saveMapThemeDocument).toHaveBeenCalledWith({
      themeId: entityId("theme-checkpoint"),
      locale: "und",
      snapshot: createSnapshot(),
      expectedRevision: 7n,
      contributorMemberIds: [contributorMemberId],
    });
  });

  it("rejects missing or mixed mutation contributors", async () => {
    vi.mocked(loadMapThemeDocument).mockResolvedValue({
      snapshot: createSnapshot(),
      revision: 4n,
      locale: "und",
    });
    const doc = decode(
      await mapThemeHandler.load("theme-checkpoint-without-evidence"),
    );

    await expect(
      mapThemeHandler.store("theme-checkpoint-without-evidence", doc),
    ).rejects.toThrow("collaboration_mutation_actor_required");
    await expect(
      mapThemeHandler.store("theme-checkpoint-without-evidence", doc, {
        contributorMemberIds: [contributorMemberId, otherContributorMemberId],
      }),
    ).rejects.toThrow("collaboration_mutation_actor_mixed");
    expect(saveMapThemeDocument).not.toHaveBeenCalled();
  });

  it("rejects missing or invalid variants before calling the API", async () => {
    vi.mocked(loadMapThemeDocument).mockResolvedValue({
      snapshot: createSnapshot(),
      revision: 3n,
      locale: "und",
    });
    const missing = decode(await mapThemeHandler.load("theme-missing"));
    missing.getMap(getMapThemeVariantMapName("dark")).delete("backgroundColor");

    await expect(
      mapThemeHandler.store("theme-missing", missing),
    ).rejects.toThrow("invalid_map_theme_document");

    vi.mocked(loadMapThemeDocument).mockResolvedValue({
      snapshot: createSnapshot(),
      revision: 4n,
      locale: "und",
    });
    const invalid = decode(await mapThemeHandler.load("theme-invalid"));
    invalid
      .getMap(getMapThemeVariantMapName("light"))
      .set("roadColor", "var(--unsafe)");

    await expect(
      mapThemeHandler.store("theme-invalid", invalid),
    ).rejects.toThrow("invalid_map_theme_document");
    expect(saveMapThemeDocument).not.toHaveBeenCalled();
  });

  it("rejects store-before-load and a store after transient revision cleanup", async () => {
    const doc = materialize(createSnapshot());
    await expect(
      mapThemeHandler.store("theme-never-loaded", doc),
    ).rejects.toThrow("map_theme_document_not_loaded");

    vi.mocked(loadMapThemeDocument).mockResolvedValue({
      snapshot: createSnapshot(),
      revision: 2n,
      locale: "und",
    });
    await mapThemeHandler.load("theme-unloaded");
    clearMapThemeTransientRevision("theme-unloaded");
    await expect(mapThemeHandler.store("theme-unloaded", doc)).rejects.toThrow(
      "map_theme_document_not_loaded",
    );
    expect(saveMapThemeDocument).not.toHaveBeenCalled();
  });

  it("rejects invalid load snapshots and non-positive revisions", async () => {
    vi.mocked(loadMapThemeDocument).mockResolvedValueOnce({
      snapshot: { ...createSnapshot(), darkVariant: undefined } as never,
      revision: 1n,
      locale: "und",
    });
    await expect(mapThemeHandler.load("theme-invalid-load")).rejects.toThrow(
      "invalid_map_theme_document",
    );

    vi.mocked(loadMapThemeDocument).mockResolvedValueOnce({
      snapshot: createSnapshot(),
      revision: 0n,
      locale: "und",
    });
    await expect(
      mapThemeHandler.load("theme-invalid-revision"),
    ).rejects.toThrow("invalid_map_theme_load_revision");
  });

  it.each([
    { success: false, revision: 8n, locale: "und" },
    { success: true, revision: 7n, locale: "und" },
  ])("rejects a save response that does not advance CAS", async (response) => {
    vi.mocked(loadMapThemeDocument).mockResolvedValue({
      snapshot: createSnapshot(),
      revision: 7n,
      locale: "und",
    });
    vi.mocked(saveMapThemeDocument).mockResolvedValue(response);
    const doc = decode(
      await mapThemeHandler.load(`theme-save-${String(response.success)}`),
    );

    await expect(
      mapThemeHandler.store(`theme-save-${String(response.success)}`, doc, {
        contributorMemberIds: [contributorMemberId],
      }),
    ).rejects.toThrow("invalid_map_theme_save_response");
  });

  it("accepts already-decoded callout fields and rejects malformed serialized fields", async () => {
    vi.mocked(loadMapThemeDocument).mockResolvedValue({
      snapshot: createSnapshot(),
      revision: 7n,
      locale: "und",
    });
    vi.mocked(saveMapThemeDocument).mockResolvedValue({
      success: true,
      revision: 8n,
      locale: "und",
    });
    const decoded = decode(await mapThemeHandler.load("theme-decoded-fields"));
    decoded.getMap(MAP_THEME_SETTINGS_MAP_NAME).set("calloutFields", ["name"]);
    await expect(
      mapThemeHandler.store("theme-decoded-fields", decoded, {
        contributorMemberIds: [contributorMemberId],
      }),
    ).resolves.toBeUndefined();

    vi.mocked(loadMapThemeDocument).mockResolvedValue({
      snapshot: createSnapshot(),
      revision: 7n,
      locale: "und",
    });
    const malformed = decode(
      await mapThemeHandler.load("theme-malformed-fields"),
    );
    malformed
      .getMap(MAP_THEME_SETTINGS_MAP_NAME)
      .set("calloutFields", "{bad json");
    await expect(
      mapThemeHandler.store("theme-malformed-fields", malformed),
    ).rejects.toThrow("invalid_map_theme_document");
  });

  it("rejects bare IDs and non-und Map Theme room identities", async () => {
    await expect(
      canonicalMapThemeHandler.load(entityId("bare")),
    ).rejects.toThrow("Invalid document name format");
    expect(() =>
      createDocumentName(
        CollaborativeDocumentType.MAP_THEME,
        entityId("wrong-locale"),
        "en",
      ),
    ).toThrow("locale-neutral und room");
    await expect(
      canonicalMapThemeHandler.load(
        createDocumentName(
          CollaborativeDocumentType.POST,
          entityId("wrong-type"),
          "en",
        ),
      ),
    ).rejects.toThrow("collaboration_document_type_mismatch");
  });

  it("rejects Map Theme load and save acknowledgements outside und", async () => {
    vi.mocked(loadMapThemeDocument)
      .mockResolvedValueOnce({
        snapshot: createSnapshot(),
        revision: 7n,
        locale: "en",
      })
      .mockResolvedValueOnce({
        snapshot: createSnapshot(),
        revision: 7n,
        locale: "und",
      });

    await expect(mapThemeHandler.load("load-locale-mismatch")).rejects.toThrow(
      "response locale mismatch",
    );
    const document = decode(await mapThemeHandler.load("save-locale-mismatch"));
    vi.mocked(saveMapThemeDocument).mockResolvedValueOnce({
      success: true,
      revision: 8n,
      locale: "en",
    });
    await expect(
      mapThemeHandler.store("save-locale-mismatch", document, {
        contributorMemberIds: [contributorMemberId],
      }),
    ).rejects.toThrow("response locale mismatch");
  });
});

const contributorMemberId = "550e8400-e29b-41d4-a716-446655440001";
const otherContributorMemberId = "550e8400-e29b-41d4-a716-446655440002";

function decode(state: Buffer | null): Y.Doc {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(state ?? new Uint8Array()));
  return doc;
}

function materialize(snapshot: MapThemeDocumentSnapshot): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap(MAP_THEME_META_MAP_NAME).set("name", snapshot.name);
  const settings = doc.getMap(MAP_THEME_SETTINGS_MAP_NAME);
  for (const [key, value] of Object.entries(snapshot.settings)) {
    settings.set(key, key === "calloutFields" ? JSON.stringify(value) : value);
  }
  for (const [scheme, variant] of [
    ["light", snapshot.lightVariant],
    ["dark", snapshot.darkVariant],
  ] as const) {
    const map = doc.getMap(getMapThemeVariantMapName(scheme));
    for (const [key, value] of Object.entries(variant)) {
      map.set(key, value);
    }
  }
  return doc;
}

function createSnapshot(): MapThemeDocumentSnapshot {
  const light = {
    backgroundColor: "#ffffff",
    waterColor: "#a0c4e8",
    landColor: "#e8e8e8",
    roadColor: "rgba(255,255,255,0.8)",
    buildingFillColor: "rgba(221,221,221,0.7)",
    buildingStrokeEnabled: false,
    buildingStrokeColor: "rgba(204,204,204,0.5)",
    calloutLineColor: "rgba(59,130,246,0.88)",
    calloutHoverLineColor: "#1d4ed8",
    calloutTextColor: "#1f2937",
    calloutHoverTextColor: "#111827",
    calloutDescriptionColor: "rgba(107,114,128,0.8)",
    calloutHoverDescriptionColor: "rgba(31,41,55,0.92)",
    calloutBackgroundColor: "rgba(255,255,255,0.56)",
    calloutHoverBackgroundColor: "rgba(255,255,255,0.98)",
    attributionColor: "rgba(0,0,0,0.55)",
    labelTextColor: "rgba(51,65,85,0.82)",
    clusterColor: "rgba(15,23,42,0.08)",
    clusterHoverColor: "rgba(15,23,42,0.14)",
    clusterTextColor: "rgba(15,23,42,0.9)",
    clusterTextHoverColor: "rgba(15,23,42,1)",
  };
  return {
    name: "Theme A",
    settings: {
      calloutScale: 1,
      calloutOffsetX: 2,
      calloutOffsetY: -3,
      calloutFields: ["name", "address"],
      attributionFontSize: 11,
      showAreaLabels: true,
      showPoiLabels: false,
    },
    lightVariant: light,
    darkVariant: {
      ...light,
      backgroundColor: "#0b0b0b",
      waterColor: "#000000",
      landColor: "#252540",
      roadColor: "rgba(154,151,151,0.8)",
      buildingFillColor: "rgba(61,61,92,0.7)",
      buildingStrokeColor: "rgba(74,74,106,0.5)",
      calloutLineColor: "#b02d23",
      calloutHoverLineColor: "#b02d23",
      calloutTextColor: "#ffffff",
      calloutHoverTextColor: "#ffffff",
      calloutDescriptionColor: "rgba(255,255,255,0.8)",
      calloutHoverDescriptionColor: "#ffffff",
      calloutBackgroundColor: "rgba(176,45,35,0.84)",
      calloutHoverBackgroundColor: "#b02d23",
      attributionColor: "#ffffff",
      labelTextColor: "#ffffff",
      clusterColor: "rgba(176,45,35,0.84)",
      clusterHoverColor: "#b02d23",
      clusterTextColor: "#ffffff",
      clusterTextHoverColor: "#ffffff",
    },
  };
}
