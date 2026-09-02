import type * as Y from "yjs";

const BLOCK_ROOM_ROOT = "block-document";
export const RESIDENT_BLOCK_ROOT_AUTHORITY_REPAIR_ORIGIN = Symbol(
  "resident-room-authority-repair",
);

export interface ResidentBlockRootAuthority {
  documentType: unknown;
  blockCatalogFingerprint: unknown;
  sourceLocale: unknown;
  roomLocale: unknown;
  hasProfile: boolean;
  profile: unknown;
}

export function captureResidentBlockRootAuthority(
  document: Y.Doc,
): ResidentBlockRootAuthority {
  const root = document.getMap<unknown>(BLOCK_ROOM_ROOT);
  return {
    documentType: root.get("documentType"),
    blockCatalogFingerprint: root.get("blockCatalogFingerprint"),
    sourceLocale: root.get("sourceLocale"),
    roomLocale: root.get("roomLocale"),
    hasProfile: root.has("profile"),
    profile: root.get("profile"),
  };
}

function restoreProfile(
  root: Y.Map<unknown>,
  expected: ResidentBlockRootAuthority,
): void {
  if (!expected.hasProfile) {
    root.delete("profile");
    return;
  }
  root.set("profile", expected.profile);
}

/**
 * Restores server-owned room identity after a client-authored Yjs update.
 * These fields are transport authority, not collaborative content: repairing
 * them keeps an otherwise valid edit in the resident room instead of turning
 * the local protocol violation into a document revision conflict.
 */
export function restoreResidentBlockRootAuthority(
  document: Y.Doc,
  expected: ResidentBlockRootAuthority,
): string[] {
  const root = document.getMap<unknown>(BLOCK_ROOM_ROOT);
  const actual = captureResidentBlockRootAuthority(document);
  const restored = [
    ...(actual.documentType === expected.documentType ? [] : ["documentType"]),
    ...(actual.blockCatalogFingerprint === expected.blockCatalogFingerprint
      ? []
      : ["blockCatalogFingerprint"]),
    ...(actual.sourceLocale === expected.sourceLocale ? [] : ["sourceLocale"]),
    ...(actual.roomLocale === expected.roomLocale ? [] : ["roomLocale"]),
    ...(actual.hasProfile === expected.hasProfile &&
    (!expected.hasProfile || actual.profile === expected.profile)
      ? []
      : ["profile"]),
  ];
  if (restored.length === 0) return restored;
  document.transact(() => {
    if (restored.includes("documentType"))
      root.set("documentType", expected.documentType);
    if (restored.includes("blockCatalogFingerprint"))
      root.set("blockCatalogFingerprint", expected.blockCatalogFingerprint);
    if (restored.includes("sourceLocale"))
      root.set("sourceLocale", expected.sourceLocale);
    if (restored.includes("roomLocale"))
      root.set("roomLocale", expected.roomLocale);
    if (restored.includes("profile")) restoreProfile(root, expected);
  }, RESIDENT_BLOCK_ROOT_AUTHORITY_REPAIR_ORIGIN);
  return restored;
}
