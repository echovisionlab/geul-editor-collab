import {
  externalVideoLinkLayoutPropSchema,
  fileBlockPropSchema,
} from "@echovisionlab/geul-common/media/block-schemas";

export type GeulRichTextSchema = "bio" | "editor" | "email" | "page" | "post";

export interface ProseMirrorJsonMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ProseMirrorJsonNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorJsonNode[];
  marks?: ProseMirrorJsonMark[];
  text?: string;
}

const DEFAULT_TEXT_BLOCK_PROPS = {
  backgroundColor: { default: "default" },
  textColor: { default: "default" },
  textAlignment: { default: "left" },
} as const;
const QUOTE_PROPS = {
  backgroundColor: { default: "default" },
  textColor: { default: "default" },
} as const;
const CALLOUT_PROPS = {
  icon: { default: "💡" },
  backgroundColor: { default: "gray" },
  textColor: { default: "default" },
} as const;
const MAP_PROPS = {
  mapPlaceIds: { default: "" },
  mapPlaceId: { default: "" },
  location: { default: "" },
  aspectRatio: { default: "16:9" },
  previewWidth: { default: "" },
  textAlignment: { default: "left" },
  zoom: { default: "15" },
  minZoom: { default: "-2" },
  maxZoom: { default: "22" },
  url: { default: "map" },
  showPreview: { default: "true" },
  draggable: { default: "true" },
  zoomable: { default: "true" },
  rotatable: { default: "false" },
  tiltable: { default: "false" },
  pinClickable: { default: "true" },
  centerLat: { default: "" },
  centerLng: { default: "" },
  pitch: { default: "0" },
  bearing: { default: "0" },
  show3DBuildings: { default: "false" },
  autoRotate: { default: "false" },
  autoRotateSpeed: { default: "1" },
  showDirections: { default: "true" },
  variant: { default: "default" },
  themeId: { default: "" },
  preferredScheme: { default: "auto" },
  areaLabelsMode: { default: "inherit" },
  poiLabelsMode: { default: "inherit" },
  caption: { default: "" },
} as const;

const BLOCK_PROPS = {
  paragraph: DEFAULT_TEXT_BLOCK_PROPS,
  heading: { ...DEFAULT_TEXT_BLOCK_PROPS, level: { default: 1 } },
  bulletListItem: DEFAULT_TEXT_BLOCK_PROPS,
  numberedListItem: {
    ...DEFAULT_TEXT_BLOCK_PROPS,
    start: { default: undefined },
  },
  checkListItem: { ...DEFAULT_TEXT_BLOCK_PROPS, checked: { default: false } },
  quote: QUOTE_PROPS,
  callout: CALLOUT_PROPS,
  codeBlock: { language: { default: "javascript" } },
  mermaid: { title: { default: "" } },
  p5Sketch: {
    title: { default: "" },
    mode: { default: "edit" },
    previewHeight: { default: 360 },
    previewWidth: { default: "100" },
    textAlignment: { default: "left" },
  },
  threeScene: {
    title: { default: "" },
    mode: { default: "edit" },
    previewHeight: { default: 360 },
    previewWidth: { default: "100" },
    textAlignment: { default: "left" },
    language: { default: "typescript" },
  },
  shader: {
    title: { default: "" },
    mode: { default: "edit" },
    previewHeight: { default: 360 },
    previewWidth: { default: "100" },
    textAlignment: { default: "left" },
  },
  divider: {},
  table: { textColor: { default: "default" } },
  math: { latex: { default: "" } },
  map: MAP_PROPS,
  file: {
    ...fileBlockPropSchema,
    pendingUploadFileId: { default: "" },
    mediaAttemptId: { default: "" },
  },
} as const;

export type BlockType = keyof typeof BLOCK_PROPS;
type AttributeValidator = (value: unknown) => boolean;
export type AttributeValidators = Record<string, AttributeValidator>;

