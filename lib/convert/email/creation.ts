import { createHash } from "node:crypto";
import { stripTrailingEmptyParagraphBlocks } from "@echovisionlab/geul-common/editor/materialized-blocks";
import * as Y from "yjs";
import { z } from "zod";
import { assertIntervalTableGeometry, type EmailBlocks } from "./validation.ts";
import { replaceGeulBlocksInYXmlFragment } from "../tiptap-document.ts";
import { parseLegacyEmailHtmlBlocks } from "./legacy-html.ts";

const safePositiveIntegerSchema = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER);
const safeNonNegativeIntegerSchema = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER);
const finitePositiveNumberSchema = z.number().finite().positive();
const textAlignmentSchema = z.enum(["left", "center", "right", "justify"]);
const emailJsonStylesSchema = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strike: z.boolean().optional(),
    code: z.boolean().optional(),
    textColor: z.string().optional(),
    backgroundColor: z.string().optional(),
  })
  .strict();
const emailJsonTextSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
    styles: emailJsonStylesSchema,
  })
  .strict();
const emailJsonLinkSchema = z
  .object({
    type: z.literal("link"),
    href: z.string(),
    content: z.array(emailJsonTextSchema),
  })
  .strict();
const emailJsonInlineSchema = z.discriminatedUnion("type", [
  emailJsonTextSchema,
  emailJsonLinkSchema,
]);
const emailJsonDefaultPropsSchema = z
  .object({
    backgroundColor: z.string(),
    textColor: z.string(),
    textAlignment: textAlignmentSchema,
  })
  .strict();
const emailJsonQuotePropsSchema = z
  .object({
    backgroundColor: z.string(),
    textColor: z.string(),
  })
  .strict();
const emailJsonCalloutPropsSchema = z
  .object({
    icon: z.string().min(1).max(32),
    backgroundColor: z.string(),
    textColor: z.string(),
  })
  .strict();
const emailJsonTableCellPropsSchema = z
  .object({
    backgroundColor: z.string(),
    textColor: z.string(),
    textAlignment: textAlignmentSchema,
    colspan: safePositiveIntegerSchema.optional(),
    rowspan: safePositiveIntegerSchema.optional(),
  })
  .strict();
const emailJsonTableCellSchema = z
  .object({
    type: z.literal("tableCell"),
    props: emailJsonTableCellPropsSchema,
    content: z.array(emailJsonInlineSchema),
  })
  .strict();
