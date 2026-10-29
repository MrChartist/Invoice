/**
 * Drill-down plumbing shared by DrillStack and the report screens (WP-2): the stack context, the
 * `useDrill()` API, keyboard row navigation (`useDrillRows`) and per-report options (`useReportPrefs`).
 * Kept apart from the components so React Fast Refresh stays happy.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { getReportPrefs, setReportPrefs, type ReportPrefs } from '../../../lib/report-prefs';
import { negativeLedgers, type LedgerVoucher } from '../../../lib/ledger';
import { getPeriodContext } from '../../../lib/books';
import { can } from '../../../lib/access';
import { setVoucherDate } from '../../../lib/gateway/period';
import { keysOn } from '../../../lib/keys/stub';
import { rowById } from '../../../lib/keys/registry';
import { rowRoute } from '../../../lib/keys/engine';
import { duplicateRoute } from '../../../lib/keys/entry-actions';
import { liveReport, putLive, useReportKeys, type LiveReport } from '../../../lib/keys/report-keys';
import {
  NO_TOOLS, addSel, hideRows, invertSel, shownRows, stepShown, toggleSel, toolsActive, unhideAll, unhideLast,
  type RowFact, type RowTools,
} from '../../../lib/keys/report-actions';
import { EnvContext } from './report-env';
import surface from '../../../styles/surface.module.css';
import rk from '../../keys/report-keys.module.css';
import styles from './ledger.module.css';

export interface DrillFrame {
  /** Unique within the stack (re-pushing the same key replaces nothing; it is a new level). */
  key: string;
  title: string;
  render: () => ReactNode;
}

export interface DrillEntry {
  frame: DrillFrame;
  selected: number;
  scrollY: number;
}

export interface DrillApi {
  push(frame: DrillFrame): void;
  /** Back one level (Esc). */
  pop(): void;
  /** Back to level `depth` (0 = the root report). */
  popTo(depth: number): void;
  depth: number;
  /** Selected row of the CURRENT frame (kept when the user comes back with Esc). */
  selected: number;
  setSelected(i: number): void;
}

export const DrillContext = createContext<DrillApi | null>(null);

/** Inside a DrillStack: the stack API. Outside one: a no-op API, so views render standalone too. */
export function useDrill(): DrillApi {
  const ctx = useContext(DrillContext);
  const [selected, setSelected] = useState(0);
  return ctx ?? { push: () => {}, pop: () => {}, popTo: () => {}, depth: 0, selected, setSelected };
}

export const typing = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName));
};
export const dialogOpen = () => typeof document !== 'undefined' && !!document.querySelector('[role="dialog"], [role="alertdialog"]');

const NUM = /-?[\d,]+(?:\.\d+)?/;
/** Facts read from the rendered row (reports that pass none): text, last amount column (Dr / Cr), indent. */
function domFact(tr: HTMLTableRowElement): RowFact {
  const cells = [...tr.cells];
  const last = cells.filter((td) => td.className.includes(surface.numeric)).pop()?.textContent?.trim() ?? '';
  const v = Math.round(Number((last.match(NUM)?.[0] ?? '0').replace(/,/g, '')) * 100) || 0;
  const pad = parseFloat(cells.map((c) => c.style.paddingLeft).find(Boolean) ?? '0') || 0;
  return { text: tr.textContent ?? '', amt: /Cr$/.test(last) ? -v : v, depth: tr.className.includes(styles.groupRow) ? -1 : pad };
}

/** Extra row abilities a report may give (all optional; `useDrillRows(count, onActivate)` stays as it was). */
export interface DrillRowOpts {
  /** Facts for the filter and totals (else read from the row's cells). */
  fact?: (i: number) => RowFact;
  /** The voucher of a row: Alt+I / Alt+A open a new entry of its type on its day. */
  voucher?: (i: number) => LedgerVoucher | undefined;
  /** Ctrl+Enter: the row's master (a route); else the row opens as with Enter. */
  master?: (i: number) => string | undefined;
  /** Shift+Enter: expand / collapse the row. */
  expand?: (i: number) => void;
}

const GW_KIND: Record<string, string> = { Journal: 'journal', Contra: 'contra', Payment: 'payment', Receipt: 'receipt' };
const ROW_KIND: Record<string, string> = { Sales: 'sales', 'Credit Note': 'creditNote', 'Debit Note': 'debitNote', Purchase: 'purchase', Expense: 'purchase' };
const field = (t: EventTarget | null | undefined) => !!(t as Element | null)?.closest?.('a, button, input, select, textarea');

