import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("./resident-block-rpc.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./resident-block-rpc.ts")>()),
  callResidentRpc: rpc.call,
}));

import { loadResidentBlockDocument } from "./resident-block-load.ts";

const principal = { sessionId: "session-1" } as never;

function response(metadata?: Record<string, unknown>) {
  return {
    document: { $typeName: "api.content.v1.LocalizedRichTextDocument" },
    documentRevision: "document-revision-7",
    locale: "ko",
    localeExists: true,
    presentLocaleValues: [],
    sourceMetadata: { locale: "ko", title: "Post title" },
    ...(metadata === undefined ? {} : { metadata }),
  } as never;
}

describe("resident Block document metadata projection", () => {
  afterEach(() => rpc.call.mockReset());

  it("returns authorized public metadata, omitting internal keys and normalizing undefined values", async () => {
    rpc.call.mockResolvedValueOnce(
      response({
        $internalRevision: "internal-9",
        documentTitle: "Post title",
        optionalValue: undefined,
      }),
    );

    const loaded = await loadResidentBlockDocument(
      "artist",
      "artist-1",
      "ko",
      principal,
    );

    expect(loaded.documentMetadata).toEqual({
      documentTitle: "Post title",
      optionalValue: null,
    });
    expect(loaded).toMatchObject({
      documentRevision: "document-revision-7",
      locale: "ko",
      sourceMetadata: { locale: "ko", title: "Post title" },
    });
    expect(rpc.call).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/api.intra.v1.InternalArtistService/LoadArtistBlockDocument",
        operation: "load Artist Block document",
      }),
      "artist",
      "artist-1",
      expect.objectContaining({
        artistId: "artist-1",
        locale: "ko",
        principal,
      }),
    );
  });

  it("omits the metadata projection when the API response has no metadata field", async () => {
    rpc.call.mockResolvedValueOnce(response());

    const loaded = await loadResidentBlockDocument(
      "artist",
      "artist-1",
      "ko",
      principal,
    );

    expect(loaded).not.toHaveProperty("documentMetadata");
  });
});
