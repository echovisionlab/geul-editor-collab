import * as Y from "yjs";
import type { ResidentBlockPersistResult } from "./resident-block-persistence.ts";

export async function persistResidentBlockWithAcknowledgment(
  documentName: string,
  document: Y.Doc,
  persist: () => Promise<ResidentBlockPersistResult>,
): Promise<ResidentBlockPersistResult> {
  // Capture before the asynchronous save; later edits are not covered by this ACK.
  const stateVector = Buffer.from(Y.encodeStateVector(document)).toString(
    "base64",
  );
  const deleted = Object.fromEntries(
    Y.decodeUpdate(Y.encodeStateAsUpdate(document)).ds.clients,
  );
  const result = await persist();
  const broadcaster = document as Y.Doc & {
    broadcastStateless?: (payload: string) => void;
  };
  broadcaster.broadcastStateless?.(
    JSON.stringify({
      kind: "block_room.persisted",
      protocolVersion: 2,
      documentName,
      stateVector,
      deleted,
    }),
  );
  return result;
}