/**
 * Keyboard row navigation for a report table (↑ ↓ Home End PgUp PgDn, Enter drills). The selection
 * lives in the DrillStack, so Esc back lands on the same row. R20-C (Tally keys on): Space ticks, Shift+↑ / ↓ extend,
 * Ctrl+R hides, Ctrl+U / Alt+U restore, Ctrl+F filters (Esc clears), Ctrl+P / Ctrl+E press Print / Export, Ctrl+J
 * exceptions, Shift+Enter / Ctrl+Enter / Alt+I from `opts`; never saved (per visit).
 */
export function useDrillRows(count: number, onActivate: (index: number) => void, opts: DrillRowOpts = {}) {
  const { selected, setSelected } = useDrill();
  // The row container is found by id (no ref object, so callers may pass `nav` around during render).
  const bodyId = useId();
  const navigate = useNavigate();
  const env = useContext(EnvContext);
  const [tools, setTools] = useState<RowTools>(NO_TOOLS);
  const [sheet, setSheet] = useState<LiveReport['sheet']>('');
  const [seen, setSeen] = useState(count);
  // New rows (period, detail, columns) start clean: ticks and hidden rows are by position.
  if (seen !== count) {
    setSeen(count);
    setTools(NO_TOOLS);
  }
  const shown = useMemo(() => shownRows(count, tools), [count, tools]);
  const raw = Math.min(Math.max(selected, 0), Math.max(count - 1, 0));
  const sel = !shown.length || shown.includes(raw) ? raw : stepShown(shown, raw, 1);
  const table = () => document.getElementById(bodyId)?.closest('table') ?? null;
  const facts = (): RowFact[] => {
    const rows = new Map([...(document.getElementById(bodyId)?.querySelectorAll<HTMLTableRowElement>(':scope > tr[data-ri]') ?? [])].map((tr) => [Number(tr.dataset.ri), tr]));
    return Array.from({ length: count }, (_, i) => opts.fact?.(i) ?? (rows.get(i) ? domFact(rows.get(i)!) : { text: '', amt: 0 }));
  };
  const self = useRef<LiveReport | null>(null);
  const snap: LiveReport = { tools, count, sheet, dated: !!opts.fact, facts, set: setTools, setSheet, table, except: env ? () => negativeLedgers(env.ledger, getPeriodContext().period) : undefined };
  useEffect(() => {
    self.current = snap;
  });

  useEffect(() => {
    const el = document.getElementById(bodyId)?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [sel, bodyId]);

  // Focus the table when it appears so the keys work at once (no scroll jump).
  useEffect(() => {
    const t = document.getElementById(bodyId)?.closest<HTMLElement>('[tabindex]');
    if (t && !typing(document.activeElement) && !dialogOpen()) t.focus({ preventScroll: true });
  }, [bodyId]);

  // The tick column shows while rows are ticked (on the body, so callers keep `id={nav.bodyId}`).
  useEffect(() => {
    document.getElementById(bodyId)?.classList.toggle(rk.ticking, tools.sel.length > 0);
  }, [bodyId, tools.sel.length]);

  // The "what you see" strip and sheets follow the report that was last acted on.
  useEffect(() => {
    if (toolsActive(tools) || sheet) putLive(self.current);
    else if (liveReport()?.table() === table() || !liveReport()?.table()) putLive(null);
  }, [tools, sheet, count]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    if (liveReport() && !liveReport()?.table()?.isConnected) putLive(null);
  }, []);

  const go = (i: number) => setSelected(i);
  const tick = (dir: number) => {
    const n = stepShown(shown, sel, dir);
    setTools((t) => (dir ? addSel(t, [sel, n]) : toggleSel(t, sel)));
    go(dir ? n : stepShown(shown, sel, 1));
  };
  const insert = () => {
    const v = opts.voucher?.(sel);
    const gw = v && GW_KIND[v.kind];
    if (gw && can('books.edit')) {
      setVoucherDate(v.date);
      navigate(`/gateway/voucher/${gw}`);
      return true;
    }
    const row = v && rowById(ROW_KIND[v.kind] ?? '');
    const to = row && (!row.need || can(row.need)) ? rowRoute(row) : undefined;
    if (!to) return false;
    navigate(to);
  };
  // Alt+2 (R20-B's route): an unsaved copy of the row's manual voucher or sales document; it numbers on save.
  const dup = () => {
    const v = opts.voucher?.(sel);
    const gw = v?.manualId && GW_KIND[v.kind];
    const inv = /^\/invoice\/([^/?]+)$/.exec(v?.link ?? '')?.[1];
    const to = gw && can('books.edit') ? duplicateRoute('voucher', v!.manualId!, gw) : inv && can('doc.create') ? duplicateRoute('invoice', decodeURIComponent(inv)) : '';
    if (!to) return false;
    navigate(to);
  };
  const press = (sel: string) => {
    let el: Element | null = table();
    for (let k = 0; el && k < 8; k++, el = el.parentElement) {
      const b = [...el.querySelectorAll<HTMLButtonElement>(sel)].find((x) => x.offsetParent !== null);
      if (b) return void b.click();
    }
    return false;
  };
  useReportKeys('reportRow', table, {
    select: (e) => (field(e.target) ? false : tick(0)),
    'extend.down': () => tick(1),
    'extend.up': () => tick(-1),
    hide: () => setTools((t) => hideRows(t, sel)),
    expand: opts.expand && (() => opts.expand?.(sel)),
    alterRow: () => {
      const to = opts.master?.(sel);
      if (to) navigate(to);
      else onActivate(sel);
    },
    insert: opts.voucher && insert,
    'insert.alias': opts.voucher && insert,
    'dup.row': opts.voucher && dup,
  });
  useReportKeys('report', table, {
    filter: () => setSheet('filter'),
    'filter.alias': () => setSheet('filter'),
    invert: () => setTools((t) => invertSel(t, shown)),
    unhide: () => (tools.hid.length ? setTools(unhideLast) : false),
    unhideAll: () => (tools.hid.length ? setTools(unhideAll) : false),
    except: env ? () => setSheet('except') : undefined,
    printReport: () => window.print(),
    export: () => press('button:has(> svg.lucide-download), button:has(> svg.lucide-file-spreadsheet)'),
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (typing(e.target) || !count) return;
    if (e.key === 'Escape' && (tools.filter || tools.sel.length)) {
      // Esc clears the filter (then the ticks) before it leaves the level.
      e.preventDefault();
      setTools((t) => (t.filter ? { ...t, filter: null, match: null } : { ...t, sel: [] }));
      return;
    }
    if (!shown.length) return;
    const pos = Math.max(shown.indexOf(sel), 0);
    const at = (p: number) => shown[Math.min(Math.max(p, 0), shown.length - 1)];
    const map: Record<string, number> = {
      ArrowDown: at(pos + 1),
      ArrowUp: at(pos - 1),
      Home: shown[0],
      End: shown[shown.length - 1],
      PageDown: at(pos + 10),
      PageUp: at(pos - 10),
    };
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON' && (e.target as HTMLElement).tagName !== 'A') {
      // Tally keys: Shift+Enter / Ctrl+Enter are row keys (expand, open the master), handled by the key engine.
      if ((e.shiftKey || e.ctrlKey || e.metaKey) && keysOn()) return;
      e.preventDefault();
      onActivate(sel);
      return;
    }
    if (map[e.key] === undefined || e.shiftKey) return;
    e.preventDefault();
    go(map[e.key]);
  };

  const hid = useMemo(() => new Set(tools.hid.flat()), [tools.hid]);
  return {
    table: { tabIndex: 0, onKeyDown },
    bodyId,
    row: (i: number) => ({
      'data-ri': i,
      'data-selected': i === sel ? 'true' : undefined,
      'aria-selected': tools.sel.length ? tools.sel.includes(i) : undefined,
      hidden: hid.has(i) || (tools.match ? !tools.match.includes(i) : undefined) || undefined,
      className: [i === sel ? styles.rowSel : '', tools.sel.includes(i) ? rk.tick : ''].filter(Boolean).join(' ') || undefined,
      onClick: (e: React.MouseEvent) => {
        setSelected(i);
        // Ctrl / ⌘ + click ticks the row (the mouse twin of Space).
        if ((e.ctrlKey || e.metaKey) && keysOn()) return void setTools((t) => toggleSel(t, i));
        if ((e.target as HTMLElement).closest('a, button')) return;
        onActivate(i);
      },
    }),
    /** Is row `i` on screen (not hidden, kept by the filter)? */
    shown: (i: number) => !hid.has(i) && (!tools.match || tools.match.includes(i)),
    selected: sel,
  };
}


/** Per-report display options remembered on this device (F12 / Alt+F1 / columns). */
export function useReportPrefs(reportId: string, defaults: Partial<ReportPrefs> = {}): [ReportPrefs, (patch: Partial<ReportPrefs>) => void] {
  const [prefs, setPrefs] = useState<ReportPrefs>(() => getReportPrefs(reportId, defaults));
  const update = useCallback(
    (patch: Partial<ReportPrefs>) => setPrefs((p) => setReportPrefs(reportId, { ...p, ...patch })),
    [reportId],
  );
  return [prefs, update];
}
