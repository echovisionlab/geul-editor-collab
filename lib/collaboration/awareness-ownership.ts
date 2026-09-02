import {
  type Connection,
  IncomingMessage,
  MessageType,
  type TransactionOrigin,
  isTransactionOrigin,
} from "@hocuspocus/server";
import { removeAwarenessStates } from "y-protocols/awareness";

interface AwarenessEntry {
  clientId: number;
  state: Record<string, unknown> | null;
}

function decodeAwarenessEntries(
  rawMessage: Uint8Array,
): AwarenessEntry[] | null {
  const message = new IncomingMessage(rawMessage);
  message.readVarString();
  if (message.readVarUint() !== MessageType.Awareness) {
    return null;
  }

  const update = new IncomingMessage(message.readVarUint8Array());
  const count = update.readVarUint();
  const entries: AwarenessEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const clientId = update.readVarUint();
    update.readVarUint(); // awareness clock
    const state = JSON.parse(update.readVarString()) as unknown;
    if (state !== null && (typeof state !== "object" || Array.isArray(state))) {
      throw new Error("Invalid awareness state");
    }
    entries.push({ clientId, state: state as Record<string, unknown> | null });
  }
  return entries;
}

/**
 * Binds each awareness client ID to the authenticated websocket connection
 * that first introduced it. The binding is process-local presence state.
 */
export class AwarenessConnectionOwnership<Context = unknown> {
  private readonly owners = new WeakMap<
    object,
    Map<number, Connection<Context>>
  >();

  prepareInboundMessage(
    connection: Connection<Context>,
    rawMessage: Uint8Array,
  ): void {
    const entries = decodeAwarenessEntries(rawMessage);
    if (!entries) {
      return;
    }

    const owners = this.ownersFor(connection.document);
    for (const { clientId } of entries) {
      const owner = owners.get(clientId);
      if (owner && owner !== connection) {
        throw new Error("Awareness client ID belongs to another connection");
      }
    }

    const removed: number[] = [];
    for (const { clientId, state } of entries) {
      if (state !== null) {
        owners.set(clientId, connection);
        continue;
      }
      if (owners.get(clientId) !== connection) {
        continue;
      }
      owners.delete(clientId);
      removed.push(clientId);
    }

    // Hocuspocus 4.3 decodes awareness into a new scratch Awareness and then
    // re-encodes only scratch.getStates(). A null removal is therefore lost.
    // Apply only already-authorized removals here; non-null states continue to
    // the normal hook where their Member projection is rewritten first.
    if (removed.length > 0) {
      removeAwarenessStates(connection.document.awareness, removed, {
        source: "connection",
        connection,
      });
    }
  }

  rewriteOwnedStates(
    states: Map<number, Record<string, unknown>>,
    transactionOrigin: TransactionOrigin | unknown,
    rewrite: (state: Record<string, unknown>) => Record<string, unknown>,
  ): void {
    if (
      !isTransactionOrigin(transactionOrigin) ||
      transactionOrigin.source !== "connection"
    ) {
      states.clear();
      return;
    }

    const connection = transactionOrigin.connection as Connection<Context>;
    const owners = this.ownersFor(connection.document);
    for (const [clientId, state] of states) {
      const owner = owners.get(clientId);
      if (owner && owner !== connection) {
        throw new Error("Awareness client ID belongs to another connection");
      }
      owners.set(clientId, connection);
      states.set(clientId, rewrite(state));
    }
  }

  disconnected(connection: Connection<Context>): void {
    const owners = this.owners.get(connection.document);
    if (!owners) {
      return;
    }
    for (const [clientId, owner] of owners) {
      if (owner === connection) {
        owners.delete(clientId);
      }
    }
    if (owners.size === 0) {
      this.owners.delete(connection.document);
    }
  }

  private ownersFor(document: object): Map<number, Connection<Context>> {
    let owners = this.owners.get(document);
    if (!owners) {
      owners = new Map();
      this.owners.set(document, owners);
    }
    return owners;
  }
}
