/**
 * R20-C: report key plumbing shared by the report screens (drill-hooks, ReportToolbar, PeriodBar, the Gateway viewer):
 * `useReportKeys` joins a report part to one key registration per scope, and the "live report" store feeds the
 * "what you see" strip (`ReportStrip` below, sheets in components/keys/ReportSheets.tsx).
 */
import { Fragment, Suspense, createElement, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { NegativeLedger } from '../ledger';
import { registerKeyActions, type KeyHandler } from './engine';
import type { KeyScope } from './registry';
import type { RowFact, RowTools } from './report-actions';

/* ── R20-C: report keys (one registration per scope, routed to the report on screen) ─────────── */

interface KeyEnt { scope: KeyScope; el: () => Element | null; map: Record<string, KeyHandler> }
const ents = new Set<KeyEnt>();
let sig = '';
let unreg: Array<() => void> = [];
const visible = (el: Element | null) => !!el && (el as HTMLElement).offsetParent !== null;

/** The entry that answers a row: the visible one holding the focus, else the newest visible one. */
function runEnt(scope: KeyScope, id: string, e: Parameters<KeyHandler>[0], row: Parameters<KeyHandler>[1]): boolean | void {
  const list = [...ents].filter((x) => x.scope === scope && x.map[id] && visible(x.el()));
  const ent = list.find((x) => x.el()?.contains(document.activeElement)) ?? list[list.length - 1];
  return ent ? ent.map[id](e, row) : false;
}
function syncKeys() {
  const by = new Map<KeyScope, Set<string>>();
  for (const x of ents) for (const id of Object.keys(x.map)) by.set(x.scope, (by.get(x.scope) ?? new Set()).add(id));
  const next = [...by].map(([s, ids]) => `${s}:${[...ids].sort()}`).sort().join(' ');
  if (next === sig) return;
  sig = next;
  unreg.forEach((f) => f());
  unreg = [...by].map(([scope, ids]) => registerKeyActions(scope, Object.fromEntries([...ids].map((id) => [id, (e, row) => runEnt(scope, id, e, row)]))));
}

/**
 * R20-C: handle report key rows from a report part (table, options bar, period bar). Every mounted part joins one
 * registration per scope; a key goes to the visible part that holds the focus, else the newest visible one, so a
 * report hidden under a drill-down level never answers. `el` returns the part's element.
 */
export function useReportKeys(scope: KeyScope, el: () => Element | null, handlers: Record<string, KeyHandler | false | undefined>): void {
  const ref = useRef({ el, handlers });
  useEffect(() => {
    ref.current = { el, handlers };
  });
  const ids = Object.keys(handlers).filter((k) => handlers[k]).sort().join(' ');
  useEffect(() => {
    const map: Record<string, KeyHandler> = {};
    for (const id of ids.split(' ')) if (id) map[id] = (e, row) => (ref.current.handlers[id] || (() => false))(e, row);
    const ent: KeyEnt = { scope, el: () => ref.current.el(), map };
    ents.add(ent);
    syncKeys();
    return () => {
      ents.delete(ent);
      syncKeys();
    };
  }, [scope, ids]);
}

/** What the "what you see" strip and the filter / exceptions sheets read from the report on screen. */
export interface LiveReport {
  tools: RowTools;
  count: number;
  sheet: '' | 'filter' | 'except';
  /** Rows carry dates / narrations (the filter offers those boxes). */
  dated: boolean;
  facts(): RowFact[];
  set(f: (t: RowTools) => RowTools): void;
  setSheet(s: LiveReport['sheet']): void;
  table(): HTMLElement | null;
  /** Ctrl+J: the period's exceptions (wrong-side ledgers), when the report has a ledger. */
  except?: () => NegativeLedger[];
}
let live: LiveReport | null = null;
const liveSubs = new Set<() => void>();
export const putLive = (l: LiveReport | null) => {
  live = l;
  liveSubs.forEach((f) => f());
};
export const liveReport = (): LiveReport | null => live;
export const subscribeLive = (f: () => void): (() => void) => (liveSubs.add(f), () => void liveSubs.delete(f));

// The strip and the report sheets load only after a report key was used.
const ReportPanel = lazy(() => import('../../components/keys/ReportSheets'));

/**
 * Where a report's filter / ticks / hidden-rows strip shows: under the report it belongs to (the live report's table
 * sits inside this strip's parent). DrillStack mounts one; the Day Book and the Gateway viewer mount their own.
 */
export function ReportStrip() {
  const live = useSyncExternalStore(subscribeLive, liveReport);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const mark = useCallback((el: HTMLSpanElement | null) => setHost(el?.parentElement ?? null), []);
  const t = live?.table();
  return createElement(
    Fragment,
    null,
    createElement('span', { hidden: true, ref: mark }),
    live && t && host?.contains(t) ? createElement(Suspense, { fallback: null }, createElement(ReportPanel, { live })) : null,
  );
}
