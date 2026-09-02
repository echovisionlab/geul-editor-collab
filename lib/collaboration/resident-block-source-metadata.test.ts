import { describe, expect, it } from "vitest";
import { applyResidentSourceMetadataUpdate } from "./resident-block-source-metadata.ts";

describe("applyResidentSourceMetadataUpdate", () => {
  it("ignores document-only updates and absent source projections", () => {
    const current = { locale: "en", title: "Old" };
    expect(
      applyResidentSourceMetadataUpdate(current, {
        type: "post",
        scope: "document",
        tagIds: [],
      }),
    ).toBe(current);
    expect(
      applyResidentSourceMetadataUpdate(undefined, {
        type: "post",
        scope: "locale",
        title: "New",
      }),
    ).toBeUndefined();
  });

  it("projects source title/summary changes and clears nullable fields", () => {
    expect(
      applyResidentSourceMetadataUpdate(
        { locale: "en", title: "Old", summary: "Old summary" },
        { type: "post", scope: "locale", title: null, summary: "New" },
      ),
    ).toEqual({ locale: "en", title: undefined, summary: "New" });
    expect(
      applyResidentSourceMetadataUpdate(
        { locale: "en", title: "Old", summary: "Old summary" },
        { type: "post", scope: "locale" },
      ),
    ).toEqual({ locale: "en", title: "Old", summary: "Old summary" });
  });

  it("projects campaign subjects and release credit notes", () => {
    expect(
      applyResidentSourceMetadataUpdate(
        { locale: "en", subject: "Old" },
        { type: "campaign", subject: "New" },
      ),
    ).toEqual({ locale: "en", subject: "New" });
    expect(
      applyResidentSourceMetadataUpdate(
        {
          locale: "en",
          creditNotes: [{ creditId: "credit-old", note: "Old" }],
        },
        {
          type: "release",
          creditNotes: [
            { creditId: "credit-a", note: "A" },
            { creditId: "credit-b", note: "B" },
          ],
        },
      ),
    ).toEqual({
      locale: "en",
      creditNotes: [
        { creditId: "credit-a", note: "A" },
        { creditId: "credit-b", note: "B" },
      ],
    });
  });
});
