import type { AIDocumentFieldTarget } from "@echovisionlab/geul-proto/secure/ai_pb.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CanonicalBlock<TBase = unknown, TLocale = unknown> {
  blockId: string;
  parentBlockId: string | null;
  containerSlot: string;
  position: number;
  kind: string;
  baseData: TBase;
  localeData?: TLocale;
  adapterData?: unknown;
}

export interface CanonicalBlockDocument<TBase = unknown, TLocale = unknown> {
  blockCatalogFingerprint: string;
  profile?: string | number;
  sourceLocale: string;
  locale: string;
  blocks: CanonicalBlock<TBase, TLocale>[];
}

export interface CanonicalBlockChanges<TBase = unknown, TLocale = unknown> {
  locale: string;
  blocks: CanonicalBlock<TBase, TLocale>[];
  affectedBaseBlockIds: string[];
  deletedBaseBlockIds: string[];
  affectedLocaleBlockIds: string[];
  affectedLocaleValueTargets?: readonly AIDocumentFieldTarget[];
  deletedLocaleBlockIds: string[];
}

interface UpsertBaseBlock<TBase = unknown> {
  operation: "upsert";
  block: Omit<CanonicalBlock<TBase, never>, "localeData">;
}
interface DeleteBaseBlock {
  operation: "delete";
  blockId: string;
  kind: string;
  adapterData?: unknown;
}
interface MoveBaseBlock {
  operation: "move";
  blockId: string;
  parentBlockId: string | null;
  containerSlot: string;
  position: number;
  kind: string;
  adapterData?: unknown;
}
export type BaseBlockMutation<TBase = unknown> =
  UpsertBaseBlock<TBase> | DeleteBaseBlock | MoveBaseBlock;
interface UpsertLocaleBlock<TLocale = unknown> {
  operation: "upsert";
  blockId: string;
  data: TLocale;
  kind: string;
  adapterData?: unknown;
}
interface DeleteLocaleBlock {
  operation: "delete";
  blockId: string;
  kind: string;
  adapterData?: unknown;
}
export type LocaleBlockMutation<TLocale = unknown> =
  UpsertLocaleBlock<TLocale> | DeleteLocaleBlock;
export interface BlockMutationBatch<TBase = unknown, TLocale = unknown> {
  expectedDocumentRevision: string;
  expectedTargetRevision?: string;
  blockCatalogFingerprint: string;
  profile?: string | number;
  baseMutations: BaseBlockMutation<TBase>[];
  locale: string;
  localeMutations: LocaleBlockMutation<TLocale>[];
  affectedLocaleValueTargets: AIDocumentFieldTarget[];
  contributorMemberIds: string[];
}
export interface BlockMutationAck {
  documentRevision: string;
  changed: boolean;
  sourceChanged: boolean;
  locale?: string;
  targetRevision?: string;
}

interface PendingMutation<TBase, TLocale> {
  batch: BlockMutationBatch<TBase, TLocale>;
  changes: CanonicalBlockChanges<TBase, TLocale>;
}

function assertAcknowledgementAuthority(
  ack: BlockMutationAck,
  documentRevision: string,
  isTarget: boolean,
): void {
  if (!ack.documentRevision)
    throw new Error("block_mutation_ack_missing_authority");
  if (isTarget && ack.documentRevision !== documentRevision) {
    throw new Error("block_mutation_target_document_revision_changed");
  }
  if (!isTarget && ack.targetRevision !== undefined) {
    throw new Error("block_mutation_source_target_revision_forbidden");
  }
}

function applyAcknowledgedBaseChanges<TBase, TLocale>(
  blocks: Map<string, CanonicalBlock<TBase, TLocale>>,
  changes: CanonicalBlockChanges<TBase, TLocale>,
  current: ReadonlyMap<string, CanonicalBlock<TBase, TLocale>>,
): Set<string> {
  const affectedBase = new Set(changes.affectedBaseBlockIds);
  for (const blockId of affectedBase) {
    const block = current.get(blockId);
    if (block) blocks.set(blockId, block);
    else blocks.delete(blockId);
  }
  return affectedBase;
}

