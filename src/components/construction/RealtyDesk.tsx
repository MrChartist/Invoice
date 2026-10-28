/**
 * CN-C builder desk (Receivables → Realty, pack `realty`) — ONE lazy chunk with eight views: projects (RERA, towers,
 * completion certificate), units (grid by tower and floor, bulk add, CSV), bookings (cost sheet, receipts, 10% / 194-IA
 * guards, allotment letter), plans (and builder settings), demands (stage certificates → demand run, ageing,
 * WhatsApp), RERA account (70% statement, withdrawals, QPR / year CSV), cancellations and the 80% procurement test.
 * Working papers — verify with your CA (CN18–CN25).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Building2, CalendarDays, ClipboardList, FileText, Landmark, Receipt, Scale, XCircle } from 'lucide-react';
import { useT } from '../../i18n';
import { rcT, type RcKey } from '../../i18n/areas/construction-r11c';
import type { CostHead, PaymentPlan, RealtyProject, RealtyUnit, RealtyUnitType } from '../../types/construction-r11';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { INDIAN_STATES } from '../../lib/india-states';
import { bankAccountsDb } from '../../lib/bank-accounts';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { formatCurrency, todayInput } from '../../lib/utils';
import { downloadText } from '../../lib/download';
import { printHtmlDocument } from '../../lib/voucher-print';
import { loadAdvances } from '../../lib/advances';
import { deleteProject, loadProjects, saveProject } from '../../lib/construction/cn-realty-projects';
import { addUnits, deleteUnit, loadUnits, saveUnit, unitPrice, unitsCsv } from '../../lib/construction/cn-units';
import { certifyStage, deleteCert, deletePlan, loadCerts, loadPlans, parseStages, planTotal, savePlan } from '../../lib/construction/cn-plans';
import { agreementValue, bookingTds, createBooking, defaultCostSheet, deleteBooking, live, loadBookings, receivedFor, recordReceipt, setBookingStatus, setInterestWaived } from '../../lib/construction/cn-bookings';
import { candidates, demandAgeing, demandText, raiseDemands } from '../../lib/construction/cn-demands';
import { collections, deleteReraEntry, loadReraEntries, qprCsv, reraStatement, saveReraEntry, statementCsv, withdrawalWarnings } from '../../lib/construction/cn-rera';
import { cancelBooking, proposal } from '../../lib/construction/cn-cancellations';
import { bookRcmDraft, procurement80 } from '../../lib/construction/cn-procurement80';
import { allotmentHtml, cancellationHtml } from '../../lib/construction/cn-allotment-print';
import { preAgreementWarning } from '../../lib/construction/cn-realty-tax';
import { readConstructionSettings, saveConstructionSettings } from '../../lib/construction/cn-settings';
import { purchasesDb } from '../../lib/purchases';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { fyStartYear } from '../../lib/day-math';

type Done = (msg: string, tone?: 'success' | 'error') => void;
const VIEWS = [['projects', Building2], ['units', ClipboardList], ['bookings', FileText], ['plans', CalendarDays], ['demands', Receipt], ['rera', Landmark], ['cancellations', XCircle], ['procurement', Scale]] as const;
const sm = `${controls.btnOutline} ${controls.btnSm}`;
const T = (k: RcKey, v?: Record<string, string | number>) => rcT(k, v);
const rs = (n: number) => formatCurrency(n);
const row = { flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' } as const;
const BADGE: Record<string, string> = { available: surface.badgePaid, hold: surface.badgePartial, booked: surface.badgeSent, registered: surface.badgeDraft, cancelled: surface.badgeCancelled };
const company = () => localDb.settings.activeProfile()?.companyName ?? '';
const print = (html: string, name: string) => printHtmlDocument(html, (h) => downloadText(name, h, 'text/html'));
const csv = (name: string, text: string) => downloadText(name, `\uFEFF${text}`, 'text/csv');
const fyOf = fyStartYear;

const F = ({ l, w, children }: { l: string; w?: number; children: ReactNode }) => <label className={controls.field} style={w ? { maxWidth: w } : undefined}><span className={controls.label}>{l}</span>{children}</label>;
const Txt = ({ l, v, set, w, type = 'text', d }: { l: string; v: string; set: (s: string) => void; w?: number; type?: string; d?: string }) => <F l={l} w={w}><input type={type} className={controls.input} value={v} onChange={(e) => set(e.target.value)} data-rc={d} /></F>;
const Num = ({ l, v, set, w = 130, d }: { l: string; v: number; set: (n: number) => void; w?: number; d?: string }) => <F l={l} w={w}><NumberInput className={controls.input} value={v} onChange={set} data-rc={d} /></F>;
function Sel<K extends string>({ l, v, set, o, w, d }: { l: string; v: K; set: (k: K) => void; o: readonly (readonly [K, string])[]; w?: number; d?: string }) {
  return <F l={l} w={w}><select className={controls.select} value={v} onChange={(e) => set(e.target.value as K)} data-rc={d}>{o.map(([k, s]) => <option key={k} value={k}>{s}</option>)}</select></F>;
}
const Table = ({ head, rows, d }: { head: string[]; rows: ReactNode[][]; d?: string }) => rows.length ? (
  <div className={surface.tableWrap}><table className={surface.table} data-rc-table={d}><thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
) : <p className={controls.hint}>{T('none')}</p>;

function useRun(onDone: Done) {
  const [tick, setTick] = useState(0);
  return [tick, (fn: () => string | void) => {
    try {
      const m = fn();
      if (m) onDone(m, 'success');
      setTick((t) => t + 1);
    } catch (e) {
      onDone((e as Error).message, 'error');
    }
  }] as const;
}

export default function RealtyDesk({ onDone }: { onDone: Done }) {
  useT();
  const [params] = useSearchParams();
  const v = VIEWS.find(([id]) => id === params.get('view'))?.[0] ?? 'projects';
  const [tick, run] = useRun(onDone);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const projects = useMemo(() => loadProjects(), [tick]);
  const [pid, setPid] = useState('');
  const project = projects.find((p) => p.id === pid) ?? projects[0];
  const body = { run, tick, project, projects };
  return (
    <section data-realty-desk={v}>
      <div className={surface.cardHead}>
        <span className={controls.segment}>
          {VIEWS.map(([id, Icon]) => <Link key={id} to={`/receivables?tab=realty&view=${id}`} className={id === v ? `${controls.segmentBtn} ${controls.segmentBtnActive}` : controls.segmentBtn}><Icon size={14} aria-hidden="true" /> {T(`v.${id}`)}</Link>)}
        </span>
        {v !== 'projects' && v !== 'plans' && projects.length > 1 && <Sel l={T('project')} v={project?.id ?? ''} set={setPid} o={projects.map((p) => [p.id, p.name] as const)} w={220} />}
      </div>
      <div className={surface.cardBody}>
        {v === 'projects' ? <Projects {...body} /> : v === 'plans' ? <Plans {...body} /> : !project ? <p className={controls.hint}>{T('none')}</p>
          : v === 'units' ? <Units {...body} p={project} /> : v === 'bookings' ? <Bookings {...body} p={project} /> : v === 'demands' ? <Demands {...body} p={project} />
          : v === 'rera' ? <Rera {...body} p={project} /> : v === 'cancellations' ? <Cancels {...body} p={project} /> : <Procurement {...body} p={project} />}
        <p className={controls.hint}>{T('wp')}</p>
      </div>
    </section>
  );
}

type Body = { run: (fn: () => string | void) => void; tick: number; projects: RealtyProject[] };
type PBody = Body & { p: RealtyProject };
const banks = () => [['', '—'] as const, ...bankAccountsDb.active().map((a) => [a.id, a.name] as const)];

/* ── C1 projects ── */
type PForm = { id?: string; name: string; rera_no: string; rera_valid_till: string; rera_account_id: string; collection_account_id: string; state_code: string; city_class: RealtyProject['city_class']; gst_scheme: RealtyProject['gst_scheme']; old_rate: number; cc_date: string; oc_date: string; towers: string };
const BLANK_P: PForm = { name: '', rera_no: '', rera_valid_till: '', rera_account_id: '', collection_account_id: '', state_code: '27', city_class: 'other', gst_scheme: 'n03_2019', old_rate: 12, cc_date: '', oc_date: '', towers: 'A:10' };
function Projects({ run, projects }: Body) {
  const [f, setF] = useState<PForm>(BLANK_P);
  const set = (k: keyof PForm) => (x: string | number) => setF({ ...f, [k]: x });
  const load = (p: RealtyProject) => setF({ ...BLANK_P, ...p, old_rate: p.old_rate ?? 12, towers: p.towers.map((t) => `${t.name}:${t.floors}:${t.completion_pct ?? 0}`).join(', ') } as never);
  const save = () => run(() => {
    const prev = projects.find((p) => p.id === f.id);
    const towers = f.towers.split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
      const [name, floors, pct] = s.split(':').map((x) => x.trim());
      return { id: prev?.towers.find((t) => t.name === name)?.id, name, floors: num(floors), completion_pct: num(pct) };
    });
    const clean = (s: string) => s.trim() || undefined;
    saveProject({ ...f, towers, rera_no: clean(f.rera_no), rera_valid_till: clean(f.rera_valid_till), rera_account_id: clean(f.rera_account_id), collection_account_id: clean(f.collection_account_id), cc_date: clean(f.cc_date), oc_date: clean(f.oc_date) } as never);
    setF(BLANK_P);
  });
  return (
    <>
      <Table d="projects" head={[T('name'), T('reraNo'), T('v.units'), T('cc'), '']} rows={projects.map((p) => [p.name, p.rera_no ?? '', p.towers.map((t) => t.name).join(', '), p.cc_date ?? '', <span key="a"><button type="button" className={sm} onClick={() => load(p)}>{T('edit')}</button> <button type="button" className={sm} onClick={() => run(() => deleteProject(p.id))}>{T('del')}</button></span>])} />
      <div className={controls.row} style={row} data-rc-project-form>
        <Txt l={T('name')} v={f.name} set={set('name')} w={220} d="p-name" />
        <Txt l={T('reraNo')} v={f.rera_no} set={set('rera_no')} w={170} d="p-rera" />
        <Txt l={T('reraTill')} v={f.rera_valid_till} set={set('rera_valid_till')} type="date" w={160} />
        <Sel l={T('state')} v={f.state_code} set={set('state_code')} o={INDIAN_STATES.map((s) => [s.code, s.name] as const)} w={180} />
        <Sel l={T('city')} v={f.city_class} set={set('city_class')} o={(['metro', 'other'] as const).map((k) => [k, T(`city.${k}`)] as const)} w={200} />
        <Sel l={T('scheme')} v={f.gst_scheme} set={set('gst_scheme')} o={(['n03_2019', 'old_option'] as const).map((k) => [k, T(`scheme.${k}`)] as const)} w={240} />
        {f.gst_scheme === 'old_option' && <Num l={T('oldRate')} v={f.old_rate} set={set('old_rate')} w={110} />}
        <Sel l={T('reraAcc')} v={f.rera_account_id} set={set('rera_account_id')} o={banks()} w={200} d="p-rera-acc" />
        <Sel l={T('collAcc')} v={f.collection_account_id} set={set('collection_account_id')} o={banks()} w={200} />
        <Txt l={T('towers')} v={f.towers} set={set('towers')} w={260} d="p-towers" />
        <Txt l={T('cc')} v={f.cc_date} set={set('cc_date')} type="date" w={170} d="p-cc" />
        <Txt l={T('oc')} v={f.oc_date} set={set('oc_date')} type="date" w={170} />
        <button type="button" className={controls.btnPrimary} onClick={save} data-rc-save-project>{T('save')}</button>
      </div>
      <p className={controls.hint}>{T('ccNote')}</p>
    </>
  );
}

