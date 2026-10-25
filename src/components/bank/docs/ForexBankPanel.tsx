/**
 * Forex bank ledgers (7U): make a bank account an EEFC / foreign-currency account, see its balance in
 * the currency and in rupees, record money in / out (realised difference) and the period-end
 * revaluation at a typed rate (unrealised difference). Lazy, inside the Banking documents tab.
 */
import { useMemo, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { bankAccountsDb, DEFAULT_BANK_ID } from '../../../lib/bank-accounts';
import { bankLedgerId } from '../../../lib/bank-ledgers';
import { chartOf, loadUserAccounts, A } from '../../../lib/ledger/accounts';
import { deleteFxMove, forexSummary, loadFxMoves, recordFxMove, setAccountCurrency, type FxMoveKind } from '../../../lib/forex-bank';
import { getIndianFY } from '../../../lib/invoice-number';
import { formatDate, formatMoney, todayInput } from '../../../lib/utils';
import { fxbT } from '../../../i18n/areas/extras-7u';
import controls from '../../../styles/controls.module.css';
import surface from '../../../styles/surface.module.css';
import styles from './bankdocs.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
const KIND_LABEL = { opening: 'kOpening', receipt: 'kReceipt', in: 'kIn', out: 'kOut', revalue: 'kRevalue' } as const;

export default function ForexBankPanel({ notify }: { notify: Notify }) {
  const [tick, setTick] = useState(0);
  const accounts = useMemo(() => bankAccountsDb.all().filter((a) => a.id !== DEFAULT_BANK_ID), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [accountId, setAccountId] = useState(() => accounts.find((a) => a.currency)?.id ?? accounts[0]?.id ?? '');
  const account = accounts.find((a) => a.id === accountId);
  const today = todayInput();
  const [from, setFrom] = useState(() => `${getIndianFY(today).startYear}-04-01`);
  const [to, setTo] = useState(today);
  const [currency, setCurrency] = useState(account?.currency ?? 'USD');
  const [fcyOpening, setFcyOpening] = useState(account?.fcy_opening !== undefined ? String(account.fcy_opening) : '');
  const [kind, setKind] = useState<FxMoveKind>('revalue');
  const [date, setDate] = useState(today);
  const [fcy, setFcy] = useState('');
  const [rate, setRate] = useState('');
  const [inr, setInr] = useState('');
  const [counter, setCounter] = useState<string>(A.bank);
  const [party, setParty] = useState('');
  const [narration, setNarration] = useState('');
  const chart = useMemo(() => chartOf(loadUserAccounts()), []);
  const summary = useMemo(() => {
    if (!account?.currency) return null;
    try {
      return forexSummary(account, { from, to });
    } catch {
      return null;
    }
  }, [account, from, to, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (id: string) => {
    setAccountId(id);
    const a = accounts.find((x) => x.id === id);
    setCurrency(a?.currency ?? 'USD');
    setFcyOpening(a?.fcy_opening !== undefined ? String(a.fcy_opening) : '');
  };
  const run = (fn: () => void, ok: string) => {
    try {
      fn();
      setTick((t) => t + 1);
      notify(ok, 'success');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const saveCurrency = (cur: string) => run(() => setAccountCurrency(accountId, cur, fcyOpening === '' ? undefined : Number(fcyOpening)), fxbT('saved'));
  const record = () => run(() => {
    recordFxMove({
      bank_account_id: accountId, date, kind, rate: Number(rate) || 0,
      ...(kind !== 'revalue' ? { fcy: Number(fcy) || 0, counter_account: counter } : {}),
      ...(kind === 'out' && inr ? { inr: Number(inr) } : {}),
      ...(party.trim() ? { counter_party: party.trim() } : {}),
      ...(narration.trim() ? { narration: narration.trim() } : {}),
    });
    setFcy('');
    setInr('');
    setNarration('');
  }, fxbT('recorded'));

  if (!accounts.length) return <p className={styles.muted}>{fxbT('needAccount')}</p>;
  const counters = chart.filter((a) => a.id !== bankLedgerId(accountId));
  const partyLedger = counter === A.debtors || counter === A.creditors;
  const cur = account?.currency ?? '';
  const n = (v: number) => formatMoney(v);

  return (
    <div className={styles.stack}>
      <p className={styles.warn} role="note">{fxbT('intro')}</p>
      <div className={styles.grid}>
        <label className={controls.field}><span className={controls.label}>{fxbT('account')}</span>
          <select className={controls.select} value={accountId} onChange={(e) => pick(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.currency ? ` · ${a.currency}` : ''}</option>)}
          </select></label>
        <label className={controls.field}><span className={controls.label}>{fxbT('currency')}</span>
          <input className={controls.input} maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></label>
        <label className={controls.field}><span className={controls.label}>{fxbT('fcyOpening', { cur: currency })}</span>
          <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={fcyOpening} onChange={(e) => setFcyOpening(e.target.value.replace(/[^0-9.-]/g, ''))} /></label>
      </div>
      <div className={styles.toolbar}>
        <button type="button" className={controls.btnOutline} onClick={() => saveCurrency(currency)}><Save size={16} /> {fxbT('makeForex')}</button>
        {account?.currency && <button type="button" className={controls.btnGhost} onClick={() => saveCurrency('')}>{fxbT('backToInr')}</button>}
      </div>
      <p className={styles.muted}>{fxbT('openingNote')}</p>

      {account?.currency && summary && (
        <>
          <div className={styles.grid}>
            <label className={controls.field}><span className={controls.label}>{fxbT('from')}</span>
              <input className={controls.input} type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className={controls.field}><span className={controls.label}>{fxbT('to')}</span>
              <input className={controls.input} type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div className={styles.totals} data-forex-summary>
            <span>{fxbT('fcyBalance')}: <strong>{cur} {n(summary.fcy)}</strong></span>
            <span>{fxbT('inrBalance')}: <strong>₹{n(summary.inr)}</strong></span>
            <span>{fxbT('carrying')}: <strong>{summary.rate === null ? '—' : `₹${summary.rate.toFixed(4)}`}</strong></span>
            <span>{fxbT('realised')}: <strong>₹{n(summary.realised)}</strong></span>
            <span>{fxbT('unrealised')}: <strong>₹{n(summary.unrealised)}</strong></span>
          </div>
          {summary.inrOnly > 0 && <p className={styles.warn}>{fxbT('inrOnly', { n: String(summary.inrOnly) })}</p>}

          <section className={surface.card}>
            <div className={surface.cardHead}>{fxbT('newEntry')}</div>
            <div className={surface.cardBody}>
              <div className={styles.grid}>
                <label className={controls.field}><span className={controls.label}>{fxbT('kind')}</span>
                  <select className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as FxMoveKind)}>
                    <option value="revalue">{fxbT('kRevalue')}</option>
                    <option value="out">{fxbT('kOut')}</option>
                    <option value="in">{fxbT('kIn')}</option>
                  </select></label>
                <label className={controls.field}><span className={controls.label}>{fxbT('date')}</span>
                  <input className={controls.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
                {kind !== 'revalue' && (
                  <label className={controls.field}><span className={controls.label}>{fxbT('amountFcy', { cur })}</span>
                    <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={fcy} onChange={(e) => setFcy(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
                )}
                <label className={controls.field}><span className={controls.label}>{kind === 'revalue' ? fxbT('closingRate', { cur }) : fxbT('rate', { cur })}</span>
                  <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ''))} /></label>
                {kind === 'out' && (
                  <label className={controls.field}><span className={controls.label}>{fxbT('inrReceived')}</span>
                    <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={inr} onChange={(e) => setInr(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={fcy && rate ? (Number(fcy) * Number(rate)).toFixed(2) : ''} /></label>
                )}
                {kind !== 'revalue' && (
                  <label className={controls.field}><span className={controls.label}>{kind === 'in' ? fxbT('fromLedger') : fxbT('toLedger')}</span>
                    <select className={controls.select} value={counter} onChange={(e) => setCounter(e.target.value)}>
                      {counters.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                    </select></label>
                )}
                {kind !== 'revalue' && partyLedger && (
                  <label className={controls.field}><span className={controls.label}>{fxbT('party')}</span>
                    <input className={controls.input} value={party} onChange={(e) => setParty(e.target.value)} /></label>
                )}
                <label className={controls.field}><span className={controls.label}>{fxbT('narration')}</span>
                  <input className={controls.input} value={narration} onChange={(e) => setNarration(e.target.value)} /></label>
              </div>
              <p className={styles.muted}>{kind === 'revalue' ? fxbT('revalueHelp') : kind === 'out' ? fxbT('outHelp') : fxbT('inHelp')}</p>
              <div className={styles.toolbar}><button type="button" className={controls.btnPrimary} onClick={record} disabled={!rate}>{fxbT('record')}</button></div>
            </div>
          </section>

          <section className={surface.card}>
            <div className={surface.cardHead}>{fxbT('movements')}</div>
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead><tr><th>{fxbT('date')}</th><th>{fxbT('kind')}</th><th>{fxbT('ref')}</th><th className={surface.numeric}>{cur}</th><th className={surface.numeric}>₹</th><th /></tr></thead>
                <tbody>
                  {summary.rows.map((r, i) => {
                    const move = r.kind === 'in' || r.kind === 'out' || r.kind === 'revalue';
                    return (
                      <tr key={`${r.kind}-${r.ref}-${i}`}>
                        <td>{r.date ? formatDate(r.date) : '—'}</td>
                        <td>{fxbT(KIND_LABEL[r.kind])}</td>
                        <td>{r.ref}</td>
                        <td className={surface.numeric}>{n(r.fcy)}</td>
                        <td className={surface.numeric}>{n(r.inr)}</td>
                        <td>{move && (
                          <button type="button" className={controls.btnGhost} aria-label={fxbT('delete')} onClick={() => {
                            const m = loadMoveId(r.ref, accountId);
                            if (m) run(() => deleteFxMove(m), fxbT('deleted'));
                          }}><Trash2 size={14} /></button>
                        )}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/** Move id behind a voucher number (the statement rows carry the voucher number). */
function loadMoveId(voucherNumber: string, accountId: string): string | undefined {
  return loadFxMoves().find((m) => m.voucher_number === voucherNumber && m.bank_account_id === accountId)?.id;
}
