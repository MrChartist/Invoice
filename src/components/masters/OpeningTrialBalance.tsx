/**
 * Opening trial balance (Tally: opening balances of every ledger on the books beginning date).
 * Lists all ledgers by group with Debit / Credit columns; the difference in opening balances is
 * shown live with Tally's wording and, when saved, carried to "Opening balance difference" —
 * never forced away.
 */
import { Fragment, useId, useMemo, useState } from 'react';
import { can } from '../../lib/access';
import {
  allGroups,
  allLedgers,
  loadBooksBegin,
  loadMasters,
  loadOpenings,
  parsePartyLedgerId,
  saveBooksBegin,
  saveOpenings,
  signedOpening,
  storedBooksBegin,
  type OpeningEntry,
} from '../../lib/ledger';
import { billsTotal, loadOpeningBills } from '../../lib/opening-bills';
import { getTable } from '../../lib/storage';
import { todayIso } from '../../lib/tax-rules';
import { formatMoney } from '../../lib/utils';
import { useT } from '../../i18n';
import { mastersT } from '../../i18n/areas/masters';
import { MasterFrame } from './shared';
import { paiseText, parsePaise } from './masters-utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './masters.module.css';

export interface OpeningTrialBalanceProps {
  onDone: () => void;
  onBack: () => void;
  onBillwise?: (ledgerId: string) => void;
  notify?: (msg: string, tone?: 'success' | 'error') => void;
}

interface Cell {
  dr: string;
  cr: string;
}

