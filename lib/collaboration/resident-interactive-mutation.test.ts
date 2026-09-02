import type { JsonValue } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { BlockRoomLocaleData } from "./block-room-snapshot.ts";
import type { ResidentBlockPersistence } from "./resident-block-persistence.ts";
import {
  applyAcceptedResidentInteractiveMutation,
  type ResidentInteractiveMutationInput,
} from "./resident-interactive-mutation.ts";

const ENTITY_ID = "11111111-1111-4111-8111-111111111111";

type Persistence = ResidentBlockPersistence<JsonValue, BlockRoomLocaleData>;

function input(
  overrides: Partial<ResidentInteractiveMutationInput> = {},
): ResidentInteractiveMutationInput {
  return {
    expectedDocumentRevision: "document-before",
    acceptedDocumentRevision: "document-after",
    operations: [],
    origin: {},
    beforeApply: vi.fn(),
    ...overrides,
  };
}

function persistence(metadata?: {
  locale: string;
  sourceLocale: string;
}): Persistence {
  return {
    snapshot: vi.fn(() =>
      metadata
        ? {
            ...metadata,
            documentRevision: "document-before",
            localeExists: true,
            blockCatalogFingerprint: "fingerprint",
          }
        : undefined,
    ),
    assertExternalMutationReady: vi.fn(),
    acceptExternalMutation: vi.fn(),
  } as unknown as Persistence;
}

function apply(
  documentName: string,
  metadata: Parameters<typeof persistence>[0],
  mutation: ResidentInteractiveMutationInput,
): void {
  applyAcceptedResidentInteractiveMutation(
    persistence(metadata),
    new WeakSet(),
    documentName,
    new Y.Doc(),
    mutation,
  );
}

describe("resident interactive mutation revision roles", () => {
  it("rejects a non-resident document type", () => {
    expect(() =>
      apply(
        `form:${ENTITY_ID}:ko`,
        { locale: "ko", sourceLocale: "ko" },
        input(),
      ),
    ).toThrow(`resident_block_type_required:form:${ENTITY_ID}:ko`);
  });

  it("rejects an unloaded resident document", () => {
    expect(() => apply(`post:${ENTITY_ID}:ko`, undefined, input())).toThrow(
      `resident_document_not_loaded:post:${ENTITY_ID}:ko`,
    );
  });

  it("rejects a target tuple applied to the source room", () => {
    expect(() =>
      apply(
        `post:${ENTITY_ID}:ko`,
        { locale: "ko", sourceLocale: "ko" },
        input({
          acceptedDocumentRevision: "document-before",
          expectedTargetRevision: "target-before",
          acceptedTargetRevision: "target-after",
        }),
      ),
    ).toThrow("interactive_mutation_target_source_room_forbidden");
  });

  it.each([
    input({
      acceptedDocumentRevision: "document-after",
      expectedTargetRevision: "target-before",
      acceptedTargetRevision: "target-after",
    }),
    input({
      acceptedDocumentRevision: "document-before",
      expectedTargetRevision: "target-before",
    }),
  ])("rejects an invalid target revision tuple", (mutation) => {
    expect(() =>
      apply(
        `post:${ENTITY_ID}:en`,
        { locale: "en", sourceLocale: "ko" },
        mutation,
      ),
    ).toThrow("interactive_mutation_target_revision_tuple_invalid");
  });

  it("rejects a source tuple applied to a target room", () => {
    expect(() =>
      apply(
        `post:${ENTITY_ID}:en`,
        { locale: "en", sourceLocale: "ko" },
        input(),
      ),
    ).toThrow("interactive_mutation_source_target_room_forbidden");
  });

  it("requires a source mutation to advance the document revision", () => {
    expect(() =>
      apply(
        `post:${ENTITY_ID}:ko`,
        { locale: "ko", sourceLocale: "ko" },
        input({ acceptedDocumentRevision: "document-before" }),
      ),
    ).toThrow("interactive_mutation_document_revision_not_advanced");
  });
});
