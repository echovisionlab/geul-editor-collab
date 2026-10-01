import { fromJson, toJson, type JsonValue } from "@bufbuild/protobuf";
import {
  DocumentLayoutSchema,
  type DocumentLayout,
} from "@echovisionlab/geul-proto/common/common_pb.ts";
import type { ResidentSourceMetadataProjection } from "../api/resident-block-domain.ts";
import { applyResidentSourceMetadataUpdate } from "./resident-block-source-metadata.ts";
import type {
  ResidentBlockMetadataAck,
  ResidentBlockMetadataUpdate,
} from "./resident-block-metadata.ts";
import {
  mergeMetadataValue,
  type DocumentMetadata,
} from "./resident-metadata-merge.ts";

export interface ResidentBlockMetadataLoad {
  sourceMetadata: ResidentSourceMetadataProjection;
  localeMetadata?: ResidentSourceMetadataProjection;
  documentMetadata?: DocumentMetadata;
}

export interface ResidentBlockMetadataBootstrap {
  sourceMetadata: ResidentSourceMetadataProjection;
  localeMetadata?: ResidentSourceMetadataProjection;
  documentMetadata: DocumentMetadata;
  metadataSequence: number;
}

type MetadataUpdate = NonNullable<ResidentBlockMetadataAck["metadataUpdate"]>;

export class ResidentBlockMetadataState {
  private readonly documentMetadata = new Map<string, DocumentMetadata>();
  private readonly metadataSequences = new Map<string, number>();
  private readonly sourceMetadata = new Map<
    string,
    ResidentSourceMetadataProjection
  >();
  private readonly localeMetadata = new Map<
    string,
    ResidentSourceMetadataProjection | undefined
  >();

  load(name: string, loaded: ResidentBlockMetadataLoad): void {
    this.documentMetadata.set(name, { ...loaded.documentMetadata });
    this.metadataSequences.set(name, 0);
    this.sourceMetadata.set(name, { ...loaded.sourceMetadata });
    this.localeMetadata.set(
      name,
      loaded.localeMetadata ? { ...loaded.localeMetadata } : undefined,
    );
  }

  clear(name: string): void {
    this.documentMetadata.delete(name);
    this.metadataSequences.delete(name);
    this.sourceMetadata.delete(name);
    this.localeMetadata.delete(name);
  }

  bootstrap(name: string): ResidentBlockMetadataBootstrap {
    const sourceMetadata = this.sourceMetadata.get(name);
    if (!sourceMetadata)
      throw new Error("resident_document_metadata_not_loaded");
    const localeMetadata = this.localeMetadata.get(name);
    const documentMetadata = this.documentMetadata.get(name);
    return {
      sourceMetadata,
      ...(localeMetadata === undefined ? {} : { localeMetadata }),
      documentMetadata: { ...documentMetadata! },
      metadataSequence: this.metadataSequences.get(name)!,
    };
  }

  mergeUpdate(
    name: string,
    update: ResidentBlockMetadataUpdate,
  ): ResidentBlockMetadataUpdate {
    if (hasChangedCollectionWithoutObservation(update)) {
      throw new Error("metadata_observed_collection_required");
    }
    if (!update.observed) return update;
    if (isObservedReleaseCreditNotesUpdate(update)) {
      return this.mergeReleaseCreditNotes(name, update);
    }
    return this.mergeObservedDocumentMetadata(name, update, update.observed);
  }

  acknowledge(
    name: string,
    update: ResidentBlockMetadataUpdate,
    sourceLocale: string,
    locale: string,
  ): MetadataUpdate {
    const currentSequence = this.currentSequence(name);
    const next = applyResidentSourceMetadataUpdate(
      this.localeMetadata.get(name),
      update,
    );
    const operation = metadataOperation(update);
    const values = canonicalMetadataValues(update);
    const nextDocumentMetadata =
      operation === "document"
        ? { ...this.documentMetadata.get(name), ...values }
        : undefined;
    const sequence = currentSequence + 1;

    this.localeMetadata.set(name, next);
    if (locale === sourceLocale && next) this.sourceMetadata.set(name, next);
    if (operation === "document") {
      this.documentMetadata.set(name, nextDocumentMetadata!);
    }
    this.metadataSequences.set(name, sequence);
    return { operation, values, sequence };
  }

  mergePageLayout(
    name: string,
    desired: DocumentLayout,
    observed: DocumentLayout,
  ): DocumentLayout {
    const current = this.documentMetadata.get(name)?.documentLayout;
    if (observed === undefined) {
      throw new Error("metadata_observed_layout_required");
    }
    if (current === undefined) {
      throw new Error("resident_page_layout_not_loaded");
    }
    return fromJson(
      DocumentLayoutSchema,
      mergeMetadataValue(
        current,
        toJson(DocumentLayoutSchema, observed, { alwaysEmitImplicit: true }),
        toJson(DocumentLayoutSchema, desired, { alwaysEmitImplicit: true }),
      ),
    );
  }

