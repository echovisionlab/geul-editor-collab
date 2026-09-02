import { create, fromJson, toJson } from "@bufbuild/protobuf";
import { CollaborativeDocumentType } from "@echovisionlab/geul-common/collaboration/document";
import type { MenuCollaborationItem } from "@echovisionlab/geul-common/collaboration/menu";
import {
  LoadMenuDocumentResponseSchema,
  MenuCollaborationItemSchema,
  SaveMenuDocumentRequestSchema,
  SaveMenuDocumentResponseSchema,
  type MenuCollaborationItem as ProtoMenuCollaborationItem,
} from "@echovisionlab/geul-proto/intra/menu_pb.ts";
import {
  postInternalApi,
  throwIfCollaborationResourceNotFound,
} from "./transport.ts";

export interface LoadMenuDocumentResponse {
  sourceLocale: string;
  locale: string;
  localeExists: boolean;
  name: string;
  items: MenuCollaborationItem[];
  sourceLabels: Record<string, string>;
  requestedLabels: Record<string, string>;
  documentRevision: string;
  targetRevision?: string;
}

export async function loadMenuDocument(input: {
  menuId: string;
  locale: string;
}): Promise<LoadMenuDocumentResponse> {
  const response = await postInternalApi(
    "/api.intra.v1.InternalMenuService/LoadDocument",
    input,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to load Menu document: ${response.status} ${response.statusText}`,
    );
  }
  const result = fromJson(
    LoadMenuDocumentResponseSchema,
    await response.json(),
  );
  return {
    sourceLocale: result.sourceLocale,
    locale: result.locale,
    localeExists: result.localeExists,
    name: result.name,
    items: result.items.map(menuItem),
    sourceLabels: { ...result.sourceLabels },
    requestedLabels: { ...result.requestedLabels },
    documentRevision: result.documentRevision,
    ...(result.targetRevision === undefined
      ? {}
      : { targetRevision: result.targetRevision }),
  };
}

export async function saveMenuDocument(input: {
  menuId: string;
  locale: string;
  name: string;
  items: readonly MenuCollaborationItem[];
  requestedLabels: Readonly<Record<string, string>>;
  contributorMemberIds: readonly string[];
  expectedDocumentRevision: string;
  expectedTargetRevision?: string;
}) {
  const request = create(SaveMenuDocumentRequestSchema, {
    menuId: input.menuId,
    locale: input.locale,
    name: input.name,
    items: input.items.map(protoMenuItem),
    requestedLabels: { ...input.requestedLabels },
    contributorMemberIds: [...input.contributorMemberIds],
    expectedDocumentRevision: input.expectedDocumentRevision,
    expectedTargetRevision: input.expectedTargetRevision,
  });
  const response = await postInternalApi(
    "/api.intra.v1.InternalMenuService/SaveDocument",
    toJson(SaveMenuDocumentRequestSchema, request),
  );
  throwIfCollaborationResourceNotFound(
    response,
    CollaborativeDocumentType.MENU,
    input.menuId,
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Failed to save Menu document: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`,
    );
  }
  return fromJson(SaveMenuDocumentResponseSchema, await response.json());
}

function menuItem(item: ProtoMenuCollaborationItem): MenuCollaborationItem {
  return {
    id: item.id,
    linkType: item.linkType,
    ...(item.url === undefined ? {} : { url: item.url }),
    ...(item.targetId === undefined ? {} : { targetId: item.targetId }),
    ...(item.targetSlug === undefined ? {} : { targetSlug: item.targetSlug }),
    ...(item.openInNewTab === undefined
      ? {}
      : { openInNewTab: item.openInNewTab }),
    ...(item.visibilityMode === undefined
      ? {}
      : { visibilityMode: item.visibilityMode }),
    ...(item.visibilityRoles.length === 0
      ? {}
      : { visibilityRoles: [...item.visibilityRoles] }),
    ...(item.localizationMode === undefined
      ? {}
      : { localizationMode: item.localizationMode }),
    ...(item.fixedLocale === undefined
      ? {}
      : { fixedLocale: item.fixedLocale }),
    ...(item.children.length === 0
      ? {}
      : { children: item.children.map(menuItem) }),
  };
}

function protoMenuItem(
  item: MenuCollaborationItem,
): ProtoMenuCollaborationItem {
  return create(MenuCollaborationItemSchema, {
    id: item.id,
    linkType: item.linkType,
    url: item.url,
    targetId: item.targetId,
    targetSlug: item.targetSlug,
    openInNewTab: item.openInNewTab,
    visibilityMode: item.visibilityMode,
    visibilityRoles: [...(item.visibilityRoles ?? [])],
    localizationMode: item.localizationMode,
    fixedLocale: item.fixedLocale,
    children: (item.children ?? []).map(protoMenuItem),
  });
}
