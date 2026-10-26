/**
 * Receivables → Interest (TR-A4, every business): interest on overdue bills per party as on a date, untick the
 * parties not to charge, raise one DRAFT interest invoice per party. Payables side: MSMED interest stays on the
 * existing MSME screen. Working paper — verify with your CA.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { aT } from '../../i18n/areas/trade-r8a';
import { localDb } from '../../lib/localDb';
import { peekTable } from '../../lib/storage';
import { readLinks } from '../../lib/documents';
import { loadReceivableOpeningBills } from '../../lib/opening-bills';
import { formatCurrency, todayInput } from '../../lib/utils';
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import type { InterestSettings } from '../../types/trade-r8';
import { interestText, loadInterestRuns, loadInterestSettings, overlaps, partyInterest, raiseInterest, saveInterestSettings } from '../../lib/trade/tr-interest';
import { downloadCsv } from './desk-shared';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';

const money = (n: number) => formatCurrency(n);

export default function InterestTab({ onDone }: { onDone: (msg: string, error?: boolean) => void }) {
  useT();
  const [asOf, setAsOf] = useState(todayInput);
  const [s, setS] = useState<InterestSettings>(loadInterestSettings);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState('');
  const parties = useMemo(() => {
    void tick;
    const clients = peekTable<Client>('clients');
    return partyInterest(asOf, s, { invoices: peekTable<InvoiceRecord>('invoices'), payments: peekTable<Payment>('transactions'), links: readLinks(), clients, openingBills: loadReceivableOpeningBills(clients, asOf), runs: loadInterestRuns() });
  }, [asOf, s, tick]);
  const ticked = parties.filter((p) => !p.below_min && !off.has(p.party));
  const warn = overlaps(ticked);
  const set = (p: Partial<InterestSettings>) => {
    const next = { ...s, ...p };
    setS(next);
    try {
      saveInterestSettings(next);
    } catch (e) {
      onDone((e as Error).message, true);
    }
  };
  const raise = () => {
    try {
      const r = raiseInterest(ticked, asOf, todayInput());
      onDone(aT('raised', { n: r.invoice_ids.length, amount: money(r.total) }));
      setTick((n) => n + 1);
    } catch (e) {
      onDone((e as Error).message, true);
    }
  };
  const company = localDb.settings.activeProfile()?.companyName ?? '';
  return (
    <div className={own.stack} data-interest-tab>
      <div className={own.row}>
        <label className={controls.field}><span className={controls.label}>{aT('asOf')}</span><input type="date" className={controls.input} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></label>
        <label className={controls.field}><span className={controls.label}>{aT('rate')}</span><input type="number" min={0} max={100} className={controls.input} value={s.rate ?? ''} onChange={(e) => set({ rate: Number(e.target.value) || 0 })} data-interest-rate /></label>
        <label className={controls.field}><span className={controls.label}>{aT('grace')}</span><input type="number" min={0} className={controls.input} value={s.grace_days ?? ''} onChange={(e) => set({ grace_days: Number(e.target.value) || 0 })} /></label>
        <label className={controls.field}><span className={controls.label}>{aT('basisFrom')}</span>
          <select className={controls.select} value={s.basis ?? 'due'} onChange={(e) => set({ basis: e.target.value as 'due' | 'bill' })}>
            <option value="due">{aT('fromDue')}</option>
            <option value="bill">{aT('fromBill')}</option>
          </select>
        </label>
        <label className={controls.field}><span className={controls.label}>{aT('minAmount')}</span><input type="number" min={0} className={controls.input} value={s.min_amount ?? ''} onChange={(e) => set({ min_amount: Number(e.target.value) || 0 })} /></label>
      </div>
      <p className={own.muted}>{aT('rateNote')}</p>
      <div className={own.tableWrap}>
        <table className={own.table} data-interest-parties>
          <thead><tr><th /><th>{aT('party')}</th><th className={own.num}>{aT('rate')}</th><th className={own.num}>{aT('bills')}</th><th className={own.num}>{aT('interest')}</th><th /></tr></thead>
          <tbody>
            {parties.map((p) => (
              <tr key={p.party} data-interest-party={p.party}>
                <td><input type="checkbox" disabled={p.below_min} checked={!p.below_min && !off.has(p.party)} onChange={(e) => setOff((o) => { const n = new Set(o); if (e.target.checked) n.delete(p.party); else n.add(p.party); return n; })} aria-label={p.party} /></td>
                <td>{p.party}{p.below_min ? ` (${aT('belowMin')})` : ''}</td><td className={own.num}>{p.rate}%</td><td className={own.num}>{p.bills.length}</td><td className={own.num}>{money(p.total)}</td>
                <td className={own.row}>
                  <button type="button" className={controls.btnGhost} onClick={() => setOpen(open === p.party ? '' : p.party)}>{aT('view')}</button>
                  <a className={controls.btnGhost} href={`https://wa.me/?text=${encodeURIComponent(`${company}\n${interestText(p, asOf, money)}`)}`} target="_blank" rel="noreferrer">WhatsApp</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!parties.length && <p className={own.muted}>{aT('noInterest')}</p>}
      </div>
      {open && <pre className={own.muted} data-interest-statement>{interestText(parties.find((p) => p.party === open)!, asOf, money)}</pre>}
      {warn.length > 0 && <p className={own.notice}>{aT('overlap', { list: warn.join(', ') })}</p>}
      <div className={own.row}>
        <button type="button" className={controls.btnPrimary} disabled={!ticked.length} onClick={raise} data-interest-raise>{aT('raise', { n: ticked.length })}</button>
        <button type="button" className={controls.btnGhost} onClick={() => downloadCsv(`interest-${asOf}.csv`, [['Party', 'Bill', 'Date', 'Due', 'From', 'To', 'Days', 'Outstanding', 'Interest'], ...parties.flatMap((p) => p.bills.map((b) => [p.party, b.number, b.date, b.due, b.from, b.to, b.days, b.outstanding, b.amount]))])}>CSV</button>
        <button type="button" className={controls.btnGhost} onClick={() => window.print()}>{aT('print')}</button>
        <Link to="/expenses" className={controls.btnGhost}>{aT('payables')}</Link>
      </div>
      <p className={own.muted}>{aT('workingPaper')}</p>
    </div>
  );
}
