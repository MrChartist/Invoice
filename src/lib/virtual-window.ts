/**
 * Pure maths behind `useVirtualRows`: which rows of a long list to mount for a given viewport,
 * and how tall the spacer ("gap") rows standing in for the rest must be.
 *
 * Rows may have different heights (measured after render, keyed by row id so a re-sort keeps
 * them); unmeasured rows use the average measured height, or the caller's estimate.
 * No DOM access here, so it is unit-tested in tests/virtual-window.test.ts.
 */

export type Slot =
  | { kind: 'row'; index: number }
  | { kind: 'gap'; key: string; height: number };

export interface Range {
  /** First mounted index (inclusive). */
  start: number;
  /** Last mounted index + 1 (exclusive). */
  end: number;
}

/** Height of every row: measured where known, else the mean of measured rows, else `estimate`. */
export function rowSizes(keys: readonly string[], measured: ReadonlyMap<string, number>, estimate: number): number[] {
  let sum = 0;
  let n = 0;
  for (const k of keys) {
    const h = measured.get(k);
    if (h !== undefined) {
      sum += h;
      n++;
    }
  }
  const fallback = n ? sum / n : estimate;
  return keys.map((k) => measured.get(k) ?? fallback);
}

/** offsets[i] = top of row i; offsets[count] = total height. */
export function prefixOffsets(sizes: readonly number[]): number[] {
  const out = new Array<number>(sizes.length + 1);
  out[0] = 0;
  for (let i = 0; i < sizes.length; i++) out[i + 1] = out[i] + sizes[i];
  return out;
}

/** Largest i with offsets[i] <= y (clamped to [0, count - 1]). */
function indexAt(offsets: readonly number[], y: number): number {
  const count = offsets.length - 1;
  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/**
 * Rows intersecting [viewTop, viewBottom) (in list coordinates, 0 = top of the first row),
 * widened by `overscan` rows on each side.
 */
export function visibleRange(offsets: readonly number[], viewTop: number, viewBottom: number, overscan: number): Range {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  const total = offsets[count];
  // Viewport entirely above / below the list: still mount a little so the edge is ready.
  const top = Math.min(Math.max(viewTop, 0), total);
  const bottom = Math.min(Math.max(viewBottom, top), total);
  const first = indexAt(offsets, top);
  const last = bottom > top ? indexAt(offsets, bottom - 0.001) : first;
  return { start: Math.max(0, first - overscan), end: Math.min(count, last + 1 + overscan) };
}

/**
 * The slots to render: mounted rows plus gap rows for the unmounted runs. `pinned` (the row that
 * holds keyboard focus) stays mounted even when scrolled away, so focus is never dropped.
 */
export function buildSlots(offsets: readonly number[], range: Range, pinned: number | null = null): Slot[] {
  const count = offsets.length - 1;
  const start = Math.max(0, Math.min(range.start, count));
  const end = Math.max(start, Math.min(range.end, count));
  const indices: number[] = [];
  if (pinned !== null && pinned >= 0 && pinned < count && pinned < start) indices.push(pinned);
  for (let i = start; i < end; i++) indices.push(i);
  if (pinned !== null && pinned >= 0 && pinned < count && pinned >= end) indices.push(pinned);

  const slots: Slot[] = [];
  let cursor = 0;
  let gaps = 0; // positional keys keep the spacer elements stable while scrolling
  for (const i of indices) {
    if (i > cursor) slots.push({ kind: 'gap', key: `gap-${gaps++}`, height: offsets[i] - offsets[cursor] });
    slots.push({ kind: 'row', index: i });
    cursor = i + 1;
  }
  if (cursor < count) slots.push({ kind: 'gap', key: `gap-${gaps}`, height: offsets[count] - offsets[cursor] });
  return slots;
}
