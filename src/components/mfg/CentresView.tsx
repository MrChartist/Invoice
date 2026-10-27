/** MF-A2 Floor → Work centres: machine-hour rate as a breakdown, shifts, working days, efficiency, parallel units, holidays. */
import { useMemo, useState } from 'react';
import type { WorkCentre } from '../../types/mfg-r13';
import type { MfgContext } from '../manufacturing/context';
import { loadCentres, machineHourRate, removeCentre, saveCentre, shiftHours } from '../../lib/mfg/mf-centres';
import { getTable } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { fT } from '../../i18n/areas/mfg-r13a';
import controls from '../../styles/controls.module.css';
import { F, Grid, In, Sel } from './floor-ui';
import { fmt, row } from './floor-util';

const KINDS = ['machine', 'line', 'manual', 'outside'] as const;
const DAYS = [1, 2, 3, 4, 5, 6, 0];
type Draft = { id?: string; name: string; kind: WorkCentre['kind']; rate: string; labour: string; power: string; overhead: string; shifts: string; days: number[]; eff: string; units: string; holidays: string; vendor: string; normal: string };
const blank = (): Draft => ({ name: '', kind: 'machine', rate: '', labour: '', power: '', overhead: '', shifts: '8', days: [1, 2, 3, 4, 5, 6], eff: '100', units: '1', holidays: '', vendor: '', normal: '' });
const draftOf = (c: WorkCentre): Draft => ({ id: c.id, name: c.name, kind: c.kind, rate: String(c.hourly_rate || ''), labour: String(c.labour_rate ?? ''), power: String(c.power_rate ?? ''), overhead: String(c.overhead_rate ?? ''), shifts: c.shifts.map((s) => s.hours).join(', '), days: c.days, eff: String(c.efficiency_pct ?? 100), units: String(c.capacity_units ?? 1), holidays: (c.holidays ?? []).join(', '), vendor: c.vendor_id ?? '', normal: String(c.normal_hours ?? '') });

