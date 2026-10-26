/** R5-B1: consignment note form (new / edit while booked). */
import { useMemo, useState } from 'react';
import { Plus, Truck } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { ConsignmentNote, FreightBasis, GstLiable, LrLine, LrPaymentBasis } from '../../types/transport-works-r5';
import { CHARGE_KINDS, FREIGHT_BASES, PAYMENT_BASES, derivedLiable, freightOf, saveLr } from '../../lib/transport/consignment-notes';
import { loadVehicles } from '../../lib/transport/vehicles';
import { localDb } from '../../lib/localDb';
import type { GtaRecipientKind } from '../../lib/transport-works-rules';
import { B, errText, fmtMoney, today, type Notify } from './shared';
import { F } from './Field';
import controls from '../../styles/controls.module.css';
import styles from './transport.module.css';

const KINDS: GtaRecipientKind[] = ['registered', 'factory', 'society', 'cooperative', 'body_corporate', 'partnership', 'casual', 'unregistered'];
const blankLine = (): LrLine => ({ description: '', packages: 1 });

export function LrForm({ lr, notify, onSaved, onCancel }: { lr?: ConsignmentNote; notify: Notify; onSaved: () => void; onCancel: () => void }) {
  const clients = useMemo(() => localDb.clients.getAll().filter((c) => c.id && c.name?.trim()).sort((a, b) => a.name.localeCompare(b.name)), []);
  const vehicles = useMemo(() => loadVehicles(), []);
  const [f, setF] = useState(() => ({
    date: lr?.date ?? today(),
    prefix: lr?.prefix ?? 'LR',
    fromPlace: lr?.from.place ?? '', fromState: lr?.from.state ?? '',
    toPlace: lr?.to.place ?? '', toState: lr?.to.state ?? '',
    consignor: lr?.consignor_id ?? '', consignee: lr?.consignee_id ?? '', billing: lr?.billing_party_id ?? '',
    invoiceNos: lr?.invoice_nos ?? '', ewayNos: lr?.eway_nos ?? '',
    vehicleId: lr?.vehicle_id ?? '', vehicleNo: lr?.vehicle_no ?? '', driver: lr?.driver ?? '',
    basis: (lr?.basis ?? 'fixed') as FreightBasis, rate: String(lr?.rate ?? ''),
    pay: (lr?.payment_basis ?? 'tbb') as LrPaymentBasis,
    kind: '' as GtaRecipientKind | '',
    override: '' as GstLiable | '', reason: lr?.liable_override_reason ?? '',
  }));
  const [lines, setLines] = useState<LrLine[]>(lr?.lines.length ? lr.lines.map((l) => ({ ...l })) : [blankLine()]);
  const [charges, setCharges] = useState<Record<string, string>>(() => Object.fromEntries((lr?.charges ?? []).map((c) => [c.kind, String(c.amount)])));
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setLine = (i: number, k: keyof LrLine, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: k === 'description' || k === 'packing' || k === 'hsn' ? v : v === '' ? undefined : Number(v) } : l)));
  const input = (): Parameters<typeof saveLr>[0] => ({
    id: lr?.id, date: f.date, prefix: f.prefix,
    from: { place: f.fromPlace, state: f.fromState }, to: { place: f.toPlace, state: f.toState },
    consignor_id: f.consignor, consignee_id: f.consignee, ...(f.billing ? { billing_party_id: f.billing } : {}),
    lines, invoice_nos: f.invoiceNos || undefined, eway_nos: f.ewayNos || undefined,
    ...(f.vehicleId ? { vehicle_id: f.vehicleId, vehicle_no: vehicles.find((v) => v.id === f.vehicleId)?.reg_no } : { vehicle_no: f.vehicleNo }),
    driver: f.driver || undefined, basis: f.basis, rate: Number(f.rate) || 0,
    charges: Object.entries(charges).filter(([, v]) => Number(v) > 0).map(([kind, v]) => ({ kind, amount: Number(v) })),
    payment_basis: f.pay, ...(f.kind ? { recipient_kind: f.kind } : {}),
    ...(f.override ? { liable_override: f.override, liable_override_reason: f.reason } : {}),
  });
  const derived = derivedLiable({ date: f.date, payment_basis: f.pay, consignor_id: f.consignor, consignee_id: f.consignee, billing_party_id: f.billing || undefined }, clients, f.kind || undefined);
  const total = freightOf({ basis: f.basis, rate: Number(f.rate) || 0, lines, charges: Object.entries(charges).map(([kind, v]) => ({ kind, amount: Number(v) || 0 })) }).total;
  const save = () => {
    try {
      const saved = saveLr(input(), clients);
      notify(twT('lrSaved', { no: saved.number }));
      onSaved();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const party = (k: 'consignor' | 'consignee' | 'billing', label: string) => (
    <F l={label}>
      <select className={controls.select} value={f[k]} onChange={set(k)} data-lr-party={k}>
        <option value="">—</option>
        {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.gstin ? ` · ${c.gstin}` : ''}</option>)}
      </select></F>
  );
  const field = (k: keyof typeof f, label: string, type = 'text') => (
    <F l={label}><input className={controls.input} type={type} value={String(f[k])} onChange={set(k)} data-lr-field={k} /></F>
  );
  return (
    <div className={styles.box} data-lr-form>
      <h3 className={styles.toolbar}><Truck size={16} aria-hidden="true" /> {lr ? lr.number : twT('lrNew')}</h3>
      <div className={styles.grid}>
        {field('date', twT('date'), 'date')}
        {!lr && field('prefix', twT('lrPrefix'))}
        {field('fromPlace', twT('fromPlace'))}{field('fromState', twT('stateCode'))}
        {field('toPlace', twT('toPlace'))}{field('toState', twT('stateCode'))}
        {party('consignor', twT('consignor'))}{party('consignee', twT('consignee'))}{party('billing', twT('billingParty'))}
        {field('invoiceNos', twT('invoiceNos'))}{field('ewayNos', twT('ewayNos'))}
        <F l={twT('vehicle')}>
          <select className={controls.select} value={f.vehicleId} onChange={set('vehicleId')}>
            <option value="">{twT('typed')}</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.reg_no}</option>)}
          </select></F>
        {!f.vehicleId && field('vehicleNo', twT('vehicleNo'))}
        {field('driver', twT('driver'))}
      </div>
      <h4>{twT('goods')}</h4>
      {lines.map((l, i) => (
        <div key={i} className={styles.lineRow}>
          <F l={twT('description')}><input className={controls.input} value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} data-lr-goods /></F>
          <F l={twT('packages')}><input className={controls.input} type="number" value={l.packages ?? ''} onChange={(e) => setLine(i, 'packages', e.target.value)} /></F>
          <F l={twT('packing')}><input className={controls.input} value={l.packing ?? ''} onChange={(e) => setLine(i, 'packing', e.target.value)} /></F>
          <F l={twT('actualKg')}><input className={controls.input} type="number" value={l.actual_weight ?? ''} onChange={(e) => setLine(i, 'actual_weight', e.target.value)} /></F>
          <F l={twT('chargedKg')}><input className={controls.input} type="number" value={l.charged_weight ?? ''} onChange={(e) => setLine(i, 'charged_weight', e.target.value)} /></F>
          <F l={twT('goodsValue')}><input className={controls.input} type="number" value={l.value ?? ''} onChange={(e) => setLine(i, 'value', e.target.value)} /></F>
        </div>
      ))}
      <div className={styles.toolbar}><button type="button" className={B.gs} onClick={() => setLines((ls) => [...ls, blankLine()])}><Plus size={14} aria-hidden="true" /> {twT('addLine')}</button></div>
      <div className={styles.grid}>
        <F l={twT('basis')}>
          <select className={controls.select} value={f.basis} onChange={set('basis')}>{FREIGHT_BASES.map((b) => <option key={b} value={b}>{twT(`basis.${b}`)}</option>)}</select></F>
        {field('rate', twT('rate'), 'number')}
        {CHARGE_KINDS.map((k) => (
          <label key={k} className={controls.field}><span className={controls.label}>{twT(`charge.${k}`)}</span><input className={controls.input} type="number" value={charges[k] ?? ''} onChange={(e) => setCharges((c) => ({ ...c, [k]: e.target.value }))} /></label>
        ))}
        <F l={twT('payBasis')}>
          <select className={controls.select} value={f.pay} onChange={set('pay')} data-lr-pay>{PAYMENT_BASES.map((b) => <option key={b} value={b}>{twT(`pay.${b}`)}</option>)}</select></F>
        <F l={twT('recipientKind')}>
          <select className={controls.select} value={f.kind} onChange={set('kind')}><option value="">{twT('fromGstin')}</option>{KINDS.map((k) => <option key={k} value={k}>{twT(`rk.${k}`)}</option>)}</select></F>
        <F l={twT('liableOverride')}>
          <select className={controls.select} value={f.override} onChange={set('override')}><option value="">{twT('asDerived')}</option><option value="recipient">{twT('liable.recipient')}</option><option value="gta">{twT('liable.gta')}</option></select></F>
        {f.override && field('reason', twT('reason'))}
      </div>
      <p className={styles.note}>{twT('freightTotal')}: <strong>{fmtMoney(total)}</strong> · {twT('liable')}: <strong data-lr-liable>{twT(`liable.${f.override || derived}`)}</strong></p>
      <div className={styles.toolbar}>
        <button type="button" className={B.p} onClick={save} data-lr-save>{twT('save')}</button>
        <button type="button" className={B.g} onClick={onCancel}>{twT('cancel')}</button>
      </div>
    </div>
  );
}