/* ── C1 units ── */
function Units({ run, tick, p }: PBody) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const units = useMemo(() => loadUnits().filter((u) => u.project_id === p.id), [tick, p.id]);
  const [b, setB] = useState({ tower_id: p.towers[0]?.id ?? '', floors: 1, from: 1, perFloor: 4, type: 'residential' as RealtyUnitType, carpet_sqm: 0, saleable_sqft: 0, base_rate: 0 });
  const tower = (id: string) => p.towers.find((t) => t.id === id)?.name ?? '';
  const toggle = (u: RealtyUnit) => (u.status === 'available' || u.status === 'hold') && run(() => { saveUnit({ ...u, status: u.status === 'hold' ? 'available' : 'hold' }); });
  return (
    <>
      {p.towers.map((tw) => {
        const us = units.filter((u) => u.tower_id === tw.id);
        const floors = [...new Set(us.map((u) => u.floor))].sort((a, c) => c - a);
        return us.length > 0 && (
          <div key={tw.id}>
            <h4>{T('tower')} {tw.name}</h4>
            <Table d="units" head={[T('floor'), T('v.units')]} rows={floors.map((fl) => [fl, <span key="u" className={controls.row} style={row}>{us.filter((u) => u.floor === fl).map((u) => <button key={u.id} type="button" className={`${surface.badge} ${BADGE[u.status]}`} onClick={() => toggle(u)} title={`${T(`st.${u.status}`)} · ${rs(unitPrice(u))}`} data-rc-unit={u.unit_no}>{u.unit_no}</button>)}</span>])} />
          </div>
        );
      })}
      <p className={controls.hint}>{T('holdHint')}</p>
      <div className={controls.row} style={row} data-rc-bulk>
        <Sel l={T('tower')} v={b.tower_id} set={(x) => setB({ ...b, tower_id: x })} o={p.towers.map((t) => [t.id, t.name] as const)} w={110} />
        <Num l={T('floors')} v={b.floors} set={(x) => setB({ ...b, floors: x })} w={90} d="b-floors" />
        <Num l={T('fromFloor')} v={b.from} set={(x) => setB({ ...b, from: x })} w={90} />
        <Num l={T('perFloor')} v={b.perFloor} set={(x) => setB({ ...b, perFloor: x })} w={110} d="b-per" />
        <Sel l={T('type')} v={b.type} set={(x) => setB({ ...b, type: x })} o={(['residential', 'commercial', 'parking', 'plot'] as const).map((k) => [k, T(`t.${k}`)] as const)} w={140} />
        <Num l={T('carpet')} v={b.carpet_sqm} set={(x) => setB({ ...b, carpet_sqm: x })} w={110} d="b-carpet" />
        <Num l={T('saleable')} v={b.saleable_sqft} set={(x) => setB({ ...b, saleable_sqft: x })} w={120} />
        <Num l={T('rate')} v={b.base_rate} set={(x) => setB({ ...b, base_rate: x })} w={120} d="b-rate" />
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => { addUnits({ ...b, project_id: p.id, tower: tower(b.tower_id) }); })} data-rc-add-units>{T('bulk')}</button>
        <button type="button" className={sm} onClick={() => csv(`units-${p.name}.csv`, unitsCsv(units, tower))}>{T('csv')}</button>
      </div>
      {units.filter((u) => u.status === 'available').length > 0 && <p className={controls.hint}>{units.filter((u) => u.status === 'available').map((u) => <button key={u.id} type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(() => deleteUnit(u.id))}>{T('del')} {u.unit_no}</button>)}</p>}
    </>
  );
}

