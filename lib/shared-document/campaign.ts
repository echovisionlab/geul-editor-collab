import * as Y from "yjs";
import {
  extractCampaignDocumentMeta,
  type CampaignDocumentFieldValue,
  type CampaignDocumentMeta,
} from "../campaign-meta.ts";
import { decodeSharedDocument } from "./core.ts";

export function sanitizeCampaignSharedDocumentState(
  state: Buffer | Uint8Array | null,
): Buffer | null {
  if (!state || state.length === 0) {
    return null;
  }

  const sourceDocument = decodeSharedDocument(state);
  const meta = extractCampaignDocumentMeta(
    sourceDocument.getMap<CampaignDocumentFieldValue>("campaign-fields"),
  );
  return encodeCanonicalCampaignSharedDocument(meta);
}

function encodeCanonicalCampaignSharedDocument(
  meta: CampaignDocumentMeta,
): Buffer {
  const document = new Y.Doc();
  const fields = document.getMap<CampaignDocumentFieldValue>("campaign-fields");

  fields.set("targetMode", meta.targetMode);
  if (meta.segmentId !== null) {
    fields.set("segmentId", meta.segmentId);
  }
  if (meta.layoutId !== null) {
    fields.set("layoutId", meta.layoutId);
  }
  fields.set("recipientScope", meta.recipientScope);

  return Buffer.from(Y.encodeStateAsUpdate(document));
}
