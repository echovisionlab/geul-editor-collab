/**
 * Page content conversion - Yjs to Section structure
 *
 * Converts page Yjs state to rendered sections with:
 * - KaTeX math rendering (in rich-text sections)
 * - Shiki code highlighting (in rich-text sections)
 * - ID-only map sections hydrated by the runtime delivery layer
 */
import { extractPageTranslationContentText } from "@echovisionlab/geul-common/collaboration/page";
import type {
  Block,
  ColumnData,
  PageBlockType,
  PageContent,
  Section,
  SectionSettings,
} from "@echovisionlab/geul-common/page";
import * as Y from "yjs";
import { yXmlFragmentToGeulDocument } from "./tiptap-document.ts";

// ============================================================================
// Types for Page Sections
// ============================================================================

type SectionType = PageBlockType;

interface ConvertedPageContent {
  json: PageContent;
  html: string;
  text: string;
}

// Yjs document section metadata (without content)
interface SectionMeta {
  id: string;
  type: SectionType;
  settings: SectionSettings;
  props?: Record<string, unknown>;
  columns?: { id: ColumnData["id"]; sections: SectionMeta[] }[];
}

// ============================================================================
// Convert Page Content
// ============================================================================

/**
 * Convert Yjs state to PageContent structure
 *
 * @param yjsState - Yjs document state as Uint8Array
 * @returns Converted page content with sections
 */
export async function convertPageContent(
  yjsState: Uint8Array,
): Promise<ConvertedPageContent> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, yjsState);

  const sectionsArray = doc.getArray<SectionMeta>("sections");
  const sectionMetas = sectionsArray.toArray();

  async function convertRichTextSection(
    section: SectionMeta,
  ): Promise<Block[]> {
    const fragment = doc.getXmlFragment(`section-${section.id}`);
    if (fragment.length === 0) {
      return [];
    }
    try {
      return yXmlFragmentToGeulDocument(fragment, "page").blocks as Block[];
    } catch (error) {
      /* v8 ignore next -- JavaScript permits non-Error throws; conversion code throws Error instances. */
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to materialize page rich-text section ${section.id}: ${detail}`,
        {
          cause: error,
        },
      );
    }
  }

  // Convert each section
  async function convertSection(section: SectionMeta): Promise<Section> {
    const converted: Section = {
      id: section.id,
      type: section.type,
      settings: section.settings,
      props: section.props,
    };

    if (section.type === "rich-text") {
      converted.content = await convertRichTextSection(section);
    } else if (section.type === "columns" && section.columns) {
      converted.columns = await Promise.all(
        section.columns.map(async (column) => ({
          id: column.id,
          sections: await Promise.all(column.sections.map(convertSection)),
        })),
      );
    }

    return converted;
  }

  const convertedSections = await Promise.all(sectionMetas.map(convertSection));

  // Extract text
  const text = extractPageTranslationContentText(convertedSections);

  return {
    json: {
      sections: convertedSections,
    },
    html: "", // Page uses section structure, not flat HTML
    text,
  };
}
