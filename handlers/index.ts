import {
  CollaborativeDocumentType,
  type DocumentHandler,
} from "@echovisionlab/geul-common/collaboration/document";
import { emailLayoutHandler } from "./email-layout.ts";
import { formHandler } from "./form.ts";
import { mapThemeHandler } from "./map-theme.ts";
import { menuHandler } from "./menu.ts";
import { postSeriesHandler } from "./post-series.ts";

const unsupportedHandler: DocumentHandler = {
  store: () => Promise.reject(new Error("Unsupported document type")),
  load: () => Promise.reject(new Error("Unsupported document type")),
};

const residentBlockRuntimeHandler: DocumentHandler = {
  store: () => Promise.reject(new Error("resident_block_runtime_required")),
  load: () => Promise.reject(new Error("resident_block_runtime_required")),
};

const residentVersionedBlockRuntimeHandler: DocumentHandler = {
  ...residentBlockRuntimeHandler,
  supportsVersionCheckpoints: true,
};

export const handlers: Record<CollaborativeDocumentType, DocumentHandler> = {
  [CollaborativeDocumentType.UNSPECIFIED]: unsupportedHandler,
  [CollaborativeDocumentType.POST]: residentVersionedBlockRuntimeHandler,
  [CollaborativeDocumentType.PAGE]: residentVersionedBlockRuntimeHandler,
  [CollaborativeDocumentType.CAMPAIGN]: residentBlockRuntimeHandler,
  [CollaborativeDocumentType.EMAIL_TEMPLATE]: residentBlockRuntimeHandler,
  [CollaborativeDocumentType.EMAIL_LAYOUT]: emailLayoutHandler,
  [CollaborativeDocumentType.TERMS_HISTORY]: residentBlockRuntimeHandler,
  [CollaborativeDocumentType.PRIVACY_HISTORY]: residentBlockRuntimeHandler,
  [CollaborativeDocumentType.WORK]: residentVersionedBlockRuntimeHandler,
  [CollaborativeDocumentType.ARTIST]: residentBlockRuntimeHandler,
  [CollaborativeDocumentType.RELEASE]: residentBlockRuntimeHandler,
  [CollaborativeDocumentType.LABEL]: residentBlockRuntimeHandler,
  [CollaborativeDocumentType.FORM]: formHandler,
  [CollaborativeDocumentType.MAP_THEME]: mapThemeHandler,
  [CollaborativeDocumentType.PROGRAM_EVENT]: residentBlockRuntimeHandler,
  [CollaborativeDocumentType.MENU]: menuHandler,
  [CollaborativeDocumentType.POST_SERIES]: postSeriesHandler,
};
