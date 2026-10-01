import { describe, expect, it } from "vitest";
import {
  parseSourceMetadataRequest,
  parsePostDocumentMetadataRequest,
  parseResidentDocumentMetadataRequest,
} from "./block-metadata-request.ts";

describe("resident Block metadata request parsing", () => {
  it("parses Post document reference updates", () => {
    expect(
      parsePostDocumentMetadataRequest({
        categoryIds: ["category-1"],
        tagIds: ["tag-1"],
        observed: { categoryIds: [], tagIds: [] },
      }),
    ).toMatchObject({
      update: { type: "post", scope: "document" },
    });
    expect(
      parsePostDocumentMetadataRequest({
        tagIds: [],
        observed: { tagIds: [] },
      }),
    ).toMatchObject({ update: { categoryIds: undefined, tagIds: [] } });
  });

  it.each([
    null,
    [],
    {},
    { unknown: [] },
    { categoryIds: "bad" },
    { categoryIds: [1] },
    { tagIds: "bad" },
    { tagIds: [1] },
  ])("rejects invalid Post document request %#", (value) => {
    expect(() => parsePostDocumentMetadataRequest(value as never)).toThrow(
      "request_body_invalid",
    );
  });

  it.each([
    { categoryIds: [] },
    { tagIds: [] },
    { categoryIds: [], observed: { tagIds: [] } },
    { tagIds: [], observed: { categoryIds: [] } },
    { tagIds: [], observed: { tagIds: undefined } },
  ])(
    "rejects Post collection writes without the matching baseline %#",
    (value) => {
      expect(() => parsePostDocumentMetadataRequest(value as never)).toThrow(
        "request_body_invalid",
      );
    },
  );

  it("parses complete Artist and Label document metadata", () => {
    expect(
      parseResidentDocumentMetadataRequest("artist", {
        realName: "Artist",
        countryCode: null,
        website: "https://example.com",
        socialLinks: { instagram: "artist" },
        slug: "artist",
        labelIds: ["label-1"],
        parentArtistId: null,
        observed: { socialLinks: {}, labelIds: [] },
      }).update,
    ).toMatchObject({ type: "artist", scope: "document", countryCode: null });
    expect(
      parseResidentDocumentMetadataRequest("label", {
        slug: "label",
        parentLabelId: null,
      }).update,
    ).toMatchObject({ type: "label", scope: "document", parentLabelId: null });
  });

  it.each([
    null,
    [],
    {},
    { unknown: true },
    { socialLinks: null },
    { socialLinks: [] },
    { socialLinks: { bad: 1 } },
    { socialLinks: {}, observed: { socialLinks: { bad: 1 } } },
    { website: 1 },
  ])("rejects invalid resident document request %#", (value) => {
    expect(() =>
      parseResidentDocumentMetadataRequest("artist", value as never),
    ).toThrow("request_body_invalid");
  });

  it("rejects invalid Artist label ids", () => {
    expect(() =>
      parseResidentDocumentMetadataRequest("artist", {
        labelIds: "bad",
      }),
    ).toThrow("request_body_invalid");
    expect(() =>
      parseResidentDocumentMetadataRequest("artist", {
        labelIds: [1],
      }),
    ).toThrow("request_body_invalid");
  });

  it.each([
    ["artist", { socialLinks: {} }],
    ["artist", { labelIds: [] }],
    ["artist", { labelIds: [], observed: { socialLinks: {} } }],
    ["label", { socialLinks: {} }],
    ["label", { socialLinks: {}, observed: {} }],
  ] as const)(
    "rejects %s collection writes without the matching baseline %#",
    (type, value) => {
      expect(() =>
        parseResidentDocumentMetadataRequest(type, value as never),
      ).toThrow("request_body_invalid");
    },
  );

  it.each([
    ["post", { title: null, summary: "Summary" }],
    ["page", { title: "Page", summary: null }],
    ["work", { sourceTitle: "Work", summary: "Summary" }],
    ["program-event", { title: "Event", summary: null }],
    ["artist", { title: "Artist" }],
    ["label", { title: "Label" }],
    ["terms-history", { title: "Terms" }],
    ["privacy-history", { title: "Privacy" }],
    ["campaign", { subject: "Campaign" }],
    ["email-template", { subject: "Template" }],
    [
      "release",
      {
        title: "Release",
        creditNotes: [{ creditId: "credit-1", note: "note" }],
        observed: { creditNotes: [] },
      },
    ],
  ] as const)("parses %s source metadata", (type, fields) => {
    expect(
      parseSourceMetadataRequest(
        type,
        fields as unknown as import("@bufbuild/protobuf").JsonValue,
      ),
    ).toMatchObject({
      update: { type },
    });
  });

  it.each([
    "post",
    "page",
    "work",
    "program-event",
    "artist",
    "label",
    "terms-history",
    "privacy-history",
    "campaign",
    "email-template",
    "release",
  ] as const)("omits every optional %s source field", (type) => {
    expect(parseSourceMetadataRequest(type, {})).toMatchObject({
      update: { type },
    });
  });

  it.each([null, [], { locale: "ko" }, { unknown: true }])(
    "rejects invalid source request %#",
    (value) => {
      expect(() => parseSourceMetadataRequest("post", value as never)).toThrow(
        "request_body_invalid",
      );
    },
  );

  it.each([
    null,
    {},
    [null],
    [[]],
    [{ creditId: 1, note: "note" }],
    [{ creditId: "id", note: 1 }],
    [{ creditId: "id", note: "note", unknown: true }],
  ])("rejects invalid Release credit notes %#", (creditNotes) => {
    expect(() =>
      parseSourceMetadataRequest("release", {
        creditNotes: creditNotes as never,
      }),
    ).toThrow("request_body_invalid");
  });

  it("parses only paired Release credit-note observations", () => {
    expect(
      parseSourceMetadataRequest("release", {
        creditNotes: [{ creditId: "credit-1", note: "mine" }],
        observed: {
          creditNotes: [{ creditId: "credit-1", note: "old" }],
        },
      }).update,
    ).toMatchObject({
      type: "release",
      observed: { creditNotes: [{ creditId: "credit-1", note: "old" }] },
    });
    expect(() =>
      parseSourceMetadataRequest("release", {
        title: "Release",
        creditNotes: [],
      }),
    ).toThrow("request_body_invalid");
    expect(
      parseSourceMetadataRequest("release", { title: "Release" }).update,
    ).toMatchObject({ type: "release", title: "Release" });
    expect(() =>
      parseSourceMetadataRequest("release", {
        creditNotes: [],
        observed: {},
      }),
    ).toThrow("request_body_invalid");
    expect(() =>
      parseSourceMetadataRequest("release", {
        observed: { creditNotes: [] },
      }),
    ).toThrow("request_body_invalid");
    expect(() =>
      parseSourceMetadataRequest("release", {
        creditNotes: [],
        observed: { creditNotes: [{ creditId: "credit-1", note: 1 }] },
      } as never),
    ).toThrow("request_body_invalid");
  });
});
