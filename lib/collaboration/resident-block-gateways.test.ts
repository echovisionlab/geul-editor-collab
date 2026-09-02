import { describe, expect, it, vi } from "vitest";
import { RichTextProfile } from "@echovisionlab/geul-proto/content/block_content_pb.ts";
import { createResidentBlockGateways } from "./resident-block-gateways.ts";

vi.mock("../api/resident-block-domain.ts", () => ({
  loadResidentRichTextDocument: vi.fn(),
  applyResidentRichTextBlockBatch: vi.fn().mockResolvedValue({
    documentRevision: "revision-2",
    changed: false,
    sourceChanged: false,
    locale: "en",
  }),
  updateResidentRichTextMetadata: vi.fn(),
}));

describe("resident Block gateway ACK projection", () => {
  it("omits an absent source epoch from a canonical rich-text save", async () => {
    const gateways = createResidentBlockGateways();
    expect(gateways.artist.checkpoint).toBeUndefined();
    await expect(
      gateways.artist.save("artist-1", "en", {
        expectedDocumentRevision: "revision-1",
        blockCatalogFingerprint: "catalog-v1",
        profile: RichTextProfile.COMPACT,
        baseMutations: [],
        locale: "en",
        localeMutations: [],
        affectedLocaleValueTargets: [],
        contributorMemberIds: [],
      }),
    ).resolves.toEqual({
      documentRevision: "revision-2",
      changed: false,
      sourceChanged: false,
      locale: "en",
    });
  });
});
