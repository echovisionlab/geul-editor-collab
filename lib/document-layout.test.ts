import {
  DEFAULT_DOCUMENT_LAYOUT,
  type DocumentLayout,
} from "@echovisionlab/geul-common/collaboration/document-layout";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  assertLocaleDocumentLayoutAbsent,
  assertSharedDocumentLayoutBoundary,
  computePageStructureHash,
  documentSettingsMapName,
  hasCanonicalSharedDocumentLayout,
  normalizeSharedDocumentLayoutState,
  readSharedDocumentLayoutFromState,
} from "./document-layout.ts";

function decodeDocument(state: Uint8Array): Y.Doc {
  const document = new Y.Doc();
  Y.applyUpdate(document, state);
  return document;
}

function writeLayout(map: Y.Map<unknown>, layout: DocumentLayout): void {
  map.set("contentHeight", layout.contentHeight);
  map.set("pageChrome", layout.pageChrome);
  map.set("footer", layout.footer);
}

describe("canonical document layout ownership", () => {
  it("uses only the existing Page and Post settings maps", () => {
    expect(documentSettingsMapName("page")).toBe("page-fields");
    expect(documentSettingsMapName("post")).toBe("post-meta");
    expect(readSharedDocumentLayoutFromState("page")).toEqual(
      DEFAULT_DOCUMENT_LAYOUT,
    );
    expect(hasCanonicalSharedDocumentLayout("page")).toBe(false);
    expect(() => assertSharedDocumentLayoutBoundary("page")).not.toThrow();
    const unrelated = new Y.Doc();
    unrelated.getMap("unrelated").set("enabled", true);
    const unrelatedState = Y.encodeStateAsUpdate(unrelated);
    expect(() =>
      assertSharedDocumentLayoutBoundary("page", unrelatedState),
    ).not.toThrow();
    expect(hasCanonicalSharedDocumentLayout("page", unrelatedState)).toBe(
      false,
    );
  });

  it("writes defaults for missing canonical keys and preserves unrelated settings", () => {
    const page = new Y.Doc();
    page.getMap("page-fields").set("showTitle", true);
    const normalized = normalizeSharedDocumentLayoutState(
      "page",
      Y.encodeStateAsUpdate(page),
    );

    expect(
      Object.fromEntries(
        decodeDocument(normalized).getMap("page-fields").entries(),
      ),
    ).toEqual({
      showTitle: true,
      ...DEFAULT_DOCUMENT_LAYOUT,
    });
    expect(readSharedDocumentLayoutFromState("page", normalized)).toEqual(
      DEFAULT_DOCUMENT_LAYOUT,
    );
    expect(hasCanonicalSharedDocumentLayout("page", normalized)).toBe(true);
  });

  it("keeps an exact canonical state byte-for-byte", () => {
    const post = new Y.Doc();
    post.getMap("post-meta").set("commentsEnabled", true);
    writeLayout(post.getMap("post-meta"), {
      contentHeight: "viewport",
      pageChrome: "pinned",
      footer: "flow",
    });
    const state = Buffer.from(Y.encodeStateAsUpdate(post));

    expect(normalizeSharedDocumentLayoutState("post", state)).toEqual(state);
    expect(readSharedDocumentLayoutFromState("post", state)).toEqual({
      contentHeight: "viewport",
      pageChrome: "pinned",
      footer: "flow",
    });
  });

  it("rejects misplaced or invalid shared layout instead of reconstructing it", () => {
    const misplaced = new Y.Doc();
    writeLayout(misplaced.getMap("retired-settings"), {
      contentHeight: "viewport",
      pageChrome: "pinned",
      footer: "flow",
    });
    const misplacedState = Y.encodeStateAsUpdate(misplaced);

    expect(() =>
      assertSharedDocumentLayoutBoundary("page", misplacedState),
    ).toThrow("outside page-fields: retired-settings");
    expect(() =>
      normalizeSharedDocumentLayoutState("page", misplacedState),
    ).toThrow("outside page-fields: retired-settings");
    expect(() =>
      readSharedDocumentLayoutFromState("page", misplacedState),
    ).toThrow("outside page-fields: retired-settings");
    expect(hasCanonicalSharedDocumentLayout("page", misplacedState)).toBe(
      false,
    );

    const invalid = new Y.Doc();
    invalid.getMap("page-fields").set("footer", "sticky");
    const invalidState = Y.encodeStateAsUpdate(invalid);
    expect(() =>
      assertSharedDocumentLayoutBoundary("page", invalidState),
    ).toThrow();
    expect(() =>
      normalizeSharedDocumentLayoutState("page", invalidState),
    ).toThrow();
  });

  it("rejects the forbidden legacy document-layout root at runtime boundaries", () => {
    const legacy = new Y.Doc();
    writeLayout(legacy.getMap("document-layout"), DEFAULT_DOCUMENT_LAYOUT);
    const state = Y.encodeStateAsUpdate(legacy);

    expect(() => assertSharedDocumentLayoutBoundary("page", state)).toThrow(
      "Shared page Yjs contains forbidden legacy root: document-layout",
    );
    expect(() => assertLocaleDocumentLayoutAbsent("post", state)).toThrow(
      "Locale post Yjs contains forbidden legacy root: document-layout",
    );
  });

  it("rejects layout fields in every locale Yjs map", () => {
    expect(() => assertLocaleDocumentLayoutAbsent("page")).not.toThrow();

    const locale = new Y.Doc();
    locale.getMap("translation-meta").set("title", "Localized title");
    expect(() =>
      assertLocaleDocumentLayoutAbsent("page", Y.encodeStateAsUpdate(locale)),
    ).not.toThrow();

    locale.getMap("retired-settings").set("footer", "pinned");
    expect(() =>
      assertLocaleDocumentLayoutAbsent("page", Y.encodeStateAsUpdate(locale)),
    ).toThrow(
      "Locale page Yjs must not contain document layout fields: retired-settings",
    );
  });

  it("hashes only canonical Page section structure", () => {
    const first = new Y.Doc();
    first.getMap("page-fields").set("showTitle", true);
    writeLayout(first.getMap("page-fields"), DEFAULT_DOCUMENT_LAYOUT);
    first.getArray("sections").push([
      {
        id: "section-1",
        type: "map",
        settings: { width: "full", padding: 2 },
      },
    ]);

    const second = new Y.Doc();
    second.getMap("page-fields").set("showTitle", false);
    writeLayout(second.getMap("page-fields"), {
      ...DEFAULT_DOCUMENT_LAYOUT,
      footer: "pinned",
    });
    second.getArray("sections").push([
      {
        settings: { padding: 2, width: "full" },
        type: "map",
        id: "section-1",
      },
    ]);

    const firstHash = computePageStructureHash(Y.encodeStateAsUpdate(first));
    expect(firstHash).toBe(
      computePageStructureHash(Y.encodeStateAsUpdate(second)),
    );
    expect(computePageStructureHash()).toBe(
      computePageStructureHash(Y.encodeStateAsUpdate(new Y.Doc())),
    );

    second
      .getArray("sections")
      .push([{ id: "section-2", type: "rich-text", settings: {} }]);
    expect(computePageStructureHash(Y.encodeStateAsUpdate(second))).not.toBe(
      firstHash,
    );
  });
});