/* ── C2 bookings ── */
const ctx = () => ({ advances: loadAdvances(), payments: getTable<Payment>('transactions'), invoices: localDb.invoices.getAll() });
function Bookings({ run, tick, p }: PBody) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const data = useMemo(() => ({ units: loadUnits().filter((u) => u.project_id === p.id), bookings: loadBookings().filter((b) => b.project_id === p.id), plans: loadPlans(), clients: localDb.clients.getAll(), ...ctx() }), [tick, p.id]);
  const free = data.units.filter((u) => u.status === 'available' || u.status === 'hold');
  const [f, setF] = useState({ unit_id: '', client_id: '', name: '', co: '', plan_id: '', date: todayInput(), stamp: 0 });
  const unit = free.find((u) => u.id === f.unit_id) ?? free[0];
  const [sheet, setSheet] = useState<CostHead[] | null>(null);
  const heads = sheet ?? (unit ? defaultCostSheet(unit) : []);
  const [r, setR] = useState({ booking: '', amount: 0, date: todayInput(), method: 'Bank transfer', bank: '', pt: false, payer: '' });
  const book = () => run(() => {
    const c = data.clients.find((x) => x.id === f.client_id);
    const b = createBooking({ date: f.date, unit_id: unit?.id ?? '', client_id: c?.id, client_name: c?.name ?? f.name, co_applicants: f.co || undefined, cost_sheet: heads, stamp_value: f.stamp || undefined, plan_id: f.plan_id || data.plans[0]?.id || '' });
    setSheet(null);
    return T('booked', { n: b.number });
  });
  const receipt = () => run(() => {
    const out = recordReceipt(r.booking || data.bookings.find(live)?.id || '', { date: r.date, amount: r.amount, method: r.method, bankAccountId: r.bank || undefined, passThrough: r.pt, payer: r.payer });
    return `${T('recorded', { n: out.advance.number })}${out.warn10 ? ` ${T('warn10')}` : ''}`;
  });
  const acc = bankAccountsDb.all().find((a) => a.id === (p.rera_account_id || p.collection_account_id));
  return (
    <>
      <Table d="bookings" head={[T('v.bookings'), T('unit'), T('buyer'), T('cls'), T('agreement'), T('received'), T('status'), '']} rows={data.bookings.map((b) => {
        const rec = receivedFor(b.id, data.advances, data.payments, data.invoices);
        const tds = bookingTds(b, todayInput());
        const warn = live(b) && preAgreementWarning(rec.consideration, b.agreement_value, b.registered_on, todayInput());
        const u = data.units.find((x) => x.id === b.unit_id);
        const st = (s: 'agreement' | 'registered' | 'possession', k: RcKey) => <button type="button" className={sm} onClick={() => run(() => { setBookingStatus(b.id, s, todayInput()); })}>{T(k)}</button>;
        return [b.number, u?.unit_no ?? '', b.client_name, T(`cls.${b.cls}`), rs(b.agreement_value), <span key="r">{rs(rec.consideration)}{warn && <><br /><small data-rc-warn10>{T('warn10')}</small></>}{tds.applies && live(b) && <><br /><small data-rc-tds>{T('tds', { rate: tds.rate, section: tds.section })}</small></>}</span>, T(`st.${b.status}`),
          live(b) ? <span key="a" className={controls.row} style={row}>{b.status === 'booked' && st('agreement', 'toAgreement')}{(b.status === 'booked' || b.status === 'agreement') && st('registered', 'toRegistered')}{b.status === 'registered' && st('possession', 'toPossession')}
            <button type="button" className={sm} onClick={() => run(() => setInterestWaived(b.id, !b.interest_waived))}>{T(b.interest_waived ? 'unwaive' : 'waive')}</button>
            <button type="button" className={sm} onClick={() => print(allotmentHtml(b, u, p, data.plans.find((x) => x.id === b.plan_id), acc, company(), readConstructionSettings().realty?.terms), `${b.number}.html`)}>{T('allotment')}</button>
            <button type="button" className={sm} onClick={() => run(() => deleteBooking(b.id))}>{T('del')}</button></span> : ''];
      })} />
      <h4>{T('book')}</h4>
      <div className={controls.row} style={row} data-rc-book>
        <Sel l={T('unit')} v={unit?.id ?? ''} set={(x) => { setF({ ...f, unit_id: x }); setSheet(null); }} o={free.map((u) => [u.id, `${u.unit_no} · ${rs(unitPrice(u))}`] as const)} w={200} d="k-unit" />
        <Sel l={T('buyer')} v={f.client_id} set={(x) => setF({ ...f, client_id: x })} o={[['', '—'] as const, ...data.clients.map((c) => [c.id ?? '', c.name] as const)]} w={200} d="k-client" />
        {!f.client_id && <Txt l={T('name')} v={f.name} set={(x) => setF({ ...f, name: x })} w={180} d="k-name" />}
        <Txt l={T('coApp')} v={f.co} set={(x) => setF({ ...f, co: x })} w={180} />
        <Sel l={T('plan')} v={f.plan_id || data.plans[0]?.id || ''} set={(x) => setF({ ...f, plan_id: x })} o={data.plans.map((x) => [x.id, x.name] as const)} w={180} />
        <Txt l={T('date')} v={f.date} set={(x) => setF({ ...f, date: x })} type="date" w={160} d="k-date" />
        <Num l={T('stamp')} v={f.stamp} set={(x) => setF({ ...f, stamp: x })} />
      </div>
      <div className={controls.row} style={row} data-rc-sheet>
        {heads.map((h, i) => <Num key={h.head} l={`${h.head}${h.pass_through ? ` (${T('passThrough')})` : ''}`} v={h.amount} set={(x) => setSheet(heads.map((y, j) => (j === i ? { ...y, amount: x } : y)))} w={170} d={`h-${h.head}`} />)}
        <span>{T('agreement')}: <strong>{rs(agreementValue(heads))}</strong></span>
        <button type="button" className={controls.btnPrimary} onClick={book} data-rc-book-save>{T('book')}</button>
      </div>
      <h4>{T('receipt')}</h4>
      <div className={controls.row} style={row} data-rc-receipt>
        <Sel l={T('v.bookings')} v={r.booking} set={(x) => setR({ ...r, booking: x })} o={data.bookings.filter(live).map((b) => [b.id, `${b.number} · ${b.client_name}`] as const)} w={220} />
        <Num l={T('amount')} v={r.amount} set={(x) => setR({ ...r, amount: x })} d="r-amount" />
        <Txt l={T('date')} v={r.date} set={(x) => setR({ ...r, date: x })} type="date" w={160} d="r-date" />
        <Txt l={T('method')} v={r.method} set={(x) => setR({ ...r, method: x })} w={150} />
        <Sel l={T('bank')} v={r.bank} set={(x) => setR({ ...r, bank: x })} o={banks()} w={180} />
        <Txt l={T('payer')} v={r.payer} set={(x) => setR({ ...r, payer: x })} w={180} />
        <label className={controls.row}><input type="checkbox" checked={r.pt} onChange={(e) => setR({ ...r, pt: e.target.checked })} /> {T('ptReceipt')}</label>
        <button type="button" className={controls.btnPrimary} onClick={receipt} data-rc-receipt-save>{T('save')}</button>
      </div>
    </>
  );
}

