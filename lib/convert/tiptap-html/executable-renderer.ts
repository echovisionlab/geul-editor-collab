import {
  attribute,
  childrenToString,
  containerStyle,
  escapeAttribute,
  escapeText,
} from "./html-attributes.ts";
import type { ProseMirrorJsonNode, RenderedChildren } from "./types.ts";

const SHADER_FILENAMES = [
  "common.glsl",
  "vert.glsl",
  "buffer-a.glsl",
  "buffer-b.glsl",
  "buffer-c.glsl",
  "buffer-d.glsl",
  "cubemap.glsl",
  "sound.glsl",
  "frag.glsl",
] as const;

export const SHADER_STAGE_TYPES = [
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

export function renderExecutable(
  node: ProseMirrorJsonNode,
  children?: RenderedChildren,
): string {
  const language = executableLanguage(node);
  const title = executableTitle(node);
  const renderedSource = childrenToString(children);
  const legacySource = executableLegacySource(node);
  return `<figure class="executable-block executable-block--${node.type}" data-content-type="${node.type}" data-language="${language}" data-mode="preview"${attribute("data-title", node.attrs?.title)}${attribute("data-preview-height", node.attrs?.previewHeight ?? 360)}${containerStyle(node.attrs)}><figcaption>${escapeText(title)}</figcaption><pre data-language="${language}"><code>${renderedSource || legacySource}</code></pre></figure>`;
}

export function renderShader(
  node: ProseMirrorJsonNode,
  children: string[],
): string {
  const rendered = children;
  const stages = (node.content ?? [])
    .map((stage, index) => {
      const filename = SHADER_FILENAMES[index] ?? "unknown.glsl";
      const channels = stage.attrs?.channels;
      return `<section data-shader-stage="${escapeAttribute(stage.type)}" data-shader-filename="${filename}"${channels ? attribute("data-shader-channels", JSON.stringify(channels)) : ""}><h3>${filename}</h3><pre data-language="glsl"><code>${rendered[index]!}</code></pre></section>`;
    })
    .join("");
  return `<figure class="executable-block executable-block--shader" data-content-type="shader" data-language="glsl" data-mode="preview"${attribute("data-title", node.attrs?.title)}${attribute("data-preview-height", node.attrs?.previewHeight ?? 360)}${containerStyle(node.attrs)}><figcaption>${escapeText(executableTitle(node))}</figcaption>${stages}</figure>`;
}

function executableLanguage(
  node: ProseMirrorJsonNode,
): "javascript" | "typescript" {
  if (node.type === "threeScene") {
    return node.attrs?.language === "javascript" ? "javascript" : "typescript";
  }
  return "javascript";
}

function executableTitle(node: ProseMirrorJsonNode): string {
  const title =
    typeof node.attrs?.title === "string" ? node.attrs.title.trim() : "";
  return title || executableLabel(node.type);
}

function executableLabel(type: string): string {
  if (type === "p5Sketch") {
    return "p5.js sketch";
  }
  return type === "threeScene" ? "Three.js scene" : "Shader";
}

function executableLegacySource(node: ProseMirrorJsonNode): string {
  return typeof node.attrs?.source === "string"
    ? escapeText(node.attrs.source)
    : "";
}
