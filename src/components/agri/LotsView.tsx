/** AG-D1 lots: receive a lot (storage receipt `CSR/FY…`), the lot list with receipt print, transfers, depositor statement. */
import { useMemo, useState } from 'react';
import { Printer, Trash2 } from 'lucide-react';
import { agdT } from '../../i18n/areas/agri-r12d';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { addLot, deleteLot, depositorLots, loadLots, lotBalance, receiptHtml, transferBags } from '../../lib/agri/ag-cold-lots';
import { loadPlans, suggestClass } from '../../lib/agri/ag-cold-rent';
import { loadLoans, loanState } from '../../lib/agri/ag-loans';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import { NumberInput } from '../ui/NumberInput';
import { F, Sel, Tbl } from './agd-kit';
import { btn, clientOpts, company, fmt, printPaper, useRun, wrap, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

export default function LotsView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const day = todayInput();
  const s = readAgriSettings();
  const chambers = s.chambers ?? [];
  const plans = useMemo(() => { void tick; return loadPlans(); }, [tick]);
  const lots = useMemo(() => { void tick; return loadLots(); }, [tick]);
  const clients = clientOpts();
  const [f, setF] = useState({ date_in: day, depositor_id: '', commodity: '', variety: '', bags: 0, bag_kg: 50, chamber_id: '', location: '', season: day.slice(0, 4), rent_plan_id: '' });
  const set = (k: keyof typeof f) => (v: string | number) => setF({ ...f, [k]: v });
  const [tr, setTr] = useState({ lot: '', to: '', bags: 0, note: '' });
  const [who, setWho] = useState('');
  const cls = suggestClass(f.commodity);
  const name = (id: string) => clients.find((c) => c[0] === id)?.[1] ?? '';
  const chamberName = (id: string) => chambers.find((c) => c.id === id)?.name ?? id;
  const planName = (id: string) => plans.find((p) => p.id === id)?.name ?? '';
  const st = who ? depositorLots(lots, who) : undefined;
  const bills = who ? localDb.invoices.getAll().filter((i) => i.ag?.rent && i.client?.id === who && i.status !== 'Cancelled') : [];
  const loans = who ? loadLoans().filter((l) => l.borrower_id === who && l.status === 'open') : [];
  return (
    <>
      <div style={wrap}>
        <F label={agdT('dateIn')}><input type="date" className={controls.input} value={f.date_in} onChange={(e) => set('date_in')(e.target.value)} /></F>
        <F label={agdT('depositor')}><Sel value={f.depositor_id} onChange={set('depositor_id')} opts={clients} blank="—" data-agd="depositor" /></F>
        <F label={agdT('commodity')}><input className={controls.input} value={f.commodity} onChange={(e) => set('commodity')(e.target.value)} data-agd="commodity" /></F>
        <F label={agdT('variety')} w={140}><input className={controls.input} value={f.variety} onChange={(e) => set('variety')(e.target.value)} /></F>
        <F label={agdT('bags')} w={100}><NumberInput className={controls.input} value={f.bags} onChange={set('bags')} data-agd="bags" /></F>
        <F label={agdT('bagKg')} w={90}><NumberInput className={controls.input} value={f.bag_kg} onChange={set('bag_kg')} /></F>
        <F label={agdT('chamber')}><Sel value={f.chamber_id} onChange={set('chamber_id')} opts={chambers.map((c) => [c.id, c.name])} blank="—" data-agd="chamber" /></F>
        <F label={agdT('location')} w={140}><input className={controls.input} value={f.location} onChange={(e) => set('location')(e.target.value)} /></F>
        <F label={agdT('season')} w={100}><input className={controls.input} value={f.season} onChange={(e) => set('season')(e.target.value)} /></F>
        <F label={agdT('plan')}><Sel value={f.rent_plan_id} onChange={set('rent_plan_id')} opts={plans.map((p) => [p.id, p.name])} blank="—" data-agd="plan" /></F>
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => agdT('lotSaved', { n: addLot({ ...f, depositor_name: name(f.depositor_id) }).number }))} data-agd-add-lot>{agdT('receive')}</button>
      </div>
      {f.commodity.trim() && <p className={controls.hint}>{agdT(cls === 'storage_agri' ? 'clsAgri' : cls === 'storage_other' ? 'clsOther' : 'clsAsk')}</p>}
      <Tbl
        head={[agdT('receipt'), agdT('dateIn'), agdT('depositor'), agdT('commodity'), agdT('bags'), agdT('balance'), agdT('chamber'), agdT('plan'), '']}
        flag={lots.map((l) => lotBalance(l) <= 0)}
        rows={lots.map((l) => [l.number, l.date_in, l.depositor_name, [l.commodity, l.variety].filter(Boolean).join(' — '), l.bags, lotBalance(l), chamberName(l.chamber_id), planName(l.rent_plan_id),
          <span key="a" style={{ display: 'flex', gap: 4 }}>
            <button type="button" className={btn} aria-label={agdT('print')} onClick={() => printPaper(receiptHtml(l, { company: company(), chamber: chamberName(l.chamber_id), plan: planName(l.rent_plan_id), terms: s.receipt_terms }), l.number)}><Printer size={14} aria-hidden="true" /></button>
            <button type="button" className={btn} aria-label={agdT('delete')} onClick={() => run(() => { deleteLot(l.id); return agdT('deleted'); })}><Trash2 size={14} aria-hidden="true" /></button>
          </span>])}
      />
      <h3>{agdT('transfer')}</h3>
      <div style={wrap}>
        <F label={agdT('lot')}><Sel value={tr.lot} onChange={(v) => setTr({ ...tr, lot: v })} opts={lots.filter((l) => lotBalance(l) > 0).map((l) => [l.id, `${l.number} · ${l.depositor_name}`])} blank="—" /></F>
        <F label={agdT('toDepositor')}><Sel value={tr.to} onChange={(v) => setTr({ ...tr, to: v })} opts={clients} blank="—" /></F>
        <F label={agdT('bags')} w={100}><NumberInput className={controls.input} value={tr.bags} onChange={(v) => setTr({ ...tr, bags: v })} /></F>
        <F label={agdT('consent')}><input className={controls.input} value={tr.note} onChange={(e) => setTr({ ...tr, note: e.target.value })} /></F>
        <button type="button" className={btn} onClick={() => run(() => agdT('lotSaved', { n: transferBags(tr.lot, { date: day, to_depositor_id: tr.to, to_depositor_name: name(tr.to), bags: tr.bags, note: tr.note }).number }))}>{agdT('transfer')}</button>
      </div>
      <h3>{agdT('statement')}</h3>
      <F label={agdT('depositor')}><Sel value={who} onChange={setWho} opts={clients} blank="—" /></F>
      {st && (
        <p data-agd-statement>
          {agdT('stLine', { lots: st.lots.length, in: st.in, out: st.out, bal: st.balance })}{' · '}
          {agdT('stRent', { billed: fmt(bills.reduce((t, i) => t + (i.total ?? 0), 0)), due: fmt(bills.filter((i) => i.status !== 'Draft').reduce((t, i) => t + (i.balance_due ?? 0), 0)) })}{' · '}
          {agdT('stLoans', { due: fmt(loans.reduce((t, l) => t + loanState(l, day).total, 0)) })}
        </p>
      )}
    </>
  );
}
