import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import type { onStatelessPayload } from "@hocuspocus/server";
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
  FORM_CANONICAL_CONTEXT_MAP_NAME,
  FORM_FIELDS_MAP_NAME,
  FORM_LOCALE_PRESENCE_MAP_NAME,
  hydrateFormCanonicalRoom,
  type FormCollabFields,
} from "@echovisionlab/geul-common/collaboration/form";
import {
  FORM_SCHEMA_CHANGED_KIND,
  FORM_SCHEMA_PATCH_ACK_KIND,
  FORM_SCHEMA_PATCH_KIND,
  FORM_SCHEMA_PROTOCOL_VERSION,
  FormSchemaProtocol,
} from "./form-schema-protocol.ts";
import { CollaborationConflictError } from "../api/transport.ts";
import type { FormSchemaProtocolDependencies } from "./form-schema-protocol.ts";

const formId = "11111111-1111-4111-8111-111111111111";
const documentName = createDocumentName(
  CollaborativeDocumentType.FORM,
  formId,
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

function sourceFields(formSchema: unknown = schema()): FormCollabFields {
  return { title: "Form", schema: formSchema };
}

function createDocument(fields: FormCollabFields = sourceFields()) {
  return hydrateFormCanonicalRoom({
    sourceLocale: "en",
    locale: "en",
    source: fields,
    requested: fields,
    requestedExists: true,
    presentLocaleValues: [
      formRootTitleTarget(),
      formStepTitleTarget("step-1"),
      formFieldLabelTarget("field-a"),
      formFieldLabelTarget("field-b"),
    ],
  });
}

function serializedSchema(document: Y.Doc) {
  return JSON.parse(
    document.getMap<unknown>(FORM_FIELDS_MAP_NAME).get("schema") as string,
  ) as ReturnType<typeof schema>;
}

function request(
  connection: ReturnType<typeof makeConnection>,
  message: Record<string, unknown>,
  roomName = documentName,
): onStatelessPayload {
  return {
    connection: connection as unknown as onStatelessPayload["connection"],
    documentName: roomName,
    document: room as unknown as onStatelessPayload["document"],
    payload: JSON.stringify(message),
  };
}

let room: Y.Doc;

function makeConnection(locale = "en") {
  const sent: string[] = [];
  return {
    context: {
      member: { id: "member-1" },
      canEdit: true,
      documentType: CollaborativeDocumentType.FORM,
      resourceId: formId,
      locale,
    },
    sendStateless: vi.fn((payload: string) => sent.push(payload)),
    sent,
  };
}

function patchMessage(
  previousSchema: unknown,
  nextSchema: unknown,
  requestId = "request-1",
  overrides: Record<string, unknown> = {},
) {
  return {
    kind: FORM_SCHEMA_PATCH_KIND,
    protocolVersion: FORM_SCHEMA_PROTOCOL_VERSION,
    requestId,
    documentName,
    previousSchema,
    nextSchema,
    ...overrides,
  };
}

function createProtocol(
  overrides: Partial<FormSchemaProtocolDependencies> = {},
) {
  const order: string[] = [];
  const persist = vi.fn(
    async (_name: string, candidate: Y.Doc, memberId: string) => {
      order.push("persist");
      expect(memberId).toBe("member-1");
      expect(candidate).not.toBe(room);
    },
  );
  const recordAcceptedChange = vi.fn(() => order.push("attribute"));
  const handleRevisionConflict = vi.fn(() => false);
  const dependencies: FormSchemaProtocolDependencies = {
    isDocumentFenced: () => false,
    isDocumentStale: () => false,
    ownsDocument: () => true,
    ...overrides,
    persist: overrides.persist ?? persist,
    recordAcceptedChange:
      overrides.recordAcceptedChange ?? recordAcceptedChange,
    handleRevisionConflict:
      overrides.handleRevisionConflict ?? handleRevisionConflict,
  };
  const protocol = new FormSchemaProtocol(dependencies);
  return {
    protocol,
    persist: dependencies.persist,
    recordAcceptedChange: dependencies.recordAcceptedChange,
    handleRevisionConflict: dependencies.handleRevisionConflict,
    order,
  };
}

function ack(connection: ReturnType<typeof makeConnection>) {
  return JSON.parse(connection.sent.at(-1)!) as Record<string, unknown>;
}

describe("Form schema stateless protocol", () => {
  afterEach(() => room?.destroy());

  it("ignores invalid JSON and other stateless message kinds", async () => {
    room = createDocument();
    const connection = makeConnection();
    const runtime = createProtocol();
    const base = request(connection, {});

    await expect(
      runtime.protocol.handleStateless({ ...base, payload: "{" }),
    ).resolves.toBe(false);
    await expect(
      runtime.protocol.handleStateless({
        ...base,
        payload: JSON.stringify({ kind: "other.message" }),
      }),
    ).resolves.toBe(false);
    expect(connection.sendStateless).not.toHaveBeenCalled();
  });

  it("rejects malformed requests without persisting", async () => {
    room = createDocument();
    const connection = makeConnection();
    const runtime = createProtocol();

    await runtime.protocol.handleStateless(
      request(connection, {
        kind: FORM_SCHEMA_PATCH_KIND,
        protocolVersion: FORM_SCHEMA_PROTOCOL_VERSION,
        requestId: "bad",
      }),
    );

    expect(ack(connection)).toMatchObject({
      kind: FORM_SCHEMA_PATCH_ACK_KIND,
      requestId: "bad",
      ok: false,
      error: "invalid_request",
    });

    await runtime.protocol.handleStateless(
      request(connection, {
        kind: FORM_SCHEMA_PATCH_KIND,
        protocolVersion: FORM_SCHEMA_PROTOCOL_VERSION,
        previousSchema: schema(),
        nextSchema: schema("missing request id"),
      }),
    );
    expect(ack(connection)).toMatchObject({
      requestId: "",
      ok: false,
      error: "invalid_request",
    });
    expect(runtime.persist).not.toHaveBeenCalled();
  });

  it("rejects missing and malformed resident schemas before saving", async () => {
    room = createDocument();
    const connection = makeConnection();
    const runtime = createProtocol();
    const fields = room.getMap<unknown>(FORM_FIELDS_MAP_NAME);

    fields.delete("schema");
    await runtime.protocol.handleStateless(
      request(connection, patchMessage(schema(), schema("missing"), "missing")),
    );
    expect(ack(connection)).toMatchObject({
      ok: false,
      error: "invalid_schema",
    });

    fields.set("schema", "{");
    await runtime.protocol.handleStateless(
      request(
        connection,
        patchMessage(schema(), schema("malformed"), "malformed"),
      ),
    );
    expect(ack(connection)).toMatchObject({
      ok: false,
      error: "invalid_schema",
    });
    expect(runtime.persist).not.toHaveBeenCalled();
  });

  it("serializes a stale field patch over the latest distinct-field peer value", async () => {
    const previous = schema();
    room = createDocument();
    room
      .getMap<unknown>(FORM_FIELDS_MAP_NAME)
      .set("schema", JSON.stringify(schema("A", "B from peer")));
    const connection = makeConnection();
    const runtime = createProtocol();
    const next = schema("A from local", "B");

    await runtime.protocol.handleStateless(
      request(connection, patchMessage(previous, next)),
    );

    expect(ack(connection)).toMatchObject({
      ok: true,
      canonicalSchema: schema("A from local", "B from peer"),
    });
    expect(serializedSchema(room)).toEqual(
      schema("A from local", "B from peer"),
    );
    expect(runtime.persist).toHaveBeenCalledOnce();
    expect(runtime.persist).toHaveBeenCalledWith(
      documentName,
      expect.any(Y.Doc),
      "member-1",
    );
    expect(runtime.order).toEqual(["persist", "attribute"]);
  });

  it("serializes concurrent stale patches and composes their distinct field changes", async () => {
    const previous = schema();
    room = createDocument();
    const connection = makeConnection();
    let releaseFirstPersist!: () => void;
    let firstPersistStarted!: () => void;
    const firstPersist = new Promise<void>((resolve) => {
      releaseFirstPersist = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      firstPersistStarted = resolve;
    });
    let persistCalls = 0;
    const runtime = createProtocol({
      persist: vi.fn(async () => {
        persistCalls += 1;
        if (persistCalls === 1) {
          firstPersistStarted();
          await firstPersist;
        }
      }),
    });

    const first = runtime.protocol.handleStateless(
      request(
        connection,
        patchMessage(previous, schema("A from first"), "first"),
      ),
    );
    await firstStarted;
    const second = runtime.protocol.handleStateless(
      request(
        connection,
        patchMessage(previous, schema("A", "B from second"), "second"),
      ),
    );
    releaseFirstPersist();
    await Promise.all([first, second]);

    expect(serializedSchema(room)).toEqual(
      schema("A from first", "B from second"),
    );
    expect(runtime.persist).toHaveBeenCalledTimes(2);
  });

  it("answers an accepted retry with the current canonical schema after a later peer change", async () => {
    const previous = schema();
    room = createDocument();
    const connection = makeConnection();
    const runtime = createProtocol();
    const accepted = patchMessage(
      previous,
      schema("Accepted local value"),
      "retry-current",
    );

    await runtime.protocol.handleStateless(request(connection, accepted));
    room
      .getMap<unknown>(FORM_FIELDS_MAP_NAME)
      .set("schema", JSON.stringify(schema("Later peer value")));
    await runtime.protocol.handleStateless(request(connection, accepted));

    expect(ack(connection)).toMatchObject({
      ok: true,
      canonicalSchema: schema("Later peer value"),
    });
    expect(serializedSchema(room)).toEqual(schema("Later peer value"));
    expect(runtime.persist).toHaveBeenCalledOnce();
  });

  it("revalidates room name, editor authority, staleness, and fencing before a cached ACK", async () => {
    let fenced = false;
    let stale = false;
    room = createDocument();
    const connection = makeConnection();
    const runtime = createProtocol({
      isDocumentFenced: () => fenced,
      isDocumentStale: () => stale,
    });
    const accepted = patchMessage(
      schema(),
      schema("Accepted local value"),
      "retry-guarded",
    );
    await runtime.protocol.handleStateless(request(connection, accepted));

    await runtime.protocol.handleStateless(
      request(connection, {
        ...accepted,
        documentName: `form:${"22222222-2222-4222-8222-222222222222"}:en`,
      }),
    );
    expect(ack(connection)).toMatchObject({
      ok: false,
      error: "document_name_mismatch",
    });

    connection.context.canEdit = false;
    await runtime.protocol.handleStateless(request(connection, accepted));
    expect(ack(connection)).toMatchObject({
      ok: false,
      error: "permission_denied",
    });

    connection.context.canEdit = true;
    room.getMap<string>(FORM_CANONICAL_CONTEXT_MAP_NAME).set("locale", "fr");
    await runtime.protocol.handleStateless(request(connection, accepted));
    expect(ack(connection)).toMatchObject({
      ok: false,
      error: "form_room_context_mismatch",
    });

    room.getMap<string>(FORM_CANONICAL_CONTEXT_MAP_NAME).set("locale", "en");
    stale = true;
    await runtime.protocol.handleStateless(request(connection, accepted));
    expect(ack(connection)).toMatchObject({
      ok: false,
      error: "document_revision_changed",
    });

    stale = false;
    fenced = true;
    await runtime.protocol.handleStateless(request(connection, accepted));
    expect(ack(connection)).toMatchObject({
      ok: false,
      error: "document_revision_changed",
    });
    expect(runtime.persist).toHaveBeenCalledOnce();
    expect(runtime.handleRevisionConflict).toHaveBeenCalledTimes(2);
  });

  it("revalidates target locale existence before serving a cached ACK", async () => {
    const source = sourceFields();
    const targetFields: FormCollabFields = {
      schema: {
        id: "schema-1",
        steps: [
          {
            id: "step-1",
            fields: [
              { id: "field-a", key: "a", type: "text" },
              {
                id: "field-b",
                key: "b",
                type: "text",
                validation: { validators: [] },
              },
            ],
          },
        ],
      },
    };
    room = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: targetFields,
      requestedExists: true,
      presentLocaleValues: [],
    });
    room
      .getMap<string | boolean>("collaboration-revision")
      .set("localeExists", true);
    const targetDocumentName = createDocumentName(
      CollaborativeDocumentType.FORM,
      formId,
      "ko",
    );
    const connection = makeConnection("ko");
    const runtime = createProtocol();
    const previous = serializedSchema(room);
    const next = structuredClone(previous);
    next.steps[0]!.fields[1]!.label = "Target translation";
    const message = {
      ...patchMessage(previous, next, "cached-target-scope"),
      documentName: targetDocumentName,
    };

    await runtime.protocol.handleStateless(
      request(connection, message, targetDocumentName),
    );
    room
      .getMap<string | boolean>("collaboration-revision")
      .set("localeExists", false);
    await runtime.protocol.handleStateless(
      request(connection, message, targetDocumentName),
    );

    expect(ack(connection)).toMatchObject({
      ok: false,
      error: "target_missing",
    });
    expect(runtime.persist).toHaveBeenCalledOnce();
  });

  it("keeps accepted request IDs independent across members and fresh resident documents", async () => {
    const baseline = schema();
    room = createDocument();
    const originalRoom = room;
    const firstMember = makeConnection();
    const runtime = createProtocol({ persist: vi.fn(async () => undefined) });
    const firstMessage = patchMessage(
      baseline,
      schema("First member"),
      "shared-request-id",
    );

    await runtime.protocol.handleStateless(request(firstMember, firstMessage));
    const firstMemberSchema = serializedSchema(room);

    const secondMember = makeConnection();
    secondMember.context.member.id = "member-2";
    await runtime.protocol.handleStateless(
      request(
        secondMember,
        patchMessage(
          firstMemberSchema,
          schema("Second member"),
          "shared-request-id",
        ),
      ),
    );
    expect(serializedSchema(room)).toEqual(schema("Second member"));
    expect(runtime.persist).toHaveBeenCalledTimes(2);

    await runtime.protocol.handleStateless(request(firstMember, firstMessage));
    expect(ack(firstMember)).toMatchObject({
      ok: true,
      canonicalSchema: schema("Second member"),
    });
    expect(runtime.persist).toHaveBeenCalledTimes(2);

    room = createDocument();
    await runtime.protocol.handleStateless(request(firstMember, firstMessage));
    expect(serializedSchema(room)).toEqual(schema("First member"));
    expect(runtime.persist).toHaveBeenCalledTimes(3);
    originalRoom.destroy();
  });

  it("evicts accepted request IDs beyond the resident document's 256-entry limit", async () => {
    const baseline = schema();
    room = createDocument();
    const connection = makeConnection();
    const runtime = createProtocol();
    const oldest = patchMessage(
      baseline,
      schema("Oldest accepted edit"),
      "oldest-request",
    );
    await runtime.protocol.handleStateless(request(connection, oldest));

    for (let index = 0; index < 256; index += 1) {
      await runtime.protocol.handleStateless(
        request(connection, patchMessage(baseline, baseline, `fill-${index}`)),
      );
    }
    expect(runtime.persist).toHaveBeenCalledOnce();

    room
      .getMap<unknown>(FORM_FIELDS_MAP_NAME)
      .set("schema", JSON.stringify(schema("Later peer edit")));
    await runtime.protocol.handleStateless(request(connection, oldest));

    expect(ack(connection)).toMatchObject({
      ok: true,
      canonicalSchema: schema("Oldest accepted edit"),
    });
    expect(serializedSchema(room)).toEqual(schema("Oldest accepted edit"));
    expect(runtime.persist).toHaveBeenCalledTimes(2);
  });

  it("does not resurrect a peer-deleted node from an untouched stale snapshot", async () => {
    const previous = schema();
    room = createDocument(sourceFields(schema("A", "B")));
    room.getMap<unknown>(FORM_FIELDS_MAP_NAME).set(
      "schema",
      JSON.stringify({
        id: "schema-1",
        steps: [
          {
            id: "step-1",
            title: "Step",
            fields: [{ id: "field-a", key: "a", type: "text", label: "A" }],
          },
        ],
      }),
    );
    const connection = makeConnection();
    const runtime = createProtocol();

    await runtime.protocol.handleStateless(
      request(connection, patchMessage(previous, schema("A local", "B"))),
    );

    expect(ack(connection)).toMatchObject({ ok: true });
    expect(serializedSchema(room).steps[0]?.fields).toEqual([
      { id: "field-a", key: "a", type: "text", label: "A local" },
    ]);
  });

  it("cascades explicit field deletion over a peer-added descendant", async () => {
    const previous = schema();
    const current = structuredClone(previous) as {
      steps: Array<{ fields: Array<Record<string, unknown>> }>;
    };
    current.steps[0]!.fields[1]!.validation = {
      validators: [
        {
          id: "validator-peer",
          name: "Peer validator",
          predicate: "required",
        },
      ],
    };
    room = createDocument(sourceFields(current));
    const connection = makeConnection();
    const runtime = createProtocol();
    const localDelete = structuredClone(previous);
    localDelete.steps[0]!.fields.splice(1, 1);

    await runtime.protocol.handleStateless(
      request(connection, patchMessage(previous, localDelete, "delete-field")),
    );

    expect(ack(connection)).toMatchObject({
      ok: true,
      canonicalSchema: localDelete,
    });
    expect(serializedSchema(room)).toEqual(localDelete);
    expect(runtime.persist).toHaveBeenCalledOnce();
  });

  it("rejects target topology changes before durable save", async () => {
    const target = {
      schema: {
        id: "schema-1",
        steps: [
          {
            id: "step-1",
            fields: [
              { id: "field-a", key: "a", type: "text" },
              {
                id: "field-b",
                key: "b",
                type: "text",
                label: "B",
                validation: { validators: [] },
              },
            ],
          },
        ],
      },
    };
    const source = sourceFields();
    room = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: target,
      requestedExists: true,
      presentLocaleValues: [formFieldLabelTarget("field-b")],
    });
    room
      .getMap<string | boolean>("collaboration-revision")
      .set("localeExists", true);
    const connection = makeConnection("ko");
    const targetDocumentName = createDocumentName(
      CollaborativeDocumentType.FORM,
      formId,
      "ko",
    );
    const runtime = createProtocol();
    const previous = serializedSchema(room);
    const next = structuredClone(previous);
    next.steps[0]!.fields[0]!.type = "email";

    await runtime.protocol.handleStateless(
      request(
        connection,
        {
          ...patchMessage(previous, next, "target-topology"),
          documentName: targetDocumentName,
        },
        targetDocumentName,
      ),
    );

    expect(ack(connection)).toMatchObject({
      ok: false,
      error: "target_topology_changed",
    });
    expect(runtime.persist).not.toHaveBeenCalled();
  });

  it("accepts a target localized leaf and records explicit locale presence", async () => {
    const source = sourceFields();
    const targetFields: FormCollabFields = {
      schema: {
        id: "schema-1",
        steps: [
          {
            id: "step-1",
            fields: [
              { id: "field-a", key: "a", type: "text" },
              {
                id: "field-b",
                key: "b",
                type: "text",
                validation: { validators: [] },
              },
            ],
          },
        ],
      },
    };
    room = hydrateFormCanonicalRoom({
      sourceLocale: "en",
      locale: "ko",
      source,
      requested: targetFields,
      requestedExists: true,
      presentLocaleValues: [],
    });
    room
      .getMap<string | boolean>("collaboration-revision")
      .set("localeExists", true);
    const connection = makeConnection("ko");
    const targetDocumentName = createDocumentName(
      CollaborativeDocumentType.FORM,
      formId,
      "ko",
    );
    const runtime = createProtocol();
    const previous = serializedSchema(room);
    const next = structuredClone(previous);
    next.steps[0]!.fields[1]!.label = "B translated";

    await runtime.protocol.handleStateless(
      request(
        connection,
        {
          ...patchMessage(previous, next, "target-localized-leaf"),
          documentName: targetDocumentName,
        },
        targetDocumentName,
      ),
    );

    const target = formFieldLabelTarget("field-b");
    const presenceKey =
      target.owner.case === "blockHandle"
        ? `${target.owner.value}\u0000${target.fieldHandle}`
        : null;
    expect(ack(connection)).toMatchObject({
      ok: true,
      canonicalSchema: next,
    });
    expect(serializedSchema(room)).toEqual(next);
    expect(presenceKey).not.toBeNull();
    expect(room.getMap(FORM_LOCALE_PRESENCE_MAP_NAME).has(presenceKey!)).toBe(
      true,
    );
    expect(runtime.persist).toHaveBeenCalledOnce();
  });

  it("makes the same-property last accepted request win and broadcasts after persistence", async () => {
    const previous = schema();
    room = createDocument();
    const connection = makeConnection();
    const events: string[] = [];
    const persist = vi.fn(async () => {
      events.push("persist");
    });
    const runtime = createProtocol({
      persist,
    });
    const broadcastStateless = vi.fn((payload: string) => {
      events.push("broadcast");
      return payload;
    });
    Object.assign(room, { broadcastStateless });
    const first = patchMessage(previous, schema("first", "B"), "first");
    const second = patchMessage(previous, schema("second", "B"), "second");

    await runtime.protocol.handleStateless(request(connection, first));
    await runtime.protocol.handleStateless(request(connection, second));

    expect(serializedSchema(room)).toEqual(schema("second", "B"));
    expect(ack(connection)).toMatchObject({
      ok: true,
      canonicalSchema: schema("second", "B"),
    });
    expect(runtime.persist).toHaveBeenCalledTimes(2);
    expect(broadcastStateless).toHaveBeenCalledTimes(2);
    expect(events).toEqual(["persist", "broadcast", "persist", "broadcast"]);
    const changed = JSON.parse(broadcastStateless.mock.calls[1]![0] as string);
    expect(changed).toMatchObject({
      kind: FORM_SCHEMA_CHANGED_KIND,
      canonicalSchema: schema("second", "B"),
    });
  });

  it("fences typed stale-save conflicts and never broadcasts an unpersisted candidate", async () => {
    room = createDocument();
    const connection = makeConnection();
    const conflict = new CollaborationConflictError("target_revision_changed");
    const runtime = createProtocol({
      persist: vi.fn(async () => {
        throw conflict;
      }),
      handleRevisionConflict: vi.fn(() => true),
    });
    const broadcastStateless = vi.fn();
    Object.assign(room, { broadcastStateless });

    await runtime.protocol.handleStateless(
      request(connection, patchMessage(schema(), schema("local", "B"))),
    );

    expect(ack(connection)).toMatchObject({
      ok: false,
      error: "target_revision_changed",
    });
    expect(runtime.handleRevisionConflict).toHaveBeenCalledWith(
      conflict,
      documentName,
      room,
    );
    expect(broadcastStateless).not.toHaveBeenCalled();
    expect(serializedSchema(room)).toEqual(schema());
  });

  it("normalizes a non-Error persistence rejection", async () => {
    room = createDocument();
    const connection = makeConnection();
    const runtime = createProtocol({
      persist: vi.fn(() => Promise.reject("unexpected persistence failure")),
    });

    await runtime.protocol.handleStateless(
      request(connection, patchMessage(schema(), schema("local", "B"))),
    );

    expect(ack(connection)).toMatchObject({
      ok: false,
      error: "form_schema_patch_failed",
    });
    expect(serializedSchema(room)).toEqual(schema());
  });

  it("continues a document queue after the preceding ACK transport rejects", async () => {
    const previous = schema();
    room = createDocument();
    const failedConnection = makeConnection();
    failedConnection.sendStateless.mockImplementation(() => {
      throw new Error("connection closed");
    });
    let releaseFirstPersist!: () => void;
    let firstPersistStarted!: () => void;
    const firstPersist = new Promise<void>((resolve) => {
      releaseFirstPersist = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      firstPersistStarted = resolve;
    });
    let persistCalls = 0;
    const runtime = createProtocol({
      persist: vi.fn(async () => {
        persistCalls += 1;
        if (persistCalls === 1) {
          firstPersistStarted();
          await firstPersist;
        }
      }),
    });

    const first = runtime.protocol.handleStateless(
      request(
        failedConnection,
        patchMessage(previous, schema("first accepted", "B"), "first"),
      ),
    );
    await firstStarted;

    const nextConnection = makeConnection();
    const second = runtime.protocol.handleStateless(
      request(
        nextConnection,
        patchMessage(previous, schema("A", "second accepted"), "second"),
      ),
    );
    releaseFirstPersist();
    await expect(first).rejects.toThrow("connection closed");
    await second;

    expect(ack(nextConnection)).toMatchObject({
      ok: true,
      canonicalSchema: schema("first accepted", "second accepted"),
    });
    expect(serializedSchema(room)).toEqual(
      schema("first accepted", "second accepted"),
    );
    expect(runtime.persist).toHaveBeenCalledTimes(2);
  });
});
