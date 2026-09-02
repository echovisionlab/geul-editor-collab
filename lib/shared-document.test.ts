import { type DocumentLayout } from "@echovisionlab/geul-common/collaboration/document-layout";
import { CampaignTargetMode } from "@echovisionlab/geul-proto/secure/campaign_pb.ts";
import { pickPostSharedFields } from "@echovisionlab/geul-common/collaboration/post";
import {
  RELEASE_SOURCE_OWNED_FIELD_KEYS,
  RELEASE_SHARED_FIELD_KEYS,
} from "@echovisionlab/geul-common/collaboration/release";
import {
  pickWorkSharedFields,
  WORK_SOURCE_OWNED_FIELD_KEYS,
  WORK_SHARED_FIELD_KEYS,
} from "@echovisionlab/geul-common/collaboration/work";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  sanitizeArtistSharedDocumentState,
  sanitizeCampaignSharedDocumentState,
  sanitizeLabelSharedDocumentState,
  sanitizePageSharedDocumentState,
  sanitizePostSharedDocumentState,
  sanitizeProgramEventSharedDocumentState,
  sanitizeReleaseSharedDocumentState,
  sanitizeWorkSharedDocumentState,
} from "./shared-document.ts";

function decodeMap(
  update: Buffer | null,
  mapName: string,
): Map<string, unknown> {
  const doc = new Y.Doc();
  if (update) {
    Y.applyUpdate(doc, update);
  }
  const values = new Map<string, unknown>();
  doc.getMap<unknown>(mapName).forEach((value, key) => {
    values.set(key, value);
  });
  return values;
}

function decodeDoc(update: Buffer | null): Y.Doc {
  const doc = new Y.Doc();
  if (update) {
    Y.applyUpdate(doc, update);
  }
  return doc;
}

function writeLayout(map: Y.Map<unknown>, layout: DocumentLayout): void {
  map.set("contentHeight", layout.contentHeight);
  map.set("pageChrome", layout.pageChrome);
  map.set("footer", layout.footer);
}

