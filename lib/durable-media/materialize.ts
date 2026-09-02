import * as Y from "yjs";
import {
  type LazyRootKind,
  type LazyYRoot,
  type SharedYType,
} from "./types.ts";

const ARRAY_ROOT_NAMES = new Set(["sections", "items"]);
const TEXT_ROOT_NAMES = new Set(["html-content"]);
const XML_ROOT_NAMES = new Set([
  "document-store",
  "artist-bio",
  "label-description",
  "release-description",
]);
const TEXT_CONTENT_TYPES = new Set<unknown>([
  "ContentString",
  "ContentFormat",
  "ContentEmbed",
]);

function lazyContentRootKind(
  content: Array<{ name?: string; type?: unknown }>,
): LazyRootKind | undefined {
  if (
    content.some(({ name: contentType }) => TEXT_CONTENT_TYPES.has(contentType))
  ) {
    return "text";
  }
  if (
    content.some(
      ({ name: contentType, type }) =>
        contentType === "ContentType" &&
        type instanceof Y.AbstractType &&
        type.constructor.name.startsWith("YXml"),
    )
  ) {
    return "xml";
  }
  return undefined;
}

function namedLazyRootKind(name: string): LazyRootKind | undefined {
  if (TEXT_ROOT_NAMES.has(name)) {
    return "text";
  }
  if (XML_ROOT_NAMES.has(name) || name.startsWith("section-")) {
    return "xml";
  }
  if (ARRAY_ROOT_NAMES.has(name)) {
    return "array";
  }
  return undefined;
}

function inferLazyRootKind(name: string, lazy: LazyYRoot): LazyRootKind {
  if (lazy._map.size > 0) {
    return "map";
  }
  const namedKind = namedLazyRootKind(name);
  if (namedKind) {
    return namedKind;
  }

  const content: Array<{ name?: string; type?: unknown }> = [];
  for (let item = lazy._start; item; item = item.right) {
    content.push({
      name: item.content?.constructor?.name,
      type: item.content?.type,
    });
  }
  return lazyContentRootKind(content) ?? "array";
}

function materializeRootType(
  document: Y.Doc,
  name: string,
  value: SharedYType,
): void {
  if (
    value instanceof Y.Map ||
    value instanceof Y.Array ||
    value instanceof Y.XmlFragment ||
    value instanceof Y.XmlElement ||
    value instanceof Y.Text
  ) {
    return;
  }

  switch (inferLazyRootKind(name, value as unknown as LazyYRoot)) {
    case "map":
      document.getMap(name);
      return;
    case "text":
      document.getText(name);
      return;
    case "xml":
      document.getXmlFragment(name);
      return;
    case "array":
      document.getArray(name);
      return;
  }
}

export function materializeDocumentRootTypes(document: Y.Doc): void {
  for (const [name, value] of [...document.share.entries()]) {
    materializeRootType(document, name, value);
  }
}
