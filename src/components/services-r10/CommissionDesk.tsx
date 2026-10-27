/**
 * SV-A3 Time → Staff & commission: the staff list (role, employment, payroll / supplier link, plan, weekly off and a
 * break), commission plans (rules by item > category > kind, % of taxable or ₹ per unit, a monthly slab) and the
 * monthly statement per staff member with its payout (payroll adjustment for employees, else a journal with opt-in
 * TDS) and undo. Part of the front-desk chunk. Working papers — verify with your CA (SV16).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { CommissionKind, CommissionPlan, CommissionRule, ServiceStaff, StaffRole } from '../../types/services-r10';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { enabledModules } from '../../lib/shop-mode';
import { downloadText, toCsv } from '../../lib/download';
import { formatCurrency, todayInput } from '../../lib/utils';
import { deletePlan, deleteStaff, loadPlans, loadStaff, savePlan, saveStaff } from '../../lib/services/sv-staff';
import { commissionFor, statementRows } from '../../lib/services/sv-commission';
import { loadPayouts, paidOut, payoutRoute, postPayout, undoPayout } from '../../lib/services/sv-payouts';
import { svT, type SvKey } from '../../i18n/areas/services-r10a';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './services.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
const VIEWS = ['staff', 'plans', 'statement'] as const;
const ROLES: StaffRole[] = ['stylist', 'therapist', 'trainer', 'doctor', 'technician', 'teacher', 'other'];
const KINDS: CommissionKind[] = ['service', 'product', 'package_sale', 'membership_sale', 'package_redemption'];
const DAYS = [0, 1, 2, 3, 4, 5, 6];
const dayLabel = (i: number) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2024, 0, 1 + i));
const Field = ({ k, children }: { k: SvKey; children: ReactNode }) => <label className={controls.field}><span className={controls.label}>{svT(k)}</span>{children}</label>;

export function CommissionDesk({ view, notify }: { view?: string; notify: Notify }) {
  const [, setParams] = useSearchParams();
  const v = (VIEWS as readonly string[]).includes(view ?? '') ? (view as (typeof VIEWS)[number]) : 'staff';
  const [tick, setTick] = useState(0);
  /* eslint-disable react-hooks/exhaustive-deps */
  const staff = useMemo(() => loadStaff(), [tick]);
  const plans = useMemo(() => loadPlans(), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const run = (fn: () => void, ok = svT('saved')) => {
    try {
      fn();
      notify(ok);
      setTick((n) => n + 1);
      return true;
    } catch (e) {
      notify((e as Error).message, 'error');
      return false;
    }
  };
  return (
    <section className={surface.card} data-commission-desk>
      <div className={surface.cardBody}>
        <div className={controls.segment} role="tablist">
          {VIEWS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={v === x} className={v === x ? controls.segmentBtnActive : controls.segmentBtn}
              onClick={() => setParams((p) => { p.set('tab', 'commission'); p.set('view', x); return p; }, { replace: true })}>{svT(`v.${x}`)}</button>
          ))}
        </div>
        {v === 'staff' && <StaffView staff={staff} plans={plans} run={run} />}
        {v === 'plans' && <PlansView plans={plans} run={run} />}
        {v === 'statement' && <StatementView staff={staff} plans={plans} run={run} tick={tick} />}
      </div>
    </section>
  );
}

type Run = (fn: () => void, ok?: string) => boolean;
const blankStaff = (): Omit<ServiceStaff, 'id' | 'created_at'> & { id?: string } => ({ name: '', role: 'stylist', employment: 'employee', bookable: true, active: true });

