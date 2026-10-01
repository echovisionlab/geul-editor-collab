import { randomUUID } from "node:crypto";

export const COLLAB_RELOAD_REQUIRED_SIGNAL = "reload_required";
export const ROOM_EPOCH_TOKEN_TTL_MS = 24 * 60 * 60 * 1_000;
export const ROOM_EPOCH_MAX_TOKENS_PER_ROOM = 1_024;

export class RoomEpochMismatchError extends Error {
  readonly reason = COLLAB_RELOAD_REQUIRED_SIGNAL;

  constructor() {
    super(COLLAB_RELOAD_REQUIRED_SIGNAL);
    this.name = "RoomEpochMismatchError";
  }
}

export interface RoomEpochAdmission {
  serverInstanceId: string;
  roomEpoch: string;
  yjsBootstrapStateVector: Uint8Array;
  requiresCanonicalSyncFence: boolean;
}

export interface RoomEpochBinding {
  yjsBootstrapStateVector: Uint8Array;
}

interface IssuedRoomEpochToken extends RoomEpochBinding {
  roomEpoch: string;
  synchronized: boolean;
  lastUsedAt: number;
  lastAccessOrder: number;
}

type CreateId = () => string;

export interface RoomEpochRegistryOptions {
  now?: () => number;
  tokenTtlMs?: number;
  maxTokensPerRoom?: number;
}

/**
 * Process-local admission fence for resident collaboration rooms. Epochs are
 * deliberately not durable: a process restart or room unload requires every
 * client to reload the canonical document before it may sync Yjs updates.
 */
export class RoomEpochRegistry {
  readonly serverInstanceId: string;
  private readonly roomEpochs = new Map<string, string>();
  private readonly tokensByRoom = new Map<
    string,
    Map<string, IssuedRoomEpochToken>
  >();
  private readonly now: () => number;
  private readonly tokenTtlMs: number;
  private readonly maxTokensPerRoom: number;
  private nextTokenAccessOrder = 0;

  constructor(
    private readonly createId: CreateId = randomUUID,
    options: RoomEpochRegistryOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.tokenTtlMs = options.tokenTtlMs ?? ROOM_EPOCH_TOKEN_TTL_MS;
    this.maxTokensPerRoom =
      options.maxTokensPerRoom ?? ROOM_EPOCH_MAX_TOKENS_PER_ROOM;
    if (!Number.isFinite(this.tokenTtlMs) || this.tokenTtlMs <= 0) {
      throw new RangeError("Room epoch token TTL must be a positive number");
    }
    if (
      !Number.isSafeInteger(this.maxTokensPerRoom) ||
      this.maxTokensPerRoom <= 0
    ) {
      throw new RangeError(
        "Room epoch token limit must be a positive safe integer",
      );
    }
    this.serverInstanceId = createId();
  }

  issue(
    documentName: string,
  ): Pick<RoomEpochAdmission, "serverInstanceId" | "roomEpoch"> {
    this.pruneTokens(documentName, this.readNow());
    let roomEpoch = this.roomEpochs.get(documentName);
    if (!roomEpoch) {
      roomEpoch = this.createId();
      this.roomEpochs.set(documentName, roomEpoch);
    }
    return { serverInstanceId: this.serverInstanceId, roomEpoch };
  }

  issueToken(documentName: string, binding: RoomEpochBinding): string {
    const { roomEpoch } = this.issue(documentName);
    const now = this.readNow();
    const token = this.createId();
    let roomTokens = this.tokensByRoom.get(documentName);
    if (!roomTokens) {
      roomTokens = new Map();
      this.tokensByRoom.set(documentName, roomTokens);
    }
    roomTokens.set(token, {
      roomEpoch,
      ...binding,
      yjsBootstrapStateVector: binding.yjsBootstrapStateVector.slice(),
      synchronized: false,
      lastUsedAt: now,
      lastAccessOrder: this.nextTokenAccessOrder++,
    });
    this.pruneTokens(documentName, now);
    return token;
  }

  validate(
    documentName: string,
    tokenValue: string,
  ): RoomEpochAdmission | undefined {
    const now = this.readNow();
    this.pruneTokens(documentName, now);
    const token = this.tokensByRoom.get(documentName)?.get(tokenValue);
    if (!token) {
      return undefined;
    }
    const activeEpoch = this.roomEpochs.get(documentName);
    if (!activeEpoch || token.roomEpoch !== activeEpoch) {
      return undefined;
    }
    token.lastUsedAt = now;
    token.lastAccessOrder = this.nextTokenAccessOrder++;
    return {
      serverInstanceId: this.serverInstanceId,
      roomEpoch: token.roomEpoch,
      yjsBootstrapStateVector: token.yjsBootstrapStateVector.slice(),
      requiresCanonicalSyncFence: !token.synchronized,
    };
  }

  validateAdmission(
    documentName: string,
    admission: RoomEpochAdmission,
  ): RoomEpochAdmission | undefined {
    const activeEpoch = this.roomEpochs.get(documentName);
    if (
      !activeEpoch ||
      admission.serverInstanceId !== this.serverInstanceId ||
      admission.roomEpoch !== activeEpoch
    ) {
      return undefined;
    }
    return {
      serverInstanceId: admission.serverInstanceId,
      roomEpoch: admission.roomEpoch,
      yjsBootstrapStateVector: admission.yjsBootstrapStateVector.slice(),
      requiresCanonicalSyncFence: admission.requiresCanonicalSyncFence,
    };
  }

  markSynchronized(documentName: string, tokenValue: string): boolean {
    const now = this.readNow();
    this.pruneTokens(documentName, now);
    const token = this.tokensByRoom.get(documentName)?.get(tokenValue);
    const activeEpoch = this.roomEpochs.get(documentName);
    if (!token || token.roomEpoch !== activeEpoch) {
      return false;
    }
    token.synchronized = true;
    return true;
  }

  retire(documentName: string): void {
    this.roomEpochs.delete(documentName);
    this.tokensByRoom.delete(documentName);
  }

  private readNow(): number {
    const now = this.now();
    if (!Number.isFinite(now)) {
      throw new RangeError("Room epoch registry clock must return a number");
    }
    return now;
  }

  private pruneTokens(documentName: string, now: number): void {
    const roomTokens = this.tokensByRoom.get(documentName);
    if (!roomTokens) return;

    for (const [tokenValue, token] of roomTokens) {
      if (now - token.lastUsedAt >= this.tokenTtlMs) {
        roomTokens.delete(tokenValue);
      }
    }

    while (roomTokens.size > this.maxTokensPerRoom) {
      let oldestTokenValue: string | undefined;
      let oldestAccessOrder = Number.POSITIVE_INFINITY;
      for (const [tokenValue, token] of roomTokens) {
        if (token.lastAccessOrder < oldestAccessOrder) {
          oldestTokenValue = tokenValue;
          oldestAccessOrder = token.lastAccessOrder;
        }
      }
      if (oldestTokenValue === undefined) break;
      roomTokens.delete(oldestTokenValue);
    }

    if (roomTokens.size === 0) {
      this.tokensByRoom.delete(documentName);
    }
  }
}
