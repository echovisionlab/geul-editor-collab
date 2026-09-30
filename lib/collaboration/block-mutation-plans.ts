import type {
  BaseBlockMutation,
  CanonicalBlock,
  LocaleBlockMutation,
} from "./block-mutation-batch.ts";

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

function upsertBase<TBase, TLocale>(
  block: CanonicalBlock<TBase, TLocale>,
): Extract<BaseBlockMutation<TBase>, { operation: "upsert" }> {
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

function moveBase<TBase, TLocale>(
  block: CanonicalBlock<TBase, TLocale>,
): Extract<BaseBlockMutation<TBase>, { operation: "move" }> {
  return {
    operation: "move",
    blockId: block.blockId,
    parentBlockId: block.parentBlockId,
    containerSlot: block.containerSlot,
    position: block.position,
    ...mutationContext(block),
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
): Extract<BaseBlockMutation<TBase>, { operation: "delete" }> | undefined {
  return previous
    ? { operation: "delete", blockId, ...mutationContext(previous) }
    : undefined;
}

const BASE_MUTATION_ORDER: Record<BaseBlockMutation["operation"], number> = {
  move: 0,
  upsert: 1,
  delete: 2,
};

export interface BasePlacementMutationPlan<TBase> {
  mutations: BaseBlockMutation<TBase>[];
  changedKindBlockIds: ReadonlySet<string>;
}

function planBaseBlock<TBase, TLocale>(input: {
  blockId: string;
  currentBlocks: ReadonlyMap<string, CanonicalBlock<TBase, TLocale>>;
  previousBlocks: ReadonlyMap<string, CanonicalBlock<TBase, TLocale>>;
}): {
  mutation: BaseBlockMutation<TBase> | undefined;
  kindChanged: boolean;
} {
  const block = input.currentBlocks.get(input.blockId);
  const previous = input.previousBlocks.get(input.blockId);
  if (!block) {
    return {
      mutation: deleteBaseMutation(input.blockId, previous),
      kindChanged: false,
    };
  }

  const kindChanged = previous?.kind !== block.kind;
  const baseChanged =
    !previous || kindChanged || !equal(previous.baseData, block.baseData);
  const placementChanged =
    previous &&
    (previous.parentBlockId !== block.parentBlockId ||
      previous.containerSlot !== block.containerSlot ||
      previous.position !== block.position);
  let mutation: BaseBlockMutation<TBase> | undefined;
  if (baseChanged) mutation = upsertBase(block);
  else if (placementChanged) mutation = moveBase(block);

  return {
    mutation,
    kindChanged,
  };
}

export function planBasePlacementMutations<TBase, TLocale>(input: {
  affectedBlockIds: readonly string[];
  currentBlocks: ReadonlyMap<string, CanonicalBlock<TBase, TLocale>>;
  previousBlocks: ReadonlyMap<string, CanonicalBlock<TBase, TLocale>>;
}): BasePlacementMutationPlan<TBase> {
  const mutations: BaseBlockMutation<TBase>[] = [];
  const changedKindBlockIds = new Set<string>();

  for (const blockId of input.affectedBlockIds) {
    const planned = planBaseBlock({ ...input, blockId });
    if (planned.mutation) mutations.push(planned.mutation);
    if (planned.kindChanged) changedKindBlockIds.add(blockId);
  }

  return {
    mutations: mutations.sort(
      (left, right) =>
        BASE_MUTATION_ORDER[left.operation] -
        BASE_MUTATION_ORDER[right.operation],
    ),
    changedKindBlockIds,
  };
}

function planKindChangeLocaleMutation<TBase, TLocale>(input: {
  blockId: string;
  currentBlocks: ReadonlyMap<string, CanonicalBlock<TBase, TLocale>>;
  previousBlocks: ReadonlyMap<string, CanonicalBlock<TBase, TLocale>>;
}): LocaleBlockMutation<TLocale> | undefined {
  const block = input.currentBlocks.get(input.blockId);
  const previous = input.previousBlocks.get(input.blockId);
  if (!block) return undefined;
  if (block.localeData === undefined && previous?.localeData === undefined) {
    return undefined;
  }
  return localeMutation(block, block.localeData);
}

function planChangedLocaleMutation<TBase, TLocale>(input: {
  blockId: string;
  changedKindBlockIds: ReadonlySet<string>;
  currentBlocks: ReadonlyMap<string, CanonicalBlock<TBase, TLocale>>;
  previousBlocks: ReadonlyMap<string, CanonicalBlock<TBase, TLocale>>;
}): LocaleBlockMutation<TLocale> | undefined {
  if (input.changedKindBlockIds.has(input.blockId)) return undefined;
  const block = input.currentBlocks.get(input.blockId);
  const previous = input.previousBlocks.get(input.blockId);
  if (!block || !previous) return undefined;
  if (equal(previous.localeData, block.localeData)) return undefined;
  return localeMutation(block, block.localeData);
}

export function planLocaleMutations<TBase, TLocale>(input: {
  affectedBaseBlockIds: readonly string[];
  affectedLocaleBlockIds: readonly string[];
  changedKindBlockIds: ReadonlySet<string>;
  currentBlocks: ReadonlyMap<string, CanonicalBlock<TBase, TLocale>>;
  previousBlocks: ReadonlyMap<string, CanonicalBlock<TBase, TLocale>>;
}): LocaleBlockMutation<TLocale>[] {
  const mutations: LocaleBlockMutation<TLocale>[] = [];

  for (const blockId of input.affectedBaseBlockIds) {
    if (!input.changedKindBlockIds.has(blockId)) continue;
    const mutation = planKindChangeLocaleMutation({ ...input, blockId });
    if (mutation) mutations.push(mutation);
  }

  for (const blockId of new Set(input.affectedLocaleBlockIds)) {
    const mutation = planChangedLocaleMutation({ ...input, blockId });
    if (mutation) mutations.push(mutation);
  }

  return mutations.sort((left, right) =>
    left.blockId.localeCompare(right.blockId),
  );
}