/* ── C3 plans + builder settings ── */
function Plans({ run, tick }: Body) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const plans = useMemo(() => loadPlans(), [tick]);
  const [f, setF] = useState({ name: '', kind: 'clp' as PaymentPlan['kind'], stages: 'Booking 10, Agreement 10, Plinth 15, 1st slab 15, 2nd slab 15, 3rd slab 15, Possession 20' });
  const [s, setS] = useState(() => ({ interest_rate: 0, forfeit_pct: 0, forfeit_amount: 0, terms: '', ...readConstructionSettings().realty }));
  return (
    <>
      <Table d="plans" head={[T('name'), T('kind'), T('stages'), '']} rows={plans.map((x) => [x.name, T(`k.${x.kind}`), x.stages.map((st) => `${st.label} ${st.pct}%`).join(', '), <button key="d" type="button" className={sm} onClick={() => run(() => deletePlan(x.id))}>{T('del')}</button>])} />
      <div className={controls.row} style={row} data-rc-plan>
        <Txt l={T('name')} v={f.name} set={(x) => setF({ ...f, name: x })} w={180} d="plan-name" />
        <Sel l={T('kind')} v={f.kind} set={(x) => setF({ ...f, kind: x })} o={(['clp', 'time', 'down_payment', 'subvention'] as const).map((k) => [k, T(`k.${k}`)] as const)} w={180} />
        <Txt l={`${T('stages')} = ${planTotal(parseStages(f.stages))}%`} v={f.stages} set={(x) => setF({ ...f, stages: x })} w={460} d="plan-stages" />
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => { savePlan({ name: f.name, kind: f.kind, stages: parseStages(f.stages) }); })} data-rc-plan-save>{T('save')}</button>
      </div>
      <h4>{T('settings')}</h4>
      <div className={controls.row} style={row}>
        <Num l={T('interest')} v={s.interest_rate ?? 0} set={(x) => setS({ ...s, interest_rate: x })} w={260} />
        <Num l={T('forfeitPct')} v={s.forfeit_pct ?? 0} set={(x) => setS({ ...s, forfeit_pct: x })} w={170} />
        <Num l={T('forfeitAmt')} v={s.forfeit_amount ?? 0} set={(x) => setS({ ...s, forfeit_amount: x })} w={170} />
        <Txt l={T('terms')} v={s.terms ?? ''} set={(x) => setS({ ...s, terms: x })} w={360} />
        <button type="button" className={sm} onClick={() => run(() => { saveConstructionSettings({ realty: s }); })}>{T('save')}</button>
      </div>
    </>
  );
}

