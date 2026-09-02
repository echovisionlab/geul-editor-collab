import { attribute, containerStyle, escapeText } from "./html-attributes.ts";

export function renderMap(
  attributes: Record<string, unknown> | undefined,
): string {
  const props = attributes ?? {};
  const mapPlaceIds = mapPlaceIdsFromProps(props);
  const legacyLocation = stringProp(props.location);
  const caption = stringProp(props.caption);
  const alignment = props.textAlignment ?? "left";
  const mapAttributes = renderMapAttributes(props, mapPlaceIds, caption);
  const map = `<div class="map-block"${attribute("data-block-alignment", alignment)}${caption ? "" : containerStyle(props)}${mapAttributes}${legacyLocation ? attribute("data-location", legacyLocation) : ""}>${renderMapBody(mapPlaceIds, legacyLocation)}</div>`;
  return caption
    ? wrapCaptionedMap(map, props, mapPlaceIds, alignment, caption)
    : map;
}

function mapPlaceIdsFromProps(props: Record<string, unknown>): string {
  return String(props.mapPlaceIds || props.mapPlaceId || "");
}

function renderMapAttributes(
  props: Record<string, unknown>,
  mapPlaceIds: string,
  caption: string,
): string {
  return [
    ["data-map-place-ids", mapPlaceIds],
    ["data-aspect-ratio", props.aspectRatio],
    ["data-preview-width", props.previewWidth || ""],
    ["data-zoom", props.zoom],
    ["data-show-directions", props.showDirections],
    ["data-draggable", props.draggable],
    ["data-zoomable", props.zoomable],
    ["data-rotatable", props.rotatable],
    ["data-tiltable", props.tiltable],
    ["data-pin-clickable", props.pinClickable],
    ["data-center-lat", props.centerLat],
    ["data-center-lng", props.centerLng],
    ["data-pitch", props.pitch],
    ["data-bearing", props.bearing],
    ["data-show-3d-buildings", props.show3DBuildings],
    ["data-auto-rotate", props.autoRotate],
    ["data-auto-rotate-speed", props.autoRotateSpeed],
    ["data-theme-id", props.themeId],
    ["data-preferred-scheme", props.preferredScheme],
    ["data-area-labels-mode", props.areaLabelsMode],
    ["data-poi-labels-mode", props.poiLabelsMode],
    ["data-caption", caption || undefined],
  ]
    .map(([name, value]) => attribute(String(name), value))
    .join("");
}

function renderMapBody(mapPlaceIds: string, legacyLocation: string): string {
  if (mapPlaceIds) {
    const count = mapPlaceIds.split(",").filter((id) => id.trim()).length;
    return `<p class="map-block__placeholder">[Map: ${count} place${count === 1 ? "" : "s"}]</p>`;
  }
  return legacyLocation ? renderLegacyMapLocation(legacyLocation) : "";
}

function wrapCaptionedMap(
  map: string,
  props: Record<string, unknown>,
  mapPlaceIds: string,
  alignment: unknown,
  caption: string,
): string {
  return `<figure class="map-block-figure"${containerStyle(props)}${attribute("data-map-place-ids", mapPlaceIds)}${attribute("data-preview-width", props.previewWidth)}${attribute("data-text-alignment", alignment)}${attribute("data-caption", caption)}>${map}<figcaption>${escapeText(caption)}</figcaption></figure>`;
}

function renderLegacyMapLocation(value: string): string {
  try {
    const location = JSON.parse(value) as Record<string, unknown>;
    const name =
      typeof location.name === "string"
        ? `<p class="map-block__name">${escapeText(location.name)}</p>`
        : "";
    const address =
      typeof location.address === "string"
        ? `<p class="map-block__address">${escapeText(location.address)}</p>`
        : "";
    const latitude = typeof location.lat === "number" ? location.lat : 0;
    const longitude = typeof location.lng === "number" ? location.lng : 0;
    const mapsUrl = location.placeId
      ? `https://www.google.com/maps/place/?q=place_id:${String(location.placeId)}`
      : `https://www.google.com/maps?q=${latitude},${longitude}`;
    return `${name}${address}<p class="map-block__coords"><a${attribute("href", mapsUrl)} target="_blank" rel="noopener noreferrer">View on Google Maps (${latitude.toFixed(6)}, ${longitude.toFixed(6)})</a></p>`;
  } catch {
    return "";
  }
}

function stringProp(value: unknown): string {
  return typeof value === "string" ? value : "";
}
