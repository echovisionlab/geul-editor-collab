import { afterEach, describe, expect, it, vi } from "vitest";
import { attachTrackOriginalAudio } from "./file-ingest.ts";

function response(
  result: string,
  currentFileId = "file-1",
  releaseId = "release-1",
): Response {
  return Response.json({ result, currentFileId, releaseId });
}

describe("typed Track original audio attachment API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ["ATTACH_TRACK_ORIGINAL_AUDIO_RESULT_APPLIED", "applied"],
    ["ATTACH_TRACK_ORIGINAL_AUDIO_RESULT_ALREADY_APPLIED", "already_applied"],
  ])("maps the generated %s result to %s", async (result, outcome) => {
    const fetchMock = vi.fn().mockResolvedValue(response(result));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      attachTrackOriginalAudio({
        trackId: "track-1",
        verifiedFileId: "file-1",
        ingestAttemptId: "attempt-1",
        expectedCurrentFileId: "file-old",
      }),
    ).resolves.toEqual({
      outcome,
      currentFileId: "file-1",
      releaseId: "release-1",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain("InternalFileIngestService/AttachTrackOriginalAudio");
    expect(JSON.parse(String(init.body))).toEqual({
      trackId: "track-1",
      verifiedFileId: "file-1",
      ingestAttemptId: "attempt-1",
      expectedCurrentFileId: "file-old",
    });
  });

  it("rejects unspecified, mismatched, and failed responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response("ATTACH_TRACK_ORIGINAL_AUDIO_RESULT_UNSPECIFIED"),
        ),
    );
    await expect(
      attachTrackOriginalAudio({
        trackId: "track-1",
        verifiedFileId: "file-1",
        ingestAttemptId: "attempt-1",
      }),
    ).rejects.toThrow("Invalid Track original audio attachment result");

    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response("ATTACH_TRACK_ORIGINAL_AUDIO_RESULT_APPLIED", "file-other"),
        ),
    );
    await expect(
      attachTrackOriginalAudio({
        trackId: "track-1",
        verifiedFileId: "file-1",
        ingestAttemptId: "attempt-1",
      }),
    ).rejects.toThrow("Invalid Track original audio attachment response");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(new Response(null, { status: 409 })),
    );
    await expect(
      attachTrackOriginalAudio({
        trackId: "track-1",
        verifiedFileId: "file-1",
        ingestAttemptId: "attempt-1",
      }),
    ).rejects.toThrow("Failed to attach Track original audio: 409");
  });
});
