import { create, toJson } from "@bufbuild/protobuf";
import {
  DocumentContentHeight,
  DocumentLayoutSchema,
  DocumentRegionPlacement,
} from "@echovisionlab/geul-proto/common/common_pb.ts";
import { describe, expect, it } from "vitest";
import { ResidentBlockMetadataState } from "./resident-block-metadata-state.ts";

describe("resident block metadata state", () => {
  it("bootstraps omitted document metadata as an empty projection at sequence zero", () => {
    const state = new ResidentBlockMetadataState();
    state.load("post:sparse:ko", { sourceMetadata: { locale: "ko" } });

    const bootstrap = state.bootstrap("post:sparse:ko");
    expect(bootstrap).toMatchObject({
      sourceMetadata: { locale: "ko" },
      documentMetadata: {},
      metadataSequence: 0,
    });
    bootstrap.documentMetadata.tagIds = ["local-copy-only"];
    expect(state.bootstrap("post:sparse:ko").documentMetadata).toEqual({});
  });

  it("merges release credit-note updates against the loaded locale metadata", () => {
    const state = new ResidentBlockMetadataState();
    state.load("release:1:ko", {
      sourceMetadata: {
        locale: "ko",
        creditNotes: [
          { creditId: "a", note: "peer" },
          { creditId: "b", note: "peer" },
          { creditId: "c", note: "new" },
        ],
      },
      localeMetadata: {
        locale: "ko",
        creditNotes: [
          { creditId: "a", note: "peer" },
          { creditId: "b", note: "peer" },
          { creditId: "c", note: "new" },
        ],
      },
    });

    expect(
      state.mergeUpdate("release:1:ko", {
        type: "release",
        observed: {
          creditNotes: [
            { creditId: "a", note: "old" },
            { creditId: "b", note: "old" },
          ],
        },
        creditNotes: [
          { creditId: "a", note: "mine" },
          { creditId: "b", note: "old" },
        ],
      }),
    ).toMatchObject({
      creditNotes: [
        { creditId: "a", note: "mine" },
        { creditId: "b", note: "peer" },
        { creditId: "c", note: "new" },
      ],
    });
  });

  it("requires a loaded and observed release credit-note collection", () => {
    const state = new ResidentBlockMetadataState();
    state.load("release:2:ko", {
      sourceMetadata: { locale: "ko", creditNotes: [] },
      localeMetadata: { locale: "ko", creditNotes: [] },
    });

    expect(() =>
      state.mergeUpdate("release:2:ko", {
        type: "release",
        creditNotes: [{ creditId: "a", note: "mine" }],
      }),
    ).toThrow("metadata_observed_collection_required");
    expect(
      state.mergeUpdate("release:2:ko", {
        type: "release",
        title: "Title only",
      }),
    ).toMatchObject({ title: "Title only" });

    state.load("release:3:ko", { sourceMetadata: { locale: "ko" } });
    expect(() =>
      state.mergeUpdate("release:3:ko", {
        type: "release",
        observed: { creditNotes: [] },
        creditNotes: [{ creditId: "a", note: "mine" }],
      }),
    ).toThrow("resident_credit_notes_not_loaded");
  });

  it("rejects malformed observed Release notes at the resident-state boundary", () => {
    const state = new ResidentBlockMetadataState();
    state.load("release:malformed:ko", {
      sourceMetadata: { locale: "ko", creditNotes: [] },
      localeMetadata: { locale: "ko", creditNotes: [] },
    });

    expect(() =>
      state.mergeUpdate("release:malformed:ko", {
        type: "release",
        creditNotes: [],
        observed: { creditNotes: null },
      }),
    ).toThrow("metadata_observed_collection_required");
  });

  it.each([
    ["post", { type: "post", scope: "document", categoryIds: [] }],
    ["post", { type: "post", scope: "document", tagIds: [] }],
    ["artist", { type: "artist", scope: "document", labelIds: [] }],
    ["artist", { type: "artist", scope: "document", socialLinks: {} }],
    ["label", { type: "label", scope: "document", socialLinks: {} }],
  ] as const)("requires observed %s collection metadata", (type, update) => {
    const state = new ResidentBlockMetadataState();
    state.load(`${type}:1:ko`, {
      sourceMetadata: { locale: "ko" },
      documentMetadata: {
        categoryIds: [],
        tagIds: [],
        labelIds: [],
        socialLinks: {},
      },
    });
    expect(() => state.mergeUpdate(`${type}:1:ko`, update as never)).toThrow(
      "metadata_observed_collection_required",
    );
  });

  it("applies locale and document acknowledgments in sequence", () => {
    const state = new ResidentBlockMetadataState();
    state.load("page:1:en", {
      sourceMetadata: {
        locale: "ko",
        title: "Source",
        summary: "Source summary",
      },
      localeMetadata: {
        locale: "en",
        title: "Target",
        summary: "Target summary",
      },
      documentMetadata: { categoryIds: ["category-1"], tagIds: [] },
    });

    expect(
      state.acknowledge(
        "page:1:en",
        { type: "page", title: "Target changed" },
        "ko",
        "en",
      ),
    ).toEqual({
      operation: "locale",
      values: { title: "Target changed" },
      sequence: 1,
    });
    expect(state.bootstrap("page:1:en")).toMatchObject({
      sourceMetadata: { title: "Source" },
      localeMetadata: { title: "Target changed" },
      metadataSequence: 1,
    });

    expect(
      state.acknowledge(
        "page:1:en",
        { type: "post", scope: "document", tagIds: ["tag-1"] },
        "ko",
        "en",
      ),
    ).toEqual({
      operation: "document",
      values: { tagIds: ["tag-1"] },
      sequence: 2,
    });
    expect(state.bootstrap("page:1:en")).toMatchObject({
      documentMetadata: {
        categoryIds: ["category-1"],
        tagIds: ["tag-1"],
      },
      metadataSequence: 2,
    });
  });

  it("keeps peer document metadata through merge and acknowledges sequence parity", () => {
    const state = new ResidentBlockMetadataState();
    state.load("artist:peer:en", {
      sourceMetadata: { locale: "en", title: "Artist" },
      localeMetadata: { locale: "en", title: "Artist" },
      documentMetadata: {
        socialLinks: {
          instagram: "peer-change",
          website: "peer-website",
          peerOnly: "preserved",
        },
        labelIds: ["label-base", "label-peer"],
      },
    });

    const merged = state.mergeUpdate("artist:peer:en", {
      type: "artist",
      scope: "document",
      socialLinks: {
        instagram: "local-change",
        website: "observed-website",
        localOnly: "added",
      },
      labelIds: ["label-base", "label-local"],
      observed: {
        socialLinks: {
          instagram: "observed-instagram",
          website: "observed-website",
        },
        labelIds: ["label-base"],
      },
    });

    expect(merged).toMatchObject({
      socialLinks: {
        instagram: "local-change",
        website: "peer-website",
        peerOnly: "preserved",
        localOnly: "added",
      },
      labelIds: ["label-base", "label-peer", "label-local"],
    });
    expect(
      state.acknowledge("artist:peer:en", merged, "en", "en"),
    ).toMatchObject({
      operation: "document",
      sequence: 1,
      values: {
        socialLinks: {
          instagram: "local-change",
          website: "peer-website",
          peerOnly: "preserved",
          localOnly: "added",
        },
        labelIds: ["label-base", "label-peer", "label-local"],
      },
    });
    expect(state.bootstrap("artist:peer:en")).toMatchObject({
      sourceMetadata: { title: "Artist" },
      documentMetadata: {
        socialLinks: {
          instagram: "local-change",
          website: "peer-website",
          peerOnly: "preserved",
          localOnly: "added",
        },
        labelIds: ["label-base", "label-peer", "label-local"],
      },
      metadataSequence: 1,
    });
  });

  it("applies source-locale ACKs to both source and locale projections", () => {
    const state = new ResidentBlockMetadataState();
    state.load("page:source:ko", {
      sourceMetadata: { locale: "ko", title: "Before", summary: "Old" },
      localeMetadata: { locale: "ko", title: "Before", summary: "Old" },
    });

    expect(
      state.acknowledge(
        "page:source:ko",
        { type: "page", title: "After", summary: null },
        "ko",
        "ko",
      ),
    ).toEqual({
      operation: "locale",
      values: { title: "After", summary: null },
      sequence: 1,
    });
    expect(state.bootstrap("page:source:ko")).toMatchObject({
      sourceMetadata: { locale: "ko", title: "After", summary: undefined },
      localeMetadata: { locale: "ko", title: "After", summary: undefined },
      metadataSequence: 1,
    });
  });

  it("rejects ACKs before load without consuming a sequence", () => {
    const state = new ResidentBlockMetadataState();
    expect(() =>
      state.acknowledge(
        "page:unloaded:ko",
        { type: "page", title: "After" },
        "ko",
        "ko",
      ),
    ).toThrow("resident_document_metadata_not_loaded");
    expect(() =>
      state.acknowledgePageLayout(
        "page:unloaded:ko",
        create(DocumentLayoutSchema, {}),
      ),
    ).toThrow("resident_document_metadata_not_loaded");

    state.load("page:unloaded:ko", { sourceMetadata: { locale: "ko" } });
    expect(
      state.acknowledge(
        "page:unloaded:ko",
        { type: "page", title: "After" },
        "ko",
        "ko",
      ).sequence,
    ).toBe(1);
  });

  it("does not advance sequence when canonical layout conversion fails", () => {
    const state = new ResidentBlockMetadataState();
    state.load("page:layout:ko", { sourceMetadata: { locale: "ko" } });

    expect(() =>
      state.acknowledgePageLayout("page:layout:ko", null as never),
    ).toThrow();
    expect(state.bootstrap("page:layout:ko").metadataSequence).toBe(0);
    expect(
      state.acknowledgePageLayout(
        "page:layout:ko",
        create(DocumentLayoutSchema, {}),
      ).sequence,
    ).toBe(1);
  });

  it("validates observed document collections against changed and loaded fields", () => {
    const state = new ResidentBlockMetadataState();
    state.load("post:invalid-observed:ko", {
      sourceMetadata: { locale: "ko" },
      documentMetadata: { categoryIds: [] },
    });

    expect(() =>
      state.mergeUpdate("post:invalid-observed:ko", {
        type: "post",
        scope: "document",
        observed: { categoryIds: [] },
      } as never),
    ).toThrow("metadata_observed_field_not_changed");
    expect(() =>
      state.mergeUpdate("post:invalid-observed:ko", {
        type: "post",
        scope: "document",
        categoryIds: ["category-local"],
        observed: { categoryIds: null },
      }),
    ).toThrow("metadata_observed_collection_required");

    state.load("post:missing-field:ko", { sourceMetadata: { locale: "ko" } });
    expect(() =>
      state.mergeUpdate("post:missing-field:ko", {
        type: "post",
        scope: "document",
        categoryIds: ["category-local"],
        observed: { categoryIds: [] },
      }),
    ).toThrow("metadata_observed_field_not_loaded");
  });

  it("treats empty observed metadata as a no-op and rejects it for an unloaded room", () => {
    const state = new ResidentBlockMetadataState();
    state.load("page:empty-observed:ko", {
      sourceMetadata: { locale: "ko" },
      documentMetadata: {},
    });
    const update = {
      type: "page",
      title: "Page title",
      observed: {},
    } as const;

    expect(state.mergeUpdate("page:empty-observed:ko", update)).toMatchObject(
      update,
    );
    expect(() =>
      state.mergeUpdate("page:unloaded-observed:ko", update),
    ).toThrow("resident_document_metadata_not_loaded");
  });

  it("acknowledges canonical page layouts and advances their sequence", () => {
    const state = new ResidentBlockMetadataState();
    const layout = create(DocumentLayoutSchema, {});
    state.load("page:1:ko", {
      sourceMetadata: { locale: "ko" },
      documentMetadata: {},
    });

    expect(state.acknowledgePageLayout("page:1:ko", layout)).toMatchObject({
      operation: "page_layout",
      sequence: 1,
      values: { documentLayout: expect.any(Object) },
    });
    expect(state.bootstrap("page:1:ko")).toMatchObject({
      metadataSequence: 1,
      documentMetadata: { documentLayout: expect.any(Object) },
    });
  });

  it("merges Page layout writes only against loaded and observed canonical values", () => {
    const state = new ResidentBlockMetadataState();
    const observed = create(DocumentLayoutSchema, {
      contentHeight: DocumentContentHeight.CONTENT,
      pageChrome: DocumentRegionPlacement.FLOW,
      footer: DocumentRegionPlacement.FLOW,
    });
    const current = create(DocumentLayoutSchema, {
      contentHeight: DocumentContentHeight.CONTENT,
      pageChrome: DocumentRegionPlacement.FLOW,
      footer: DocumentRegionPlacement.PINNED,
    });
    const desired = create(DocumentLayoutSchema, {
      contentHeight: DocumentContentHeight.VIEWPORT,
      pageChrome: DocumentRegionPlacement.FLOW,
      footer: DocumentRegionPlacement.FLOW,
    });
    state.load("page:1:ko", {
      sourceMetadata: { locale: "ko" },
      documentMetadata: {
        documentLayout: toJson(DocumentLayoutSchema, current, {
          alwaysEmitImplicit: true,
        }),
      },
    });

    expect(state.mergePageLayout("page:1:ko", desired, observed)).toMatchObject(
      {
        contentHeight: DocumentContentHeight.VIEWPORT,
        pageChrome: DocumentRegionPlacement.FLOW,
        footer: DocumentRegionPlacement.PINNED,
      },
    );
    expect(() =>
      state.mergePageLayout("page:1:ko", desired, undefined as never),
    ).toThrow("metadata_observed_layout_required");

    state.load("page:2:ko", { sourceMetadata: { locale: "ko" } });
    expect(() => state.mergePageLayout("page:2:ko", desired, current)).toThrow(
      "resident_page_layout_not_loaded",
    );
  });

  it("clears all state for a room", () => {
    const state = new ResidentBlockMetadataState();
    state.load("page:1:ko", { sourceMetadata: { locale: "ko" } });
    state.clear("page:1:ko");
    expect(() => state.bootstrap("page:1:ko")).toThrow(
      "resident_document_metadata_not_loaded",
    );
  });
});
