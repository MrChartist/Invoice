import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { gwT, type GwKey } from '../../i18n/areas/gateway';
import { branchT } from '../../i18n/areas/branch-books';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { toIsoDate } from '../../lib/books';
import { loadLedger, loadStockValuer } from '../../lib/ledger';
import { loadBranchStockValuer } from '../../lib/ledger/branch-stock';
import { buildFrame, decodePath, encodePath, isReportId, type Cell, type ColKey, type DisplayFrame, type DisplayRow, type ReportId, type Seg } from '../../lib/gateway/drill';
import { isScreenId } from '../../lib/gateway/menu';
import { cn, formatDate, formatMoney } from '../../lib/utils';
import { isTypingTarget } from '../../hooks/useHotkeys';
import { useGateway, useGatewaySession, useScreenKeys } from './context';
import { ButtonBar } from './ButtonBar';
import styles from './Gateway.module.css';

// WP-9: branch filter (renders nothing without branches); the branch is kept in the URL (`b=`).
const BranchFilter = lazy(() => import('../branches/BranchFilter').then((m) => ({ default: m.BranchFilter })));

const REPORT_TITLE: Record<ReportId, GwKey> = {
  bs: 'rBs',
  pl: 'rPl',
  tb: 'rTb',
  groups: 'rGroups',
  daybook: 'rDaybook',
  cash: 'rCash',
  ledgers: 'rLedgers',
  acct: 'rAcct',
};

const COL: Record<ColKey, GwKey> = {
  particulars: 'colParticulars',
  amount: 'colAmount',
  debit: 'colDebit',
  credit: 'colCredit',
  opening: 'colOpening',
  closing: 'colClosing',
  date: 'colDate',
  type: 'colType',
  number: 'colNumber',
};

/** Selected row per drill frame (keyed by URL), so Esc returns to the line you drilled from. */
const memory = new Map<string, number>();

const amount = (p: number) => formatMoney(p / 100);
const balance = (p: number) => (p ? `${formatMoney(Math.abs(p) / 100)} ${p > 0 ? 'Dr' : 'Cr'}` : '-');

function cellText(c: Cell, kind: 'text' | 'amount' | 'balance'): string {
  if (c === null || c === undefined) return '';
  if (typeof c === 'number') return kind === 'balance' ? balance(c) : kind === 'amount' ? amount(c) : String(c);
  return kind === 'text' && /^\d{4}-\d{2}-\d{2}$/.test(c) ? formatDate(c) : c;
}

function frameTitle(f: DisplayFrame, report: ReportId): string {
  if ('report' in f.title) return gwT(REPORT_TITLE[f.title.report]);
  if ('key' in f.title) return gwT(f.title.key);
  return f.title.text || gwT(REPORT_TITLE[report]);
}

const rowLabel = (r: DisplayRow) => (typeof r.label === 'string' ? r.label : gwT(r.label.key));

/**
 * Gateway "Display" reports with drill-down: Enter goes one level in (group → ledgers → parties →
 * months → vouchers → voucher / document), Esc one level out, keeping the selected line.
 */
