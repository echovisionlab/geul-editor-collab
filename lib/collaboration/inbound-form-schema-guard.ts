import { FORM_FIELDS_MAP_NAME } from "@echovisionlab/geul-common/collaboration/form";
import * as Y from "yjs";

/** Reject legacy whole-schema Y updates; Form schemas must use the patch protocol. */
export function assertInboundFormSchemaUnchanged(
  documentName: string,
  document: Y.Doc,
  inboundUpdate: Uint8Array,
): void {
  if (!documentName.startsWith("form:")) return;

  const staged = new Y.Doc();
  try {
    Y.applyUpdate(staged, Y.encodeStateAsUpdate(document));
    const schemaBefore = staged
      .getMap<unknown>(FORM_FIELDS_MAP_NAME)
      .get("schema");
    Y.applyUpdate(staged, inboundUpdate);
    const schemaAfter = staged
      .getMap<unknown>(FORM_FIELDS_MAP_NAME)
      .get("schema");
    if (!Object.is(schemaBefore, schemaAfter)) {
      throw new Error("form_schema_patch_required");
    }
  } finally {
    staged.destroy();
  }
}
