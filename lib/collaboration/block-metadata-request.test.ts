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
      }),
    ).toMatchObject({
      update: { type: "post", scope: "document" },
    });
    expect(parsePostDocumentMetadataRequest({ tagIds: [] })).toMatchObject({
      update: { categoryIds: undefined, tagIds: [] },
    });
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
});