export function OpeningTrialBalance({ onDone, onBack, onBillwise, notify }: OpeningTrialBalanceProps) {
  useT();
  const uid = useId();
  const masters = useMemo(() => loadMasters(), []);
  const ledgers = useMemo(() => allLedgers(masters), [masters]);
  const groups = useMemo(() => allGroups(masters.userGroups), [masters]);
  const today = todayIso();
  const [begin, setBegin] = useState(loadBooksBegin(today));
  const [query, setQuery] = useState('');
  const [showZero, setShowZero] = useState(true);
  const [error, setError] = useState('');
  const readOnly = !can('books.edit');

  // Effective openings: typed, else (parties) the total of their opening bills.
  const initial = useMemo(() => {
    const m = new Map<string, number>(loadOpenings().map((o) => [o.ledger_id, signedOpening(o)]));
    const bills = loadOpeningBills();
    for (const l of ledgers) {
      const p = l.kind === 'party' ? parsePartyLedgerId(l.id) : null;
      if (!p || m.has(l.id)) continue;
      const t = Math.round(billsTotal(bills.filter((b) => b.party_id === p.id && b.side === (p.side === 'debtor' ? 'receivable' : 'payable'))) * 100);
      if (t) m.set(l.id, t);
    }
    return m;
  }, [ledgers]);
  const [cells, setCells] = useState<Record<string, Cell>>(() => {
    const out: Record<string, Cell> = {};
    for (const [id, v] of initial) out[id] = { dr: v > 0 ? paiseText(v) : '', cr: v < 0 ? paiseText(v) : '' };
    return out;
  });
  const valueOf = (id: string) => {
    const c = cells[id];
    return c ? parsePaise(c.dr) - parsePaise(c.cr) : 0;
  };
  let totalDr = 0;
  let totalCr = 0;
  for (const l of ledgers) {
    const v = valueOf(l.id);
    if (v > 0) totalDr += v;
    else totalCr -= v;
  }
  const diff = totalDr - totalCr;
  const hasBookOpening = getTable<{ as_of?: string }>('book_opening').some((o) => o && o.as_of);

  const q = query.trim().toLowerCase();
  const visible = (id: string, name: string) => (!q || name.toLowerCase().includes(q)) && (showZero || valueOf(id) !== 0);

  const accept = () => {
    if (readOnly) return onBack();
    try {
      if (begin !== storedBooksBegin()) saveBooksBegin(begin);
      const entries: OpeningEntry[] = [];
      for (const l of ledgers) {
        const v = valueOf(l.id);
        if (v !== (initial.get(l.id) ?? 0)) entries.push({ ledger_id: l.id, amount: v, party_name: l.kind === 'party' ? l.name : undefined });
      }
      saveOpenings(entries);
      notify?.(mastersT('saved', { name: mastersT('openingTb') }));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const setCell = (id: string, key: keyof Cell, v: string) =>
    setCells((cs) => {
      const cur = cs[id] ?? { dr: '', cr: '' };
      // Typing in one column clears the other: a ledger has one opening side.
      return { ...cs, [id]: key === 'dr' ? { dr: v, cr: v ? '' : cur.cr } : { cr: v, dr: v ? '' : cur.dr } };
    });

  return (
    <MasterFrame
      title={mastersT('openingTb')}
      keys={{ onAccept: accept, onBack }}
      actions={
        <>
          {!readOnly && (
            <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={accept}>
              {mastersT('accept')} (Ctrl+A)
            </button>
          )}
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={onBack}>
            {mastersT('back')} (Esc)
          </button>
        </>
      }
    >
      <div className={styles.inline}>
        <label htmlFor={`${uid}-begin`}>{mastersT('booksBegin')}</label>
        <input id={`${uid}-begin`} type="date" className={controls.input} style={{ maxWidth: 180 }} value={begin} readOnly={readOnly} onChange={(e) => setBegin(e.target.value)} />
        <input type="search" className={controls.input} style={{ maxWidth: 240 }} placeholder={mastersT('search')} aria-label={mastersT('search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className={controls.check} htmlFor={`${uid}-zero`}>
          <input id={`${uid}-zero`} type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} /> {mastersT('showZero')}
        </label>
      </div>
      <div className={diff ? styles.diffBad : styles.diffOk} role="status" aria-live="polite">
        {diff ? mastersT('difference', { amount: `₹${formatMoney(Math.abs(diff) / 100)} ${diff > 0 ? 'Dr' : 'Cr'}` }) : mastersT('balanced')}
      </div>
      <div className={surface.tableWrap} style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>{mastersT('openingTb')}</caption>
          <thead>
            <tr>
              <th scope="col">{mastersT('name')}</th>
              <th scope="col" className={surface.numeric}>{mastersT('debit')}</th>
              <th scope="col" className={surface.numeric}>{mastersT('credit')}</th>
              <th scope="col"><span className={surface.srOnly}>{mastersT('billwise')}</span></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const list = ledgers.filter((l) => l.group === g.id && visible(l.id, l.name));
              if (!list.length) return null;
              const depth = Math.min(g.depth ?? 0, 3);
              return (
                <Fragment key={g.id}>
                  <tr>
                    <th scope="rowgroup" colSpan={4} className={depth ? styles[`indent${depth}` as 'indent1'] : undefined}>
                      {g.label}
                    </th>
                  </tr>
                  {list.map((l) => (
                    <tr key={l.id}>
                      <td className={styles[`indent${Math.min(depth + 1, 3)}` as 'indent1']}>{l.name}</td>
                      <td>
                        <input className={`${controls.input} ${styles.cellInput}`} inputMode="decimal" aria-label={`${l.name} debit`} value={cells[l.id]?.dr ?? ''} readOnly={readOnly} onChange={(e) => setCell(l.id, 'dr', e.target.value)} />
                      </td>
                      <td>
                        <input className={`${controls.input} ${styles.cellInput}`} inputMode="decimal" aria-label={`${l.name} credit`} value={cells[l.id]?.cr ?? ''} readOnly={readOnly} onChange={(e) => setCell(l.id, 'cr', e.target.value)} />
                      </td>
                      <td>
                        {l.kind === 'party' && onBillwise && (
                          <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => onBillwise(l.id)}>
                            {mastersT('billwise')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">{mastersT('totals')}</th>
              <td className={surface.numeric}>{formatMoney(totalDr / 100)}</td>
              <td className={surface.numeric}>{formatMoney(totalCr / 100)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {diff !== 0 && <p className={styles.note}>{mastersT('differenceNote')}</p>}
      <p className={styles.note}>{mastersT('plNote')}</p>
      {hasBookOpening && <p className={styles.note}>{mastersT('cashNote')}</p>}
      <p className={styles.note}>{mastersT('caNote')}</p>
      {error && (
        <div className={controls.error} role="alert">
          {error}
        </div>
      )}
    </MasterFrame>
  );
}
