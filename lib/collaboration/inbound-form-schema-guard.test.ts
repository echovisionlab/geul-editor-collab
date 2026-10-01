import {
  CollaborativeDocumentType,
  createDocumentName,
} from "@echovisionlab/geul-common/collaboration/document";
import {
  FORM_FIELDS_MAP_NAME,
  FORM_LOCALE_PRESENCE_MAP_NAME,
} from "@echovisionlab/geul-common/collaboration/form";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { assertInboundFormSchemaUnchanged } from "./inbound-form-schema-guard.ts";

const entityId = "11111111-1111-4111-8111-111111111111";
const formDocumentName = createDocumentName(
  CollaborativeDocumentType.FORM,
  entityId,
  "en",
);
const initialSchema = { id: "schema-1", steps: [{ id: "step-1", fields: [] }] };
const documents: Y.Doc[] = [];

function document(): Y.Doc {
  const value = new Y.Doc();
  documents.push(value);
  return value;
}

function formDocument(): Y.Doc {
  const value = document();
  value.transact(() => {
    const fields = value.getMap<unknown>(FORM_FIELDS_MAP_NAME);
    fields.set("title", "Contact");
    fields.set("schema", JSON.stringify(initialSchema));
    value.getMap<boolean>(FORM_LOCALE_PRESENCE_MAP_NAME).set("title", true);
  });
  return value;
}

function updateFrom(current: Y.Doc, edit: (client: Y.Doc) => void): Uint8Array {
  const client = document();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(current));
  const stateVector = Y.encodeStateVector(client);
  edit(client);
  return Y.encodeStateAsUpdate(client, stateVector);
}

afterEach(() => {
  for (const value of documents.splice(0)) value.destroy();
});

describe("inbound Form schema guard", () => {
  it("rejects a whole-schema Y update while permitting unrelated title, description, and presence fields", () => {
    const current = formDocument();
    const replacement = {
      ...initialSchema,
      steps: [{ id: "new-step", fields: [] }],
    };
    const replacementUpdate = updateFrom(current, (client) => {
      client
        .getMap<unknown>(FORM_FIELDS_MAP_NAME)
        .set("schema", JSON.stringify(replacement));
    });

    expect(() =>
      assertInboundFormSchemaUnchanged(
        formDocumentName,
        current,
        replacementUpdate,
      ),
    ).toThrow("form_schema_patch_required");

    const unrelatedUpdate = updateFrom(current, (client) => {
      const fields = client.getMap<unknown>(FORM_FIELDS_MAP_NAME);
      fields.set("title", "Updated contact");
      fields.set("description", "A legacy standalone description field");
      client
        .getMap<boolean>(FORM_LOCALE_PRESENCE_MAP_NAME)
        .set("description", true);
    });
    expect(() =>
      assertInboundFormSchemaUnchanged(
        formDocumentName,
        current,
        unrelatedUpdate,
      ),
    ).not.toThrow();
    expect(current.getMap<unknown>(FORM_FIELDS_MAP_NAME).get("title")).toBe(
      "Contact",
    );
    expect(current.getMap<unknown>(FORM_FIELDS_MAP_NAME).get("schema")).toBe(
      JSON.stringify(initialSchema),
    );
  });

  it("allows duplicate canonical echoes when the schema value is unchanged", () => {
    const current = formDocument();
    const canonicalEcho = updateFrom(current, (client) => {
      client
        .getMap<unknown>(FORM_FIELDS_MAP_NAME)
        .set("schema", JSON.stringify(initialSchema));
    });

    expect(() =>
      assertInboundFormSchemaUnchanged(
        formDocumentName,
        current,
        canonicalEcho,
      ),
    ).not.toThrow();
  });

  it("does not restrict whole-schema updates for other document types", () => {
    const current = document();
    const postDocumentName = createDocumentName(
      CollaborativeDocumentType.POST,
      entityId,
      "en",
    );
    const update = updateFrom(current, (client) => {
      client
        .getMap<unknown>(FORM_FIELDS_MAP_NAME)
        .set("schema", JSON.stringify({ id: "post-schema", steps: [] }));
    });

    expect(() =>
      assertInboundFormSchemaUnchanged(postDocumentName, current, update),
    ).not.toThrow();
  });
});
