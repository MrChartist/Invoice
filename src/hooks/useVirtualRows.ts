import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent } from 'react';
import { flushSync } from 'react-dom';
import { buildSlots, prefixOffsets, rowSizes, visibleRange, type Range, type Slot } from '../lib/virtual-window';

/**
 * Dependency-free row windowing for long `<table>`s.
 *
 * - Only kicks in above `threshold` rows; smaller lists render exactly as before (no extra attributes).
 * - Mounts the rows in view (+ `overscan`) and replaces the rest with spacer rows (`<VirtualGap>`),
 *   so `<table>/<thead>/<tbody>/<tr>` semantics stay intact. Rows announce their real position via
 *   `aria-rowindex`; the table should set `aria-rowcount` (see `ariaRowCount`).
 * - Row heights are measured after render (all `<tr>` children of the tbody with the same
 *   `data-vindex` are summed, so a row plus an expanded detail row count as one item), so the mobile
 *   card layout and expandable rows work without configuration.
 * - Follows whichever ancestor actually scrolls (the app's `main#main`), falling back to the window.
 * - The row holding keyboard focus stays mounted when scrolled away, so focus is never lost.
 * - Printing temporarily renders every row.
 * - Trade-off: browser find-in-page (Ctrl+F) only sees mounted rows; use the page's search box.
 */
export interface VirtualRowsOptions {
  /** Height used for rows not yet measured (px). */
  estimate?: number;
  /** Extra rows mounted above and below the viewport. */
  overscan?: number;
  /** Lists with this many rows or fewer are not virtualised. */
  threshold?: number;
  /** Rows in the table before the first virtualised row (header rows etc.), for `aria-rowindex`. */
  rowIndexOffset?: number;
}

export interface VirtualRows {
  enabled: boolean;
  slots: Slot[];
  /** Spread onto the `<tbody>`. */
  bodyProps: {
    ref: (el: HTMLTableSectionElement | null) => void;
    onFocus?: (e: FocusEvent<HTMLTableSectionElement>) => void;
    onBlur?: (e: FocusEvent<HTMLTableSectionElement>) => void;
  };
  /** Spread onto every `<tr>` that belongs to row `index` (empty object when not virtualised). */
  rowProps: (index: number) => { 'data-vindex'?: number; 'aria-rowindex'?: number };
  /** Value for the table's `aria-rowcount` given the number of non-virtualised rows (header, footer). */
  ariaRowCount: (extraRows: number) => number | undefined;
}

const DEFAULTS = { estimate: 64, overscan: 8, threshold: 100, rowIndexOffset: 1 };

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    // overflow-x:auto wrappers also compute overflow-y:auto; only an element that really overflows counts.
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