describe("shared-document ownership guards", () => {
  it("returns null for absent and empty shared states", () => {
    for (const sanitize of [
      sanitizePostSharedDocumentState,
      sanitizePageSharedDocumentState,
      sanitizeWorkSharedDocumentState,
      sanitizeProgramEventSharedDocumentState,
      sanitizeArtistSharedDocumentState,
      sanitizeLabelSharedDocumentState,
      sanitizeReleaseSharedDocumentState,
      sanitizeCampaignSharedDocumentState,
    ]) {
      expect(sanitize(null)).toBeNull();
      expect(sanitize(Buffer.alloc(0))).toBeNull();
    }
  });

  it("rebuilds campaign shared state with only exact canonical fields", () => {
    const doc = new Y.Doc();
    const fields = doc.getMap("campaign-fields");
    fields.set("targetMode", CampaignTargetMode.SEGMENT);
    fields.set("segmentId", "segment-1");
    fields.set("layoutId", "layout-1");
    fields.set("recipientScope", "ALL_MATCHING_USERS");
    fields.set("audienceId", "legacy-audience");
    fields.set("futureField", "must-not-survive");
    doc.getMap("legacy-target").set("segmentId", "legacy-segment");
    doc.getMap("unrelated").set("value", "must-not-survive");
    doc.getMap("translation-meta").set("title", "Localized campaign title");
    const fragment = doc.getXmlFragment("document-store");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Localized campaign body")]);
    fragment.insert(0, [paragraph]);

    const sanitizedState = sanitizeCampaignSharedDocumentState(
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
    const sanitizedDoc = decodeDoc(sanitizedState);

    expect([
      ...(sanitizedDoc as Y.Doc & { share: Map<string, unknown> }).share.keys(),
    ]).toEqual(["campaign-fields"]);
    expect(sanitizedDoc.getMap("campaign-fields").toJSON()).toEqual({
      targetMode: CampaignTargetMode.SEGMENT,
      segmentId: "segment-1",
      layoutId: "layout-1",
      recipientScope: "ALL_MATCHING_USERS",
    });
  });

  it("omits nullable campaign fields from its canonical shared state", () => {
    const doc = new Y.Doc();
    const fields = doc.getMap("campaign-fields");
    fields.set("targetMode", CampaignTargetMode.ALL);
    fields.set("recipientScope", "SUBSCRIBED_USERS");

    const sanitizedState = sanitizeCampaignSharedDocumentState(
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
    const sanitizedDoc = decodeDoc(sanitizedState);

    expect(sanitizedDoc.getMap("campaign-fields").toJSON()).toEqual({
      targetMode: CampaignTargetMode.ALL,
      recipientScope: "SUBSCRIBED_USERS",
    });
  });

  it("rejects malformed canonical campaign values instead of inferring compatibility", () => {
    const doc = new Y.Doc();
    const fields = doc.getMap("campaign-fields");
    fields.set("targetMode", CampaignTargetMode.ALL);
    fields.set("segmentId", "legacy-segment");
    fields.set("recipientScope", "SUBSCRIBED_USERS");

    expect(() =>
      sanitizeCampaignSharedDocumentState(
        Buffer.from(Y.encodeStateAsUpdate(doc)),
      ),
    ).toThrow("Invalid campaign metadata: ALL must not include segmentId");
  });

  it.each([undefined, true, "UNSUPPORTED"])(
    "rejects a missing or invalid current recipient scope value: %s",
    (recipientScope) => {
      const doc = new Y.Doc();
      const fields = doc.getMap("campaign-fields");
      fields.set("targetMode", CampaignTargetMode.ALL);
      if (recipientScope !== undefined) {
        fields.set("recipientScope", recipientScope);
      }

      expect(() =>
        sanitizeCampaignSharedDocumentState(
          Buffer.from(Y.encodeStateAsUpdate(doc)),
        ),
      ).toThrow(
        "Invalid campaign metadata: recipientScope must be SUBSCRIBED_USERS or ALL_MATCHING_USERS",
      );
    },
  );

  it.each([
    ["an empty layout ID", CampaignTargetMode.ALL, undefined, ""],
    ["an unsupported target mode", 99, undefined, undefined],
    [
      "a segment target without a segment ID",
      CampaignTargetMode.SEGMENT,
      undefined,
      undefined,
    ],
  ])(
    "rejects %s in campaign shared metadata",
    (_caseName, targetMode, segmentId, layoutId) => {
      const doc = new Y.Doc();
      const fields = doc.getMap("campaign-fields");
      fields.set("targetMode", targetMode);
      fields.set("recipientScope", "SUBSCRIBED_USERS");
      if (segmentId !== undefined) {
        fields.set("segmentId", segmentId);
      }
      if (layoutId !== undefined) {
        fields.set("layoutId", layoutId);
      }

      expect(() =>
        sanitizeCampaignSharedDocumentState(
          Buffer.from(Y.encodeStateAsUpdate(doc)),
        ),
      ).toThrow("Invalid campaign metadata:");
    },
  );

  it("preserves unrelated roots when a shared ownership map is absent", () => {
    const doc = new Y.Doc();
    doc.getMap("unrelated").set("value", "preserved");
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));

    expect(
      decodeDoc(sanitizePostSharedDocumentState(state))
        .getMap("unrelated")
        .get("value"),
    ).toBeUndefined();

    for (const sanitize of [
      sanitizeWorkSharedDocumentState,
      sanitizeArtistSharedDocumentState,
      sanitizeReleaseSharedDocumentState,
    ]) {
      expect(decodeDoc(sanitize(state)).getMap("unrelated").get("value")).toBe(
        "preserved",
      );
    }
  });

  it("removes document layout from Page shared state", () => {
    const layout = {
      contentHeight: "viewport",
      pageChrome: "pinned",
      footer: "flow",
    } as const;
    const doc = new Y.Doc();
    writeLayout(doc.getMap("page-fields"), layout);
    const sanitized = decodeDoc(
      sanitizePageSharedDocumentState(Buffer.from(Y.encodeStateAsUpdate(doc))),
    );
    expect([...sanitized.getMap("page-fields").keys()]).toEqual([]);
  });

  it("removes a page sections root that contains only invalid null entries", () => {
    const doc = new Y.Doc();
    doc.getArray("sections").push([null]);

    const sanitized = decodeDoc(
      sanitizePageSharedDocumentState(Buffer.from(Y.encodeStateAsUpdate(doc))),
    );

    expect(sanitized.getArray("sections").length).toBe(0);
  });

  it("hard-cuts Page shared state to section structure only", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>("page-fields");
    map.set("title", "Source title");
    map.set("summary", "Source summary");
    map.set("slug", "page-slug");
    map.set("status", "published");
    map.set("showTitle", true);
    writeLayout(map, {
      contentHeight: "viewport",
      pageChrome: "pinned",
      footer: "flow",
    });

    const sanitizedState = sanitizePageSharedDocumentState(
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
    const sanitized = decodeMap(sanitizedState, "page-fields");

    expect([...sanitized.keys()]).toEqual([]);
  });

  it("deduplicates page structure while stripping locale-owned rich text from shared state", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>("page-fields");
    map.set("title", "Source title");
    map.set("summary", "Source summary");
    map.set("slug", "page-slug");

    const sections = doc.getArray<unknown>("sections");
    sections.push([
      {
        id: "section-map",
        type: "map",
        settings: {},
        props: { caption: "Map caption source sample" },
      },
      {
        id: "section-rich",
        type: "rich-text",
        settings: {},
      },
      {
        id: "section-map",
        type: "map",
        settings: {},
        props: { caption: "Duplicate map caption should be removed" },
      },
      {
        id: "section-rich",
        type: "rich-text",
        settings: {},
      },
    ]);

    const fragment = doc.getXmlFragment("section-section-rich");
    const orphanFragment = doc.getXmlFragment("section-orphan");
    orphanFragment.insert(0, [new Y.XmlElement("temporary")]);
    const emptyFragment = doc.getXmlFragment("section-empty");
    emptyFragment.insert(0, [new Y.XmlElement("temporary")]);
    emptyFragment.delete(0, 1);
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Rich text body")]);
    fragment.insert(0, [paragraph]);

    const sanitizedState = sanitizePageSharedDocumentState(
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
    const sanitizedDoc = decodeDoc(sanitizedState);

    const sanitizedFields = new Map<string, unknown>();
    sanitizedDoc.getMap<unknown>("page-fields").forEach((value, key) => {
      sanitizedFields.set(key, value);
    });

    expect(sanitizedFields.has("title")).toBe(false);
    expect(sanitizedFields.has("summary")).toBe(false);
    expect(sanitizedFields.has("slug")).toBe(false);

    const sanitizedSections = sanitizedDoc
      .getArray<unknown>("sections")
      .toArray() as Array<{
      id: string;
      props?: { caption?: string };
    }>;
    expect(sanitizedSections).toHaveLength(2);
    expect(sanitizedSections[0]?.id).toBe("section-map");
    expect(sanitizedSections[0]?.props?.caption).toBeUndefined();

    const sanitizedFragment = sanitizedDoc.getXmlFragment(
      "section-section-rich",
    );
    expect(sanitizedFragment.length).toBe(1);
    expect(sanitizedFragment.toString()).toBe("<paragraph></paragraph>");
    expect(sanitizedDoc.getXmlFragment("section-orphan").length).toBe(0);
  });

  it("keeps immersive scene IDs and authored settings while stripping runtime metadata", () => {
    const doc = new Y.Doc();
    doc.getArray<unknown>("sections").push([
      {
        id: "scene-1",
        type: "immersive-scene",
        props: {
          unitsJson: JSON.stringify([
            {
              id: "unit-1",
              name: "Opening",
              mesh: "sphere",
              meshSource: "file",
              meshFileId: "mesh-source",
              meshObjectName: "Scene",
              meshOptimizationCandidateId: "candidate-1",
              meshOptimizationSourceFileId: "mesh-source",
              meshOptimizationFileId: "mesh-output",
              meshOptimizationMethod: "draco",
              meshOptimizationTargetRatioPercent: "70",
              scale: "1.5",
              meshOffsetY: "-1.2",
              particleSize: "4",
              holdSeconds: "3",
              rotationX: "15",
              rotationY: "-30",
              rotationZ: "45",
              rotationSpeedX: "0.1",
              rotationSpeedY: "-0.2",
              rotationSpeedZ: "0.3",
              scrollRotationTurnsX: "0.25",
              scrollRotationTurnsY: "-0.5",
              scrollRotationTurnsZ: "0.75",
              attribution: "Created by [Artist](https://example.com/artist)",
              color: "#ffffff",
              textureSource: "file",
              textureFileId: "texture-light",
              darkColor: "#000000",
              darkTextureSource: "file",
              darkTextureFileId: "texture-dark",
              meshUrl: "/media/token/mesh.glb",
              meshFileName: "mesh.glb",
              meshFileSize: 1000,
              meshOptimizationUrl: "/media/token/optimized.glb",
              meshOptimizationFileName: "optimized.glb",
              meshOptimizationFileSize: 700,
              meshOptimizationTriangleCount: 4096,
              meshOptimizationVertexCount: 2048,
            },
          ]),
          copyJson: JSON.stringify([
            { id: "unit-1", title: "Localized", text: "Copy" },
          ]),
        },
      },
    ]);

    const sanitized = decodeDoc(
      sanitizePageSharedDocumentState(Buffer.from(Y.encodeStateAsUpdate(doc))),
    )
      .getArray<Record<string, unknown>>("sections")
      .toArray();
    const props = sanitized[0]?.props as Record<string, unknown>;

    expect(JSON.parse(String(props.unitsJson))).toEqual([
      {
        id: "unit-1",
        name: "Opening",
        mesh: "sphere",
        meshSource: "file",
        meshFileId: "mesh-source",
        meshObjectName: "Scene",
        meshOptimizationCandidateId: "candidate-1",
        meshOptimizationSourceFileId: "mesh-source",
        meshOptimizationFileId: "mesh-output",
        scale: "1.5",
        meshOffsetY: "-1.2",
        particleSize: "4",
        holdSeconds: "3",
        rotationX: "15",
        rotationY: "-30",
        rotationZ: "45",
        rotationSpeedX: "0.1",
        rotationSpeedY: "-0.2",
        rotationSpeedZ: "0.3",
        scrollRotationTurnsX: "0.25",
        scrollRotationTurnsY: "-0.5",
        scrollRotationTurnsZ: "0.75",
        attribution: "Created by [Artist](https://example.com/artist)",
        color: "#ffffff",
        textureSource: "file",
        textureFileId: "texture-light",
        darkColor: "#000000",
        darkTextureSource: "file",
        darkTextureFileId: "texture-dark",
      },
    ]);
    expect(props.copyJson).toBeUndefined();
  });

  it("preserves malformed and nested column shapes while sanitizing valid nested sections", () => {
    const doc = new Y.Doc();
    doc.getArray<unknown>("sections").push([
      "legacy-section",
      { type: "map", props: "legacy-props" },
      {
        id: "columns-1",
        type: "columns",
        props: { title: "Localized title" },
        columns: [
          null,
          [],
          { sections: "legacy-sections" },
          {
            sections: [
              {
                id: "nested-map",
                type: "map",
                props: { caption: "Localized caption" },
              },
              {
                id: "nested-map",
                type: "map",
                props: { caption: "Duplicate" },
              },
            ],
          },
        ],
      },
    ]);

    const sanitized = decodeDoc(
      sanitizePageSharedDocumentState(Buffer.from(Y.encodeStateAsUpdate(doc))),
    )
      .getArray<Record<string, unknown>>("sections")
      .toArray();
    expect(sanitized[0]).toBe("legacy-section");
    expect(sanitized[1]).toEqual({ type: "map", props: "legacy-props" });
    const columns = sanitized[2]?.columns as unknown[];
    expect(columns[0]).toBeNull();
    expect(columns[1]).toEqual([]);
    expect((columns[3] as { sections: unknown[] }).sections).toEqual([
      { id: "nested-map", type: "map", props: {} },
    ]);
  });

  it("hard-cuts Post shared state to body structure only", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>("post-meta");
    map.set("title", "Source title");
    map.set("summary", "Source summary");
    map.set("slug", "post-slug");
    map.set("featuredImageFileId", "post-image-file");
    map.set("categoryIds", ["cat-1"]);
    map.set("tagIds", ["tag-1"]);
    map.set("commentsEnabled", false);
    map.set("seriesId", "series-1");
    map.set("seriesOrder", 2);
    map.set("mapPlaceId", "place-1");
    writeLayout(map, {
      contentHeight: "viewport",
      pageChrome: "flow",
      footer: "pinned",
    });
    const fragment = doc.getXmlFragment("document-store");
    const container = new Y.XmlElement("blockcontainer");
    container.setAttribute("id", "audio-1");
    const audio = new Y.XmlElement("file");
    audio.setAttribute("fileId", "file-1");
    audio.setAttribute("name", "Shared recording.wav");
    audio.setAttribute("state", "ready");
    audio.setAttribute("caption", "Localized caption");
    audio.setAttribute("url", "/media/transient");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Shared body should be stripped")]);
    container.insert(0, [audio, paragraph]);
    fragment.insert(0, [container]);

    const sanitizedState = sanitizePostSharedDocumentState(
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
    const sanitized = decodeMap(sanitizedState, "post-meta");
    const sanitizedDoc = decodeDoc(sanitizedState);

    expect([...sanitized.keys()]).toEqual([]);
    expect([
      ...(sanitizedDoc as Y.Doc & { share: Map<string, unknown> }).share.keys(),
    ]).toEqual(["document-store"]);
    const sanitizedContainer = sanitizedDoc
      .getXmlFragment("document-store")
      .get(0) as Y.XmlElement;
    const sanitizedAudio = sanitizedContainer.get(0) as Y.XmlElement;
    expect(sanitizedContainer.getAttribute("id")).toBe("audio-1");
    expect(sanitizedAudio.getAttributes()).toEqual({
      fileId: "file-1",
      name: "Shared recording.wav",
      state: "ready",
    });
    expect((sanitizedContainer.get(1) as Y.XmlElement).toString()).toBe(
      "<paragraph></paragraph>",
    );
  });

  it("drops unsupported XML hooks from durable Post and Page rich-text roots", () => {
    const post = new Y.Doc();
    post
      .getXmlFragment("document-store")
      .insert(0, [new Y.XmlHook("unsupported")] as unknown as Array<
        Y.XmlElement | Y.XmlText
      >);
    const sanitizedPost = decodeDoc(
      sanitizePostSharedDocumentState(Buffer.from(Y.encodeStateAsUpdate(post))),
    );
    expect(sanitizedPost.getXmlFragment("document-store").length).toBe(0);

    const page = new Y.Doc();
    page
      .getArray("sections")
      .push([{ id: "rich", type: "rich-text", settings: {} }]);
    page
      .getXmlFragment("section-rich")
      .insert(0, [new Y.XmlHook("unsupported")] as unknown as Array<
        Y.XmlElement | Y.XmlText
      >);
    const sanitizedPage = decodeDoc(
      sanitizePageSharedDocumentState(Buffer.from(Y.encodeStateAsUpdate(page))),
    );
    expect(sanitizedPage.getXmlFragment("section-rich").length).toBe(0);
  });

  it("sanitizes work shared state by stripping locale-owned keys and legacy status", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>("work-meta");
    map.set("title", "Source title");
    map.set("summary", "Source summary");
    map.set("status", "archived");
    map.set("slug", "work-slug");
    map.set("type", "portfolio");
    map.set("year", 2026);
    map.set("month", 3);
    map.set("metadata", { client: "Acme" });
    map.set("featuredImageFileId", "work-image-file");
    map.set("clients", ["client-1"]);
    const fragment = doc.getXmlFragment("document-store");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [
      new Y.XmlText("Localized work body should be stripped"),
    ]);
    fragment.insert(0, [paragraph]);

    const sanitizedState = sanitizeWorkSharedDocumentState(
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
    const sanitized = decodeMap(sanitizedState, "work-meta");
    const sanitizedDoc = decodeDoc(sanitizedState);

    expect([...sanitized.keys()].sort()).toEqual(
      [
        "slug",
        "type",
        "year",
        "month",
        "metadata",
        "featuredImageFileId",
        "clients",
      ].sort(),
    );
    for (const key of WORK_SOURCE_OWNED_FIELD_KEYS) {
      expect(sanitized.has(key)).toBe(false);
    }
    expect(sanitized.has("status")).toBe(false);
    expect(sanitized.get("slug")).toBe("work-slug");
    expect(sanitized.get("clients")).toEqual(["client-1"]);
    expect(sanitizedDoc.getXmlFragment("document-store").length).toBe(1);
    expect(sanitizedDoc.getXmlFragment("document-store").toString()).toBe(
      "<paragraph></paragraph>",
    );
  });

  it("keeps Program Event shared media identity while stripping locale-owned copy", () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("document-store");
    const container = new Y.XmlElement("blockcontainer");
    container.setAttribute("id", "image-1");
    const image = new Y.XmlElement("file");
    image.setAttribute("fileId", "file-2");
    image.setAttribute("name", "Shared still.webp");
    image.setAttribute("state", "ready");
    image.setAttribute("alt", "Localized alternative text");
    image.setAttribute("caption", "Localized caption");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Localized Event body")]);
    container.insert(0, [image, paragraph]);
    container.insert(2, [
      new Y.XmlHook("neutral-marker") as unknown as Y.XmlElement,
    ]);
    fragment.insert(0, [container]);

    const sanitizedDoc = decodeDoc(
      sanitizeProgramEventSharedDocumentState(
        Buffer.from(Y.encodeStateAsUpdate(doc)),
      ),
    );
    const sanitizedContainer = sanitizedDoc
      .getXmlFragment("document-store")
      .get(0) as Y.XmlElement;
    const sanitizedImage = sanitizedContainer.get(0) as Y.XmlElement;

    expect(sanitizedContainer.getAttribute("id")).toBe("image-1");
    expect(sanitizedImage.getAttributes()).toEqual({
      fileId: "file-2",
      name: "Shared still.webp",
      state: "ready",
    });
    expect((sanitizedContainer.get(1) as Y.XmlElement).toString()).toBe(
      "<paragraph></paragraph>",
    );
  });

  it("sanitizes artist shared state by stripping locale-owned keys and bio fragments", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>("artist-fields");
    map.set("name", "Localized artist title");
    map.set("status", "draft");
    map.set("slug", "artist-slug");

    const fragment = doc.getXmlFragment("artist-bio");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [
      new Y.XmlText("Shared artist bio should be stripped"),
    ]);
    fragment.insert(0, [paragraph]);

    const sanitizedState = sanitizeArtistSharedDocumentState(
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
    const sanitized = decodeMap(sanitizedState, "artist-fields");
    const sanitizedDoc = decodeDoc(sanitizedState);

    expect([...sanitized.keys()].sort()).toEqual(["slug", "status"].sort());
    expect(sanitized.has("name")).toBe(false);
    expect(sanitized.get("status")).toBe("draft");
    expect(sanitized.get("slug")).toBe("artist-slug");
    expect(sanitizedDoc.getXmlFragment("artist-bio").length).toBe(0);
    expect(sanitizedDoc.getXmlFragment("document-store").length).toBe(0);
  });

  it("sanitizes label shared state to exact shared profile fields", () => {
    const doc = new Y.Doc();
    const fields = doc.getMap<unknown>("label-fields");
    fields.set("slug", "label-slug");
    fields.set("imageUrl", "https://cdn.example.com/legacy.png");
    fields.set("imageFileId", "legacy-file");
    fields.set("futureField", "must-not-survive");

    const legacyFragment = doc.getXmlFragment("label-description");
    const legacyParagraph = new Y.XmlElement("paragraph");
    legacyParagraph.insert(0, [
      new Y.XmlText("Shared label description should be stripped"),
    ]);
    legacyFragment.insert(0, [legacyParagraph]);

    const nextFragment = doc.getXmlFragment("document-store");
    const nextParagraph = new Y.XmlElement("paragraph");
    nextParagraph.insert(0, [
      new Y.XmlText("Shared label document-store should be stripped"),
    ]);
    nextFragment.insert(0, [nextParagraph]);

    const sanitizedState = sanitizeLabelSharedDocumentState(
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
    const sanitizedDoc = decodeDoc(sanitizedState);

    expect(sanitizedDoc.getMap<unknown>("label-fields").toJSON()).toEqual({
      slug: "label-slug",
    });
    expect(sanitizedDoc.getXmlFragment("label-description").length).toBe(0);
    expect(sanitizedDoc.getXmlFragment("document-store").length).toBe(0);
  });

  it("leaves unrelated Label roots untouched when the profile map is absent", () => {
    const doc = new Y.Doc();
    doc.getMap("unrelated").set("value", "preserved");
    const sanitized = decodeDoc(
      sanitizeLabelSharedDocumentState(Buffer.from(Y.encodeStateAsUpdate(doc))),
    );
    expect(sanitized.getMap("unrelated").get("value")).toBe("preserved");
  });

  it("sanitizes release shared state by stripping locale-owned keys and body fragments", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>("release-fields");
    map.set("title", "Localized release title");
    map.set("type", "album");
    map.set("releaseDate", "2026-03-30");
    map.set("status", "draft");
    map.set("spotifyUrl", "https://spotify.example.com/release");
    map.set("tracks", []);

    const fragment = doc.getXmlFragment("release-description");
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [
      new Y.XmlText("Shared release body should be stripped"),
    ]);
    fragment.insert(0, [paragraph]);

    const sanitizedState = sanitizeReleaseSharedDocumentState(
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
    const sanitized = decodeMap(sanitizedState, "release-fields");
    const sanitizedDoc = decodeDoc(sanitizedState);

    expect([...sanitized.keys()].sort()).toEqual(
      ["releaseDate", "spotifyUrl", "status", "tracks", "type"].sort(),
    );
    expect(RELEASE_SHARED_FIELD_KEYS).toContain("type");
    expect(RELEASE_SHARED_FIELD_KEYS).not.toContain("title");
    for (const key of RELEASE_SOURCE_OWNED_FIELD_KEYS) {
      expect(sanitized.has(key)).toBe(false);
    }
    expect(sanitized.get("type")).toBe("album");
    expect(sanitizedDoc.getXmlFragment("release-description").length).toBe(0);
    expect(sanitizedDoc.getXmlFragment("document-store").length).toBe(0);
  });

  it("strips legacy download flags from serialized release tracks without losing track data", () => {
    const doc = new Y.Doc();
    doc.getMap<unknown>("release-fields").set(
      "tracks",
      JSON.stringify([
        {
          id: "track-1",
          title: "Field recording",
          name: "Original shared name",
          audio_original_file_id: "file-1",
          allowOriginalDownload: true,
          allow_original_download: true,
          credits: [
            {
              id: "credit-1",
              credited_name: "Mix Engineer",
              credit_role: "Mixer",
            },
          ],
        },
      ]),
    );

    const sanitizedState = sanitizeReleaseSharedDocumentState(
      Buffer.from(Y.encodeStateAsUpdate(doc)),
    );
    const sanitized = decodeMap(sanitizedState, "release-fields");

    expect(JSON.parse(String(sanitized.get("tracks")))).toEqual([
      {
        id: "track-1",
        title: "Field recording",
        name: "Original shared name",
        audio_original_file_id: "file-1",
        credits: [
          {
            id: "credit-1",
            credited_name: "Mix Engineer",
            credit_role: "Mixer",
          },
        ],
      },
    ]);
  });

  it("picks only shared post/work fields for persistence guards", () => {
    expect(
      pickPostSharedFields({
        title: "Ignore me",
        summary: "Ignore me",
        categoryIds: ["category-1"],
        tagIds: ["tag-1"],
      }),
    ).toEqual({
      categoryIds: ["category-1"],
      tagIds: ["tag-1"],
    });

    expect(
      pickWorkSharedFields({
        title: "Ignore me",
        summary: "Ignore me",
        slug: "work-slug",
        type: "portfolio",
        featured: true,
        year: 2026,
        month: 3,
        untilYear: null,
        untilMonth: null,
        isPresent: false,
        metadata: { client: "Acme" },
        featuredImageFileId: "work-image-file",
        clients: ["client-1"],
      }),
    ).toEqual({
      slug: "work-slug",
      type: "portfolio",
      featured: true,
      year: 2026,
      month: 3,
      untilYear: null,
      untilMonth: null,
      isPresent: false,
      metadata: { client: "Acme" },
      featuredImageFileId: "work-image-file",
      clients: ["client-1"],
    });

    expect(WORK_SHARED_FIELD_KEYS).toContain("metadata");
  });

  it("keeps a shared RichText Page section even when its optional fragment is absent", () => {
    const page = new Y.Doc();
    page.getArray("sections").push([
      {
        id: "rich",
        type: "rich-text",
        settings: {},
        props: {},
      },
    ]);
    const sanitized = decodeDoc(
      sanitizePageSharedDocumentState(Buffer.from(Y.encodeStateAsUpdate(page))),
    );
    expect(sanitized.getArray("sections")).toHaveLength(1);
    expect(sanitized.getXmlFragment("section-rich")).toHaveLength(0);
  });
});
