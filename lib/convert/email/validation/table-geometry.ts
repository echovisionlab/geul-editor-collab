export interface TableGeometryCell {
  colspan: number;
  rowspan: number;
}

interface TableInterval {
  start: number;
  end: number;
  endRow: number;
}

function mergeTableIntervals(
  left: readonly TableInterval[],
  right: readonly TableInterval[],
): TableInterval[] {
  const merged: TableInterval[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < left.length || rightIndex < right.length) {
    const leftInterval = left[leftIndex];
    const rightInterval = right[rightIndex];
    if (
      rightInterval === undefined ||
      (leftInterval !== undefined && leftInterval.start <= rightInterval.start)
    ) {
      merged.push(leftInterval);
      leftIndex += 1;
    } else {
      merged.push(rightInterval);
      rightIndex += 1;
    }
  }

  return merged;
}

function advancePastActiveTableIntervals(
  activeIntervals: readonly TableInterval[],
  activeIndex: number,
  columnIndex: number,
): { activeIndex: number; columnIndex: number } {
  let nextActiveIndex = activeIndex;
  let nextColumnIndex = columnIndex;
  while (nextActiveIndex < activeIntervals.length) {
    const active = activeIntervals[nextActiveIndex];
    if (active.start > nextColumnIndex) {
      break;
    }
    nextColumnIndex = active.end;
    nextActiveIndex += 1;
  }
  return { activeIndex: nextActiveIndex, columnIndex: nextColumnIndex };
}

function geometryForTableRow(
  rows: readonly (readonly TableGeometryCell[])[],
  rowIndex: number,
  cells: readonly TableGeometryCell[],
  activeIntervals: readonly TableInterval[],
  source: "Yjs" | "content JSON",
): { rowWidth: number; currentIntervals: TableInterval[] } {
  const currentIntervals: TableInterval[] = [];
  let activeIndex = 0;
  let columnIndex = 0;
  for (const cell of cells) {
    if (cell.rowspan > rows.length - rowIndex) {
      throw new Error(`Invalid email ${source} table rowspan`);
    }
    ({ activeIndex, columnIndex } = advancePastActiveTableIntervals(
      activeIntervals,
      activeIndex,
      columnIndex,
    ));
    if (cell.colspan > Number.MAX_SAFE_INTEGER - columnIndex) {
      throw new Error(`Invalid email ${source} table colspan`);
    }
    const end = columnIndex + cell.colspan;
    const nextActive = activeIntervals[activeIndex];
    if (nextActive && nextActive.start < end) {
      throw new Error(`Invalid email ${source} overlapping table cells`);
    }
    currentIntervals.push({
      start: columnIndex,
      end,
      endRow: rowIndex + cell.rowspan,
    });
    columnIndex = end;
  }

  const rowIntervals = mergeTableIntervals(activeIntervals, currentIntervals);
  let rowWidth = 0;
  for (const interval of rowIntervals) {
    if (interval.start > rowWidth) {
      throw new Error(`Invalid email ${source} non-rectangular table`);
    }
    rowWidth = interval.end;
  }
  return { rowWidth, currentIntervals };
}

export function assertIntervalTableGeometry(
  rows: readonly (readonly TableGeometryCell[])[],
  source: "Yjs" | "content JSON",
): number {
  let activeIntervals: TableInterval[] = [];
  let tableWidth: number | undefined;

  for (const [rowIndex, cells] of rows.entries()) {
    const { rowWidth, currentIntervals } = geometryForTableRow(
      rows,
      rowIndex,
      cells,
      activeIntervals,
      source,
    );
    if (
      rowWidth === 0 ||
      (tableWidth !== undefined && rowWidth !== tableWidth)
    ) {
      throw new Error(`Invalid email ${source} non-rectangular table`);
    }
    tableWidth = rowWidth;

    activeIntervals = mergeTableIntervals(
      activeIntervals.filter((interval) => interval.endRow > rowIndex + 1),
      currentIntervals.filter((interval) => interval.endRow > rowIndex + 1),
    );
  }

  return tableWidth as number;
}
