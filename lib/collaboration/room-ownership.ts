import { Client, type QueryResult } from "pg";
import { env } from "../../env.ts";
import { logger } from "../logger.ts";

const LOCK_NAMESPACE = 1_146_310_978;

interface AdvisoryLockClient {
  connect(): Promise<unknown>;
  query<T extends Record<string, unknown>>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<T>>;
  on(event: "error", listener: (error: Error) => void): this;
  end(): Promise<void>;
}

type ClientFactory = () => AdvisoryLockClient;

export class RoomOwnedElsewhereError extends Error {
  constructor(readonly documentName: string) {
    super("room_owner_elsewhere");
    this.name = "RoomOwnedElsewhereError";
  }
}

export interface RoomOwnership {
  acquire(documentName: string): Promise<void>;
  isOwned(documentName: string): boolean;
  release(documentName: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * One PostgreSQL session holds all process-owned room locks. Advisory locks are
 * ephemeral coordination, not product state: process/session loss releases
 * every room so another replica can load the canonical document.
 */
export class PostgresRoomOwnership implements RoomOwnership {
  private client: AdvisoryLockClient | undefined;
  private connecting: Promise<AdvisoryLockClient> | undefined;
  private readonly owned = new Set<string>();
  private readonly acquiring = new Map<string, Promise<void>>();
  private closed = false;

  constructor(
    private readonly onOwnershipLost: (
      documentNames: readonly string[],
      error: Error,
    ) => void,
    private readonly createClient: ClientFactory = () =>
      new Client({ connectionString: env.DATABASE_DSN }),
  ) {}

  acquire(documentName: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error("room_ownership_closed"));
    if (this.owned.has(documentName)) return Promise.resolve();
    const existing = this.acquiring.get(documentName);
    if (existing) return existing;
    const acquisition = this.acquireOnce(documentName).finally(() => {
      this.acquiring.delete(documentName);
    });
    this.acquiring.set(documentName, acquisition);
    return acquisition;
  }

  isOwned(documentName: string): boolean {
    return (
      !this.closed && this.client !== undefined && this.owned.has(documentName)
    );
  }

  async release(documentName: string): Promise<void> {
    if (!this.owned.delete(documentName)) return;
    const client = this.client;
    if (!client) return;
    try {
      await client.query<{ released: boolean }>(
        "SELECT pg_advisory_unlock(hashtextextended($1::text, $2::bigint)) AS released",
        [documentName, LOCK_NAMESPACE],
      );
    } catch (error) {
      this.loseClient(
        client,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled(this.acquiring.values());
    this.acquiring.clear();
    this.owned.clear();
    const client = this.client;
    this.client = undefined;
    this.connecting = undefined;
    if (client) await client.end();
  }

  private async acquireOnce(documentName: string): Promise<void> {
    const client = await this.connectedClient();
    let result: QueryResult<{ acquired: boolean }>;
    try {
      result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1::text, $2::bigint)) AS acquired",
        [documentName, LOCK_NAMESPACE],
      );
    } catch (error) {
      this.loseClient(
        client,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
    if (result.rows[0]?.acquired !== true)
      throw new RoomOwnedElsewhereError(documentName);
    this.owned.add(documentName);
  }

  private connectedClient(): Promise<AdvisoryLockClient> {
    if (this.client) return Promise.resolve(this.client);
    this.connecting ??= (async () => {
      const client = this.createClient();
      client.on("error", (error) => this.loseClient(client, error));
      await client.connect();
      if (this.closed) {
        await client.end();
        throw new Error("room_ownership_closed");
      }
      this.client = client;
      return client;
    })().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private loseClient(client: AdvisoryLockClient, error: Error): void {
    if (this.client !== client) return;
    this.client = undefined;
    void client.end().catch(() => undefined);
    const lost = [...this.owned];
    this.owned.clear();
    logger.error("Collaboration room ownership session lost", {
      reason: "room_ownership_lost",
      room_count: lost.length,
      error: error.message,
    });
    if (lost.length > 0) {
      try {
        this.onOwnershipLost(lost, error);
      } catch (callbackError) {
        logger.error(
          "Failed to fence collaboration rooms after ownership loss",
          {
            reason: "room_ownership_fence_failed",
            room_count: lost.length,
            error:
              callbackError instanceof Error
                ? callbackError.message
                : String(callbackError),
          },
        );
      }
    }
  }
}
