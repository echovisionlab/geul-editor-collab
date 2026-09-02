import type { ProseMirrorJsonNode } from "./types.ts";

export function prepareDocumentForStaticRender(
  document: ProseMirrorJsonNode,
): ProseMirrorJsonNode {
  return visit(document, 0);
}

function visit(
  node: ProseMirrorJsonNode,
  nestingLevel: number,
): ProseMirrorJsonNode {
  const cloned: ProseMirrorJsonNode = {
    ...node,
    ...(node.attrs ? { attrs: { ...node.attrs } } : {}),
    ...(node.marks
      ? {
          marks: [...node.marks].reverse().map((mark) => ({
            ...mark,
            attrs: mark.attrs ? { ...mark.attrs } : undefined,
          })),
        }
      : {}),
  };
  if (node.type === "blockGroup") {
    cloned.content = (node.content ?? []).map((container) =>
      prepareBlockContainer(container, nestingLevel),
    );
    return cloned;
  }
  cloned.content = node.content?.map((child) => visit(child, nestingLevel));
  return cloned;
}

function prepareBlockContainer(
  container: ProseMirrorJsonNode,
  nestingLevel: number,
): ProseMirrorJsonNode {
  const [blockContent, childGroup] = container.content ?? [];
  return {
    ...container,
    attrs: container.attrs ? { ...container.attrs } : undefined,
    content: [
      ...(blockContent
        ? [
            {
              ...visit(blockContent, nestingLevel),
              attrs: {
                ...blockContent.attrs,
                _nestingLevel: nestingLevel,
              },
            },
          ]
        : []),
      ...(childGroup ? [visit(childGroup, nestingLevel + 1)] : []),
    ],
  };
}