function StaffView({ staff, plans, run }: { staff: ServiceStaff[]; plans: CommissionPlan[]; run: Run }) {
  const [f, setF] = useState(blankStaff);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const employees = useMemo(() => getTable<{ id: string; name?: string }>('employees').filter((e) => e?.id), []);
  const vendors = useMemo(() => getTable<{ id: string; name?: string }>('vendors').filter((e) => e?.id), []);
  const brk = f.hours?.breaks?.[0] ?? { from: '', to: '' };
  return (
    <>
      <div className={styles.form} data-staff-form>
        <Field k="name"><input className={controls.input} value={f.name} onChange={(e) => set({ name: e.target.value })} data-staff-name /></Field>
        <Field k="phone"><input className={controls.input} type="tel" value={f.phone ?? ''} onChange={(e) => set({ phone: e.target.value })} /></Field>
        <Field k="role"><select className={controls.select} value={f.role} onChange={(e) => set({ role: e.target.value as StaffRole })}>{ROLES.map((r) => <option key={r} value={r}>{svT(`role.${r}`)}</option>)}</select></Field>
        <Field k="employment"><select className={controls.select} value={f.employment} onChange={(e) => set({ employment: e.target.value as ServiceStaff['employment'] })}><option value="employee">{svT('emp.employee')}</option><option value="freelance">{svT('emp.freelance')}</option></select></Field>
        {f.employment === 'employee' && !!employees.length && <Field k="employee"><select className={controls.select} value={f.employee_id ?? ''} onChange={(e) => set({ employee_id: e.target.value || undefined })}><option value="">—</option>{employees.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
        {f.employment === 'freelance' && <Field k="vendor"><select className={controls.select} value={f.vendor_id ?? ''} onChange={(e) => set({ vendor_id: e.target.value || undefined })}><option value="">—</option>{vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
        {f.employment === 'freelance' && <Field k="tds"><select className={controls.select} value={f.tds_section ?? ''} onChange={(e) => set({ tds_section: e.target.value || undefined })}><option value="">{f.role === 'doctor' ? '194J' : '194H'}</option>{['194H', '194J', '194C'].map((x) => <option key={x}>{x}</option>)}</select></Field>}
        <Field k="plan"><select className={controls.select} value={f.plan_id ?? ''} onChange={(e) => set({ plan_id: e.target.value || undefined })} data-staff-plan><option value="">—</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field k="breakFrom"><input className={controls.input} type="time" value={brk.from} onChange={(e) => set({ hours: { ...f.hours, breaks: e.target.value ? [{ from: e.target.value, to: brk.to || e.target.value }] : [] } })} /></Field>
        <Field k="breakTo"><input className={controls.input} type="time" value={brk.to} onChange={(e) => set({ hours: { ...f.hours, breaks: brk.from ? [{ from: brk.from, to: e.target.value }] : [] } })} /></Field>
      </div>
      <div className={styles.actions}>
        <span className={controls.label}>{svT('offDays')}</span>
        {DAYS.map((d) => <label key={d} className={controls.check}><input type="checkbox" checked={!!f.hours?.off_days?.includes(d)} onChange={(e) => set({ hours: { ...f.hours, off_days: e.target.checked ? [...(f.hours?.off_days ?? []), d] : (f.hours?.off_days ?? []).filter((x) => x !== d) } })} /> {dayLabel(d)}</label>)}
        <label className={controls.check}><input type="checkbox" checked={f.bookable !== false} onChange={(e) => set({ bookable: e.target.checked })} /> {svT('bookable')}</label>
        <label className={controls.check}><input type="checkbox" checked={f.active !== false} onChange={(e) => set({ active: e.target.checked })} /> {svT('active')}</label>
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => saveStaff({ ...f, employee_id: f.employment === 'employee' ? f.employee_id : undefined })) && setF(blankStaff())} data-staff-save>{f.id ? svT('save') : svT('add')}</button>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{svT('name')}</th><th>{svT('role')}</th><th>{svT('employment')}</th><th>{svT('plan')}</th><th /></tr></thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.name}{s.active === false ? ' ·' : ''}</td><td>{svT(`role.${s.role}`)}</td><td>{svT(`emp.${s.employment}`)}</td><td>{plans.find((p) => p.id === s.plan_id)?.name ?? '—'}</td>
                <td>
                  <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setF(s)}>{svT('edit')}</button>
                  <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(() => deleteStaff(s.id), svT('deleted'))}>{svT('del')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const blankPlan = (): Omit<CommissionPlan, 'id' | 'created_at'> & { id?: string } => ({ name: '', basis: 'invoice', rules: [{ kind: 'service', pct: 10 }] });

function PlansView({ plans, run }: { plans: CommissionPlan[]; run: Run }) {
  const [f, setF] = useState(blankPlan);
  const catalog = useMemo(() => [...localDb.items.getAll(), ...getTable<{ id: string; name: string }>('stock_items')].filter((i) => i?.id && i.name), []);
  const setRule = (i: number, p: Partial<CommissionRule>) => setF((x) => ({ ...x, rules: x.rules.map((r, k) => (k === i ? { ...r, ...p } : r)) }));
  const target = (r: CommissionRule) => (r.item_id ? `i:${r.item_id}` : r.category ? `c:${r.category}` : `k:${r.kind ?? 'service'}`);
  const setTarget = (i: number, t: string) => setRule(i, { item_id: t.startsWith('i:') ? t.slice(2) : undefined, category: undefined, kind: t.startsWith('k:') ? (t.slice(2) as CommissionKind) : undefined });
  return (
    <>
      <div className={styles.form}>
        <Field k="name"><input className={controls.input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-plan-name /></Field>
        <Field k="basis"><select className={controls.select} value={f.basis} onChange={(e) => setF({ ...f, basis: e.target.value as CommissionPlan['basis'] })}><option value="invoice">{svT('basis.invoice')}</option><option value="receipt">{svT('basis.receipt')}</option></select></Field>
      </div>
      <p className={controls.label}>{svT('rules')}</p>
      <table className={styles.lines}>
        <tbody>
          {f.rules.map((r, i) => (
            <tr key={i}>
              <td>
                <select className={controls.select} value={target(r)} onChange={(e) => setTarget(i, e.target.value)} aria-label={svT('ruleKind')}>
                  <optgroup label={svT('ruleKind')}>{KINDS.map((k) => <option key={k} value={`k:${k}`}>{svT(`k.${k}`)}</option>)}</optgroup>
                  <optgroup label={svT('ruleItem')}>{catalog.map((c) => <option key={c.id} value={`i:${c.id}`}>{c.name}</option>)}</optgroup>
                </select>
              </td>
              <td><input className={controls.input} type="number" min={0} step="0.5" placeholder={svT('pct')} value={r.pct ?? ''} onChange={(e) => setRule(i, { pct: e.target.value ? Number(e.target.value) : undefined, per_unit: undefined })} aria-label={svT('pct')} data-rule-pct={i} /></td>
              <td><input className={controls.input} type="number" min={0} placeholder={svT('perUnit')} value={r.per_unit ?? ''} onChange={(e) => setRule(i, { per_unit: e.target.value ? Number(e.target.value) : undefined, pct: undefined })} aria-label={svT('perUnit')} /></td>
              <td><button type="button" className={controls.btnGhost} onClick={() => setF({ ...f, rules: f.rules.filter((_x, k) => k !== i) })} aria-label={svT('del')}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setF({ ...f, rules: [...f.rules, { kind: 'product', pct: 5 }] })}>+ {svT('addRule')}</button>
      <p className={controls.label}>{svT('slab')}</p>
      <div className={styles.form}>
        <Field k="slabTarget"><input className={controls.input} type="number" min={0} value={f.slab?.target ?? ''} onChange={(e) => setF({ ...f, slab: e.target.value ? { base: 'service', pct: 2, mode: 'add', ...f.slab, target: Number(e.target.value) } : undefined })} /></Field>
        {f.slab && <Field k="pct"><input className={controls.input} type="number" min={0} step="0.5" value={f.slab.pct} onChange={(e) => setF({ ...f, slab: { ...f.slab!, pct: Number(e.target.value) } })} /></Field>}
        {f.slab && <Field k="slabBase"><select className={controls.select} value={f.slab.base} onChange={(e) => setF({ ...f, slab: { ...f.slab!, base: e.target.value as 'service' | 'all' } })}><option value="service">{svT('sb.service')}</option><option value="all">{svT('sb.all')}</option></select></Field>}
        {f.slab && <Field k="slabMode"><select className={controls.select} value={f.slab.mode} onChange={(e) => setF({ ...f, slab: { ...f.slab!, mode: e.target.value as 'add' | 'replace' } })}><option value="add">{svT('sm.add')}</option><option value="replace">{svT('sm.replace')}</option></select></Field>}
      </div>
      <div className={styles.actions}><button type="button" className={controls.btnPrimary} onClick={() => run(() => savePlan(f)) && setF(blankPlan())} data-plan-save>{f.id ? svT('save') : svT('add')}</button></div>
      <ul className={styles.list}>
        {plans.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong> · {p.rules.map((r) => `${r.kind ? svT(`k.${r.kind}`) : r.item_id ? catalog.find((c) => c.id === r.item_id)?.name ?? '?' : r.category} ${r.pct ? `${r.pct}%` : `₹${r.per_unit}`}`).join(', ')}
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setF(p)}>{svT('edit')}</button>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(() => deletePlan(p.id), svT('deleted'))}>{svT('del')}</button>
          </li>
        ))}
      </ul>
    </>
  );
}

function StatementView({ staff, plans, run, tick }: { staff: ServiceStaff[]; plans: CommissionPlan[]; run: Run; tick: number }) {
  const [staffId, setStaffId] = useState(staff[0]?.id ?? '');
  const [month, setMonth] = useState(todayInput().slice(0, 7));
  const [date, setDate] = useState(todayInput());
  const [tds, setTds] = useState(false);
  const s = staff.find((x) => x.id === staffId);
  /* eslint-disable react-hooks/exhaustive-deps */
  const data = useMemo(() => ({ invoices: getTable<InvoiceRecord>('invoices'), payments: getTable<Payment>('transactions'), plans, items: [...localDb.items.getAll(), ...getTable<{ id: string; name: string; group_id?: string }>('stock_items')] }), [tick, plans]);
  const payouts = useMemo(() => loadPayouts(), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const st = useMemo(() => (s ? commissionFor(s, month, data) : null), [s, month, data]);
  const payrollOn = enabledModules(localDb.settings.get())?.has('payroll') ?? true;
  const done = s ? paidOut(payouts, s.id, month) : false;
  return (
    <>
      <div className={styles.bar}>
        <select className={controls.select} value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label={svT('staff')} style={{ maxWidth: '14rem' }} data-statement-staff>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <input className={controls.input} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={svT('month')} style={{ maxWidth: '11rem' }} />
        {st && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => downloadText(`commission-${s!.name}-${month}.csv`, `﻿${toCsv(statementRows(st))}`, 'text/csv')}>{svT('csv')}</button>}
      </div>
      {st && (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-statement>
            <thead><tr><th>{svT('date')}</th><th>#</th><th>{svT('service')}</th><th>{svT('base')}</th><th>{svT('rate')}</th><th>{svT('amount')}</th></tr></thead>
            <tbody>
              {st.lines.map((l, i) => <tr key={i}><td>{l.date}</td><td>{l.number}</td><td>{l.item}{l.role === 'assist' ? ' (assist)' : ''}</td><td>{formatCurrency(l.base)}</td><td>{l.rate}</td><td>{formatCurrency(l.amount)}</td></tr>)}
              {!!st.uplift && <tr><td colSpan={5}>{svT('uplift')}</td><td>{formatCurrency(st.uplift)}</td></tr>}
              <tr><td colSpan={3}><strong>{svT('total')}</strong></td><td>{formatCurrency(st.base)}</td><td /><td><strong data-statement-total>{formatCurrency(st.total)}</strong></td></tr>
            </tbody>
          </table>
        </div>
      )}
      {s && st && (
        <div className={styles.actions}>
          {done ? <span className={styles.muted}>{svT('paidOut')}</span> : (
            <>
              <input className={controls.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label={svT('payoutDate')} style={{ maxWidth: '11rem' }} />
              {s.employment === 'freelance' && <label className={controls.check}><input type="checkbox" checked={tds} onChange={(e) => setTds(e.target.checked)} /> {svT('payoutTds')}</label>}
              <button type="button" className={controls.btnPrimary} disabled={!(st.total > 0)} onClick={() => run(() => postPayout(s, month, st, { date, payrollOn, tds }))}>{svT('payout')} · {svT(`route.${payoutRoute(s, payrollOn)}`)}</button>
            </>
          )}
        </div>
      )}
      <p className={controls.hint}>{svT('payoutNote')}</p>
      {!!payouts.length && <h3>{svT('payouts')}</h3>}
      <ul className={styles.list}>
        {payouts.map((p) => (
          <li key={p.id}>{p.month} · {p.staff_name} · {formatCurrency(p.amount)} · {svT(`route.${p.route}`)}{p.voucher_number ? ` ${p.voucher_number}` : ''}
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(() => undoPayout(p.id), svT('deleted'))}>{svT('undo')}</button>
          </li>
        ))}
      </ul>
    </>
  );
}
