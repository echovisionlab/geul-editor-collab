import {
  DEFAULT_METADATA_AI_SHARED_STATE,
  extractMetadataAiSharedState,
  METADATA_AI_GRACE_PERIOD_MS,
  METADATA_AI_MAP_NAME,
} from "@echovisionlab/geul-common/collaboration/metadata-ai";
import * as Y from "yjs";
import { listConnectedMemberIds } from "./document-persistence.ts";

function sharedState(document: Y.Doc) {
  const map = document.getMap(METADATA_AI_MAP_NAME);
  return extractMetadataAiSharedState({
    get(key) {
      return map.get(key) as
        string | number | boolean | string[] | null | undefined;
    },
  });
}

function resetState(document: Y.Doc): void {
  const map = document.getMap(METADATA_AI_MAP_NAME);
  for (const [key, value] of Object.entries(DEFAULT_METADATA_AI_SHARED_STATE)) {
    map.set(key, key === "requestedFields" ? JSON.stringify(value) : value);
  }
}

function clearOrphanedState(document: Y.Doc, orphaned: boolean): void {
  if (!orphaned) {
    return;
  }
  const map = document.getMap(METADATA_AI_MAP_NAME);
  map.set("orphanedAt", null);
  map.set("autoClearAt", null);
  map.set("updatedAt", Date.now());
}

export class MetadataAiReconnectGrace {
  private readonly timers = new Map<Y.Doc, ReturnType<typeof setTimeout>>();
  private stopping = false;

  connected(document: Y.Doc, connectedMemberId?: string): void {
    const state = sharedState(document);
    if (state.status === "idle" || !state.requesterMemberId) {
      this.cancel(document);
      return;
    }

    if (
      connectedMemberId === state.requesterMemberId ||
      listConnectedMemberIds(document).includes(state.requesterMemberId)
    ) {
      this.cancel(document);
      clearOrphanedState(
        document,
        Boolean(state.orphanedAt || state.autoClearAt),
      );
      return;
    }

    if (state.autoClearAt) {
      this.schedule(document, state.requesterMemberId, state.autoClearAt);
    }
  }

  loaded(document: Y.Doc): void {
    const state = sharedState(document);
    if (state.status === "idle" || !state.requesterMemberId) {
      this.cancel(document);
      return;
    }
    if (listConnectedMemberIds(document).includes(state.requesterMemberId)) {
      this.connected(document, state.requesterMemberId);
      return;
    }
    this.startOrResume(document, state.requesterMemberId, state.autoClearAt);
  }

  disconnected(document: Y.Doc): void {
    const state = sharedState(document);
    if (state.status === "idle" || !state.requesterMemberId) {
      this.cancel(document);
      return;
    }

    if (this.stopping) {
      this.cancel(document);
      resetState(document);
      return;
    }

    if (listConnectedMemberIds(document).includes(state.requesterMemberId)) {
      this.cancel(document);
      return;
    }

    this.startOrResume(document, state.requesterMemberId, state.autoClearAt);
  }

  preventsUnload(document: Y.Doc): boolean {
    return this.timers.has(document);
  }

  invalidate(document: Y.Doc): void {
    this.cancel(document);
    resetState(document);
  }

  beginShutdown(): void {
    this.stopping = true;
    for (const [document, timer] of this.timers) {
      clearTimeout(timer);
      resetState(document);
    }
    this.timers.clear();
  }

  private schedule(
    document: Y.Doc,
    requesterMemberId: string,
    autoClearAt: number,
  ): void {
    this.cancel(document);
    const timer = setTimeout(
      () => {
        this.timers.delete(document);

        const state = sharedState(document);
        const currentAutoClearAt = document
          .getMap(METADATA_AI_MAP_NAME)
          .get("autoClearAt");
        if (
          state.status === "idle" ||
          state.requesterMemberId !== requesterMemberId ||
          currentAutoClearAt !== autoClearAt
        ) {
          return;
        }
        if (listConnectedMemberIds(document).includes(requesterMemberId)) {
          this.connected(document, requesterMemberId);
          return;
        }
        resetState(document);
      },
      Math.max(0, autoClearAt - Date.now()),
    );
    timer.unref();
    this.timers.set(document, timer);
  }

  private startOrResume(
    document: Y.Doc,
    requesterMemberId: string,
    existingAutoClearAt: number | null,
  ): void {
    const now = Date.now();
    const autoClearAt =
      existingAutoClearAt ?? now + METADATA_AI_GRACE_PERIOD_MS;
    if (existingAutoClearAt === null) {
      const map = document.getMap(METADATA_AI_MAP_NAME);
      map.set("orphanedAt", now);
      map.set("autoClearAt", autoClearAt);
      map.set("updatedAt", now);
    }
    this.schedule(document, requesterMemberId, autoClearAt);
  }

  private cancel(document: Y.Doc): void {
    const timer = this.timers.get(document);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(document);
    }
  }
}
