import type { Connection } from "@hocuspocus/server";
import * as Y from "yjs";

const acceptedInboundMutation = Symbol("accepted-inbound-mutation");

/** Attribution is committed synchronously by the inbound actor lane, before another actor can enter. */
export function isAttributedInboundMutation(origin: unknown): boolean {
  return (
    typeof origin === "object" &&
    origin !== null &&
    acceptedInboundMutation in origin
  );
}

export function applyInboundMutation(
  document: Y.Doc,
  connection: Connection,
  update: Uint8Array,
): boolean {
  let changed = false;
  const onUpdate = () => {
    changed = true;
  };
  document.on("update", onUpdate);
  try {
    // Hocuspocus 4.6 applies the frame after awaiting beforeSync. Apply it here,
    // inside the room actor lane; its subsequent identical Yjs replay is a no-op.
    // Keep the connection origin for broadcasting and ordinary store scheduling.
    Y.applyUpdate(document, update, {
      source: "connection",
      connection,
      [acceptedInboundMutation]: true,
    });
    return changed;
  } finally {
    document.off("update", onUpdate);
  }
}
