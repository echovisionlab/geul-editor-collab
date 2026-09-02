import { parseDocumentName } from "@echovisionlab/geul-common/collaboration/document";

const documentStateMaps = new Set<Map<string, unknown>>();

/**
 * Process-local state whose lifetime must not exceed the loaded collaboration
 * document. It is never an authority for persisted content; handlers may keep
 * only opaque server-issued CAS needed for the next save.
 */
export class TransientDocumentStateMap<T> extends Map<string, T> {
  constructor() {
    super();
    documentStateMaps.add(this as Map<string, unknown>);
  }
}

export function clearTransientDocumentState(documentName: string): void {
  parseDocumentName(documentName);
  for (const state of documentStateMaps) {
    state.delete(documentName);
  }
}