const BASE_BLOCK_TYPES = new Set<BlockType>([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "callout",
  "codeBlock",
  "divider",
  "table",
]);
const SCHEMA_BLOCK_TYPES: Record<GeulRichTextSchema, ReadonlySet<BlockType>> = {
  bio: new Set(["paragraph", "divider"]),
  editor: new Set([
    ...BASE_BLOCK_TYPES,
    "mermaid",
    "p5Sketch",
    "threeScene",
    "shader",
    "math",
    "map",
    "file",
  ]),
  email: BASE_BLOCK_TYPES,
  page: new Set([
    ...BASE_BLOCK_TYPES,
    "mermaid",
    "p5Sketch",
    "threeScene",
    "shader",
    "math",
    "file",
  ]),
  post: new Set([
    ...BASE_BLOCK_TYPES,
    "mermaid",
    "p5Sketch",
    "threeScene",
    "shader",
    "math",
    "map",
    "file",
  ]),
};
export const INLINE_CONTENT_BLOCK_TYPES = new Set<BlockType>([
  "paragraph",
  "heading",
  "bulletListItem",
  "numberedListItem",
  "checkListItem",
  "quote",
  "callout",
]);
export const EXECUTABLE_SOURCE_BLOCK_TYPES = new Set<BlockType>([
  "p5Sketch",
  "threeScene",
]);
export const NO_CONTENT_BLOCK_TYPES = new Set<BlockType>([
  "divider",
  "math",
  "map",
  "file",
]);
export const SHADER_STAGES = [
  "shaderCommon",
  "shaderVertex",
  "shaderBufferA",
  "shaderBufferB",
  "shaderBufferC",
  "shaderBufferD",
  "shaderCubemap",
  "shaderSound",
  "shaderImage",
] as const;
export const BOOLEAN_STYLE_MARKS = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
]);
export const STRING_STYLE_MARKS = new Set(["textColor", "backgroundColor"]);

export const isString: AttributeValidator = (value) =>
  typeof value === "string";
const isBoolean: AttributeValidator = (value) => typeof value === "boolean";
const isPositiveSafeInteger: AttributeValidator = (value) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
const isHeadingLevel: AttributeValidator = (value) =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= 6;
const isTextAlignment: AttributeValidator = (value) =>
  typeof value === "string" &&
  ["left", "center", "right", "justify"].includes(value);
const isMediaTextAlignment: AttributeValidator = (value) =>
  typeof value === "string" && ["left", "center", "right"].includes(value);
const isExternalVideoAspectRatio: AttributeValidator = (value) =>
  typeof value === "string" &&
  ["auto", "16:9", "4:3", "1:1", "9:16"].includes(value);
const isMapAspectRatio: AttributeValidator = (value) =>
  typeof value === "string" && ["16:9", "4:3", "1:1"].includes(value);
const isMapBooleanString: AttributeValidator = (value) =>
  typeof value === "string" && ["true", "false"].includes(value);
const isMapVariant: AttributeValidator = (value) => value === "default";
const isMapPreferredScheme: AttributeValidator = (value) =>
  typeof value === "string" && ["auto", "light", "dark"].includes(value);
const isMapLabelsMode: AttributeValidator = (value) =>
  typeof value === "string" && ["inherit", "show", "hide"].includes(value);
const isColumnWidths: AttributeValidator = (value) =>
  value === null ||
  (Array.isArray(value) &&
    value.every(
      (width) =>
        width === undefined ||
        width === null ||
        (typeof width === "number" && Number.isFinite(width) && width > 0),
    ));
const isExecutableMode: AttributeValidator = (value) =>
  typeof value === "string" && ["edit", "source", "preview"].includes(value);
const isExecutableLanguage: AttributeValidator = (value) =>
  typeof value === "string" && ["javascript", "typescript"].includes(value);
const isFiniteNumber: AttributeValidator = (value) =>
  typeof value === "number" && Number.isFinite(value);