  acknowledgePageLayout(name: string, layout: DocumentLayout): MetadataUpdate {
    const currentSequence = this.currentSequence(name);
    const values = {
      documentLayout: toJson(DocumentLayoutSchema, layout, {
        alwaysEmitImplicit: true,
      }),
    };
    const sequence = currentSequence + 1;
    this.documentMetadata.set(name, {
      ...this.documentMetadata.get(name),
      ...values,
    });
    this.metadataSequences.set(name, sequence);
    return {
      operation: "page_layout",
      values,
      sequence,
    };
  }

  private mergeReleaseCreditNotes(
    name: string,
    update: Extract<ResidentBlockMetadataUpdate, { type: "release" }>,
  ): ResidentBlockMetadataUpdate {
    const current = this.localeMetadata.get(name)?.creditNotes;
    const observed = update.observed?.creditNotes as
      { creditId: string; note: string }[] | undefined;
    if (!observed) {
      throw new Error("metadata_observed_collection_required");
    }
    if (current === undefined) {
      throw new Error("resident_credit_notes_not_loaded");
    }
    const merged = mergeMetadataValue(
      notesByCreditId(current),
      notesByCreditId(observed),
      notesByCreditId(update.creditNotes!),
    ) as Record<string, string>;
    return {
      ...update,
      creditNotes: Object.entries(merged).map(([creditId, note]) => ({
        creditId,
        note,
      })),
    };
  }

  private mergeObservedDocumentMetadata(
    name: string,
    update: ResidentBlockMetadataUpdate,
    observedMetadata: DocumentMetadata,
  ): ResidentBlockMetadataUpdate {
    const current = this.documentMetadata.get(name);
    if (!current) throw new Error("resident_document_metadata_not_loaded");
    const merged = { ...update };
    for (const [key, observed] of Object.entries(observedMetadata)) {
      const desired = (update as unknown as DocumentMetadata)[key];
      if (desired === undefined)
        throw new Error("metadata_observed_field_not_changed");
      if (!Object.hasOwn(current, key))
        throw new Error("metadata_observed_field_not_loaded");
      (merged as unknown as DocumentMetadata)[key] = mergeMetadataValue(
        current[key],
        observed,
        desired,
      );
    }
    return merged;
  }

  private currentSequence(name: string): number {
    const current = this.metadataSequences.get(name);
    if (current === undefined)
      throw new Error("resident_document_metadata_not_loaded");
    return current;
  }
}

function isObservedReleaseCreditNotesUpdate(
  update: ResidentBlockMetadataUpdate,
): update is Extract<ResidentBlockMetadataUpdate, { type: "release" }> {
  return (
    update.type === "release" &&
    update.observed?.creditNotes !== undefined &&
    update.creditNotes !== undefined
  );
}

function hasChangedCollectionWithoutObservation(
  update: ResidentBlockMetadataUpdate,
): boolean {
  const fields = changedCollectionFields(update);
  const values = update as unknown as Record<string, unknown>;
  return fields.some(
    (field) =>
      values[field] !== undefined && update.observed?.[field] === undefined,
  );
}

function changedCollectionFields(
  update: ResidentBlockMetadataUpdate,
): readonly string[] {
  if (update.type === "post" && update.scope === "document") {
    return ["categoryIds", "tagIds"];
  }
  if (
    update.type === "artist" &&
    "scope" in update &&
    update.scope === "document"
  ) {
    return ["socialLinks", "labelIds"];
  }
  if (
    update.type === "label" &&
    "scope" in update &&
    update.scope === "document"
  ) {
    return ["socialLinks"];
  }
  return update.type === "release" ? ["creditNotes"] : [];
}

function notesByCreditId(
  notes: readonly { creditId: string; note: string }[],
): Record<string, JsonValue> {
  return Object.fromEntries(
    notes.map(({ creditId, note }) => [creditId, note]),
  );
}

function metadataOperation(
  update: ResidentBlockMetadataUpdate,
): "locale" | "document" {
  return "scope" in update && update.scope === "document"
    ? "document"
    : "locale";
}

function canonicalMetadataValues(
  update: ResidentBlockMetadataUpdate,
): DocumentMetadata {
  return Object.fromEntries(
    Object.entries(update).filter(
      ([key, value]) =>
        value !== undefined && !["type", "scope", "observed"].includes(key),
    ),
  ) as DocumentMetadata;
}
