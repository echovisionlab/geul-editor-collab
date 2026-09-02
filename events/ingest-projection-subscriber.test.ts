import {
  FileIngestMediaKind,
  Queues,
  TranscodeEntityType,
} from "@echovisionlab/geul-event";
import type { Server } from "@hocuspocus/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decode: vi.fn(),
  attach: vi.fn(),
  broadcast: vi.fn(),
  startQueueConsumer: vi.fn(),
}));

vi.mock("../lib/api/file-ingest.ts", () => ({
  attachTrackOriginalAudio: mocks.attach,
}));
vi.mock("../lib/postgresql/messaging.ts", () => ({
  startQueueConsumer: mocks.startQueueConsumer,
}));
vi.mock("../lib/entity-document-broadcast.ts", () => ({
  broadcastStatelessToEntityDocuments: mocks.broadcast,
}));
vi.mock("./file-ingest/decoder.ts", () => ({
  decodeFileIngestEvent: mocks.decode,
  fileIngestSourceToRuntimeSource: () => "upload",
}));

import {
  processIngestProjectionMessage,
  startIngestProjectionSubscriber,
} from "./ingest-projection-subscriber.ts";

const payload = new Uint8Array([1]);
const server = { hocuspocus: { documents: new Map() } } as unknown as Server;

function attachedEvent(overrides: Record<string, unknown> = {}) {
  return {
    entityType: TranscodeEntityType.TRACK,
    entityId: "track-1",
    fileId: "file-1",
    attemptId: "attempt-1",
    expectedCurrentFileId: undefined,
    mediaKind: FileIngestMediaKind.TRACK_AUDIO,
    stage: "attached",
    ...overrides,
  };
}

describe("Track original audio projection subscriber", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.decode.mockReturnValue(attachedEvent());
    mocks.broadcast.mockReturnValue(2);
    mocks.attach.mockResolvedValue({
      outcome: "applied",
      currentFileId: "file-1",
      releaseId: "release-1",
    });
  });

  it("registers the exact PGMQ worker and applies its payload", async () => {
    let handle:
      ((delivery: { payload: Uint8Array }) => Promise<void>) | undefined;
    mocks.startQueueConsumer.mockImplementation(async (options) => {
      handle = options.handle;
    });

    await startIngestProjectionSubscriber(server);

    expect(mocks.startQueueConsumer).toHaveBeenCalledWith(
      expect.objectContaining({
        queue: Queues.releaseTrackOriginalAudioProjection,
        expectedMessageType: "api.manage.v1.FileIngestAttachedEvent",
        visibilityTimeoutSeconds: 60,
        maxRetries: 60,
        retryDelaySeconds: 5,
        retryBackoff: 1,
      }),
    );
    await expect(handle?.({ payload })).resolves.toBeUndefined();
    expect(mocks.attach).toHaveBeenCalledWith({
      trackId: "track-1",
      verifiedFileId: "file-1",
      ingestAttemptId: "attempt-1",
      expectedCurrentFileId: undefined,
    });
  });

  it.each([
    ["applied", "applied"],
    ["already_applied", "already_applied"],
  ] as const)(
    "returns the typed %s attachment ACK",
    async (outcome, expected) => {
      mocks.attach.mockResolvedValue({
        outcome,
        currentFileId: "file-1",
        releaseId: "release-1",
      });

      await expect(
        processIngestProjectionMessage(server, payload),
      ).resolves.toEqual({
        outcome: expected,
        trackId: "track-1",
        fileId: "file-1",
        attemptId: "attempt-1",
        mediaKind: "TRACK_AUDIO",
        currentFileId: "file-1",
        releaseId: "release-1",
        broadcastCount: 2,
      });
      expect(mocks.broadcast).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: "release-1" }),
      );
    },
  );

  it("passes the optional expected current File CAS value", async () => {
    mocks.decode.mockReturnValue(
      attachedEvent({ expectedCurrentFileId: "file-old" }),
    );

    await processIngestProjectionMessage(server, payload);

    expect(mocks.attach).toHaveBeenCalledWith(
      expect.objectContaining({ expectedCurrentFileId: "file-old" }),
    );
  });

  it("rejects non-Track, non-audio, and incomplete projection identities", async () => {
    mocks.decode.mockReturnValueOnce(
      attachedEvent({ entityType: TranscodeEntityType.FILE }),
    );
    await expect(
      processIngestProjectionMessage(server, payload),
    ).rejects.toThrow("requires a Track audio event");
    mocks.decode.mockReturnValueOnce(
      attachedEvent({ mediaKind: FileIngestMediaKind.EDITOR_AUDIO }),
    );
    await expect(
      processIngestProjectionMessage(server, payload),
    ).rejects.toThrow("requires a Track audio event");
    for (const override of [
      { entityId: "" },
      { fileId: "" },
      { attemptId: "" },
    ]) {
      mocks.decode.mockReturnValueOnce(attachedEvent(override));
      await expect(
        processIngestProjectionMessage(server, payload),
      ).rejects.toThrow("requires Track, File, and attempt IDs");
    }
    mocks.decode.mockReturnValueOnce(
      attachedEvent({ expectedCurrentFileId: "  " }),
    );
    await expect(
      processIngestProjectionMessage(server, payload),
    ).rejects.toThrow("invalid expected File ID");
    expect(mocks.attach).not.toHaveBeenCalled();
  });

  it("supports an injected typed attachment API", async () => {
    const attachTrackOriginalAudio = vi.fn().mockResolvedValue({
      outcome: "already_applied",
      currentFileId: "file-1",
      releaseId: "release-1",
    });

    await processIngestProjectionMessage(server, payload, {
      attachTrackOriginalAudio,
    });

    expect(attachTrackOriginalAudio).toHaveBeenCalledOnce();
    expect(mocks.attach).not.toHaveBeenCalled();
  });
});