const EXECUTABLE_ATTRIBUTE_VALIDATORS: AttributeValidators = {
  title: isString,
  mode: isExecutableMode,
  previewHeight: isFiniteNumber,
  previewWidth: isString,
  textAlignment: isMediaTextAlignment,
};
const DEFAULT_TEXT_ATTRIBUTE_VALIDATORS: AttributeValidators = {
  backgroundColor: isString,
  textColor: isString,
  textAlignment: isTextAlignment,
};
const MAP_ATTRIBUTE_VALIDATORS: AttributeValidators = {
  mapPlaceIds: isString,
  mapPlaceId: isString,
  location: isString,
  aspectRatio: isMapAspectRatio,
  previewWidth: isString,
  textAlignment: isMediaTextAlignment,
  zoom: isString,
  minZoom: isString,
  maxZoom: isString,
  url: isString,
  showPreview: isMapBooleanString,
  draggable: isMapBooleanString,
  zoomable: isMapBooleanString,
  rotatable: isMapBooleanString,
  tiltable: isMapBooleanString,
  pinClickable: isMapBooleanString,
  centerLat: isString,
  centerLng: isString,
  pitch: isString,
  bearing: isString,
  show3DBuildings: isMapBooleanString,
  autoRotate: isMapBooleanString,
  autoRotateSpeed: isString,
  showDirections: isMapBooleanString,
  variant: isMapVariant,
  themeId: isString,
  preferredScheme: isMapPreferredScheme,
  areaLabelsMode: isMapLabelsMode,
  poiLabelsMode: isMapLabelsMode,
  caption: isString,
};
const IMAGE_ATTRIBUTE_VALIDATORS: AttributeValidators = {
  fileId: isString,
  name: isString,
  alt: isString,
  caption: isString,
  width: isString,
  height: isString,
  previewWidth: isString,
  textAlignment: isMediaTextAlignment,
  pendingUploadFileId: isString,
  mediaAttemptId: isString,
};
const FILE_ATTRIBUTE_VALIDATORS: AttributeValidators = {
  ...IMAGE_ATTRIBUTE_VALIDATORS,
  fileName: isString,
};
export const TABLE_CELL_ATTRIBUTE_VALIDATORS: AttributeValidators = {
  colspan: isPositiveSafeInteger,
  rowspan: isPositiveSafeInteger,
  colwidth: isColumnWidths,
  backgroundColor: isString,
  textColor: isString,
  textAlignment: isTextAlignment,
};
const BLOCK_ATTRIBUTE_VALIDATORS: Partial<
  Record<BlockType, AttributeValidators>
> = {
  heading: { ...DEFAULT_TEXT_ATTRIBUTE_VALIDATORS, level: isHeadingLevel },
  bulletListItem: DEFAULT_TEXT_ATTRIBUTE_VALIDATORS,
  numberedListItem: {
    ...DEFAULT_TEXT_ATTRIBUTE_VALIDATORS,
    start: isPositiveSafeInteger,
  },
  checkListItem: { ...DEFAULT_TEXT_ATTRIBUTE_VALIDATORS, checked: isBoolean },
  quote: { backgroundColor: isString, textColor: isString },
  callout: {
    icon: isString,
    backgroundColor: isString,
    textColor: isString,
  },
  codeBlock: { language: isString },
  mermaid: { title: isString },
  p5Sketch: { ...EXECUTABLE_ATTRIBUTE_VALIDATORS, source: isString },
  threeScene: {
    ...EXECUTABLE_ATTRIBUTE_VALIDATORS,
    source: isString,
    language: isExecutableLanguage,
  },
  shader: EXECUTABLE_ATTRIBUTE_VALIDATORS,
  divider: {},
  table: { textColor: isString },
  math: { latex: isString },
  map: MAP_ATTRIBUTE_VALIDATORS,
  file: FILE_ATTRIBUTE_VALIDATORS,
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function allowsMathInline(schema: GeulRichTextSchema): boolean {
  return schema === "editor" || schema === "post";
}

export function allowedBlockType(
  type: string,
  schema: GeulRichTextSchema,
): BlockType {
  if (!SCHEMA_BLOCK_TYPES[schema].has(type as BlockType)) {
    throw new Error(`Unsupported ${schema} block type: ${type}`);
  }
  return type as BlockType;
}

export function blockAttributeValidators(
  type: BlockType,
  schema: GeulRichTextSchema,
): AttributeValidators {
  if (type === "paragraph") {
    return {
      ...DEFAULT_TEXT_ATTRIBUTE_VALIDATORS,
      ...(schema === "post" || schema === "page"
        ? {
            previewWidth: isString,
            aspectRatio: isExternalVideoAspectRatio,
          }
        : {}),
    };
  }
  return BLOCK_ATTRIBUTE_VALIDATORS[type]!;
}

export function selectProps(
  type: BlockType,
  attributes: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return selectSchemaProps(
    BLOCK_PROPS[type] as Record<string, { default?: unknown }>,
    attributes,
    type,
  );
}

export function selectAdditionalProps(
  attributes: Record<string, unknown> | undefined,
  propSchema: Record<string, { default?: unknown }>,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(propSchema))
    props[name] =
      attributes?.[name] === undefined ? spec.default : attributes[name];
  return props;
}