export default function CentresView({ ctx }: { ctx: MfgContext }) {
  const [v, setV] = useState(0);
  const rows = useMemo(() => (void v, loadCentres()), [v]);
  const vendors = useMemo(() => getTable<{ id: string; name: string }>('vendors').filter((x) => x?.id), []);
  const [d, setD] = useState<Draft | null>(null);
  const set = (p: Partial<Draft>) => setD((x) => (x ? { ...x, ...p } : x));
  const save = () => {
    if (!d) return;
    try {
      const opt = (s: string) => (s.trim() === '' ? undefined : num(s));
      const c = saveCentre({
        id: d.id, name: d.name, kind: d.kind, hourly_rate: num(d.rate), labour_rate: opt(d.labour), power_rate: opt(d.power), overhead_rate: opt(d.overhead),
        shifts: d.shifts.split(',').map((h, i) => ({ name: `Shift ${i + 1}`, hours: num(h) })).filter((s) => s.hours > 0),
        days: d.days, efficiency_pct: num(d.eff, 100), capacity_units: num(d.units, 1), holidays: d.holidays.split(',').map((x) => x.trim()).filter(Boolean),
        ...(d.kind === 'outside' && d.vendor ? { vendor_id: d.vendor } : {}), ...(opt(d.normal) ? { normal_hours: opt(d.normal) } : {}),
      });
      setD(null);
      setV((x) => x + 1);
      ctx.changed(fT('centreSaved', { name: c.name }));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };
  const remove = (c: WorkCentre) => {
    try {
      removeCentre(c.id);
      setV((x) => x + 1);
      ctx.changed(fT('deleted'));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };
  return (
    <section data-mf-centres>
      {ctx.canMasters && !d && <button type="button" className={controls.btnPrimary} onClick={() => setD(blank())} data-mf-centre-new>{fT('newCentre')}</button>}
      {d && (
        <div data-mf-centre-form style={{ display: 'grid', gap: '0.5rem', margin: '0.75rem 0' }}>
          <div style={row}>
            <F label={fT('name')}><In v={d.name} set={(x) => set({ name: x })} data-mf="c-name" /></F>
            <F label={fT('kind')}><Sel v={d.kind} set={(x) => set({ kind: x as WorkCentre['kind'] })} o={KINDS.map((k) => [k, fT(`kind.${k}`)] as const)} /></F>
            {d.kind === 'outside' && <F label={fT('vendor')}><Sel v={d.vendor} set={(x) => set({ vendor: x })} o={[['', '—'], ...vendors.map((x) => [x.id, x.name] as const)]} /></F>}
          </div>
          <div style={row}>
            <F label={fT('rateMachine')} w={130}><In v={d.rate} set={(x) => set({ rate: x })} inputMode="decimal" data-mf="c-rate" /></F>
            <F label={fT('rateLabour')} w={130}><In v={d.labour} set={(x) => set({ labour: x })} inputMode="decimal" /></F>
            <F label={fT('ratePower')} w={130}><In v={d.power} set={(x) => set({ power: x })} inputMode="decimal" /></F>
            <F label={fT('rateOverhead')} w={130}><In v={d.overhead} set={(x) => set({ overhead: x })} inputMode="decimal" /></F>
            <span className={controls.hint}>= ₹{fmt(machineHourRate({ hourly_rate: num(d.rate), labour_rate: num(d.labour), power_rate: num(d.power), overhead_rate: num(d.overhead) }))} / h</span>
          </div>
          <div style={row}>
            <F label={fT('shifts')} w={140}><In v={d.shifts} set={(x) => set({ shifts: x })} data-mf="c-shifts" /></F>
            <F label={fT('eff')} w={110}><In v={d.eff} set={(x) => set({ eff: x })} inputMode="decimal" /></F>
            <F label={fT('units')} w={110}><In v={d.units} set={(x) => set({ units: x })} inputMode="numeric" /></F>
            <F label={fT('normal')} w={140}><In v={d.normal} set={(x) => set({ normal: x })} inputMode="numeric" /></F>
          </div>
          <div style={row} role="group" aria-label={fT('days')}>
            {DAYS.map((n) => (
              <label key={n} className={controls.check}><input type="checkbox" checked={d.days.includes(n)} onChange={(e) => set({ days: e.target.checked ? [...d.days, n] : d.days.filter((x) => x !== n) })} /> {fT(`d${n}` as 'd0')}</label>
            ))}
          </div>
          <F label={fT('holidays')}><In v={d.holidays} set={(x) => set({ holidays: x })} placeholder="2026-11-08, 2026-11-09" /></F>
          <div style={row}>
            <button type="button" className={controls.btnPrimary} onClick={save} data-mf="c-save">{fT('save')}</button>
            <button type="button" className={controls.btnOutline} onClick={() => setD(null)}>{fT('cancel')}</button>
          </div>
        </div>
      )}
      <Grid attr="centres" head={[fT('name'), fT('kind'), fT('rate'), fT('hoursDay'), fT('days'), '']} rows={rows.map((c) => [
        c.name, fT(`kind.${c.kind}`),
        `${[c.hourly_rate, c.labour_rate, c.power_rate, c.overhead_rate].filter((x) => num(x) > 0).map((x) => fmt(num(x))).join(' + ')} = ₹${fmt(machineHourRate(c))}`,
        `${fmt(shiftHours(c))} × ${c.capacity_units ?? 1} @ ${c.efficiency_pct ?? 100}%`,
        DAYS.filter((n) => c.days.includes(n)).map((n) => fT(`d${n}` as 'd0')).join(' '),
        ctx.canMasters ? <span style={row}><button type="button" className={controls.btnOutline} onClick={() => setD(draftOf(c))}>{fT('edit')}</button><button type="button" className={controls.btnDanger} onClick={() => remove(c)}>{fT('delete')}</button></span> : null,
      ])} />
    </section>
  );
}
