import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { computeHash } from "./hash.ts";
import {
  assertDurableMediaState,
  assertNoManagedMediaReferences,
  findDurableMediaViolations,
  materializeDocumentRootTypes,
  sanitizeDurableMediaState,
} from "./durable-media-guard.ts";

function appendLegacyRichTextMediaNode(
  fragment: Y.XmlFragment,
  type: "audio" | "video" | "attachment" | "file",
  title: string,
): void {
  const blockGroup = new Y.XmlElement("blockGroup");
  const blockContainer = new Y.XmlElement("blockContainer");
  const media = new Y.XmlElement(type);
  blockContainer.setAttribute("id", `${type}-block`);
  media.setAttribute("fileId", `${type}-file`);
  media.setAttribute("name", `${type} shared name`);
  media.setAttribute("title", title);
  blockContainer.insert(0, [media]);
  blockGroup.insert(0, [blockContainer]);
  fragment.insert(fragment.length, [blockGroup]);
}

function collectXmlElements(
  value: Y.XmlFragment | Y.XmlElement,
  elements: Y.XmlElement[] = [],
): Y.XmlElement[] {
  for (const item of value.toArray()) {
    if (item instanceof Y.XmlElement) {
      elements.push(item);
      collectXmlElements(item, elements);
    }
  }
  return elements;
}

