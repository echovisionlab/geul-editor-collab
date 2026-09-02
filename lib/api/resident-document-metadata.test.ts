import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateResidentRichTextDocumentMetadata } from "./resident-document-metadata.ts";
import {
  postInternalApi,
  throwIfCollaborationConflictResponse,
} from "./transport.ts";

vi.mock("./transport.ts", () => ({
  postInternalApi: vi.fn(),
  throwIfCollaborationConflictResponse: vi.fn(),
}));

describe("resident document metadata API", () => {
  beforeEach(() => {
    vi.mocked(postInternalApi)
      .mockReset()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            documentRevision: "revision-2",
            changed: true,
            sourceChanged: true,
            locale: "ko",
          }),
          { status: 200 },
        ),
      );
    vi.mocked(throwIfCollaborationConflictResponse).mockReset();
  });

  it("updates every Artist document field with set and clear semantics", async () => {
    await expect(
      updateResidentRichTextDocumentMetadata(
        "artist-1",
        "ko",
        {
          type: "artist",
          realName: "Artist",
          countryCode: null,
          website: "https://example.com",
          socialLinks: { instagram: "artist" },
          slug: null,
          labelIds: ["label-1"],
          parentArtistId: undefined,
        },
        "revision-1",
        ["member-1"],
      ),
    ).resolves.toEqual({
      documentRevision: "revision-2",
      changed: true,
      sourceChanged: true,
      changedLocales: [],
      locale: "ko",
    });
    expect(postInternalApi).toHaveBeenCalledWith(
      "/api.intra.v1.InternalArtistService/UpdateArtistDocumentMetadata",
      expect.any(Object),
    );
  });

  it("updates Label metadata with present and omitted containers", async () => {
    await updateResidentRichTextDocumentMetadata(
      "label-1",
      "ko",
      {
        type: "label",
        slug: "label",
        countryCode: undefined,
        website: null,
        socialLinks: undefined,
        parentLabelId: "parent-1",
      },
      "revision-1",
      [],
    );
    expect(postInternalApi).toHaveBeenCalledWith(
      "/api.intra.v1.InternalLabelService/UpdateLabelDocumentMetadata",
      expect.any(Object),
    );

    vi.mocked(postInternalApi).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          documentRevision: "revision-2",
          changed: true,
          sourceChanged: true,
          locale: "ko",
        }),
        { status: 200 },
      ),
    );
    await updateResidentRichTextDocumentMetadata(
      "label-2",
      "ko",
      {
        type: "label",
        socialLinks: { instagram: "label" },
      },
      "revision-1",
      [],
    );
  });

  it("omits optional Artist collection containers", async () => {
    await updateResidentRichTextDocumentMetadata(
      "artist-1",
      "ko",
      {
        type: "artist",
        socialLinks: undefined,
        labelIds: undefined,
      },
      "revision-1",
      [],
    );
    expect(postInternalApi).toHaveBeenCalledOnce();
  });

  it("rejects failed metadata responses after conflict classification", async () => {
    vi.mocked(postInternalApi).mockResolvedValueOnce(
      new Response("", { status: 503 }),
    );
    await expect(
      updateResidentRichTextDocumentMetadata(
        "label-1",
        "ko",
        {
          type: "label",
        },
        "revision-1",
        [],
      ),
    ).rejects.toThrow("Resident document metadata failed with HTTP 503");
    expect(throwIfCollaborationConflictResponse).toHaveBeenCalledOnce();
  });
});