function applyAcknowledgedLocaleChanges<TBase, TLocale>(
  blocks: Map<string, CanonicalBlock<TBase, TLocale>>,
  changes: CanonicalBlockChanges<TBase, TLocale>,
  current: ReadonlyMap<string, CanonicalBlock<TBase, TLocale>>,
  affectedBase: ReadonlySet<string>,
): void {
  for (const blockId of new Set(changes.affectedLocaleBlockIds)) {
    if (affectedBase.has(blockId)) continue;
    const existing = blocks.get(blockId);
    const block = current.get(blockId);
    if (!existing || !block) continue;
    blocks.set(blockId, {
      ...existing,
      ...(block.localeData === undefined
        ? { localeData: undefined }
        : { localeData: block.localeData }),
    });
  }
}

function nextAncestors(
  value: object,
  ancestors: ReadonlySet<object>,
): Set<object> {
  if (ancestors.has(value)) throw new Error("block_document_cyclic_json");
  return new Set(ancestors).add(value);
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value))
    throw new Error("block_document_non_finite_number");
  return JSON.stringify(value);
}

function canonicalJson(
  value: unknown,
  ancestors: ReadonlySet<object> = new Set(),
): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") return canonicalNumber(value);
  if (Array.isArray(value)) {
    const next = nextAncestors(value, ancestors);
    return `[${value.map((item) => canonicalJson(item, next)).join(",")}]`;
  }
  if (typeof value === "object") {
    const next = nextAncestors(value, ancestors);
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item, next)}`,
      )
      .join(",")}}`;
  }
  throw new Error("block_document_non_json_value");
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === undefined || right === undefined) return false;
  return canonicalJson(left) === canonicalJson(right);
}

const BASE_MUTATION_ORDER: Record<BaseBlockMutation["operation"], number> = {
  move: 0,
  upsert: 1,
  delete: 2,
};

function mutationContext<TBase, TLocale>(
  block: CanonicalBlock<TBase, TLocale>,
) {
  return {
    kind: block.kind,
    ...(block.adapterData === undefined
      ? {}
      : { adapterData: block.adapterData }),
  };
}

function assertBlockIdentity(block: CanonicalBlock): void {
  if (!UUID_PATTERN.test(block.blockId))
    throw new Error(`block_document_invalid_block_id:${block.blockId}`);
  if (block.parentBlockId !== null && !UUID_PATTERN.test(block.parentBlockId)) {
    throw new Error(`block_document_invalid_parent_id:${block.parentBlockId}`);
  }
  if (
    !block.containerSlot ||
    !block.kind ||
    !Number.isSafeInteger(block.position) ||
    block.position < 0
  ) {
    throw new Error(`block_document_invalid_structure:${block.blockId}`);
  }
}

function initialBlocks<TBase, TLocale>(
  snapshot: CanonicalBlockDocument<TBase, TLocale>,
) {
  if (!snapshot.blockCatalogFingerprint)
    throw new Error("block_document_missing_catalog_fingerprint");
  if (!snapshot.sourceLocale.trim())
    throw new Error("block_document_missing_source_locale");
  if (!snapshot.locale.trim()) throw new Error("block_document_missing_locale");
  const blocks = new Map<string, CanonicalBlock<TBase, TLocale>>();
  const occupied = new Set<string>();
  for (const block of snapshot.blocks) {
    assertBlockIdentity(block);
    if (blocks.has(block.blockId))
      throw new Error(`block_document_duplicate_block_id:${block.blockId}`);
    const key = `${block.parentBlockId ?? ""}\0${block.containerSlot}\0${block.position}`;
    if (occupied.has(key))
      throw new Error(`block_document_duplicate_position:${block.blockId}`);
    occupied.add(key);
    blocks.set(block.blockId, block);
  }
  const visit = (blockId: string, visiting: Set<string>): void => {
    if (visiting.has(blockId))
      throw new Error(`block_document_parent_cycle:${blockId}`);
    const block = blocks.get(blockId)!;
    if (block.parentBlockId === null) return;
    if (!blocks.has(block.parentBlockId))
      throw new Error(`block_document_missing_parent:${block.blockId}`);
    visit(block.parentBlockId, new Set(visiting).add(blockId));
  };
  for (const blockId of blocks.keys()) visit(blockId, new Set());
  return blocks;
}

function upsertBase<TBase, TLocale>(
  block: CanonicalBlock<TBase, TLocale>,
): UpsertBaseBlock<TBase> {
  return {
    operation: "upsert",
    block: {
      blockId: block.blockId,
      parentBlockId: block.parentBlockId,
      containerSlot: block.containerSlot,
      position: block.position,
      baseData: block.baseData,
      ...mutationContext(block),
    },
  };
}