export function useVirtualRows(keys: readonly string[], options: VirtualRowsOptions = {}): VirtualRows {
  const { estimate, overscan, threshold, rowIndexOffset } = { ...DEFAULTS, ...options };
  const [printing, setPrinting] = useState(false);
  const enabled = keys.length > threshold && !printing;

  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  // Measured heights by row key (replaced, never mutated, when a measurement pass finds a change).
  const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [range, setRange] = useState<Range>(() => ({
    start: 0,
    end: Math.ceil((typeof window === 'undefined' ? 900 : window.innerHeight) / estimate) + overscan,
  }));
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const offsets = useMemo(
    () => (enabled ? prefixOffsets(rowSizes(keys, measured, estimate)) : []),
    [enabled, keys, measured, estimate],
  );
  const offsetsRef = useRef(offsets);
  useLayoutEffect(() => {
    offsetsRef.current = offsets;
  }, [offsets]);

  /** Recompute the mounted range from the current scroll position. */
  const scrollerRef = useRef<HTMLElement | null>(null);
  const update = useCallback(() => {
    if (!body) return;
    const offs = offsetsRef.current;
    if (offs.length < 2) return;
    const scroller = scrollerRef.current ?? scrollParent(body);
    // List coordinates start at the first windowed row (after any fixed rows such as an opening balance).
    let listTop = body.getBoundingClientRect().top;
    for (const tr of Array.from(body.children) as HTMLElement[]) {
      if (tr.dataset.vindex !== undefined || tr.dataset.vgap !== undefined) break;
      listTop += tr.getBoundingClientRect().height;
    }
    const s = scroller?.getBoundingClientRect();
    const viewTop = Math.max(s ? s.top : 0, 0);
    const viewBottom = Math.min(s ? s.bottom : window.innerHeight, window.innerHeight);
    const next = visibleRange(offs, viewTop - listTop, viewBottom - listTop, overscan);
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [body, overscan]);

  /** Read the real heights of mounted rows; re-layout only if something changed. */
  const measure = useCallback(() => {
    if (!body) return;
    const heights = new Map<number, number>();
    for (const tr of Array.from(body.children) as HTMLElement[]) {
      const v = tr.dataset.vindex;
      if (v === undefined) continue;
      const i = Number(v);
      heights.set(i, (heights.get(i) ?? 0) + tr.getBoundingClientRect().height);
    }
    const changes: [string, number][] = [];
    for (const [i, h] of heights) {
      const key = keys[i];
      if (key !== undefined && h > 0) changes.push([key, h]);
    }
    setMeasured((prev) => {
      const diff = changes.filter(([k, h]) => Math.abs((prev.get(k) ?? -1) - h) > 0.5);
      if (!diff.length) return prev;
      const next = new Map(prev);
      for (const [k, h] of diff) next.set(k, h);
      return next;
    });
  }, [body, keys]);

  // After every render: measure what is mounted, then re-check the range (both no-ops when stable).
  useLayoutEffect(() => {
    if (!enabled) return;
    // Measuring the DOM after commit is what layout effects are for; both calls bail out when stable.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    measure();
    update();
  });

  // Follow scrolling of the real scroll container and viewport changes.
  useEffect(() => {
    if (!enabled || !body) return;
    const scroller = scrollParent(body);
    scrollerRef.current = scroller;
    const target: HTMLElement | Window = scroller ?? window;
    const onScroll = () => update();
    target.addEventListener('scroll', onScroll, { passive: true });
    if (target !== window) window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    // Size changes inside rows (an expanded detail row, a nested list, the 640px card layout)
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        measure();
        update();
      });
      ro.observe(body);
    }
    return () => {
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      ro?.disconnect();
      scrollerRef.current = null;
    };
  }, [enabled, body, update, measure]);

  // Print every row (the gap rows would otherwise print as blank space).
  useEffect(() => {
    if (keys.length <= threshold) return;
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [keys.length, threshold]);

  const pinned = focusedKey === null ? null : keys.indexOf(focusedKey);
  const slots = useMemo<Slot[]>(
    () => (enabled ? buildSlots(offsets, range, pinned !== null && pinned >= 0 ? pinned : null) : keys.map((_, index) => ({ kind: 'row', index }))),
    [enabled, offsets, range, pinned, keys],
  );

  const onFocus = useCallback(
    (e: FocusEvent<HTMLTableSectionElement>) => {
      const tr = (e.target as HTMLElement).closest?.('[data-vindex]') as HTMLElement | null;
      if (!tr || tr.parentElement !== e.currentTarget) return;
      const key = keys[Number(tr.dataset.vindex)];
      if (key !== undefined) setFocusedKey(key);
    },
    [keys],
  );
  const onBlur = useCallback((e: FocusEvent<HTMLTableSectionElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusedKey(null);
  }, []);

  const rowProps = useCallback(
    (index: number) => (enabled ? { 'data-vindex': index, 'aria-rowindex': index + 1 + rowIndexOffset } : {}),
    [enabled, rowIndexOffset],
  );

  return {
    enabled,
    slots,
    bodyProps: enabled ? { ref: setBody, onFocus, onBlur } : { ref: setBody },
    rowProps,
    ariaRowCount: (extra: number) => (enabled ? keys.length + extra : undefined),
  };
}
