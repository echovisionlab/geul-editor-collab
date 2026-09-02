import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { describe, expect, it } from "vitest";
import {
  broadcastStatelessToDocumentType,
  broadcastStatelessToEntityDocuments,
  broadcastStatelessToLocaleDocument,
} from "./entity-document-broadcast.ts";

type EntityDocumentRegistry = Parameters<
  typeof broadcastStatelessToEntityDocuments
>[0]["documents"];
type TypeDocumentRegistry = Parameters<
  typeof broadcastStatelessToDocumentType
>[0]["documents"];

function connectedDocument(connectionCount = 1) {
  const payloads: string[] = [];
  return {
    payloads,
    document: {
      getConnectionsCount: () => connectionCount,
      broadcastStateless: (payload: string) => {
        payloads.push(payload);
      },
    },
  };
}

describe("entity document broadcast", () => {
  const entityId = "11111111-1111-4111-8111-111111111111";
  const otherEntityId = "22222222-2222-4222-8222-222222222222";

  it("broadcasts entity events to every canonical locale room", () => {
    const post = connectedDocument();
    const postLocale = connectedDocument();
    const disconnectedLocale = connectedDocument(0);
    const otherPost = connectedDocument();
    const documents = new Map([
      [`post:${entityId}:en`, post.document],
      [`post:${entityId}:ko`, postLocale.document],
      [`post:${entityId}:ja`, disconnectedLocale.document],
      [`post:${otherEntityId}:en`, otherPost.document],
    ]);

    const count = broadcastStatelessToEntityDocuments({
      documents: documents as unknown as EntityDocumentRegistry,
      type: CollaborativeDocumentType.POST,
      entityId,
      payload: "payload",
    });

    expect(count).toBe(2);
    expect(post.payloads).toEqual(["payload"]);
    expect(postLocale.payloads).toEqual(["payload"]);
    expect(disconnectedLocale.payloads).toEqual([]);
    expect(otherPost.payloads).toEqual([]);
  });

  it("skips a disconnected matching resident entity room", () => {
    const disconnected = connectedDocument(0);
    const documents = new Map([[`post:${entityId}:en`, disconnected.document]]);
    expect(
      broadcastStatelessToEntityDocuments({
        documents: documents as unknown as EntityDocumentRegistry,
        type: CollaborativeDocumentType.POST,
        entityId,
        payload: "payload",
      }),
    ).toBe(0);
    expect(disconnected.payloads).toEqual([]);
  });

  it("broadcasts only to an exact requested locale when required", () => {
    const form = connectedDocument();
    const formLocale = connectedDocument();
    const disconnectedLocale = connectedDocument(0);
    const documents = new Map([
      [`form:${entityId}:en`, form.document],
      [`form:${entityId}:ko`, formLocale.document],
      [`form:${otherEntityId}:ko`, disconnectedLocale.document],
    ]);

    const count = broadcastStatelessToLocaleDocument({
      documents: documents as unknown as EntityDocumentRegistry,
      type: CollaborativeDocumentType.FORM,
      entityId,
      locale: "ko",
      payload: "payload",
    });

    expect(count).toBe(1);
    expect(form.payloads).toEqual([]);
    expect(formLocale.payloads).toEqual(["payload"]);

    expect(
      broadcastStatelessToLocaleDocument({
        documents: new Map([
          [`form:${entityId}:ko`, disconnectedLocale.document],
        ]) as unknown as EntityDocumentRegistry,
        type: CollaborativeDocumentType.FORM,
        entityId,
        locale: "ko",
        payload: "payload",
      }),
    ).toBe(0);
  });

  it("ignores malformed document identities when scanning registries", () => {
    const malformed = connectedDocument();
    const documents = new Map([["not-a-room", malformed.document]]);

    expect(
      broadcastStatelessToEntityDocuments({
        documents: documents as unknown as EntityDocumentRegistry,
        type: CollaborativeDocumentType.POST,
        entityId,
        payload: "payload",
      }),
    ).toBe(0);
    expect(
      broadcastStatelessToDocumentType({
        documents: documents as unknown as TypeDocumentRegistry,
        type: CollaborativeDocumentType.POST,
        payload: "payload",
      }),
    ).toBe(0);
    expect(malformed.payloads).toEqual([]);
  });

  it("broadcasts route-scoped legal events to every connected document of that legal type", () => {
    const privacyDraft = connectedDocument();
    const privacyLocale = connectedDocument();
    const privacyDisconnected = connectedDocument(0);
    const terms = connectedDocument();
    const documents = new Map([
      [`privacy-history:${entityId}:en`, privacyDraft.document],
      [`privacy-history:${otherEntityId}:ko`, privacyLocale.document],
      [
        "privacy-history:33333333-3333-4333-8333-333333333333:ja",
        privacyDisconnected.document,
      ],
      [`terms-history:${entityId}:en`, terms.document],
    ]);

    const count = broadcastStatelessToDocumentType({
      documents: documents as unknown as TypeDocumentRegistry,
      type: CollaborativeDocumentType.PRIVACY_HISTORY,
      payload: "payload",
    });

    expect(count).toBe(2);
    expect(privacyDraft.payloads).toEqual(["payload"]);
    expect(privacyLocale.payloads).toEqual(["payload"]);
    expect(privacyDisconnected.payloads).toEqual([]);
    expect(terms.payloads).toEqual([]);
  });
});
