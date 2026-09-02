type PatchableMeta = object;

type MetaPatch<T extends PatchableMeta> = Partial<T> & {
  patchMask?: string[];
};

export function compactMeta<T extends PatchableMeta>(meta: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

export function diffMetaPatch<T extends PatchableMeta>(
  previous: Partial<T> | undefined,
  next: Partial<T>,
): MetaPatch<T> | undefined {
  if (!previous && Object.keys(next).length === 0) {
    return undefined;
  }
  if (!previous) {
    const changedKeys = Object.keys(next);
    return {
      ...next,
      patchMask: changedKeys,
    };
  }

  const patch: Partial<T> = {};
  const changedKeys: string[] = [];

  (Object.keys(next) as (keyof T & string)[]).forEach((key) => {
    if (!metaValueEquals(previous[key], next[key])) {
      patch[key] = next[key];
      changedKeys.push(key);
    }
  });

  if (changedKeys.length === 0) {
    return undefined;
  }

  return {
    ...patch,
    patchMask: changedKeys,
  };
}

function metaValueEquals(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (a == null || b == null) {
    return false;
  }
  if (typeof a !== typeof b) {
    return false;
  }
  if (typeof a !== "object") {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}