/* ── C3 demands ── */
function Demands({ run, tick, p }: PBody) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const certs = useMemo(() => loadCerts().filter((c) => c.project_id === p.id), [tick, p.id]);
  const labels = [...new Set(loadPlans().flatMap((x) => x.stages.map((s) => s.label)))];
  const [f, setF] = useState({ tower_id: p.towers[0]?.id ?? '', label: '', on: todayInput(), by: '', ref: '' });
  const [made, setMade] = useState<InvoiceRecord[]>([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => localDb.invoices.getAll(), [tick]);
  const raise = (id: string) => run(() => {
    const out = raiseDemands(id, todayInput() < (certs.find((c) => c.id === id)?.certified_on ?? '') ? certs.find((c) => c.id === id)!.certified_on : todayInput());
    setMade(out);
    return T('raised', { n: out.length });
  });
  const wa = (i: InvoiceRecord) => `https://wa.me/${String(i.client?.phone ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(demandText(i, rs))}`;
  return (
    <>
      <h4>{T('certify')}</h4>
      <div className={controls.row} style={row} data-rc-certify>
        <Sel l={T('tower')} v={f.tower_id} set={(x) => setF({ ...f, tower_id: x })} o={p.towers.map((t) => [t.id, t.name] as const)} w={110} />
        <Sel l={T('stage')} v={f.label || labels[0] || ''} set={(x) => setF({ ...f, label: x })} o={labels.map((l) => [l, l] as const)} w={180} d="c-stage" />
        <Txt l={T('date')} v={f.on} set={(x) => setF({ ...f, on: x })} type="date" w={160} d="c-date" />
        <Txt l={T('by')} v={f.by} set={(x) => setF({ ...f, by: x })} w={180} />
        <Txt l={T('ref')} v={f.ref} set={(x) => setF({ ...f, ref: x })} w={150} />
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => { certifyStage({ project_id: p.id, tower_id: f.tower_id, stage_id: '', stage_label: f.label || labels[0] || '', certified_on: f.on, by: f.by, ref: f.ref }); })} data-rc-certify-save>{T('save')}</button>
      </div>
      <Table d="certs" head={[T('stage'), T('tower'), T('date'), T('by'), '']} rows={certs.map((c) => {
        const n = candidates(c, invoices).filter((x) => !x.done).length;
        return [c.stage_label, p.towers.find((t) => t.id === c.tower_id)?.name ?? '', c.certified_on, `${c.by}${c.ref ? ` (${c.ref})` : ''}`, <span key="a">{n > 0 && <button type="button" className={controls.btnPrimary} onClick={() => raise(c.id)} data-rc-raise>{T('raise', { n })}</button>} <button type="button" className={sm} onClick={() => run(() => deleteCert(c.id))}>{T('del')}</button></span>];
      })} />
      {made.length > 0 && <Table d="made" head={[T('v.demands'), T('unit'), T('amount'), '']} rows={made.map((i) => [<Link key="l" to={`/invoice/${i.id}`}>{i.boq_terms?.cn?.demand?.number} · {i.invoice_number}</Link>, i.boq_terms?.cn?.demand?.unit ?? '', rs(i.total), <a key="w" href={wa(i)} target="_blank" rel="noopener noreferrer">{T('share')}</a>])} />}
      <h4>{T('ageing')}</h4>
      <Table d="ageing" head={[T('v.bookings'), T('unit'), T('tower'), T('open'), T('b0'), T('b1'), T('b2'), T('b3')]} rows={demandAgeing(invoices.filter((i) => i.boq_terms?.cn?.demand?.project === p.name), todayInput()).map((a) => [a.booking, a.unit, a.tower, rs(a.open), ...a.buckets.map(rs)])} />
    </>
  );
}