export function DisplayReport() {
  useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { notify } = useGateway();
  const { period } = useGatewaySession();
  const report: ReportId = isReportId(params.get('r')) ? (params.get('r') as ReportId) : 'bs';
  const path = useMemo(() => decodePath(params.get('d')), [params]);
  const account = params.get('x') ?? undefined;
  const from = params.get('from');
  const branchId = params.get('b') ?? '';

  const ledger = useMemo(() => loadLedger(), []);
  // Same closing-stock-aware statements as Books (only the BS / P&L frames need the valuer).
  const needsStock = report === 'bs' || report === 'pl';
  // 7S (7.84): a branch view values the stock lying in the branch's godowns (branch-stock.ts).
  const stock = useMemo(() => (!needsStock ? undefined : branchId ? loadBranchStockValuer(branchId) : loadStockValuer()), [needsStock, branchId]);
  const today = toIsoDate(new Date());
  // A path that no longer resolves (deleted account …) falls back to its deepest valid frame.
  const frame = useMemo(() => {
    for (let n = path.length; n >= 0; n--) {
      const f = buildFrame(ledger, report, path.slice(0, n), period, today, { account, stock, branchId });
      if (f) return f;
    }
    return null;
  }, [ledger, report, path, period, today, account, stock, branchId]);

  const rows = frame?.rows ?? [];
  const focusable = rows.map((r, i) => (r.heading ? -1 : i)).filter((i) => i >= 0);
  const key = location.search;
  const [sel, setSel] = useState(() => memory.get(key) ?? focusable[0] ?? 0);
  const [shownKey, setShownKey] = useState(key);
  if (shownKey !== key) {
    setShownKey(key);
    setSel(memory.get(key) ?? focusable[0] ?? 0);
  }
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  useEffect(() => {
    const el = rowRefs.current[memory.get(key) ?? focusable[0] ?? 0];
    el?.focus({ preventScroll: true });
    el?.scrollIntoView?.({ block: 'center' });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const withPath = (segs: Seg[]) => {
    const next = new URLSearchParams(params);
    if (segs.length) next.set('d', encodePath(segs));
    else next.delete('d');
    return `/gateway/display?${next.toString()}`;
  };

  const enter = (i: number) => {
    const r = rows[i];
    if (!r || r.heading) return;
    memory.set(key, i);
    if (r.drillTo?.length) navigate(withPath([...path, ...r.drillTo]), { state: { drill: true } });
    else if (r.drill) navigate(withPath([...path, r.drill]), { state: { drill: true } });
    else if (r.open !== undefined) {
      if (r.open) navigate(r.open);
      else notify(gwT('noDocument'), 'info');
    }
  };

  const back = () => {
    if (path.length) {
      if ((location.state as { drill?: boolean } | null)?.drill) navigate(-1);
      else navigate(withPath(path.slice(0, -1)), { replace: true });
    } else {
      navigate(isScreenId(from) && from !== 'root' ? `/gateway?m=${from}` : '/gateway');
    }
  };

  const move = (to: number) => {
    if (!focusable.length) return;
    const pos = Math.max(0, Math.min(focusable.length - 1, to));
    const i = focusable[pos];
    setSel(i);
    memory.set(key, i);
    rowRefs.current[i]?.focus();
  };

  useScreenKeys((e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return false;
    const pos = Math.max(0, focusable.indexOf(sel));
    switch (e.key) {
      case 'ArrowDown':
        move(pos + 1);
        return true;
      case 'ArrowUp':
        move(pos - 1);
        return true;
      case 'PageDown':
        move(pos + 10);
        return true;
      case 'PageUp':
        move(pos - 10);
        return true;
      case 'Home':
        move(0);
        return true;
      case 'End':
        move(focusable.length - 1);
        return true;
      case 'Enter':
        if ((e.target as HTMLElement | null)?.closest?.('button, a')) return false;
        enter(sel);
        return true;
      case 'Escape':
        back();
        return true;
      default:
        return false;
    }
  });

  const title = frame ? frameTitle(frame, report) : gwT(REPORT_TITLE[report]);
  const crumbs = [gwT(REPORT_TITLE[report])];
  if (frame && path.length) crumbs.push(title);

  return (
    <>
      <ButtonBar />
      <section className={cn(styles.card, styles.report)} aria-labelledby="gw-report-title">
        <div className={styles.reportHead}>
          <div>
            <div className={styles.crumbs}>
              <button type="button" className={styles.chip} onClick={back} aria-keyshortcuts="Escape">
                ← {gwT('back')}
              </button>
              {path.length > 0 && <span>{crumbs[0]}</span>}
            </div>
            <h1 className={styles.reportTitle} id="gw-report-title">{title}</h1>
          </div>
          <Suspense fallback={null}>
            <BranchFilter
              className={controls.select}
              testId="gw-branch"
              value={branchId}
              onChange={(v) => {
                const next = new URLSearchParams(params);
                if (v) next.set('b', v);
                else next.delete('b');
                navigate(`/gateway/display?${next.toString()}`, { replace: true });
              }}
            />
          </Suspense>
          <div className={styles.status}>
            {frame?.asOf ? gwT('asAt', { date: formatDate(frame.asOf) }) : frame ? gwT('periodRange', { from: formatDate(frame.period.start), to: formatDate(frame.period.end) }) : null}
          </div>
        </div>
        {frame && rows.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.grid} role="grid" aria-labelledby="gw-report-title">
              <thead>
                <tr>
                  {frame.columns.map((c, ci) => (
                    <th key={ci} className={c.kind !== 'text' ? styles.num : undefined} scope="col">{gwT(COL[c.key])}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const active = i === sel && !r.heading;
                  return (
                    <tr
                      key={r.id}
                      ref={(el) => {
                        rowRefs.current[i] = el;
                      }}
                      className={cn(r.heading ? styles.heading : styles.row, active && styles.rowActive)}
                      tabIndex={r.heading ? undefined : active ? 0 : -1}
                      aria-selected={r.heading ? undefined : active}
                      onFocus={() => !r.heading && setSel(i)}
                      onClick={() => {
                        if (r.heading) return;
                        setSel(i);
                        enter(i);
                      }}
                      data-testid={`gw-row-${r.id}`}
                    >
                      <td className={r.level > 0 && frame.columns[0].kind === 'text' && !/^\d{4}-/.test(rowLabel(r)) ? styles.indent : undefined}>
                        {cellText(rowLabel(r), frame.columns[0].kind)}
                      </td>
                      {r.cells.map((c, ci) => {
                        const col = frame.columns[ci + 1];
                        if (!col) return null;
                        return (
                          <td key={ci} className={col.kind !== 'text' ? styles.num : undefined}>{cellText(c, col.kind)}</td>
                        );
                      })}
                    </tr>
                  );
                })}
                {frame.total && (
                  <tr className={styles.totalRow}>
                    <td>{gwT('total')}</td>
                    {frame.total.map((c, ci) => {
                      const col = frame.columns[ci + 1];
                      return col ? <td key={ci} className={col.kind !== 'text' ? styles.num : undefined}>{cellText(c, col.kind)}</td> : null;
                    })}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.empty}>{gwT('empty')}</p>
        )}
        <p className={styles.note}>
          {gwT('drillHint')} · {gwT('caNote')}
          {branchId && <> · {branchT('scopeNote')}</>}
        </p>
      </section>
    </>
  );
}

export default DisplayReport;
