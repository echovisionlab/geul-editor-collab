import type {
  CollaborativeDocumentType,
  FileIngestRuntimeStage,
  RuntimeEntityType,
} from "@echovisionlab/geul-common";
import type {
  FileIngestFailureReason,
  FileIngestIdentity,
  FileIngestMediaKind,
  FileIngestProgress,
  FileIngestSource,
} from "@echovisionlab/geul-event";

export interface ResolvedIngestDocument {
  documentType: CollaborativeDocumentType;
  documentEntityId: string;
  runtimeEntityType: RuntimeEntityType;
  trackId?: string;
  releaseId?: string;
}

export interface FileIngestProjectionEvent {
  timestampMs: bigint | number;
  entityId: string;
  fileId: string;
  slotId?: string;
  attemptId?: string;
  expectedCurrentFileId?: string;
  mediaKind: FileIngestMediaKind;
  stage: FileIngestRuntimeStage;
  failed?: {
    reason: FileIngestFailureReason;
    error?: string;
  };
  attached?: {
    fileName?: string;
    mimeType?: string;
    fileSize?: bigint | number;
  };
}

export interface FileIngestRuntimeEvent extends FileIngestProjectionEvent {
  identity: FileIngestIdentity;
  correlationId: string;
  sequenceNumber: bigint | number;
  entityType: number;
  uploadId?: string;
  source: FileIngestSource;
  progress?: FileIngestProgress;
}