describe("durable media guard", () => {
  it("accepts ID-only media state and unrelated external URLs", () => {
    const doc = new Y.Doc();
    doc.getMap("post-meta").set("featuredImageFileId", "file-1");
    doc.getMap("form-hook").set("url", "https://hooks.example.com/incoming");

    const block = new Y.XmlElement("block");
    block.setAttribute("type", "image");
    block.setAttribute("fileId", "file-2");
    block.setAttribute("alt", "Cover");
    doc.getXmlFragment("document-store").insert(0, [block]);

    expect(findDurableMediaViolations(doc)).toEqual([]);
    expect(() => assertDurableMediaState("post:1", doc)).not.toThrow();
  });

  it("rejects entity image URLs and media block runtime props", () => {
    const doc = new Y.Doc();
    doc.getMap("post-meta").set("featuredImageUrl", "/asset/asset-1.webp");

    const block = new Y.XmlElement("block");
    block.setAttribute("type", "audio");
    block.setAttribute("fileId", "file-1");
    block.setAttribute("url", "/media/token/file-1.mp3");
    block.setAttribute("processingStatus", "ready");
    doc.getXmlFragment("document-store").insert(0, [block]);

    expect(findDurableMediaViolations(doc).map((item) => item.field)).toEqual([
      "featuredImageUrl",
      "url",
      "processingStatus",
    ]);
    expect(() => assertDurableMediaState("post:1", doc)).toThrow(
      "Refusing managed media state in post:1",
    );
  });

  it("finds managed fields nested in JSON strings and Y arrays", () => {
    const doc = new Y.Doc();
    doc.getMap("page-fields").set(
      "unitsJson",
      JSON.stringify([
        {
          id: "unit-1",
          meshFileId: "file-1",
          meshOptimizationUrl: "/media/x",
        },
      ]),
    );
    doc
      .getArray("items")
      .push([{ type: "video", hlsUrl: "/media/token/file/master.m3u8" }]);

    expect(findDurableMediaViolations(doc).map((item) => item.field)).toEqual([
      "meshOptimizationUrl",
      "hlsUrl",
    ]);
  });

  it("rejects canonical object keys and transient delivery aliases in either naming style", () => {
    const doc = new Y.Doc();
    const map = doc.getMap("legacy");
    map.set("arbitrary", "asset/asset-1.webp");
    map.set("objectKey", "legacy/object.webp");
    map.set("source_key", "legacy/source.wav");
    map.set("playbackUrl", "https://external.example/audio.mp3");

    expect(findDurableMediaViolations(doc).map((item) => item.field)).toEqual([
      "arbitrary",
      "objectKey",
      "source_key",
      "playbackUrl",
    ]);
  });

  it("leaves malformed domain JSON to its owning validator", () => {
    const doc = new Y.Doc();
    doc.getMap("page-fields").set("unitsJson", "not-json");

    expect(findDurableMediaViolations(doc)).toEqual([]);
  });

  it("materializes lazy root types before scanning raw persisted updates", () => {
    const source = new Y.Doc();
    source.getMap("page-fields").set(
      "unitsJson",
      JSON.stringify([
        {
          meshFileId: "file-1",
          meshOptimizationUrl: "/media/token/file.glb",
        },
      ]),
    );
    source
      .getArray("items")
      .push([{ type: "video", hlsUrl: "/media/token/master.m3u8" }]);
    source.getText("html-content").insert(0, "safe html");
    source.getText("unknown-text").insert(0, "safe text");
    const node = new Y.XmlElement("block");
    node.setAttribute("type", "image");
    node.setAttribute("url", "/asset/asset.webp");
    source.getXmlFragment("unknown-fragment").insert(0, [node]);
    source.getArray("unknown-array").push([{ fileId: "file-2" }]);

    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, Y.encodeStateAsUpdate(source));
    expect(
      [...loaded.share.values()].every(
        (value) => value.constructor.name === "AbstractType",
      ),
    ).toBe(true);

    expect(
      findDurableMediaViolations(loaded).map((item) => item.field),
    ).toEqual(["meshOptimizationUrl", "hlsUrl", "url"]);
    expect(loaded.getMap("page-fields")).toBeInstanceOf(Y.Map);
    expect(loaded.getArray("items")).toBeInstanceOf(Y.Array);
    expect(loaded.getText("html-content")).toBeInstanceOf(Y.Text);
    expect(loaded.getText("unknown-text")).toBeInstanceOf(Y.Text);
    expect(loaded.getXmlFragment("unknown-fragment")).toBeInstanceOf(
      Y.XmlFragment,
    );
    expect(loaded.getArray("unknown-array")).toBeInstanceOf(Y.Array);
  });

  it("sanitizes managed fields inside nested Y types and plain map values", () => {
    const source = new Y.Doc();
    source.clientID = 0;
    const root = source.getMap<unknown>("nested-root");
    root.set("safeJson", '{"fileId":"file-1"}');
    root.set("config", {
      imageUrl: "/asset/plain.webp",
      fileId: "file-2",
      metadataJson: '{"fileId":"file-2"}',
      malformedJson: '{"imageUrl":"/asset/plain-broken.webp"',
    });
    const nestedMap = new Y.Map<unknown>();
    nestedMap.set("imageUrl", "/asset/map.webp");
    root.set("nested", nestedMap);

    const nestedArrayMap = new Y.Map<unknown>();
    nestedArrayMap.set("imageUrl", "/asset/array.webp");
    source.getArray("items").push([nestedArrayMap]);

    const parent = new Y.XmlElement("parent");
    const child = new Y.XmlElement("image");
    child.setAttribute("type", "image");
    child.setAttribute("url", "/asset/child.webp");
    parent.insert(0, [child]);
    source.getXmlFragment("nested-fragment").insert(0, [parent]);

    const sanitized = sanitizeDurableMediaState(Y.encodeStateAsUpdate(source));
    expect(sanitized.removedFields).toBe(5);
    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, sanitized.state);
    materializeDocumentRootTypes(loaded);
    expect(findDurableMediaViolations(loaded)).toEqual([]);
    expect(loaded.getMap("nested-root").get("safeJson")).toBe(
      '{"fileId":"file-1"}',
    );
    expect(loaded.getMap("nested-root").get("config")).toEqual({
      fileId: "file-2",
      metadataJson: '{"fileId":"file-2"}',
    });
  });

  it("removes forbidden fields without discarding IDs, text, or external URLs", () => {
    const source = new Y.Doc();
    source.getMap("page-fields").set(
      "unitsJson",
      JSON.stringify([
        {
          id: "unit-1",
          meshFileId: "file-1",
          meshOptimizationCandidateId: "candidate-1",
          meshOptimizationSourceFileId: "file-1",
          meshOptimizationFileId: "optimized-file-1",
          meshOptimizationUrl: "/media/token/file.glb",
          website: "https://example.com/media/reference",
        },
      ]),
    );
    source
      .getMap("malformed")
      .set("payloadJson", '{"imageUrl":"/asset/broken"');
    source.getMap("malformed").set("domainJson", "not-json");
    source.getArray("items").push([
      {
        type: "audio",
        fileId: "file-2",
        duration: 30,
        name: "Shared track name",
        title: "Legacy localized title",
        caption: "Track",
      },
    ]);
    const block = new Y.XmlElement("block");
    block.setAttribute("type", "image");
    block.setAttribute("fileId", "file-3");
    block.setAttribute("url", "/asset/image.webp");
    source.getXmlFragment("document-store").insert(0, [block]);

    const input = Y.encodeStateAsUpdate(source);
    const sanitized = sanitizeDurableMediaState(input);
    expect(sanitized.changed).toBe(true);
    expect(sanitized.removedFields).toBe(5);

    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, sanitized.state);
    materializeDocumentRootTypes(loaded);
    const units = JSON.parse(
      String(loaded.getMap("page-fields").get("unitsJson")),
    ) as Array<Record<string, unknown>>;
    expect(units).toEqual([
      {
        id: "unit-1",
        meshFileId: "file-1",
        meshOptimizationCandidateId: "candidate-1",
        meshOptimizationSourceFileId: "file-1",
        meshOptimizationFileId: "optimized-file-1",
        website: "https://example.com/media/reference",
      },
    ]);
    expect(loaded.getMap("malformed").get("payloadJson")).toBeUndefined();
    expect(loaded.getMap("malformed").get("domainJson")).toBe("not-json");
    expect(loaded.getArray<Record<string, unknown>>("items").get(0)).toEqual({
      type: "audio",
      fileId: "file-2",
      name: "Shared track name",
      caption: "Track",
    });
    expect(loaded.getXmlFragment("document-store").toJSON()).not.toContain(
      "/asset/",
    );
    expect(findDurableMediaViolations(loaded)).toEqual([]);
  });

  it("removes legacy title keys and attributes from persisted rich-text media XML nodes", () => {
    const source = new Y.Doc();
    const fragment = source.getXmlFragment("document-store");
    appendLegacyRichTextMediaNode(fragment, "audio", "");
    appendLegacyRichTextMediaNode(fragment, "video", "Legacy video title");
    appendLegacyRichTextMediaNode(
      fragment,
      "attachment",
      "Legacy attachment title",
    );
    appendLegacyRichTextMediaNode(fragment, "file", "Legacy file title");
    const legacyAudio = collectXmlElements(fragment).find(
      (element) => element.nodeName === "audio",
    );
    const nestedElement = new Y.XmlElement("legacy-child");
    const nestedText = new Y.XmlText();
    nestedText.insert(0, "preserved");
    legacyAudio?.insert(0, [nestedElement, nestedText]);
    source.getArray("items").push([
      {
        type: "file",
        fileId: "plain-file",
        name: "plain shared name",
        title: "",
      },
    ]);

    expect(
      findDurableMediaViolations(source).map((violation) => violation.field),
    ).toEqual(["title", "title", "title", "title", "title"]);

    const sanitized = sanitizeDurableMediaState(Y.encodeStateAsUpdate(source));
    expect(sanitized).toMatchObject({
      changed: true,
      removedFields: 5,
    });

    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, sanitized.state);
    materializeDocumentRootTypes(loaded);
    const mediaElements = collectXmlElements(
      loaded.getXmlFragment("document-store"),
    ).filter((element) =>
      ["audio", "video", "attachment", "file"].includes(element.nodeName),
    );
    expect(mediaElements).toHaveLength(4);
    for (const element of mediaElements) {
      expect(element.getAttribute("title")).toBeUndefined();
    }
    expect(
      mediaElements.map((element) => element.getAttribute("fileId")),
    ).toEqual(["audio-file", "video-file", "attachment-file", "file-file"]);
    expect(mediaElements.map((element) => element.nodeName)).toEqual([
      "audio",
      "video",
      "attachment",
      "file",
    ]);
    expect(mediaElements[0]?.toJSON()).toContain(
      "<legacy-child></legacy-child>preserved",
    );
    expect(loaded.getArray<Record<string, unknown>>("items").get(0)).toEqual({
      type: "file",
      fileId: "plain-file",
      name: "plain shared name",
    });
    expect(findDurableMediaViolations(loaded)).toEqual([]);
  });

  it("removes legacy download flags from top-level and Columns media in JSON and Yjs XML", () => {
    const source = new Y.Doc();
    source.getMap("page-fields").set(
      "contentJson",
      JSON.stringify([
        {
          id: "audio-top",
          type: "audio",
          props: {
            fileId: "audio-file",
            name: "Top-level audio",
            allowOriginalDownload: true,
          },
        },
        {
          id: "columns",
          type: "columns",
          columns: [
            {
              sections: [
                {
                  id: "rich-text-nested",
                  type: "rich-text",
                  content: [
                    {
                      id: "attachment-nested",
                      type: "attachment",
                      props: {
                        fileId: "attachment-file",
                        name: "Nested attachment",
                        allow_original_download: false,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ]),
    );

    const topLevelFragment = source.getXmlFragment("document-store");
    appendLegacyRichTextMediaNode(topLevelFragment, "audio", "");
    const topLevelAudio = collectXmlElements(topLevelFragment).find(
      (element) => element.nodeName === "audio",
    );
    topLevelAudio?.removeAttribute("title");
    topLevelAudio?.setAttribute("allowOriginalDownload", "true");

    const nestedColumnsFragment = source.getXmlFragment(
      "section-rich-text-nested",
    );
    appendLegacyRichTextMediaNode(nestedColumnsFragment, "attachment", "");
    const nestedAttachment = collectXmlElements(nestedColumnsFragment).find(
      (element) => element.nodeName === "attachment",
    );
    nestedAttachment?.removeAttribute("title");
    nestedAttachment?.setAttribute("allow_original_download", "false");

    expect(
      findDurableMediaViolations(source).map((violation) => violation.field),
    ).toEqual([
      "allowOriginalDownload",
      "allow_original_download",
      "allowOriginalDownload",
      "allow_original_download",
    ]);

    const sanitized = sanitizeDurableMediaState(Y.encodeStateAsUpdate(source));
    expect(sanitized).toMatchObject({ changed: true, removedFields: 4 });

    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, sanitized.state);
    materializeDocumentRootTypes(loaded);
    const content = JSON.parse(
      String(loaded.getMap("page-fields").get("contentJson")),
    ) as Array<Record<string, unknown>>;
    const topProps = content[0]?.props as Record<string, unknown>;
    const nestedProps = (
      content[1]?.columns as Array<{
        sections: Array<{ content: Array<{ props: unknown }> }>;
      }>
    )[0]?.sections[0]?.content?.[0]?.props as Record<string, unknown>;
    expect(topProps).toEqual({ fileId: "audio-file", name: "Top-level audio" });
    expect(nestedProps).toEqual({
      fileId: "attachment-file",
      name: "Nested attachment",
    });

    const sanitizedTopAudio = collectXmlElements(
      loaded.getXmlFragment("document-store"),
    ).find((element) => element.getAttribute("fileId") === "audio-file");
    const sanitizedNestedAttachment = collectXmlElements(
      loaded.getXmlFragment("section-rich-text-nested"),
    ).find((element) => element.getAttribute("fileId") === "attachment-file");
    expect(
      sanitizedTopAudio?.getAttribute("allowOriginalDownload"),
    ).toBeUndefined();
    expect(
      sanitizedNestedAttachment?.getAttribute("allow_original_download"),
    ).toBeUndefined();
    expect(sanitizedTopAudio?.getAttribute("fileId")).toBe("audio-file");
    expect(sanitizedNestedAttachment?.getAttribute("fileId")).toBe(
      "attachment-file",
    );
    expect(findDurableMediaViolations(loaded)).toEqual([]);
  });

  it("produces stable bytes and hashes when sanitizing identical stale input repeatedly", () => {
    const source = new Y.Doc();
    const fragment = source.getXmlFragment("document-store");
    appendLegacyRichTextMediaNode(fragment, "audio", "Legacy title");
    source.getMap("page-fields").set(
      "unitsJson",
      JSON.stringify([
        {
          type: "file",
          fileId: "file-1",
          name: "Shared name",
          title: "Legacy title",
        },
      ]),
    );
    const staleState = Buffer.from(Y.encodeStateAsUpdate(source));

    const first = sanitizeDurableMediaState(staleState);
    const second = sanitizeDurableMediaState(staleState);
    const third = sanitizeDurableMediaState(staleState);

    expect(first.changed).toBe(true);
    expect(first.removedFields).toBe(2);
    expect(second.state).toEqual(first.state);
    expect(third.state).toEqual(first.state);
    expect(computeHash(second.state)).toBe(computeHash(first.state));
    expect(computeHash(third.state)).toBe(computeHash(first.state));
  });

  it("uses a bounded collision-free client ID when persisted state contains uint32 max", () => {
    const source = new Y.Doc();
    source.clientID = 0xffffffff;
    appendLegacyRichTextMediaNode(
      source.getXmlFragment("document-store"),
      "audio",
      "Legacy max-client title",
    );
    source.getMap("page-fields").set(
      "unitsJson",
      JSON.stringify([
        {
          type: "file",
          fileId: "max-client-file",
          name: "Shared max-client name",
          title: "Legacy max-client JSON title",
        },
      ]),
    );
    const staleState = Buffer.from(Y.encodeStateAsUpdate(source));

    const first = sanitizeDurableMediaState(staleState);
    const second = sanitizeDurableMediaState(staleState);
    const clients = new Set(
      Y.decodeUpdate(first.state).structs.map((struct) => struct.id.client),
    );

    expect(first.changed).toBe(true);
    expect(first.removedFields).toBe(2);
    expect(second.state).toEqual(first.state);
    expect(computeHash(second.state)).toBe(computeHash(first.state));
    expect(clients).toEqual(new Set([0, 0xffffffff]));
    expect(
      [...clients].every((clientId) => clientId >= 0 && clientId <= 0xffffffff),
    ).toBe(true);
  });

  it("rewrites managed references nested in JSON strings inside plain objects", () => {
    const source = new Y.Doc();
    source.getMap("root").set("config", {
      payloadJson: JSON.stringify({
        type: "image",
        fileId: "file-1",
        url: "/asset/image.webp",
      }),
    });

    const sanitized = sanitizeDurableMediaState(Y.encodeStateAsUpdate(source));
    expect(sanitized.changed).toBe(true);
    expect(sanitized.removedFields).toBe(1);

    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, sanitized.state);
    const config = loaded.getMap<Record<string, string>>("root").get("config");
    expect(JSON.parse(config?.payloadJson ?? "{}")).toEqual({
      type: "image",
      fileId: "file-1",
    });
  });

  it("returns the original update when no migration is needed", () => {
    expect(sanitizeDurableMediaState(Buffer.alloc(0))).toEqual({
      state: Buffer.alloc(0),
      changed: false,
      removedFields: 0,
    });

    const doc = new Y.Doc();
    doc.getMap("meta").set("fileId", "file-1");
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));

    expect(sanitizeDurableMediaState(state)).toEqual({
      state,
      changed: false,
      removedFields: 0,
    });
  });

  it("rejects managed references in generated strings, bytes, and objects", () => {
    expect(() =>
      assertNoManagedMediaReferences("html", '<img src="/assets/a.webp">'),
    ).toThrow("Refusing managed media reference in html");
    expect(() =>
      assertNoManagedMediaReferences(
        "json",
        new TextEncoder().encode('{"src":"/thumbnail/a"}'),
      ),
    ).toThrow("Refusing managed media reference in json");
    expect(() =>
      assertNoManagedMediaReferences("object", {
        src: "https://example.test/media/token/a.mp3",
      }),
    ).toThrow("Refusing managed media reference in object");
    expect(() =>
      assertNoManagedMediaReferences(
        "localhost-object",
        "http://localhost:3000/assets/local.webp",
      ),
    ).toThrow("Refusing managed media reference in localhost-object");
    expect(() =>
      assertNoManagedMediaReferences(
        "unmanaged-origin",
        "https://other.example.test/media/token/a.mp3",
      ),
    ).not.toThrow();
    expect(() =>
      assertNoManagedMediaReferences(
        "malformed-url",
        "https://example.test:bad-port/media/token/a.mp3",
      ),
    ).not.toThrow();
    expect(() =>
      assertNoManagedMediaReferences("key", "media/file-1.mp3"),
    ).toThrow("Refusing managed media reference in key");
    expect(() =>
      assertNoManagedMediaReferences("safe", undefined),
    ).not.toThrow();
    expect(() =>
      assertNoManagedMediaReferences("safe", "https://example.com/asset/a"),
    ).not.toThrow();
  });

  it("reports only the first eight violation details", () => {
    const doc = new Y.Doc();
    const map = doc.getMap("legacy");
    for (let index = 0; index < 10; index += 1) {
      map.set(`entry-${index}`, { imageUrl: `/asset/${index}.webp` });
    }

    expect(() => assertDurableMediaState("page:1", doc)).toThrow(/entry-7/);
    expect(() => assertDurableMediaState("page:1", doc)).not.toThrow(/entry-8/);
  });
});
