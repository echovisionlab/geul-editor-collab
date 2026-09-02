import { getRichTextBlockLocalePropKeys } from "@echovisionlab/geul-common/collaboration/page";
import * as Y from "yjs";

export function decodeSharedDocument(state: Buffer | Uint8Array): Y.Doc {
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  return document;
}

function hasSharedType(document: Y.Doc, name: string): boolean {
  return (document as Y.Doc & { share: Map<string, unknown> }).share.has(name);
}

export function getSharedMap(
  document: Y.Doc,
  name: string,
): Y.Map<unknown> | undefined {
  return hasSharedType(document, name) ? document.getMap(name) : undefined;
}

export function getSharedArray(
  document: Y.Doc,
  name: string,
): Y.Array<unknown> | undefined {
  return hasSharedType(document, name) ? document.getArray(name) : undefined;
}

export function getSharedFragment(
  document: Y.Doc,
  name: string,
): Y.XmlFragment | undefined {
  return hasSharedType(document, name)
    ? document.getXmlFragment(name)
    : undefined;
}

export function clearSharedFragment(
  sharedDoc: Y.Doc,
  ...fragmentNames: string[]
): void {
  for (const fragmentName of fragmentNames) {
    const fragment = getSharedFragment(sharedDoc, fragmentName);
    if (fragment && fragment.length > 0) {
      fragment.delete(0, fragment.length);
    }
  }
}

export function sanitizeNeutralRichTextFragment(fragment: Y.XmlFragment): void {
  const elements: Y.XmlElement[] = [];
  const texts: Y.XmlText[] = [];

  const visit = (node: Y.XmlFragment | Y.XmlElement): void => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlElement) {
        elements.push(child);
        visit(child);
      } else if (child instanceof Y.XmlText) {
        texts.push(child);
      }
    }
  };
  visit(fragment);

  fragment.doc?.transact(() => {
    for (const element of elements) {
      for (const key of getRichTextBlockLocalePropKeys(
        element.nodeName.toLowerCase(),
      )) {
        element.removeAttribute(key);
      }
    }
    for (const text of texts) {
      text.delete(0, text.length);
    }
  });
}

export function sanitizeNeutralDocumentStore(sharedDoc: Y.Doc): void {
  const fragment = getSharedFragment(sharedDoc, "document-store");
  if (fragment) {
    sanitizeNeutralRichTextFragment(fragment);
  }
}

export function deleteSharedMapKeys(
  map: Y.Map<unknown> | undefined,
  shouldDelete: (key: string) => boolean,
): void {
  if (!map) {
    return;
  }
  for (const key of map.keys()) {
    if (shouldDelete(key)) {
      map.delete(key);
    }
  }
}
