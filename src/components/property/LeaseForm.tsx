/** R5-C5 lease editor: unit(s), tenant, dates, rent / CAM, escalation, GST class (derived and shown), 194-I, pro rata. */
import { useMemo, useState } from 'react';
import type { Lease, Property } from '../../types/institutions-r5';
import { localDb } from '../../lib/localDb';
import { leaseGstClass } from '../../lib/property/lease-gst';
import { saveLease } from '../../lib/property/leases';
import { R5cError } from '../../lib/institutions/r5c';
import { sectionRate } from '../../lib/tds-rules';
import { sectionText } from '../../lib/ita2025';
import { ita25Words } from '../../i18n/areas/ita2025';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from '../institutions/institutions.module.css';
import { B, C, S, T } from '../institutions/Views';
import { attempt, feeCtx, num, today, type Notify } from '../institutions/ui';

type Draft = Omit<Lease, 'id' | 'schedule_id' | 'status' | 'gst_class'> & { id?: string; comp?: boolean; bos?: boolean };

export function LeaseForm({ lease, props, notify, onSaved }: { lease?: Lease; props: readonly Property[]; notify: Notify; onSaved: () => void }) {
  const clients = useMemo(() => localDb.clients.getAll(), []);
  const [l, setL] = useState<Draft>(() => lease ? { ...lease, bos: lease.gst_class === 'exempt_bos' } : { property_id: props[0]?.id ?? '', unit_ids: [], tenant_id: '', start: today(), end: '', rent: 0, billing_day: 0, due_days: 7 });
  const set = (x: Partial<Draft>) => setL({ ...l, ...x });
  const prop = props.find((p) => p.id === l.property_id);
  const tenant = clients.find((c) => c.id === l.tenant_id);
  const ctx = feeCtx(l.start || today());
  const g = leaseGstClass({ use: prop?.units.find((u) => l.unit_ids.includes(u.id))?.use ?? 'commercial', landlordRegistered: !!ctx.sender?.companyGstin, tenantRegistered: !!tenant?.gstin, tenantBusinessUse: l.tenant_business_use, tenantComposition: l.comp, exemptBos: l.bos, date: ctx.date });
  const esc = l.escalation;
  const setEsc = (x: Partial<NonNullable<Lease['escalation']>>) => set({ escalation: { every_months: 12, kind: 'pct', value: 0, ...esc, ...x } });
  return (
    <div className={styles.stack} data-lease-form>
      <div className={styles.toolbar}>
        <S l={iT('property')} v={l.property_id} o={props.map((p) => [p.id, p.name] as const)} on={(property_id) => set({ property_id, unit_ids: [] })} />
        <S l={iT('tenant')} v={l.tenant_id} o={[['', '—'], ...clients.map((c) => [c.id!, c.name] as const)]} on={(tenant_id) => set({ tenant_id })} d="lease-tenant" />
        <T l={iT('start')} t="date" v={l.start} on={(start) => set({ start })} />
        <T l={iT('end')} t="date" v={l.end} on={(end) => set({ end })} d="lease-end" />
        <T l={iT('lockIn')} t="date" v={l.lock_in_end} on={(v) => set({ lock_in_end: v || undefined })} />
      </div>
      <div className={styles.line}>{prop?.units.map((u) => <C key={u.id} l={`${u.name} (${iT(`use.${u.use}`)})`} v={l.unit_ids.includes(u.id)} on={(on) => set({ unit_ids: on ? [...l.unit_ids, u.id] : l.unit_ids.filter((x) => x !== u.id) })} />)}</div>
      <div className={styles.toolbar}>
        <T l={iT('rent')} v={l.rent || ''} on={(v) => set({ rent: num(v) })} d="lease-rent" />
        <T l="CAM" v={l.cam} on={(v) => set({ cam: num(v) || undefined })} />
        <S l={iT('camBasis')} v={l.cam_basis ?? 'month'} o={[['month', iT('perMonth')], ['sqft', iT('perSqft')]]} on={(v) => set({ cam_basis: v as 'month' })} />
        <T l={iT('billingDay')} v={l.billing_day || ''} ph="1–28" on={(v) => set({ billing_day: num(v) })} />
        <T l={iT('dueDays')} v={l.due_days} on={(v) => set({ due_days: num(v) })} />
        <C l={iT('prorata')} v={l.prorata} on={(prorata) => set({ prorata })} />
      </div>
      <div className={styles.toolbar}>
        <T l={iT('escEvery')} v={esc?.every_months} on={(v) => (num(v) ? setEsc({ every_months: num(v) }) : set({ escalation: undefined }))} />
        {esc && (<>
          <S l={iT('kind')} v={esc.kind} o={[['pct', '%'], ['amount', '₹']]} on={(v) => setEsc({ kind: v as 'pct' })} />
          <T l={iT('value')} v={esc.value || ''} on={(v) => setEsc({ value: num(v) })} />
          <T l={iT('firstOn')} t="date" v={esc.first_on} on={(v) => setEsc({ first_on: v || undefined })} />
          <C l="CAM" v={esc.include_cam} on={(include_cam) => setEsc({ include_cam })} />
        </>)}
      </div>
      <div className={styles.line}>
        <C l={iT('businessUse')} v={l.tenant_business_use} on={(tenant_business_use) => set({ tenant_business_use })} />
        <C l={iT('compTenant')} v={l.comp} on={(comp) => set({ comp })} />
        <C l={iT('exemptBos')} v={l.bos} on={(bos) => set({ bos })} />
      </div>
      <p data-lease-class><strong>{iT(`cls.${g.cls}`)}</strong>{g.rate ? ` · SAC ${g.sac} · ${g.rate}%` : ''}{g.note ? ` — ${iT(`note.${g.note}`)}` : ''}</p>
      <div className={styles.toolbar}>
        <S l="TDS" v={l.tds?.section ?? ''} o={[['', '—'], ...(['194I-B', '194I-A'] as const).map((s) => [s, `${sectionText(s, ctx.date, ita25Words())} · ${iT(`tds.${s}`)} · ${sectionRate(s, ctx.date)}%`] as const)]} on={(v) => set({ tds: v ? { section: v as '194I-B' } : undefined })} />
        <T l={iT('lateFee')} v={l.late_fee_pct} on={(v) => set({ late_fee_pct: num(v) || undefined })} />
      </div>
      <div><B p l={iT('save')} d="lease-save" on={() => attempt(notify, () => {
        if (!prop || !tenant) throw new R5cError('tenant');
        const { comp: _c, bos: _b, ...rest } = l;
        void [_c, _b];
        saveLease({ ...rest, gst_class: g.cls }, { tenant, property: prop, sender: ctx.sender, templateId: ctx.templateId, roundOff: ctx.roundOff });
        onSaved();
      }, iT('saved'))} /></div>
    </div>
  );
}