function localeMutation<TBase, TLocale>(
  block: CanonicalBlock<TBase, TLocale>,
  data: TLocale | undefined,
): LocaleBlockMutation<TLocale> {
  return data === undefined
    ? { operation: "delete", blockId: block.blockId, ...mutationContext(block) }
    : {
        operation: "upsert",
        blockId: block.blockId,
        data,
        ...mutationContext(block),
      };
}

function deleteBaseMutation<TBase, TLocale>(
  blockId: string,
  previous: CanonicalBlock<TBase, TLocale> | undefined,
): DeleteBaseBlock | undefined {
  return previous
    ? { operation: "delete", blockId, ...mutationContext(previous) }
    : undefined;
}

export class BlockMutationBaseline<TBase = unknown, TLocale = unknown> {
  private readonly blocks: Map<string, CanonicalBlock<TBase, TLocale>>;
  private pending?: PendingMutation<TBase, TLocale>;
  private readonly document: Omit<
    CanonicalBlockDocument<TBase, TLocale>,
    "blocks"
  >;

  constructor(
    snapshot: CanonicalBlockDocument<TBase, TLocale>,
    private documentRevision: string,
    private targetRevision?: string,
  ) {
    this.document = {
      blockCatalogFingerprint: snapshot.blockCatalogFingerprint,
      ...(snapshot.profile === undefined ? {} : { profile: snapshot.profile }),
      sourceLocale: snapshot.sourceLocale,
      locale: snapshot.locale,
    };
    this.blocks = initialBlocks(snapshot);
  }

  static fromSnapshot<TBase = unknown, TLocale = unknown>(
    snapshot: CanonicalBlockDocument<TBase, TLocale>,
    documentRevision: string,
    targetRevision?: string,
  ): BlockMutationBaseline<TBase, TLocale> {
    return new BlockMutationBaseline(
      snapshot,
      documentRevision,
      targetRevision,
    );
  }

  get revision(): string {
    return this.documentRevision;
  }

  get target(): string | undefined {
    return this.targetRevision;
  }

  get pendingBatch(): BlockMutationBatch<TBase, TLocale> | undefined {
    return this.pending?.batch;
  }

  advanceDocumentRevision(
    expectedDocumentRevision: string,
    documentRevision: string,
  ): void {
    if (this.pending)
      throw new Error("block_mutation_revision_advance_pending");
    if (this.documentRevision !== expectedDocumentRevision)
      throw new Error("block_mutation_revision_advance_stale");
    if (!documentRevision)
      throw new Error("block_mutation_revision_advance_missing");
    this.documentRevision = documentRevision;
  }

  advanceTargetRevision(targetRevision: string | undefined): void {
    if (this.pending)
      throw new Error("block_mutation_target_revision_advance_pending");
    const isTarget = this.document.locale !== this.document.sourceLocale;
    if (!isTarget && targetRevision !== undefined) {
      throw new Error("block_mutation_source_target_revision_forbidden");
    }
    this.targetRevision = targetRevision;
  }