/* ── C4 RERA ── */
function Rera({ run, tick, p }: PBody) {
  const d = useMemo(() => {
    const c = ctx();
    const cols = collections(p, loadBookings(), c.advances, c.payments, c.invoices);
    const entries = loadReraEntries();
    return { cols, entries, st: reraStatement(p, cols, entries) };
  }, [tick, p]); // eslint-disable-line react-hooks/exhaustive-deps
  const [w, setW] = useState({ kind: 'withdrawal' as 'withdrawal' | 'deposit', date: todayInput(), amount: 0, pct: 0, purpose: 'construction' as 'land' | 'construction', eng: '', arch: '', ca: '' });
  const certs = { engineer: { name: '', ref: w.eng, date: w.date }, architect: { name: '', ref: w.arch, date: w.date }, ca: { name: '', ref: w.ca, date: w.date } };
  const warns = w.kind === 'withdrawal' && w.amount > 0 ? withdrawalWarnings(p, d.cols, d.entries, { amount: w.amount, completion_pct: w.pct, certificates: certs }) : [];
  const [fy, setFy] = useState(fyOf(todayInput()));
  const inFy = d.st.filter((m) => fyOf(`${m.month}-01`) === fy);
  return (
    <>
      <Table d="rera" head={[T('month'), T('collected'), T('required'), T('deposited'), T('withdrawn'), T('shortfall'), T('balance')]} rows={d.st.map((m) => [m.month, rs(m.collected), rs(m.required), rs(m.deposited), rs(m.withdrawn), rs(m.shortfall), rs(m.balance)])} />
      <div className={controls.row} style={row} data-rc-rera-entry>
        <Sel l={T('entry')} v={w.kind} set={(x) => setW({ ...w, kind: x })} o={(['withdrawal', 'deposit'] as const).map((k) => [k, T(`e.${k}`)] as const)} w={150} />
        <Txt l={T('date')} v={w.date} set={(x) => setW({ ...w, date: x })} type="date" w={160} />
        <Num l={T('amount')} v={w.amount} set={(x) => setW({ ...w, amount: x })} />
        {w.kind === 'withdrawal' && <>
          <Num l={T('completion')} v={w.pct} set={(x) => setW({ ...w, pct: x })} w={110} />
          <Sel l={T('purpose')} v={w.purpose} set={(x) => setW({ ...w, purpose: x })} o={(['construction', 'land'] as const).map((k) => [k, T(`p.${k}`)] as const)} w={140} />
          <Txt l={T('engineer')} v={w.eng} set={(x) => setW({ ...w, eng: x })} w={150} />
          <Txt l={T('architect')} v={w.arch} set={(x) => setW({ ...w, arch: x })} w={150} />
          <Txt l={T('ca')} v={w.ca} set={(x) => setW({ ...w, ca: x })} w={150} />
        </>}
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => { saveReraEntry({ project_id: p.id, date: w.date, amount: w.amount, kind: w.kind, ...(w.kind === 'withdrawal' ? { completion_pct: w.pct, purpose: w.purpose, certificates: certs } : {}) }); })}>{T('save')}</button>
      </div>
      {warns.map((k) => <p key={k} className={controls.hint} data-rc-rera-warn={k}>{T(`w.${k}`)}</p>)}
      <Table d="rera-entries" head={[T('date'), T('entry'), T('amount'), T('completion'), '']} rows={d.entries.filter((e) => e.project_id === p.id).map((e) => [e.date, T(`e.${e.kind ?? 'withdrawal'}`), rs(e.amount), e.completion_pct ?? '', <button key="d" type="button" className={sm} onClick={() => run(() => deleteReraEntry(e.id))}>{T('del')}</button>])} />
      <div className={controls.row} style={row}>
        <button type="button" className={sm} onClick={() => csv(`qpr-${p.name}.csv`, qprCsv(p, loadUnits().filter((u) => u.project_id === p.id), loadBookings(), d.cols, d.st))}>{T('qpr')}</button>
        <Num l={T('fy')} v={fy} set={setFy} w={100} />
        <button type="button" className={sm} onClick={() => csv(`rera-${p.name}-FY${fy}.csv`, statementCsv(inFy))}>{T('yearCsv')}</button>
      </div>
    </>
  );
}

