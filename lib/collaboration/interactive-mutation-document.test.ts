import {
  CollaborativeDocumentType,
  residentBlockDocumentType,
} from "@echovisionlab/geul-common/collaboration/document";
import { AIDocumentDomain } from "@echovisionlab/geul-proto/secure/ai_pb.ts";
import { describe, expect, it } from "vitest";
import { collaborativeDocumentTypeForAIDomain } from "./interactive-mutation-document.ts";

describe("interactive mutation Collaboration document mapping", () => {
  it.each([
    [AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST, CollaborativeDocumentType.POST],
    [AIDocumentDomain.AI_DOCUMENT_DOMAIN_PAGE, CollaborativeDocumentType.PAGE],
    [AIDocumentDomain.AI_DOCUMENT_DOMAIN_WORK, CollaborativeDocumentType.WORK],
    [
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_PROGRAM_EVENT,
      CollaborativeDocumentType.PROGRAM_EVENT,
    ],
    [
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_RELEASE,
      CollaborativeDocumentType.RELEASE,
    ],
    [
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_ARTIST,
      CollaborativeDocumentType.ARTIST,
    ],
    [
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_LABEL,
      CollaborativeDocumentType.LABEL,
    ],
    [
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_EMAIL_TEMPLATE,
      CollaborativeDocumentType.EMAIL_TEMPLATE,
    ],
    [
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_EMAIL_LAYOUT,
      CollaborativeDocumentType.EMAIL_LAYOUT,
    ],
    [
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_CAMPAIGN,
      CollaborativeDocumentType.CAMPAIGN,
    ],
    [AIDocumentDomain.AI_DOCUMENT_DOMAIN_FORM, CollaborativeDocumentType.FORM],
    [AIDocumentDomain.AI_DOCUMENT_DOMAIN_MENU, CollaborativeDocumentType.MENU],
    [
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_PRIVACY,
      CollaborativeDocumentType.PRIVACY_HISTORY,
    ],
    [
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_TERMS,
      CollaborativeDocumentType.TERMS_HISTORY,
    ],
    [
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST_SERIES,
      CollaborativeDocumentType.POST_SERIES,
    ],
  ])("maps AIDocument domain %s to resident type %s", (domain, type) => {
    expect(collaborativeDocumentTypeForAIDomain(domain)).toBe(type);
  });

  it.each([AIDocumentDomain.AI_DOCUMENT_DOMAIN_UNSPECIFIED])(
    "does not invent a Collaboration room for domain %s",
    (domain) => {
      expect(collaborativeDocumentTypeForAIDomain(domain)).toBeUndefined();
    },
  );

  it("classifies every generated AIDocument domain exactly once", () => {
    const domains = Object.values(AIDocumentDomain).filter(
      (value): value is AIDocumentDomain => typeof value === "number",
    );
    expect(domains).toEqual([
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_UNSPECIFIED,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_PAGE,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_WORK,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_PROGRAM_EVENT,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_RELEASE,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_ARTIST,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_LABEL,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_MENU,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_EMAIL_TEMPLATE,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_EMAIL_LAYOUT,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_CAMPAIGN,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_FORM,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_PRIVACY,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_TERMS,
      AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST_SERIES,
    ]);
  });

  it.each([
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_PAGE,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_WORK,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_PROGRAM_EVENT,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_RELEASE,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_ARTIST,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_LABEL,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_EMAIL_TEMPLATE,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_CAMPAIGN,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_PRIVACY,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_TERMS,
  ])(
    "routes resident AI domain %s through the Block Room runtime",
    (domain) => {
      const type = collaborativeDocumentTypeForAIDomain(domain);
      if (type === undefined) throw new Error("resident mapping required");
      expect(residentBlockDocumentType(type)).toBeDefined();
    },
  );

  it.each([
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_FORM,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_EMAIL_LAYOUT,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_MENU,
    AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST_SERIES,
  ])(
    "keeps collaborative but non-resident domain %s on the fallback fence path",
    (domain) => {
      const type = collaborativeDocumentTypeForAIDomain(domain);
      if (type === undefined) throw new Error("fallback mapping required");
      expect(residentBlockDocumentType(type)).toBeUndefined();
    },
  );
});
