/**
 * DrillStack (WP-2, P0-4): Tally-style drill-down for any report. Enter (or a click) on a row pushes
 * the next screen; Esc goes back one level and restores that screen's scroll position and selected
 * row; the breadcrumb jumps back several levels at once. Reusable: the Books tabs and the Gateway's
 * "Display" viewer mount one `DrillStack` around their root report and push frames with `useDrill()`.
 *
 *   <DrillStack rootTitle="Balance Sheet" resetKey={asOf}>{<BalanceSheet />}</DrillStack>
 *   (hooks in ./drill-hooks.ts)
 *   const drill = useDrill();  drill.push({ key: 'ledger:bank', title: 'Ledger: Bank', render: () => <View /> });
 *   const nav = useDrillRows(rows.length, (i) => open(rows[i]));  <tbody id={nav.bodyId}>{rows.map((r, i) => <tr {...nav.row(i)} />)}
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { reportsT } from '../../../i18n/areas/reports-engine';
import { useT } from '../../../i18n';
import styles from './ledger.module.css';

import { DrillContext, dialogOpen, typing, type DrillApi, type DrillEntry as Entry, type DrillFrame } from './drill-hooks';

export type { DrillApi, DrillFrame };

export function DrillStack({ rootTitle, resetKey, children }: { rootTitle: string; resetKey?: string; children: ReactNode }) {
  useT();
  const [stack, setStack] = useState<Entry[]>([]);
  const restore = useRef<number | null>(null);
  const [rootSelected, setRootSelected] = useState(0);
  const [prevKey, setPrevKey] = useState(resetKey);
  // A new period / report resets to the root (state adjusted during render, React's recommended pattern).
  if (prevKey !== resetKey) {
    setPrevKey(resetKey);
    setStack([]);
  }

  const rootScroll = useRef(0);
  const push = useCallback((frame: DrillFrame) => {
    const y = typeof window !== 'undefined' ? window.scrollY : 0;
    setStack((s) => {
      if (!s.length) {
        rootScroll.current = y;
        return [{ frame, selected: 0, scrollY: 0 }];
      }
      return [...s.slice(0, -1), { ...s[s.length - 1], scrollY: y }, { frame, selected: 0, scrollY: 0 }];
    });
  }, []);
  const popTo = useCallback((depth: number) => {
    setStack((s) => {
      if (depth >= s.length + 1 || depth < 0) return s;
      const next = s.slice(0, depth);
      restore.current = depth === 0 ? rootScroll.current : next[next.length - 1]?.scrollY ?? 0;
      return next;
    });
  }, []);
  const pop = useCallback(() => setStack((s) => {
    if (!s.length) return s;
    const next = s.slice(0, -1);
    restore.current = next.length ? next[next.length - 1].scrollY : rootScroll.current;
    return next;
  }), []);

  const wrap = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    if (restore.current !== null) {
      const y = restore.current;
      restore.current = null;
      window.scrollTo?.({ top: y });
      return;
    }
    // A new level: bring its top into view if the user had scrolled past it.
    const top = wrap.current?.getBoundingClientRect().top ?? 0;
    if (stack.length && top < 0) wrap.current?.scrollIntoView?.({ block: 'start' });
  }, [stack.length]);

  useEffect(() => {
    if (!stack.length) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || typing(e.target) || dialogOpen()) return;
      e.preventDefault();
      pop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stack.length, pop]);

  const depth = stack.length;
  const top = stack[depth - 1];
  const api = useMemo<DrillApi>(
    () => ({
      push,
      pop,
      popTo,
      depth,
      selected: top ? top.selected : rootSelected,
      setSelected: (i: number) => {
        if (!top) setRootSelected(i);
        else setStack((s) => s.map((e, k) => (k === s.length - 1 ? { ...e, selected: i } : e)));
      },
    }),
    [push, pop, popTo, depth, top, rootSelected],
  );

  return (
    <DrillContext.Provider value={api}>
      <div ref={wrap} className={styles.drillWrap} />
      {depth > 0 && (
        <nav className={`${styles.crumbs} no-print`} aria-label={reportsT('drillPath')}>
          <ol>
            <li>
              <button type="button" className={styles.crumb} onClick={() => popTo(0)}>{rootTitle}</button>
            </li>
            {stack.map((e, i) => (
              <li key={`${e.frame.key}-${i}`}>
                <ChevronRight size={14} aria-hidden="true" />
                {i === depth - 1 ? (
                  <span aria-current="page">{e.frame.title}</span>
                ) : (
                  <button type="button" className={styles.crumb} onClick={() => popTo(i + 1)}>{e.frame.title}</button>
                )}
              </li>
            ))}
          </ol>
          <button type="button" className={styles.crumbBack} onClick={pop}>{reportsT('back')}</button>
        </nav>
      )}
      {/* The root stays mounted (hidden) so its own state survives a drill and an Esc. */}
      <div hidden={depth > 0}>{children}</div>
      {top && <div key={`${top.frame.key}-${depth}`}>{top.frame.render()}</div>}
    </DrillContext.Provider>
  );
}