/* ── C5 cancellations ── */
function Cancels({ run, tick, p }: PBody) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bookings = useMemo(() => loadBookings().filter((b) => b.project_id === p.id), [tick, p.id]);
  const [f, setF] = useState({ id: '', date: todayInput(), reason: '' });
  const b = bookings.filter(live).find((x) => x.id === f.id) ?? bookings.filter(live)[0];
  const s = readConstructionSettings().realty ?? {};
  const pr = b && proposal(b, f.date, { ...ctx(), forfeitPct: s.forfeit_pct, forfeitAmount: s.forfeit_amount });
  return (
    <>
      <div className={controls.row} style={row} data-rc-cancel>
        <Sel l={T('v.bookings')} v={b?.id ?? ''} set={(x) => setF({ ...f, id: x })} o={bookings.filter(live).map((x) => [x.id, `${x.number} · ${x.client_name}`] as const)} w={240} />
        <Txt l={T('date')} v={f.date} set={(x) => setF({ ...f, date: x })} type="date" w={160} />
        <Txt l={T('reason')} v={f.reason} set={(x) => setF({ ...f, reason: x })} w={240} />
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => { const c = cancelBooking(b?.id ?? '', f.date, f.reason).cancellation!; return T('cancelled', { n: b!.number, x: rs(c.refund), p: rs(c.refund_pending ?? 0) }); })}>{T('cancel')}</button>
      </div>
      {pr && <p className={controls.hint} data-rc-proposal>{T('proposal', { r: rs(pr.received), f: rs(pr.forfeiture), t: rs(pr.taxRetained), x: rs(pr.refund) })} {T(pr.path === 'credit_note' ? 'cnPath' : 'netPath')}</p>}
      <Table d="cancelled" head={[T('v.bookings'), T('buyer'), T('date'), T('amount'), '']} rows={bookings.filter((x) => x.cancellation).map((x) => [x.number, x.client_name, x.cancellation!.date, rs(x.cancellation!.refund), <button key="p" type="button" className={sm} onClick={() => print(cancellationHtml(x, company()), `${x.number}-cancellation.html`)}>{T('print')}</button>])} />
    </>
  );
}

/* ── C5 80% procurement test ── */
function Procurement({ run, p }: PBody) {
  const [fy, setFy] = useState(fyOf(todayInput()));
  const t = procurement80(p, fy, purchasesDb.all());
  const L = (k: RcKey, n: number) => [T(k), k === 'pct' ? `${n}%` : rs(n)];
  return (
    <>
      <div className={controls.row} style={row}><Num l={T('fy')} v={fy} set={setFy} w={100} /></div>
      <Table d="p80" head={[T('v.procurement'), `FY ${t.fy}`]} rows={[L('total', t.total), L('registered', t.registered), L('unregistered', t.unregistered), L('pct', t.pct), L('shortfall', t.shortfall), L('cement', t.cementRcm), L('rcm', t.rcm)]} />
      {t.rcm > 0 && <button type="button" className={controls.btnPrimary} onClick={() => run(() => T('drafted', { n: bookRcmDraft(p, t, `${fy + 1}-03-31`).number }))}>{T('bookRcm')}</button>}
    </>
  );
}
