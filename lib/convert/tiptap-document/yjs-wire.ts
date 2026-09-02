import * as Y from "yjs";
import type { ProseMirrorJsonNode } from "./schema.ts";

export function xmlElementFromNode(node: ProseMirrorJsonNode): Y.XmlElement {
  const element = new Y.XmlElement(node.type);
  for (const [name, value] of Object.entries(node.attrs ?? {})) {
    element.setAttribute(name, value as never);
  }
  const children = (node.content ?? []).flatMap(xmlNodeFromProseMirror);
  if (children.length > 0) element.insert(0, children);
  return element;
}

function xmlNodeFromProseMirror(
  node: ProseMirrorJsonNode,
): Array<Y.XmlElement | Y.XmlText> {
  if (node.type !== "text") return [xmlElementFromNode(node)];
  const text = new Y.XmlText();
  text.insert(
    0,
    node.text!,
    Object.fromEntries(
      (node.marks ?? []).map((mark) => [mark.type, mark.attrs ?? {}]),
    ),
  );
  return [text];
}