const emailJsonTableContentSchema = z
  .object({
    type: z.literal("tableContent"),
    columnWidths: z.array(z.union([finitePositiveNumberSchema, z.null()])),
    headerRows: safeNonNegativeIntegerSchema.optional(),
    headerCols: safeNonNegativeIntegerSchema.optional(),
    rows: z
      .array(
        z
          .object({
            cells: z.array(emailJsonTableCellSchema).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const emailJsonBlockBaseShape = {
  id: z.string().min(1),
  children: z.array(z.unknown()),
};
const emailJsonBlockSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...emailJsonBlockBaseShape,
      type: z.literal("paragraph"),
      props: emailJsonDefaultPropsSchema,
      content: z.array(emailJsonInlineSchema),
    })
    .strict(),
  z
    .object({
      ...emailJsonBlockBaseShape,
      type: z.literal("heading"),
      props: emailJsonDefaultPropsSchema.extend({
        level: z.number().int().min(1).max(6),
      }),
      content: z.array(emailJsonInlineSchema),
    })
    .strict(),
  z
    .object({
      ...emailJsonBlockBaseShape,
      type: z.literal("bulletListItem"),
      props: emailJsonDefaultPropsSchema,
      content: z.array(emailJsonInlineSchema),
    })
    .strict(),
  z
    .object({
      ...emailJsonBlockBaseShape,
      type: z.literal("numberedListItem"),
      props: emailJsonDefaultPropsSchema.extend({
        start: safePositiveIntegerSchema.optional(),
      }),
      content: z.array(emailJsonInlineSchema),
    })
    .strict(),
  z
    .object({
      ...emailJsonBlockBaseShape,
      type: z.literal("checkListItem"),
      props: emailJsonDefaultPropsSchema.extend({
        checked: z.boolean(),
      }),
      content: z.array(emailJsonInlineSchema),
    })
    .strict(),
  z
    .object({
      ...emailJsonBlockBaseShape,
      type: z.literal("quote"),
      props: emailJsonQuotePropsSchema,
      content: z.array(emailJsonInlineSchema),
    })
    .strict(),
  z
    .object({
      ...emailJsonBlockBaseShape,
      type: z.literal("callout"),
      props: emailJsonCalloutPropsSchema,
      content: z.array(emailJsonInlineSchema),
    })
    .strict(),
  z
    .object({
      ...emailJsonBlockBaseShape,
      type: z.literal("divider"),
      props: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...emailJsonBlockBaseShape,
      type: z.literal("table"),
      props: z
        .object({
          textColor: z.string(),
        })
        .strict(),
      content: emailJsonTableContentSchema,
    })
    .strict(),
  z
    .object({
      ...emailJsonBlockBaseShape,
      type: z.literal("codeBlock"),
      props: z
        .object({
          language: z.string(),
        })
        .strict(),
      content: z.array(emailJsonInlineSchema),
    })
    .strict(),
]);

type EmailJsonBlock = z.infer<typeof emailJsonBlockSchema>;

function assertClosedEmailJsonTable(block: EmailJsonBlock): void {
  if (block.type !== "table") {
    return;
  }
  const geometryRows = block.content.rows.map((row) =>
    row.cells.map((cell) => ({
      colspan: cell.props.colspan ?? 1,
      rowspan: cell.props.rowspan ?? 1,
    })),
  );
  const width = assertIntervalTableGeometry(geometryRows, "content JSON");
  if (
    block.content.columnWidths.length !== width ||
    (block.content.headerRows ?? 0) > block.content.rows.length ||
    (block.content.headerCols ?? 0) > width
  ) {
    throw new Error("Invalid email content JSON table geometry");
  }
}
function assertClosedEmailJsonBlock(value: unknown): EmailJsonBlock {
  const result = emailJsonBlockSchema.safeParse(value);
  if (!result.success) {
    const path = result.error.issues[0]?.path.join(".") || "block";
    throw new Error(`Invalid email content JSON at ${path}`);
  }

  const block = result.data;
  block.children = block.children.map(assertClosedEmailJsonBlock);
  assertClosedEmailJsonTable(block);

  return block;
}

function assertClosedEmailContentJson(value: unknown[]): EmailJsonBlock[] {
  return value.map(assertClosedEmailJsonBlock);
}

function parseAuthoritativeEmailBlocks(contentJson?: Uint8Array | null): {
  blocks: EmailBlocks;
  authoritative: boolean;
} {
  if (!contentJson || contentJson.length === 0) {
    return { blocks: [], authoritative: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(contentJson)) as unknown;
  } catch {
    return { blocks: [], authoritative: false };
  }
  if (!Array.isArray(parsed)) {
    return { blocks: [], authoritative: false };
  }
  return {
    blocks: assertClosedEmailContentJson(parsed) as EmailBlocks,
    authoritative: true,
  };
}

function parseEmailHtmlBlocks(html?: string): EmailBlocks {
  if (!html) {
    return [];
  }
  return assertClosedEmailContentJson(
    parseLegacyEmailHtmlBlocks(html),
  ) as EmailBlocks;
}

function createEmailTextBlocks(text?: string): EmailBlocks {
  if (!text) {
    return [];
  }
  return [
    {
      id: `email-text-${createHash("sha256").update(text).digest("hex").slice(0, 16)}`,
      type: "paragraph",
      props: {
        backgroundColor: "default",
        textColor: "default",
        textAlignment: "left",
      },
      content: [{ type: "text", text, styles: {} }],
      children: [],
    },
  ] as EmailBlocks;
}

async function selectInitialEmailBlocks(input: {
  contentJson?: Uint8Array | null;
  contentHtml?: string | null;
  contentText?: string | null;
}): Promise<EmailBlocks> {
  const json = parseAuthoritativeEmailBlocks(input.contentJson);
  if (json.authoritative) {
    return json.blocks;
  }
  const htmlBlocks = parseEmailHtmlBlocks(input.contentHtml?.trim());
  if (htmlBlocks.length > 0) {
    return htmlBlocks;
  }
  return createEmailTextBlocks(input.contentText?.trim());
}

export async function createEmailDocumentState(input: {
  contentJson?: Uint8Array | null;
  contentHtml?: string | null;
  contentText?: string | null;
}): Promise<Uint8Array> {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("document-store");
  const blocks = stripTrailingEmptyParagraphBlocks(
    (await selectInitialEmailBlocks(input)) as never,
  ) as EmailBlocks;
  replaceGeulBlocksInYXmlFragment(fragment, blocks, "email");
  return Y.encodeStateAsUpdate(doc);
}