  // Exhaustive base, placement, and source mutation matrix is one atomic batch builder.
  // eslint-disable-next-line complexity
  prepareAffected(
    changes: CanonicalBlockChanges<TBase, TLocale>,
    contributorMemberIds: readonly string[],
  ): BlockMutationBatch<TBase, TLocale> {
    if (this.pending) return this.pending.batch;
    if (changes.locale !== this.document.locale) {
      throw new Error("block_document_locale_changed");
    }
    const current = new Map(
      changes.blocks.map((block) => {
        assertBlockIdentity(block);
        return [block.blockId, block];
      }),
    );
    const baseMutations: BaseBlockMutation<TBase>[] = [];
    const localeMutations: LocaleBlockMutation<TLocale>[] = [];
    const affectedBase = new Set(changes.affectedBaseBlockIds);
    for (const blockId of affectedBase) {
      const block = current.get(blockId);
      const previous = this.blocks.get(blockId);
      if (!block) {
        const deletion = deleteBaseMutation(blockId, previous);
        baseMutations.push(...(deletion ? [deletion] : []));
        continue;
      }
      const baseChanged =
        !previous ||
        previous.kind !== block.kind ||
        !equal(previous.baseData, block.baseData);
      const placementChanged =
        previous &&
        (previous.parentBlockId !== block.parentBlockId ||
          previous.containerSlot !== block.containerSlot ||
          previous.position !== block.position);
      if (baseChanged) baseMutations.push(upsertBase(block));
      else if (placementChanged) {
        baseMutations.push({
          operation: "move",
          blockId,
          parentBlockId: block.parentBlockId,
          containerSlot: block.containerSlot,
          position: block.position,
          ...mutationContext(block),
        });
      }
      if (
        (!previous || previous.kind !== block.kind) &&
        (block.localeData !== undefined || previous?.localeData !== undefined)
      ) {
        localeMutations.push(localeMutation(block, block.localeData));
      }
    }
    for (const blockId of new Set(changes.affectedLocaleBlockIds)) {
      if (
        affectedBase.has(blockId) &&
        this.blocks.get(blockId)?.kind !== current.get(blockId)?.kind
      )
        continue;
      const block = current.get(blockId);
      const previous = this.blocks.get(blockId);
      if (!block || !previous) continue;
      if (!equal(previous.localeData, block.localeData))
        localeMutations.push(localeMutation(block, block.localeData));
    }
    const batch: BlockMutationBatch<TBase, TLocale> = {
      expectedDocumentRevision: this.documentRevision,
      ...(this.targetRevision === undefined
        ? {}
        : { expectedTargetRevision: this.targetRevision }),
      blockCatalogFingerprint: this.document.blockCatalogFingerprint,
      profile: this.document.profile,
      baseMutations: baseMutations.sort(
        (left, right) =>
          BASE_MUTATION_ORDER[left.operation] -
          BASE_MUTATION_ORDER[right.operation],
      ),
      locale: this.document.locale,
      localeMutations: localeMutations.sort((left, right) =>
        left.blockId.localeCompare(right.blockId),
      ),
      affectedLocaleValueTargets: [
        ...(changes.affectedLocaleValueTargets ?? []),
      ],
      contributorMemberIds: [...new Set(contributorMemberIds)].sort(),
    };
    const isTarget = this.document.locale !== this.document.sourceLocale;
    if (isTarget && this.targetRevision === undefined) {
      throw new Error("block_mutation_missing_target_revision");
    }
    if (isTarget && baseMutations.length > 0) {
      throw new Error("block_mutation_target_structure_forbidden");
    }
    if (baseMutations.length > 0 || batch.localeMutations.length > 0)
      this.pending = { batch, changes };
    return batch;
  }

  prepareFull(
    snapshot: CanonicalBlockDocument<TBase, TLocale>,
    contributorMemberIds: readonly string[],
    affectedLocaleValueTargets: readonly AIDocumentFieldTarget[] = [],
  ): BlockMutationBatch<TBase, TLocale> {
    const current = initialBlocks(snapshot);
    const affectedBaseBlockIds = [
      ...new Set([...this.blocks.keys(), ...current.keys()]),
    ];
    const affectedLocaleBlockIds = [
      ...new Set([...this.blocks.keys(), ...current.keys()]),
    ];
    return this.prepareAffected(
      {
        locale: snapshot.locale,
        blocks: [...current.values()],
        affectedBaseBlockIds,
        deletedBaseBlockIds: affectedBaseBlockIds.filter(
          (id) => !current.has(id),
        ),
        affectedLocaleBlockIds,
        affectedLocaleValueTargets: [...affectedLocaleValueTargets],
        deletedLocaleBlockIds: affectedLocaleBlockIds.filter(
          (blockId) => current.get(blockId)?.localeData === undefined,
        ),
      },
      contributorMemberIds,
    );
  }

  acknowledge(ack: BlockMutationAck): void {
    if (!this.pending) throw new Error("block_mutation_ack_without_request");
    const isTarget = this.document.locale !== this.document.sourceLocale;
    assertAcknowledgementAuthority(ack, this.documentRevision, isTarget);
    const { changes } = this.pending;
    const current = new Map(
      changes.blocks.map((block) => [block.blockId, block]),
    );
    const affectedBase = applyAcknowledgedBaseChanges(
      this.blocks,
      changes,
      current,
    );
    applyAcknowledgedLocaleChanges(this.blocks, changes, current, affectedBase);
    this.documentRevision = ack.documentRevision;
    this.targetRevision = ack.targetRevision;
    this.pending = undefined;
  }
}
