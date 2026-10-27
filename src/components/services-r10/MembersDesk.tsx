/**
 * SV-C Members desk (Time → Members; fitness pack, also salon), one lazy chunk: plans & packages, members (sell, freeze,
 * upgrade, transfer, cancel with refund, renew, wallet top-up, renewals, forfeited sessions), check-in (code / phone /
 * name, gate, today, churn, peak hours, member cards), classes (timetable, capacity, wait-list) and service recipes.
 * Working papers — verify with your CA.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ClassSchedule, MemberPlan, MemberPlanKind, Membership, SvClass } from '../../types/services-r10';
import type { InvoiceRecord } from '../../types/invoice';
import type { Bom } from '../../types/manufacturing';
import type { StockItem } from '../../lib/inventory';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { whatsappLink } from '../../lib/share';
import { toCsv } from '../../lib/csv';
import { labelSheetHtml, layoutById } from '../../lib/label-sheet';
import { shiftDay } from '../../lib/dates';
import { dateLocale, useT } from '../../i18n';
import { mcT, type McKey } from '../../i18n/areas/services-r10c';
import { svT } from '../../i18n/areas/services-r10a';
import { SV_CLASSES } from '../../lib/services/sv-tax';
import { loadStaff } from '../../lib/services/sv-staff';
import { readServiceSettings } from '../../lib/services/sv-settings';
import { daysBetween, deleteMemberPlan, forfeited, loadCheckins, loadMemberPlans, loadMemberships, renewals, saveMemberPlan, sessionsUsed, statusOf } from '../../lib/services/sv-members';
import { autoRenewDue, bonusLeft, cancelMembership, freeze, renew, sellPlan, topUp, transfer, unfreeze, upgrade } from '../../lib/services/sv-memberships';
import { checkIn, findMembers, footfall, gateFor, notSeen, undoCheckin } from '../../lib/services/sv-checkin';
import { deleteClass, dropMember, enrolMember, loadClasses, saveClass } from '../../lib/services/sv-classes';
import { recipeReport } from '../../lib/services/sv-recipes';
import { B, C, S, T, Tbl, Views } from '../institutions/Views';
import { attempt, csv, printPage, rs, today, useView, type Notify } from '../institutions/ui';
import styles from '../institutions/institutions.module.css';
import controls from '../../styles/controls.module.css';

const VIEWS = ['plans', 'members', 'checkin', 'classes', 'recipes'] as const;
const KINDS: MemberPlanKind[] = ['membership', 'package', 'wallet', 'combo'];
const n = (v: string) => (v.trim() === '' ? undefined : Number(v) || 0);
const list = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
const o = (keys: readonly string[], p: string) => keys.map((k) => [k, mcT(`${p}${k}` as McKey)] as const);
const wd = (i: number) => new Intl.DateTimeFormat(dateLocale(), { weekday: 'short' }).format(new Date(Date.UTC(2024, 0, 1 + i)));
const staffOpts = () => [['', '—'] as const, ...loadStaff().map((s) => [s.id, s.name] as const)];

export default function MembersDesk({ notify }: { notify: Notify }) {
  useT();
  const [view, go] = useView(VIEWS);
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((x) => x + 1);
  useEffect(() => {
    if (!can('doc.create')) return;
    attempt(notify, () => {
      const made = autoRenewDue(today());
      if (made.length) notify(mcT('autoDone', { n: made.length }));
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const p = { notify, tick, refresh };
  return (
    <div className={styles.stack} data-members-desk>
      <Views views={VIEWS} value={view} onChange={go} label={(v) => mcT(`v.${v}`)} />
      {view === 'plans' && <Plans {...p} />}
      {view === 'members' && <Members {...p} />}
      {view === 'checkin' && <Checkin {...p} />}
      {view === 'classes' && <Classes {...p} />}
      {view === 'recipes' && <Recipes />}
      <p className={styles.note}>{mcT('note')}</p>
    </div>
  );
}

type P = { notify: Notify; tick: number; refresh: () => void };

// Numeric plan fields: [field, label, kinds shown] (t = time-based, s = sessions, w = wallet, p = package only).
const NUMS: [string, McKey, string][] = [['months', 'months', 't'], ['days', 'days', 't'], ['sessions', 'sessions', 's'], ['validity_days', 'validity', 'p'], ['price', 'price', 'ts'], ['max_days', 'fMax', 't'], ['max_times', 'fTimes', 't'], ['min_days', 'fMin', 't'], ['fee', 'fFee', 't'], ['transfer_fee', 'tFee', 'ts'], ['bonus_pct', 'bonus', 'w']];
const FREEZE = ['max_days', 'max_times', 'min_days', 'fee'];
const flags = (k: MemberPlanKind) => ({ membership: 't', package: 'sp', wallet: 'w', combo: 'ts' })[k];

function Plans({ notify, tick, refresh }: P) {
  const plans = useMemo(() => loadMemberPlans(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const blank = { id: '', name: '', kind: 'membership' as MemberPlanKind, covers: '', cls: '', refund: 'none', trainer: '', onCheckin: false, x: { months: '1' } as Record<string, string> };
  const [f, setF] = useState(blank);
  const set = (x: Partial<typeof f>) => setF({ ...f, ...x });
  const edit = (p: MemberPlan) => setF({ id: p.id, name: p.name, kind: p.kind, covers: (p.covers ?? []).join(', '), cls: p.cls ?? '', refund: p.refund ?? 'none', trainer: p.trainer_id ?? '', onCheckin: !!p.redeem_on_checkin, x: Object.fromEntries(NUMS.map(([k]) => [k, String((FREEZE.includes(k) ? p.freeze?.[k as 'fee'] : p[k as 'price']) ?? '')])) });
  const save = () => attempt(notify, () => {
    const v = Object.fromEntries(NUMS.map(([k]) => [k, n(f.x[k] ?? '')]));
    saveMemberPlan({
      ...(Object.fromEntries(Object.entries(v).filter(([k]) => !FREEZE.includes(k))) as Partial<MemberPlan>), id: f.id || undefined, name: f.name, kind: f.kind, covers: list(f.covers), price: v.price ?? 0, cls: (f.cls || undefined) as SvClass, refund: f.refund as MemberPlan['refund'], trainer_id: f.trainer || undefined, redeem_on_checkin: f.onCheckin,
      freeze: Object.fromEntries(FREEZE.map((k) => [k, v[k]])), transferable: v.transfer_fee !== undefined, active: true,
    });
    setF(blank);
    refresh();
  }, mcT('saved'));
  const fl = flags(f.kind);
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <T l={mcT('name')} v={f.name} on={(name) => set({ name })} d="plan-name" />
        <S l={mcT('kind')} v={f.kind} o={o(KINDS, 'k.')} on={(k) => set({ kind: k as MemberPlanKind })} d="plan-kind" />
        {NUMS.filter(([, , show]) => [...show].some((c) => fl.includes(c))).map(([k, l]) => <T key={k} l={mcT(l)} t="number" v={f.x[k]} on={(val) => set({ x: { ...f.x, [k]: val } })} d={`plan-${k}`} />)}
        <S l={mcT('cls')} v={f.cls} o={[['', '—'], ...SV_CLASSES.map((c) => [c, svT(`cl.${c}`)] as const)]} on={(cls) => set({ cls })} d="plan-cls" />
        {fl.includes('s') && <><T l={mcT('covers')} v={f.covers} on={(covers) => set({ covers })} d="plan-covers" /><S l={mcT('trainer')} v={f.trainer} o={staffOpts()} on={(trainer) => set({ trainer })} /><C l={mcT('onCheckin')} v={f.onCheckin} on={(onCheckin) => set({ onCheckin })} /></>}
        {fl !== 'w' && <S l={mcT('refund')} v={f.refund} o={o(['none', 'pro_rata'], 'r.')} on={(refund) => set({ refund })} />}
        <B p l={mcT('save')} on={save} d="plan-save" />
      </div>
      <Tbl h={[mcT('name'), mcT('kind'), mcT('price'), '']} rows={plans.map((p) => [p.name, mcT(`k.${p.kind}`), rs(p.price), <span key="a"><B sm l={mcT('edit')} on={() => edit(p)} /> <B g sm l={mcT('del')} on={() => attempt(notify, () => { deleteMemberPlan(p.id); refresh(); })} /></span>])} />
    </div>
  );
}

/** Saved client by name (datalist pick), for the member fields. */
const clientByName = (name: string) => localDb.clients.getAll().find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
const ClientList = () => <datalist id="mc-clients">{localDb.clients.getAll().slice(0, 500).map((c) => <option key={c.id} value={c.name} />)}</datalist>;
function Who({ v, on, d }: { v: string; on: (v: string) => void; d?: string }) {
  return <label className={controls.field}><span className={controls.label}>{mcT('member')}</span><input className={controls.input} value={v} list="mc-clients" onChange={(e) => on(e.target.value)} data-mem-client={d ?? ''} /></label>;
}

