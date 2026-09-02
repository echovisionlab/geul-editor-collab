import { randomUUID } from "node:crypto";

export const COLLAB_RELOAD_REQUIRED_SIGNAL = "reload_required";

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
  documentName: string;
  roomEpoch: string;
  synchronized: boolean;
}

type CreateId = () => string;

/**
 * Process-local admission fence for resident collaboration rooms. Epochs are
 * deliberately not durable: a process restart or room unload requires every
 * client to reload the canonical document before it may sync Yjs updates.
 */
export class RoomEpochRegistry {
  readonly serverInstanceId: string;
  private readonly roomEpochs = new Map<string, string>();
  private readonly tokens = new Map<string, IssuedRoomEpochToken>();

  constructor(private readonly createId: CreateId = randomUUID) {
    this.serverInstanceId = createId();
  }

  issue(
    documentName: string,
  ): Pick<RoomEpochAdmission, "serverInstanceId" | "roomEpoch"> {
    let roomEpoch = this.roomEpochs.get(documentName);
    if (!roomEpoch) {
      roomEpoch = this.createId();
      this.roomEpochs.set(documentName, roomEpoch);
    }
    return { serverInstanceId: this.serverInstanceId, roomEpoch };
  }

  issueToken(documentName: string, binding: RoomEpochBinding): string {
    const { roomEpoch } = this.issue(documentName);
    const token = this.createId();
    this.tokens.set(token, {
      documentName,
      roomEpoch,
      ...binding,
      yjsBootstrapStateVector: binding.yjsBootstrapStateVector.slice(),
      synchronized: false,
    });
    return token;
  }

  validate(
    documentName: string,
    tokenValue: string,
  ): RoomEpochAdmission | undefined {
    const token = this.tokens.get(tokenValue);
    if (!token || token.documentName !== documentName) {
      return undefined;
    }
    const activeEpoch = this.roomEpochs.get(documentName);
    if (!activeEpoch || token.roomEpoch !== activeEpoch) {
      return undefined;
    }
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
    const token = this.tokens.get(tokenValue);
    const activeEpoch = this.roomEpochs.get(documentName);
    if (
      !token ||
      token.documentName !== documentName ||
      token.roomEpoch !== activeEpoch
    ) {
      return false;
    }
    token.synchronized = true;
    return true;
  }

  retire(documentName: string): void {
    this.roomEpochs.delete(documentName);
    for (const [tokenValue, token] of this.tokens) {
      if (token.documentName === documentName) {
        this.tokens.delete(tokenValue);
      }
    }
  }
}