export function selectWritableProps(
  type: BlockType,
  props: Record<string, unknown>,
  schema: GeulRichTextSchema,
): Record<string, unknown> {
  const allowed = {
    ...(BLOCK_PROPS[type] as Record<string, { default?: unknown }>),
    ...(type === "paragraph" && (schema === "post" || schema === "page")
      ? externalVideoLinkLayoutPropSchema
      : {}),
  };
  return selectSchemaProps(allowed, props, type);
}

function selectSchemaProps(
  propSchema: Record<string, { default?: unknown }>,
  values: Record<string, unknown> | undefined,
  type: BlockType,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(propSchema)) {
    const value = values?.[name];
    if (shouldOmitProp(type, name, value, spec.default)) continue;
    props[name] = value === undefined ? spec.default : value;
  }
  return props;
}

function shouldOmitProp(
  type: BlockType,
  name: string,
  value: unknown,
  defaultValue: unknown,
): boolean {
  if (
    type === "file" &&
    (name === "pendingUploadFileId" || name === "mediaAttemptId")
  )
    return value === undefined || value === "";
  return defaultValue === undefined && value === undefined;
}

export function shaderChannels(value: unknown): boolean {
  return (
    Array.isArray(value) && value.length === 4 && value.every(shaderChannel)
  );
}

function shaderChannel(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "none") return Object.keys(value).length === 1;
  if (value.kind === "buffer")
    return (
      ["A", "B", "C", "D"].includes(String(value.buffer)) &&
      Object.keys(value).length === 2
    );
  if (shaderFileChannel(value) || shaderCubemapFileChannel(value)) return true;
  return (
    value.kind === "cubemapPass" &&
    shaderSampler(value.sampler) &&
    Object.keys(value).length === 2
  );
}

function shaderFileChannel(value: Record<string, unknown>): boolean {
  return (
    (value.kind === "textureFile" || value.kind === "videoFile") &&
    typeof value.fileId === "string" &&
    value.fileId.trim() !== "" &&
    shaderSampler(value.sampler) &&
    Object.keys(value).length === 3
  );
}

function shaderCubemapFileChannel(value: Record<string, unknown>): boolean {
  return (
    value.kind === "cubemapFiles" &&
    Array.isArray(value.fileIds) &&
    value.fileIds.length === 6 &&
    value.fileIds.every((id) => typeof id === "string" && id.trim() !== "") &&
    shaderSampler(value.sampler) &&
    Object.keys(value).length === 3
  );
}

function shaderSampler(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.filter === "nearest" || value.filter === "linear") &&
    (value.wrap === "clamp" || value.wrap === "repeat") &&
    typeof value.vflip === "boolean" &&
    Object.keys(value).every((key) => ["filter", "wrap", "vflip"].includes(key))
  );
}
