import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import { AIDocumentDomain } from "@echovisionlab/geul-proto/secure/ai_pb.ts";

const collaborativeDocumentTypeByAIDomain = {
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_UNSPECIFIED]: undefined,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST]: CollaborativeDocumentType.POST,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_PAGE]: CollaborativeDocumentType.PAGE,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_WORK]: CollaborativeDocumentType.WORK,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_PROGRAM_EVENT]:
    CollaborativeDocumentType.PROGRAM_EVENT,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_RELEASE]:
    CollaborativeDocumentType.RELEASE,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_ARTIST]:
    CollaborativeDocumentType.ARTIST,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_LABEL]: CollaborativeDocumentType.LABEL,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_MENU]: CollaborativeDocumentType.MENU,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_EMAIL_TEMPLATE]:
    CollaborativeDocumentType.EMAIL_TEMPLATE,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_EMAIL_LAYOUT]:
    CollaborativeDocumentType.EMAIL_LAYOUT,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_CAMPAIGN]:
    CollaborativeDocumentType.CAMPAIGN,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_FORM]: CollaborativeDocumentType.FORM,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_PRIVACY]:
    CollaborativeDocumentType.PRIVACY_HISTORY,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_TERMS]:
    CollaborativeDocumentType.TERMS_HISTORY,
  [AIDocumentDomain.AI_DOCUMENT_DOMAIN_POST_SERIES]:
    CollaborativeDocumentType.POST_SERIES,
} as const satisfies Record<
  AIDocumentDomain,
  CollaborativeDocumentType | undefined
>;

export function collaborativeDocumentTypeForAIDomain(
  domain: AIDocumentDomain,
): CollaborativeDocumentType | undefined {
  return collaborativeDocumentTypeByAIDomain[domain];
}
