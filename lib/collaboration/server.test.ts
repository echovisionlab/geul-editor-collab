import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  formFieldLabelTarget,
  formRootTitleTarget,
  formStepTitleTarget,
} from "@echovisionlab/geul-proto/intra/form_locale_catalog.ts";
import {
  CollaborativeDocumentType,
  createDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import {
  FORM_FIELDS_MAP_NAME,
  hydrateFormCanonicalRoom,
  type FormCollabFields,
} from "@echovisionlab/geul-common/collaboration/form";
import { EditSessionContributorTracker } from "./edit-session-contributors.ts";
import {
  FORM_SCHEMA_CHANGED_KIND,
  FORM_SCHEMA_PATCH_ACK_KIND,
  FORM_SCHEMA_PATCH_KIND,
  FORM_SCHEMA_PROTOCOL_VERSION,
} from "./form-schema-protocol.ts";

const serverMocks = vi.hoisted(() => ({
  persist: vi.fn(),
}));

vi.mock("@hocuspocus/server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@hocuspocus/server")>();
  class TestServer {
    readonly hocuspocus = {
      documents: new Map(),
      loadingDocuments: new Map(),
      handleConnection: vi.fn(),
    };

    constructor(readonly configuration: Record<string, unknown>) {}
  }
  return { ...original, Server: TestServer };
});

vi.mock("./document-persistence.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./document-persistence.ts")>()),
  persistCollaborativeDocument: serverMocks.persist,
}));

import { createCollabServer } from "./server.ts";

const FORM_ID = "11111111-1111-4111-8111-111111111111";
const DOCUMENT_NAME = createDocumentName(
  CollaborativeDocumentType.FORM,
  FORM_ID,
  "en",
);

function schema(firstLabel = "A", secondLabel = "B") {
  return {
    id: "schema-1",
    steps: [
      {
        id: "step-1",
        title: "Step",
        fields: [
          { id: "field-a", key: "a", type: "text", label: firstLabel },
          {
            id: "field-b",
            key: "b",
            type: "text",
            label: secondLabel,
            validation: { validators: [] },
          },
        ],
      },
    ],
  };
}

function fields(formSchema: unknown = schema()): FormCollabFields {
  return { title: "Form", schema: formSchema };
}

function makeRoom(connection: ReturnType<typeof makeConnection>) {
  const value = hydrateFormCanonicalRoom({
    sourceLocale: "en",
    locale: "en",
    source: fields(),
    requested: fields(),
    requestedExists: true,
    presentLocaleValues: [
      formRootTitleTarget(),
      formStepTitleTarget("step-1"),
      formFieldLabelTarget("field-a"),
      formFieldLabelTarget("field-b"),
    ],
  });
  const broadcastStateless = vi.fn();
  Object.assign(value, {
    name: DOCUMENT_NAME,
    getConnections: () => [connection],
    broadcastStateless,
  });
  return { document: value, broadcastStateless };
}

function makeConnection() {
  const sent: string[] = [];
  return {
    context: {
      member: { id: "member-1" },
      canEdit: true,
      documentType: CollaborativeDocumentType.FORM,
      resourceId: FORM_ID,
      locale: "en",
    },
    sendStateless: vi.fn((payload: string) => sent.push(payload)),
    close: vi.fn(),
    sent,
  };
}

function patchPayload(
  connection: ReturnType<typeof makeConnection>,
  document: Y.Doc,
  requestId: string,
) {
  return {
    connection,
    documentName: DOCUMENT_NAME,
    document,
    payload: JSON.stringify({
      kind: FORM_SCHEMA_PATCH_KIND,
      protocolVersion: FORM_SCHEMA_PROTOCOL_VERSION,
      requestId,
      documentName: DOCUMENT_NAME,
      previousSchema: schema(),
      nextSchema: schema("A updated"),
    }),
  } as never;
}

function onStateless(server: ReturnType<typeof createCollabServer>) {
  const callback = server.configuration.onStateless;
  if (!callback)
    throw new Error("Collaboration server lacks onStateless callback.");
  return callback as (payload: never) => Promise<unknown>;
}

function roomOwnership(owned: boolean) {
  return {
    acquire: vi.fn(async () => undefined),
    isOwned: vi.fn(() => owned),
    release: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

function sentMessages(connection: ReturnType<typeof makeConnection>) {
  return connection.sent.map(
    (payload) => JSON.parse(payload) as Record<string, unknown>,
  );
}

describe("collaboration server Form schema dispatch", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    serverMocks.persist.mockReset();
    vi.restoreAllMocks();
  });

  it("dispatches an authorized schema patch through persistence and contributor attribution", async () => {
    vi.useFakeTimers();
    serverMocks.persist.mockResolvedValueOnce(undefined);
    const acceptedChange = vi.spyOn(
      EditSessionContributorTracker.prototype,
      "recordAcceptedStatelessChange",
    );
    const owner = roomOwnership(true);
    const server = createCollabServer({ roomOwnership: owner });
    const connection = makeConnection();
    const { document, broadcastStateless } = makeRoom(connection);

    await onStateless(server)(patchPayload(connection, document, "request-1"));

    expect(owner.isOwned).toHaveBeenCalledWith(DOCUMENT_NAME);
    expect(serverMocks.persist).toHaveBeenCalledWith(
      DOCUMENT_NAME,
      expect.any(Y.Doc),
      { contributorMemberIds: ["member-1"] },
    );
    expect(acceptedChange).toHaveBeenCalledWith(DOCUMENT_NAME, "member-1");
    expect(
      JSON.parse(
        document.getMap<unknown>(FORM_FIELDS_MAP_NAME).get("schema") as string,
      ),
    ).toEqual(schema("A updated"));
    expect(sentMessages(connection)[0]).toMatchObject({
      kind: FORM_SCHEMA_PATCH_ACK_KIND,
      protocolVersion: FORM_SCHEMA_PROTOCOL_VERSION,
      requestId: "request-1",
      documentName: DOCUMENT_NAME,
      ok: true,
      canonicalSchema: schema("A updated"),
    });
    expect(broadcastStateless).toHaveBeenCalledWith(
      JSON.stringify({
        kind: FORM_SCHEMA_CHANGED_KIND,
        protocolVersion: FORM_SCHEMA_PROTOCOL_VERSION,
        requestId: "request-1",
        documentName: DOCUMENT_NAME,
        canonicalSchema: schema("A updated"),
      }),
    );
  });

  it("rejects a patch when this server no longer owns the room and fences the connected client", async () => {
    vi.useFakeTimers();
    const owner = roomOwnership(false);
    const server = createCollabServer({ roomOwnership: owner });
    const connection = makeConnection();
    const { document } = makeRoom(connection);

    await onStateless(server)(patchPayload(connection, document, "request-2"));

    expect(owner.isOwned).toHaveBeenCalledWith(DOCUMENT_NAME);
    expect(serverMocks.persist).not.toHaveBeenCalled();
    expect(sentMessages(connection)).toEqual([
      expect.objectContaining({
        kind: FORM_SCHEMA_PATCH_ACK_KIND,
        requestId: "request-2",
        ok: false,
        error: "document_revision_changed",
      }),
      { kind: "reload_required", reason: "reload_required" },
    ]);
    expect(connection.close).toHaveBeenCalledOnce();
  });
});