function Members({ notify, tick, refresh }: P) {
  /* eslint-disable react-hooks/exhaustive-deps */
  const all = useMemo(() => loadMemberships().slice().reverse(), [tick]);
  const plans = useMemo(() => loadMemberPlans(), [tick]);
  const invoices = useMemo(() => getTable<InvoiceRecord>('invoices'), [tick]);
  const checkins = useMemo(() => loadCheckins(), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const d = today();
  const [s, setS] = useState({ client: '', phone: '', plan: plans[0]?.id ?? '', start: d, trainer: '', auto: false, topup: '', method: 'Cash' });
  const [sel, setSel] = useState<Membership>();
  const [a, setA] = useState({ act: 'freeze', from: d, to: shiftDay(d, 13), reason: '', plan: '', client: '', amount: '' });
  const plan = plans.find((p) => p.id === (s.plan || plans[0]?.id));
  const sell = () => attempt(notify, () => {
    const c = clientByName(s.client);
    const m = sellPlan({ plan_id: plan?.id ?? '', client_id: c?.id, client_name: s.client, phone: s.phone || c?.phone, start: s.start, trainer_id: s.trainer || undefined, auto_renew: s.auto, ...(plan?.kind === 'wallet' && Number(s.topup) > 0 ? { topup: { amount: Number(s.topup), method: s.method } } : {}) });
    notify(`${m.number} · ${mcT('saved')}`);
    refresh();
  });
  const act = () => sel && attempt(notify, () => {
    const c = clientByName(a.client);
    if (a.act === 'freeze') freeze(sel.id, a.from, a.to, a.reason);
    else if (a.act === 'unfreeze') unfreeze(sel.id, d);
    else if (a.act === 'upgrade') upgrade(sel.id, a.plan, a.from);
    else if (a.act === 'transfer') transfer(sel.id, { client_id: c?.id, client_name: a.client, phone: c?.phone }, a.from);
    else if (a.act === 'cancel') cancelMembership(sel.id, a.from, a.reason, n(a.amount));
    else if (a.act === 'renew') renew(sel.id, a.from);
    else topUp(sel.id, Number(a.amount), 'Cash', a.from);
    setSel(undefined);
    refresh();
  }, mcT('saved'));
  const used = (m: Membership) => sessionsUsed(m, invoices, checkins);
  const due = renewals(all, d);
  const lost = forfeited(all, invoices, checkins, d);
  return (
    <div className={styles.stack}>
      <ClientList />
      <div className={styles.toolbar}>
        <Who v={s.client} on={(client) => setS({ ...s, client })} />
        <T l={mcT('phone')} v={s.phone} on={(phone) => setS({ ...s, phone })} />
        <S l={mcT('plan')} v={plan?.id} o={plans.map((p) => [p.id, p.name] as const)} on={(v) => setS({ ...s, plan: v })} d="mem-plan" />
        <T l={mcT('start')} t="date" v={s.start} on={(start) => setS({ ...s, start })} d="mem-start" />
        <S l={mcT('trainer')} v={s.trainer} o={staffOpts()} on={(trainer) => setS({ ...s, trainer })} />
        {plan?.kind === 'wallet' ? <T l={mcT('topup')} t="number" v={s.topup} on={(topup) => setS({ ...s, topup })} /> : <C l={mcT('autoRenew')} v={s.auto} on={(auto) => setS({ ...s, auto })} />}
        <B p l={mcT('sell')} on={sell} d="mem-sell" dis={!plan} />
      </div>
      <Tbl d="mem-list" h={[mcT('number'), mcT('member'), mcT('plan'), mcT('start'), mcT('end'), mcT('status'), mcT('used'), '']} rows={all.slice(0, 300).map((m) => [
        m.number, m.client_name, m.plan.name, m.start, m.end || '—', <span key="s" data-mem-status={m.number}>{mcT(`s.${statusOf(m, d, used(m))}`)}</span>,
        m.plan.sessions ? `${used(m)} / ${m.plan.sessions}` : m.plan.kind === 'wallet' ? mcT('bonusLeft', { amount: rs(bonusLeft(m)) }) : '',
        <span key="a">{m.invoice_ids[0] && <Link to={`/invoice/${m.invoice_ids[0]}`}>{mcT('bill')}</Link>} <B sm l={mcT('act')} on={() => setSel(m)} d={`mem-act-${m.number}`} /></span>,
      ])} />
      {sel && (
        <div className={styles.toolbar} data-mem-action>
          <strong>{sel.number}</strong>
          <S l={mcT('act')} v={a.act} o={(['freeze', 'unfreeze', 'upgrade', 'transfer', 'cancel', 'renew', ...(sel.plan.kind === 'wallet' ? ['topup'] : [])] as McKey[]).map((k) => [k, mcT(k)] as const)} on={(act) => setA({ ...a, act })} d="mem-act" />
          <T l={mcT('from')} t="date" v={a.from} on={(from) => setA({ ...a, from })} d="mem-from" />
          {a.act === 'freeze' && <T l={mcT('to')} t="date" v={a.to} on={(to) => setA({ ...a, to })} d="mem-to" />}
          {(a.act === 'freeze' || a.act === 'cancel') && <T l={mcT('reason')} v={a.reason} on={(reason) => setA({ ...a, reason })} />}
          {a.act === 'upgrade' && <S l={mcT('plan')} v={a.plan} o={[['', '—'], ...plans.map((p) => [p.id, p.name] as const)]} on={(v) => setA({ ...a, plan: v })} />}
          {a.act === 'transfer' && <Who v={a.client} on={(client) => setA({ ...a, client })} />}
          {(a.act === 'cancel' || a.act === 'topup') && <T l={a.act === 'cancel' ? mcT('refundAmt') : mcT('amount')} t="number" v={a.amount} on={(amount) => setA({ ...a, amount })} />}
          <B p l={mcT('go')} on={act} d="mem-go" />
        </div>
      )}
      <h4>{mcT('renewals')}</h4>
      <Tbl h={[mcT('member'), mcT('plan'), mcT('end'), '']} rows={due.map(({ m }) => [m.client_name, m.plan.name, m.end, <span key="a"><a className={styles.note} target="_blank" rel="noreferrer" href={whatsappLink(m.phone, mcT('waRenew', { name: m.client_name, plan: m.plan.name, number: m.number, date: m.end }))}>{mcT('remind')}</a> <B sm l={mcT('renew')} on={() => attempt(notify, () => { renew(m.id, d); refresh(); }, mcT('saved'))} /></span>])} />
      {!!lost.length && <><h4>{mcT('forfeit')}</h4><Tbl h={[mcT('month'), mcT('number'), mcT('member'), mcT('used'), mcT('amount')]} rows={lost.map((x) => [x.month, x.m.number, x.m.client_name, x.unused, rs(x.value)])} /></>}
    </div>
  );
}

function Checkin({ notify, tick, refresh }: P) {
  /* eslint-disable react-hooks/exhaustive-deps */
  const all = useMemo(() => loadMemberships(), [tick]);
  const days = useMemo(() => loadCheckins(), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const [q, setQ] = useState('');
  const d = today();
  const gate = readServiceSettings().checkin_gate ?? 'warn';
  const invoices = getTable<InvoiceRecord>('invoices');
  const hits = findMembers(q, all).slice(0, 8);
  const line = (m: Membership) => {
    const st = statusOf(m, d, sessionsUsed(m, invoices, days));
    return gateFor(st, gate) === 'block' ? mcT('blocked') : st === 'active' ? mcT('till', { date: m.end || '—' }) : st === 'frozen' ? mcT('frozenNow') : st === 'expired' ? mcT('exp', { n: Math.max(0, daysBetween(m.end || d, d)) }) : mcT(`s.${st}`);
  };
  const go = (m: Membership) => attempt(notify, () => {
    const now = new Date();
    checkIn(m, d, `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, { gate, invoices });
    setQ('');
    refresh();
  }, `${m.client_name}: ${mcT('in')}`);
  const todays = days.find((x) => x.date === d)?.entries ?? [];
  const peak = footfall(days, shiftDay(d, -29), d).byHour.slice(0, 3);
  const cards = () => printPage(labelSheetHtml(all.filter((m) => !m.closed).map((m) => ({ name: m.client_name, code: m.number, note: `${m.plan.name}${m.end ? ` · ${m.end}` : ''}`, copies: 1 })), { layout: layoutById('member-card'), price: 'none', business: localDb.settings.activeProfile()?.companyName }), 'member-cards.html');
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <T l={mcT('code')} v={q} on={setQ} d="checkin-code" />
        <B l={mcT('cards')} on={cards} />
      </div>
      {hits.map((m) => (
        <div key={m.id} className={styles.line}>
          <strong>{m.client_name}</strong><span className={styles.note}>{m.number} · {m.plan.name}</span>
          <span data-checkin-status>{line(m)}</span>
          <B p sm l={mcT('checkIn')} on={() => go(m)} d="checkin-go" />
        </div>
      ))}
      <h4>{mcT('today', { n: todays.length })}</h4>
      <Tbl h={[mcT('time'), mcT('member'), '']} rows={todays.map((e, i) => [e.time, e.name, <B key="u" g sm l={mcT('undo')} on={() => attempt(notify, () => { undoCheckin(d, i); refresh(); })} />])} />
      <p className={styles.note}>{mcT('peak')}: {peak.map(([h, c]) => `${h}:00 (${c})`).join(', ') || '—'}</p>
      <h4>{mcT('notSeen')}</h4>
      <Tbl h={[mcT('member'), mcT('plan'), '']} rows={notSeen(all, days, d).slice(0, 100).map(({ m, last }) => [m.client_name, `${m.plan.name}${last ? ` · ${last}` : ''}`, <a key="w" target="_blank" rel="noreferrer" href={whatsappLink(m.phone, mcT('waRenew', { name: m.client_name, plan: m.plan.name, number: m.number, date: m.end }))}>{mcT('remind')}</a>])} />
    </div>
  );
}

/** Class / batch form (also the Fees → Batches view). */
export function ClassForm({ notify, onSaved, feePlanId, kind = 'class' }: { notify: Notify; onSaved: () => void; feePlanId?: string; kind?: ClassSchedule['kind'] }) {
  const [f, setF] = useState({ name: '', days: [] as number[], start: '06:30', minutes: '60', capacity: '', staff: '', from: '', to: '', holidays: '' });
  const set = (x: Partial<typeof f>) => setF({ ...f, ...x });
  return (
    <div className={styles.toolbar}>
      <T l={mcT('name')} v={f.name} on={(name) => set({ name })} d="class-name" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => <C key={i} l={wd(i)} v={f.days.includes(i)} on={(on) => set({ days: on ? [...f.days, i] : f.days.filter((x) => x !== i) })} />)}
      <T l={mcT('time')} t="time" v={f.start} on={(start) => set({ start })} />
      <T l={mcT('minutes')} t="number" v={f.minutes} on={(minutes) => set({ minutes })} />
      <T l={mcT('capacity')} t="number" v={f.capacity} on={(capacity) => set({ capacity })} />
      <S l={mcT('staff')} v={f.staff} o={staffOpts()} on={(staff) => set({ staff })} />
      <T l={mcT('dateFrom')} t="date" v={f.from} on={(from) => set({ from })} />
      <T l={mcT('dateTo')} t="date" v={f.to} on={(to) => set({ to })} d="class-to" />
      <T l={mcT('holidays')} v={f.holidays} on={(holidays) => set({ holidays })} />
      <B p l={mcT('save')} d="class-save" on={() => attempt(notify, () => {
        saveClass({ name: f.name, kind, days: f.days, start: f.start, minutes: Number(f.minutes) || 60, capacity: n(f.capacity), staff_id: f.staff || undefined, from: f.from || undefined, to: f.to || undefined, holidays: list(f.holidays), ...(feePlanId ? { fee_plan_id: feePlanId } : {}), active: true });
        onSaved();
      }, mcT('saved'))} />
    </div>
  );
}

/** Week timetable: one column per weekday. */
export function Timetable({ classes }: { classes: readonly ClassSchedule[] }) {
  return <Tbl d="timetable" h={[0, 1, 2, 3, 4, 5, 6].map(wd)} rows={[[0, 1, 2, 3, 4, 5, 6].map((i) => classes.filter((c) => c.days.includes(i)).sort((a, b) => a.start.localeCompare(b.start)).map((c) => `${c.start} ${c.name}`).join(' · '))]} />;
}

function Classes({ notify, tick, refresh }: P) {
  const classes = useMemo(() => loadClasses().filter((c) => c.kind === 'class'), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState<Record<string, string>>({});
  const name = (id: string) => localDb.clients.getById(id)?.name ?? id;
  return (
    <div className={styles.stack}>
      <ClassForm notify={notify} onSaved={refresh} />
      <h4>{mcT('timetable')}</h4>
      <Timetable classes={classes} />
      {classes.map((c) => (
        <div key={c.id} className={styles.line}>
          <strong>{c.name}</strong>
          <span className={styles.note}>{c.start} · {mcT('members')} {(c.members ?? []).map(name).join(', ') || '—'}{c.capacity ? ` (${c.members?.length ?? 0}/${c.capacity})` : ''}{c.waitlist?.length ? ` · ${mcT('waitlist')}: ${c.waitlist.map(name).join(', ')}` : ''}</span>
          <input className={controls.input} list="mc-clients" value={pick[c.id] ?? ''} onChange={(e) => setPick({ ...pick, [c.id]: e.target.value })} aria-label={mcT('member')} />
          <B sm l={mcT('enrol')} on={() => attempt(notify, () => { const cl = clientByName(pick[c.id] ?? ''); if (!cl) throw new Error(mcT('member')); notify(mcT(enrolMember(c.id, cl.id!) === 'member' ? 'members' : 'waitlist')); refresh(); })} />
          {(c.members ?? []).slice(-1).map((id) => <B key={id} g sm l={`− ${name(id)}`} on={() => attempt(notify, () => { dropMember(c.id, id); refresh(); })} />)}
          <B g sm l={mcT('del')} on={() => attempt(notify, () => { deleteClass(c.id); refresh(); })} />
        </div>
      ))}
      <ClientList />
    </div>
  );
}

function Recipes() {
  const [month, setMonth] = useState(today().slice(0, 7));
  const staff = loadStaff();
  const r = useMemo(() => recipeReport(getTable<InvoiceRecord>('invoices'), getTable<StockItem>('stock_items'), getTable<Bom>('boms'), month, (id) => staff.find((s) => s.id === id)?.name ?? '—'), [month]); // eslint-disable-line react-hooks/exhaustive-deps
  const h = (k: McKey) => [mcT(k), mcT('qty'), mcT('cost'), mcT('revenue')];
  const rows = (x: typeof r.product) => x.map((y) => [y.key, y.qty, rs(y.cost), y.revenue ? rs(y.revenue) : '']);
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <T l={mcT('month')} t="month" v={month} on={setMonth} />
        <B l={mcT('csv')} on={() => csv(`recipes-${month}.csv`, toCsv([h('product'), ...rows(r.product), [], h('service'), ...rows(r.service), [], h('staff'), ...rows(r.staff)]))} />
      </div>
      {(['product', 'service', 'staff'] as const).map((k) => <Tbl key={k} h={h(k)} rows={rows(r[k])} />)}
      <p className={styles.note}>{mcT('recipesNote')}</p>
    </div>
  );
}
