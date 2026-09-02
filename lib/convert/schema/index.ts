import type { GeulRichTextSchema } from "../tiptap-document.ts";

/**
 * Server conversion boundaries. These are not editor schemas: the strict
 * ProseMirror/Yjs converter owns the durable node allowlists and validation.
 */
export const editorSchema = "editor" as const satisfies GeulRichTextSchema;
export const postEditorSchema = "post" as const satisfies GeulRichTextSchema;
export const pageRichTextSchema = "page" as const satisfies GeulRichTextSchema;
