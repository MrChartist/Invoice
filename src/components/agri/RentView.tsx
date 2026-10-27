/** AG-D2 rent: plans (basis, season, charges, class, billing), bills in advance / monthly / at season end, rent due and the unbilled memo. */
import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { agdT, type AgdKey } from '../../i18n/areas/agri-r12d';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { loadLots, lotBalance } from '../../lib/agri/ag-cold-lots';
import { deletePlan, loadPlans, raiseRentBill, rentDue, savePlan, suggestClass, unbilledRent } from '../../lib/agri/ag-cold-rent';
import type { ColdRentPlan, RentCharge } from '../../types/agri-r12d';
import { NumberInput } from '../ui/NumberInput';
import { F, Sel, Tbl } from './agd-kit';
import { btn, fmt, useRun, wrap, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

const BASES = ['bag_season', 'bag_month', 'qtl_season', 'qtl_month', 'flat'] as const;
const AT = ['out', 'in', 'monthly', 'season_end'] as const;
const opt = (xs: readonly string[], p: string) => xs.map((x) => [x, agdT(`${p}${x}` as AgdKey)] as const);
const blank = { name: '', commodity: '', basis: 'bag_season' as ColdRentPlan['basis'], rate: 0, from: '03-01', to: '11-30', min_months: 0, part_month: 'full' as ColdRentPlan['part_month'], class: 'storage_agri' as ColdRentPlan['class'], bill_at: 'out' as ColdRentPlan['bill_at'], space: false, c1: '', c1rate: 0, c1when: 'out' as RentCharge['when'], lateAfter: '', lateRate: 0, nRate: 0, nRef: '' };

export default function RentView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const day = todayInput();
  const plans = useMemo(() => { void tick; return loadPlans(); }, [tick]);
  const lots = useMemo(() => { void tick; return loadLots(); }, [tick]);
  const invoices = useMemo(() => { void tick; return localDb.invoices.getAll(); }, [tick]);
  const [f, setF] = useState(blank);
  const [b, setB] = useState({ lot: '', from: day, to: day });
  const set = <K extends keyof typeof blank>(k: K) => (v: (typeof blank)[K]) => setF({ ...f, [k]: v });
  const save = () => run(() => {
    const p = savePlan({
      name: f.name, ...(f.commodity.trim() ? { commodity: f.commodity.trim() } : {}), basis: f.basis, rate: f.rate, season: { from: f.from, to: f.to }, part_month: f.part_month, class: f.class, bill_at: f.bill_at,
      ...(f.min_months > 0 ? { min_months: f.min_months } : {}), ...(f.space ? { space: true } : {}),
      charges: f.c1.trim() ? [{ name: f.c1.trim(), basis: 'bag', rate: f.c1rate, when: f.c1when }] : [],
      ...(f.lateAfter && f.lateRate > 0 ? { late: { after: f.lateAfter, rate_per_bag_month: f.lateRate } } : {}),
      ...(f.nRate > 0 && f.nRef.trim() ? { notified: { rate: f.nRate, order_ref: f.nRef.trim() } } : {}),
    });
    setF(blank);
    return agdT('planSaved', { n: p.name });
  });
  const lot = lots.find((l) => l.id === b.lot);
  const bill = (occ: Parameters<typeof raiseRentBill>[1]) => run(() => { const i = raiseRentBill(lot!, occ); return agdT('billRaised', { n: i.invoice_number, total: i.total }); });
  return (
    <>
      <div style={wrap}>
        <F label={agdT('planName')}><input className={controls.input} value={f.name} onChange={(e) => set('name')(e.target.value)} data-agd="plan-name" /></F>
        <F label={agdT('commodity')} w={140}><input className={controls.input} value={f.commodity} onChange={(e) => { const c = suggestClass(e.target.value, f.space); setF({ ...f, commodity: e.target.value, ...(c ? { class: c } : {}) }); }} /></F>
        <F label={agdT('basis')}><Sel value={f.basis} onChange={(v) => set('basis')(v as ColdRentPlan['basis'])} opts={opt(BASES, 'b.')} /></F>
        <F label={agdT('rate')} w={100}><NumberInput className={controls.input} value={f.rate} onChange={set('rate')} data-agd="plan-rate" /></F>
        <F label={agdT('seasonFrom')} w={90}><input className={controls.input} value={f.from} onChange={(e) => set('from')(e.target.value)} placeholder="03-01" /></F>
        <F label={agdT('seasonTo')} w={90}><input className={controls.input} value={f.to} onChange={(e) => set('to')(e.target.value)} placeholder="11-30" /></F>
        <F label={agdT('minMonths')} w={90}><NumberInput className={controls.input} value={f.min_months} onChange={set('min_months')} /></F>
        <F label={agdT('partMonth')}><Sel value={f.part_month} onChange={(v) => set('part_month')(v as ColdRentPlan['part_month'])} opts={opt(['full', 'days'], 'pm.')} /></F>
        <F label={agdT('class')}><Sel value={f.class} onChange={(v) => set('class')(v as ColdRentPlan['class'])} opts={opt(['storage_agri', 'storage_other'], 'c.')} /></F>
        <F label={agdT('billAt')}><Sel value={f.bill_at} onChange={(v) => set('bill_at')(v as ColdRentPlan['bill_at'])} opts={opt(AT, 'at.')} /></F>
        <label className={controls.field}><span className={controls.label}>{agdT('space')}</span><input type="checkbox" checked={f.space} onChange={(e) => setF({ ...f, space: e.target.checked, ...(e.target.checked ? { class: 'storage_other' } : {}) })} /></label>
      </div>
      <div style={wrap}>
        <F label={agdT('charge')} w={140}><input className={controls.input} value={f.c1} onChange={(e) => set('c1')(e.target.value)} placeholder={agdT('chargeHint')} /></F>
        <F label={agdT('perBag')} w={90}><NumberInput className={controls.input} value={f.c1rate} onChange={set('c1rate')} /></F>
        <F label={agdT('when')}><Sel value={f.c1when} onChange={(v) => set('c1when')(v as RentCharge['when'])} opts={opt(['in', 'out'], 'w.')} /></F>
        <F label={agdT('lateAfter')} w={90}><input className={controls.input} value={f.lateAfter} onChange={(e) => set('lateAfter')(e.target.value)} placeholder="11-30" /></F>
        <F label={agdT('lateRate')} w={110}><NumberInput className={controls.input} value={f.lateRate} onChange={set('lateRate')} /></F>
        <F label={agdT('notifiedRate')} w={110}><NumberInput className={controls.input} value={f.nRate} onChange={set('nRate')} /></F>
        <F label={agdT('orderRef')} w={160}><input className={controls.input} value={f.nRef} onChange={(e) => set('nRef')(e.target.value)} /></F>
        <button type="button" className={controls.btnPrimary} onClick={save} data-agd-save-plan>{agdT('savePlan')}</button>
      </div>
      <p className={controls.hint}>{agdT(f.space ? 'spaceNote' : f.class === 'storage_agri' ? 'clsAgri' : 'clsOther')}</p>
      <Tbl
        head={[agdT('planName'), agdT('basis'), agdT('rate'), agdT('class'), agdT('billAt'), '']}
        rows={plans.map((p) => [p.name, agdT(`b.${p.basis}` as AgdKey), p.rate, agdT(`c.${p.class}` as AgdKey), agdT(`at.${p.bill_at}` as AgdKey),
          <button key="d" type="button" className={btn} aria-label={agdT('delete')} onClick={() => run(() => { deletePlan(p.id, lots); return agdT('deleted'); })}><Trash2 size={14} aria-hidden="true" /></button>])}
      />
      <h3>{agdT('raiseBill')}</h3>
      <div style={wrap}>
        <F label={agdT('lot')}><Sel value={b.lot} onChange={(v) => setB({ ...b, lot: v })} opts={lots.map((l) => [l.id, `${l.number} · ${l.depositor_name} (${lotBalance(l)})`])} blank="—" /></F>
        <F label={agdT('from')}><input type="date" className={controls.input} value={b.from} onChange={(e) => setB({ ...b, from: e.target.value })} /></F>
        <F label={agdT('to')}><input type="date" className={controls.input} value={b.to} onChange={(e) => setB({ ...b, to: e.target.value })} /></F>
        <button type="button" className={btn} disabled={!lot} onClick={() => bill({ kind: 'in' })}>{agdT('billAdvance')}</button>
        <button type="button" className={btn} disabled={!lot} onClick={() => bill({ kind: 'month', from: b.from, to: b.to })}>{agdT('billMonth')}</button>
        <button type="button" className={btn} disabled={!lot} onClick={() => bill({ kind: 'season_end', date: b.to })}>{agdT('billSeason')}</button>
      </div>
      <h3>{agdT('rentDue')}</h3>
      <Tbl head={[agdT('depositor'), agdT('season'), agdT('billed'), agdT('due'), '']} flag={rentDue(invoices, lots).map((r) => r.closedUnpaid)} rows={rentDue(invoices, lots).map((r) => [r.depositor, r.season, fmt(r.billed), fmt(r.due), r.closedUnpaid ? agdT('closedUnpaid') : ''])} />
      <h3>{agdT('unbilled')}</h3>
      <Tbl head={[agdT('lot'), agdT('depositor'), agdT('amount')]} rows={unbilledRent(lots, plans, invoices, day).map((u) => [u.lot.number, u.lot.depositor_name, fmt(u.amount)])} />
      <p className={controls.hint}>{agdT('unbilledNote')}</p>
    </>
  );
}
