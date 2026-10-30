/**
 * AG-B5 household milk cards: one card per customer per month; a day grid (the default fills, type a day to change it,
 * 0 = skipped); "Bill month" raises one bill of supply per card; "Copy last month" carries the defaults forward.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MilkCard, MilkKind } from '../../types/agri-r12';
import { bT } from '../../i18n/areas/agri-r12b';
import { billMonth, cardQty, cardTotals, copyCards, deleteCard, loadCards, monthDays, saveCard } from '../../lib/agri/ag-milk-cards';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { clientOpts, milkOpts, sm, useRun, wrap, type Done } from './dairy-kit';
import { F, N, Sel } from './dairy-ui';
import { DateField } from '../ui/DateField';

const prevMonth = (m: string) => {
  const d = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

function Grid({ c, run }: { c: MilkCard; run: (fn: () => string | void) => void }) {
  const locked = !!c.invoice_id && !!localDb.invoices.getById(c.invoice_id);
  return (
    <div className={controls.row} style={wrap} data-dairy="grid">
      {Array.from({ length: monthDays(c.month) }, (_, i) => i + 1).map((d) => (
        <label key={d} className={controls.field} style={{ maxWidth: 52 }}>
          <span className={controls.label}>{d}</span>
          <input className={controls.input} inputMode="decimal" disabled={locked} defaultValue={cardQty(c, d)}
            onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v !== cardQty(c, d)) run(() => { saveCard({ ...c, days: { ...c.days, [d]: v } }); }); }} />
        </label>
      ))}
    </div>
  );
}

export default function MilkCardsView({ onDone }: { onDone: Done }) {
  const [tick, run] = useRun(onDone);
  const [month, setMonth] = useState(todayInput().slice(0, 7));
  const [n, setN] = useState({ client: '', milk: 'buffalo' as MilkKind, rate: 0, qty: 1 });
  const [open, setOpen] = useState('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const cards = useMemo(() => loadCards().filter((c) => c.month === month), [tick, month]);
  const client = n.client || clientOpts()[0]?.[0] || '';
  return (
    <>
      <div className={controls.row} style={wrap}>
        <F l={bT('month')} w={160}><DateField mode="month" className={controls.input} value={month} onChange={(e) => setMonth(e.target.value)} data-dairy="card-month" /></F>
        <button type="button" className={sm} onClick={() => run(() => bT('copied', { n: copyCards(prevMonth(month), month) }))}>{bT('copyLast')}</button>
        <button type="button" className={controls.btnPrimary} data-dairy="bill-month" onClick={() => run(() => {
          const r = billMonth(month, todayInput());
          return [bT('billsDone', { n: r.bills.length }), ...r.skipped].join(' · ');
        })}>{bT('billMonth')}</button>
      </div>
      <div className={controls.row} style={wrap}>
        <Sel l={bT('customer')} v={client} set={(c) => setN({ ...n, client: c })} opts={clientOpts()} w={200} d="card-client" />
        <Sel l={bT('milk')} v={n.milk} set={(milk) => setN({ ...n, milk })} opts={milkOpts()} w={110} />
        <N l={bT('rate')} v={n.rate} set={(rate) => setN({ ...n, rate })} d="card-rate" />
        <N l={bT('dailyQty')} v={n.qty} set={(qty) => setN({ ...n, qty })} d="card-qty" />
        <button type="button" className={sm} data-dairy="card-add" onClick={() => run(() => {
          const name = clientOpts().find(([id]) => id === client)?.[1];
          saveCard({ client_id: client, ...(name ? { client_name: name } : {}), month, milk: n.milk, rate: n.rate, default_qty: n.qty, days: {} });
          return bT('saved');
        })}>{bT('addCard')}</button>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-dairy="cards">
          <thead><tr><th>{bT('customer')}</th><th className={surface.numeric}>{bT('days')}</th><th className={surface.numeric}>{bT('litres')}</th><th className={surface.numeric}>{bT('amount')}</th><th /></tr></thead>
          <tbody>{cards.map((c) => {
            const t = cardTotals(c);
            return (
              <tr key={c.id}>
                <td>{c.client_name} · {bT(`milk.${c.milk}`)} · ₹{c.rate}{open === c.id && <Grid c={c} run={run} />}</td>
                <td className={surface.numeric}>{t.days}</td><td className={surface.numeric}>{t.litres}</td><td className={surface.numeric}>{formatCurrency(t.amount)}</td>
                <td>
                  <button type="button" className={sm} onClick={() => setOpen(open === c.id ? '' : c.id)}>{bT('grid')}</button>
                  {c.invoice_id ? <Link className={sm} to={`/invoice/${c.invoice_id}`}>{bT('openBill')}</Link>
                    : <button type="button" className={sm} onClick={() => run(() => { deleteCard(c.id); return bT('deleted'); })}>{bT('delete')}</button>}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </>
  );
}
