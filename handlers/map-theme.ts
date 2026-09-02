import {
  CollaborativeDocumentType,
  type DocumentHandler,
} from "@echovisionlab/geul-common/collaboration/document";
import {
  getMapThemeVariantMapName,
  MAP_THEME_META_MAP_NAME,
  MAP_THEME_SETTINGS_MAP_NAME,
  MapThemeDocumentSnapshotSchema,
  MapThemeDocumentVariantSchema,
  type MapThemeDocumentSnapshot,
  type MapThemeDocumentVariant,
} from "@echovisionlab/geul-common/collaboration/map-theme";
import * as Y from "yjs";
import {
  loadMapThemeDocument,
  saveMapThemeDocument,
} from "../lib/api/map-theme.ts";
import { TransientDocumentStateMap } from "../lib/transient-document-state.ts";
import { handlerDocumentIdentity } from "../lib/collaboration/handler-document-identity.ts";
import { requireSaveContributorMemberIds } from "../lib/collaboration/mutation-contributors.ts";

const loadedRevisionByThemeId = new TransientDocumentStateMap<bigint>();

class InvalidMapThemeDocumentError extends Error {
  constructor() {
    super("invalid_map_theme_document");
    this.name = "InvalidMapThemeDocumentError";
  }
}

export function clearMapThemeTransientRevision(documentName: string): void {
  const identity = handlerDocumentIdentity(
    documentName,
    CollaborativeDocumentType.MAP_THEME,
  );
  loadedRevisionByThemeId.delete(identity.stateKey);
}

export const mapThemeHandler: DocumentHandler = {
  supportsVersionCheckpoints: false,

  async store(id, document, options = {}) {
    const identity = handlerDocumentIdentity(
      id,
      CollaborativeDocumentType.MAP_THEME,
    );
    const expectedRevision = loadedRevisionByThemeId.get(identity.stateKey);
    if (expectedRevision === undefined || expectedRevision <= 0n) {
      throw new Error("map_theme_document_not_loaded");
    }

    const snapshot = extractMapThemeSnapshot(document as Y.Doc);
    const response = await saveMapThemeDocument({
      themeId: identity.entityId,
      locale: "und",
      snapshot,
      expectedRevision,
      contributorMemberIds: requireSaveContributorMemberIds({
        contributorMemberIds: options.contributorMemberIds,
        versionCheckpoint: false,
      }),
    });
    if (!response.success || response.revision <= expectedRevision) {
      throw new Error("invalid_map_theme_save_response");
    }
    if (response.locale !== "und") {
      throw new Error("Map Theme collaboration response locale mismatch");
    }
    loadedRevisionByThemeId.set(identity.stateKey, response.revision);
  },

  async load(id) {
    const identity = handlerDocumentIdentity(
      id,
      CollaborativeDocumentType.MAP_THEME,
    );
    const response = await loadMapThemeDocument({
      themeId: identity.entityId,
      locale: "und",
    });
    if (response.locale !== "und") {
      throw new Error("Map Theme collaboration response locale mismatch");
    }
    const snapshot = parseSnapshot(response.snapshot);
    if (response.revision <= 0n) {
      throw new Error("invalid_map_theme_load_revision");
    }

    const state = materializeMapThemeState(snapshot);
    loadedRevisionByThemeId.set(identity.stateKey, response.revision);
    return state;
  },
};

function materializeMapThemeState(snapshot: MapThemeDocumentSnapshot): Buffer {
  const doc = new Y.Doc();
  const metaMap = doc.getMap(MAP_THEME_META_MAP_NAME);
  const settingsMap = doc.getMap(MAP_THEME_SETTINGS_MAP_NAME);
  metaMap.set("name", snapshot.name);

  settingsMap.set("calloutScale", snapshot.settings.calloutScale);
  settingsMap.set("calloutOffsetX", snapshot.settings.calloutOffsetX);
  settingsMap.set("calloutOffsetY", snapshot.settings.calloutOffsetY);
  settingsMap.set(
    "calloutFields",
    JSON.stringify(snapshot.settings.calloutFields),
  );
  settingsMap.set("attributionFontSize", snapshot.settings.attributionFontSize);
  settingsMap.set("showAreaLabels", snapshot.settings.showAreaLabels);
  settingsMap.set("showPoiLabels", snapshot.settings.showPoiLabels);

  writeVariant(
    doc.getMap(getMapThemeVariantMapName("light")),
    snapshot.lightVariant,
  );
  writeVariant(
    doc.getMap(getMapThemeVariantMapName("dark")),
    snapshot.darkVariant,
  );
  return Buffer.from(Y.encodeStateAsUpdate(doc));
}

function writeVariant(
  map: Y.Map<unknown>,
  variant: MapThemeDocumentVariant,
): void {
  for (const [key, value] of Object.entries(variant)) {
    map.set(key, value);
  }
}

function extractMapThemeSnapshot(doc: Y.Doc): MapThemeDocumentSnapshot {
  const metaMap = doc.getMap(MAP_THEME_META_MAP_NAME);
  const settingsMap = doc.getMap(MAP_THEME_SETTINGS_MAP_NAME);
  return parseSnapshot({
    name: metaMap.get("name"),
    settings: {
      calloutScale: settingsMap.get("calloutScale"),
      calloutOffsetX: settingsMap.get("calloutOffsetX"),
      calloutOffsetY: settingsMap.get("calloutOffsetY"),
      calloutFields: parseJsonValue(settingsMap.get("calloutFields")),
      attributionFontSize: settingsMap.get("attributionFontSize"),
      showAreaLabels: settingsMap.get("showAreaLabels"),
      showPoiLabels: settingsMap.get("showPoiLabels"),
    },
    lightVariant: extractVariant(
      doc.getMap(getMapThemeVariantMapName("light")),
    ),
    darkVariant: extractVariant(doc.getMap(getMapThemeVariantMapName("dark"))),
  });
}

function parseSnapshot(value: unknown): MapThemeDocumentSnapshot {
  const result = MapThemeDocumentSnapshotSchema.safeParse(value);
  if (!result.success) {
    throw new InvalidMapThemeDocumentError();
  }
  return result.data;
}

function extractVariant(
  map: Y.Map<unknown>,
): MapThemeDocumentVariant | undefined {
  const result = MapThemeDocumentVariantSchema.safeParse({
    backgroundColor: map.get("backgroundColor"),
    waterColor: map.get("waterColor"),
    landColor: map.get("landColor"),
    roadColor: map.get("roadColor"),
    buildingFillColor: map.get("buildingFillColor"),
    buildingStrokeEnabled: map.get("buildingStrokeEnabled"),
    buildingStrokeColor: map.get("buildingStrokeColor"),
    calloutLineColor: map.get("calloutLineColor"),
    calloutHoverLineColor: map.get("calloutHoverLineColor"),
    calloutTextColor: map.get("calloutTextColor"),
    calloutHoverTextColor: map.get("calloutHoverTextColor"),
    calloutDescriptionColor: map.get("calloutDescriptionColor"),
    calloutHoverDescriptionColor: map.get("calloutHoverDescriptionColor"),
    calloutBackgroundColor: map.get("calloutBackgroundColor"),
    calloutHoverBackgroundColor: map.get("calloutHoverBackgroundColor"),
    attributionColor: map.get("attributionColor"),
    labelTextColor: map.get("labelTextColor"),
    clusterColor: map.get("clusterColor"),
    clusterHoverColor: map.get("clusterHoverColor"),
    clusterTextColor: map.get("clusterTextColor"),
    clusterTextHoverColor: map.get("clusterTextHoverColor"),
  });
  return result.success ? result.data : undefined;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
