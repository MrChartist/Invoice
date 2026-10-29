/**
 * SV-B Time → Clinic (one lazy chunk): patients (register, history, CSV), OPD (token board per doctor, visits from
 * arrived appointments, consultation bill, the doctors' clinic fields), in-patients (admissions, running charges,
 * deposits, interim print, discharge, final bill / payer split, the SV-A5 claims desk), lab (orders, samples, results,
 * report, outsourced bills), tests (master, CSV), referrals (referral report, consultant fee-share payout, referral
 * payments only when switched on) and the rate list. Working papers — verify with your CA.
 */
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { Doctor } from '../../types/retail-r9';
import type { ClinicRoom, ClinicSettings, LabOrder, LabParam, LabTest, PatientInfo } from '../../types/services-r10';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { downloadText, toCsv } from '../../lib/download';
import { parseCsv } from '../../lib/csv';
import { printHtmlDocument } from '../../lib/voucher-print';
import { labelSheetHtml, layoutById } from '../../lib/label-sheet';
import { formatCurrency, todayInput } from '../../lib/utils';
import { refundAdvance, saveAdvance } from '../../lib/advances';
import { senderStateCode } from '../../store/invoice-defaults';
import { doctorsDb } from '../../lib/retail/rt-pharmacy-rx';
import { loadAppointments } from '../../lib/services/sv-appointments';
import { loadStaff } from '../../lib/services/sv-staff';
import { loadClaims } from '../../lib/services/sv-claims';
import { loadPayouts, paidOut } from '../../lib/services/sv-payouts';
import { ageOn, clinicLine, findPatients, liveInvoice, loadPatients, readClinicSettings, saveClinicSettings, savePatient, uhidOf } from '../../lib/services/sv-patients';
import { billVisit, loadVisits, saveVisit, updateVisit, visitFromAppointment } from '../../lib/services/sv-opd';
import { addCharge, admissionLines, applyDeposits, attachDeposit, depositsOpen, discharge, finalBill, interimHtml, linesGross, loadAdmissions, saveAdmission } from '../../lib/services/sv-ipd';
import { advanceSample, billOrder, bookOutsourcedBill, enterResults, flagOf, loadOrders, loadTests, logDelivery, outsourcedDue, parseRanges, parseResultsCsv, rangesText, resultKey, saveOrder, saveTest, tatBreached, testsCsvRows, testsFromCsv } from '../../lib/services/sv-lab';
import { bookReferral, feeShare, payFeeShare, referralCsvRows, referralReport, referralRule } from '../../lib/services/sv-referrals';
import { printedStamp, rateListHtml, rateRows, ratesOutOfDate } from '../../lib/services/sv-rate-list';
import { useT } from '../../i18n';
import { svT } from '../../i18n/areas/services-r10a';
import { bT, type BKey } from '../../i18n/areas/services-r10b';
import { LabReportPrint } from './LabReportPrint';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './services.module.css';

const ClaimsView = lazy(() => import('./ClaimsView'));
type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
type Run = (fn: () => unknown, ok?: string) => boolean;
const VIEWS = ['opd', 'patients', 'ipd', 'lab', 'tests', 'referrals', 'rates'] as const;
type View = (typeof VIEWS)[number];
const btn = `${controls.btnOutline} ${controls.btnSm}`;
const F = ({ k, children }: { k: BKey; children: ReactNode }) => <label className={controls.field}><span className={controls.label}>{bT(k)}</span>{children}</label>;
const fallback = (html: string) => downloadText('clinic.html', html, 'text/html');
const money = (n: number) => formatCurrency(n);

export default function ClinicDesk({ view, notify }: { view?: string; notify: Notify }) {
  useT();
  const [, setParams] = useSearchParams();
  const v: View = (VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : 'opd';
  const [tick, setTick] = useState(0);
  const run: Run = (fn, ok = svT('saved')) => {
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
  /* eslint-disable react-hooks/exhaustive-deps */
  const patients = useMemo(() => loadPatients(), [tick]);
  const doctors = useMemo(() => doctorsDb.all().filter((d) => d.active !== false), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const ctx = { run, patients, doctors, tick, notify };
  return (
    <section className={surface.card} data-clinic-desk>
      <div className={surface.cardBody}>
        <div className={controls.segment} role="tablist">
          {VIEWS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={v === x} className={v === x ? controls.segmentBtnActive : controls.segmentBtn}
              onClick={() => setParams((p) => { p.set('tab', 'clinic'); p.set('view', x); return p; }, { replace: true })}>{bT(`v.${x}`)}</button>
          ))}
        </div>
        {v === 'opd' && <Opd {...ctx} />}
        {v === 'patients' && <Patients {...ctx} />}
        {v === 'ipd' && <Ipd {...ctx} />}
        {v === 'lab' && <Lab {...ctx} />}
        {v === 'tests' && <Tests {...ctx} />}
        {v === 'referrals' && <Referrals {...ctx} />}
        {v === 'rates' && <Rates {...ctx} />}
      </div>
    </section>
  );
}

type Ctx = { run: Run; patients: Client[]; doctors: Doctor[]; tick: number; notify: Notify };

/** Patient picker: search by UHID / phone / name. */
function PatientPick({ patients, value, onChange }: { patients: Client[]; value: string; onChange: (c: Client | undefined) => void }) {
  const [q, setQ] = useState('');
  const list = findPatients(patients, q).slice(0, 50);
  return (
    <>
      <F k="find"><input className={controls.input} value={q} onChange={(e) => setQ(e.target.value)} data-patient-search /></F>
      <F k="patient">
        <select className={controls.select} value={value} onChange={(e) => onChange(patients.find((p) => p.id === e.target.value))} data-patient-pick>
          <option value="">-</option>
          {list.map((p) => <option key={p.id} value={p.id}>{[uhidOf(p), p.name, p.phone].filter(Boolean).join(' · ')}</option>)}
        </select>
      </F>
    </>
  );
}
const DocPick = ({ doctors, value, onChange, k = 'doctor' }: { doctors: Doctor[]; value: string; onChange: (id: string) => void; k?: BKey }) => (
  <F k={k}><select className={controls.select} value={value} onChange={(e) => onChange(e.target.value)} data-doctor-pick={k}><option value="">-</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></F>
);
const refOf = (doctors: Doctor[], id: string) => (id ? { doctor_id: id, name: doctors.find((d) => d.id === id)?.name } : undefined);
const open = (nav: (to: string) => void, inv: InvoiceRecord) => nav(`/invoice/${inv.id}`);

/* ── Patients ── */
function Patients({ run, patients, doctors }: Ctx) {
  const blank = { id: '', name: '', phone: '', dob: '', uhid: '', age: '', sex: '', guardian: '', blood: '', referred_by: '', allergies: '' };
  const [f, setF] = useState(blank);
  const [q, setQ] = useState('');
  const today = todayInput();
  const invoices = useMemo(() => getTable<InvoiceRecord>('invoices'), []);
  const set = (p: Partial<typeof blank>) => setF((x) => ({ ...x, ...p }));
  const edit = (c: Client) => setF({ ...blank, id: c.id ?? '', name: c.name, phone: c.phone ?? '', dob: c.dob ?? '', uhid: uhidOf(c), age: String(c.patient?.age ?? ''), sex: c.patient?.sex ?? '', guardian: c.patient?.guardian ?? '', blood: c.patient?.blood ?? '', referred_by: c.patient?.referred_by ?? '', allergies: c.patient?.allergies ?? '' });
  const save = () => run(() => {
    const patient: PatientInfo = { ...(f.uhid ? { uhid: f.uhid } : {}), ...(f.age ? { age: Number(f.age) } : {}), ...(f.sex ? { sex: f.sex as PatientInfo['sex'] } : {}), ...(f.guardian ? { guardian: f.guardian } : {}), ...(f.blood ? { blood: f.blood } : {}), ...(f.referred_by ? { referred_by: f.referred_by } : {}), ...(f.allergies ? { allergies: f.allergies } : {}) };
    const c = savePatient({ ...(f.id ? { id: f.id } : {}), name: f.name, phone: f.phone, dob: f.dob, patient }, today);
    setF(blank);
    return c;
  }, bT('patientSaved'));
  const stats = (c: Client) => {
    const mine = invoices.filter((i) => i.client?.id === c.id && i.status !== 'Draft' && i.status !== 'Cancelled');
    return { visits: loadVisits().filter((x) => x.patient_id === c.id).length, bills: mine.length, balance: mine.reduce((s, i) => s + (Number(i.balance_due) || 0), 0) };
  };
  const rows = findPatients(patients, q);
  const s = readClinicSettings();
  return (
    <>
      <div className={styles.form}>
        <F k="name"><input className={controls.input} value={f.name} onChange={(e) => set({ name: e.target.value })} data-patient-name /></F>
        <F k="uhid"><input className={controls.input} value={f.uhid} placeholder={bT('auto')} onChange={(e) => set({ uhid: e.target.value })} /></F>
        <F k="phone"><input className={controls.input} value={f.phone} onChange={(e) => set({ phone: e.target.value })} /></F>
        <F k="age"><input className={controls.input} type="number" min={0} value={f.age} onChange={(e) => set({ age: e.target.value })} /></F>
        <F k="dob"><input className={controls.input} type="date" value={f.dob} onChange={(e) => set({ dob: e.target.value })} /></F>
        <F k="sex"><select className={controls.select} value={f.sex} onChange={(e) => set({ sex: e.target.value })} data-patient-sex><option value="">-</option><option value="F">F</option><option value="M">M</option><option value="O">O</option></select></F>
        <F k="guardian"><input className={controls.input} value={f.guardian} onChange={(e) => set({ guardian: e.target.value })} /></F>
        <F k="blood"><input className={controls.input} value={f.blood} onChange={(e) => set({ blood: e.target.value })} /></F>
        <DocPick doctors={doctors} value={f.referred_by} onChange={(id) => set({ referred_by: id })} k="referredBy" />
        <F k="allergies"><input className={controls.input} value={f.allergies} onChange={(e) => set({ allergies: e.target.value })} /></F>
      </div>
      <div className={styles.actions}>
        <button type="button" className={controls.btnPrimary} onClick={save} data-patient-save>{f.id ? svT('save') : bT('register')}</button>
        {f.id && <button type="button" className={controls.btnGhost} onClick={() => setF(blank)}>{svT('cancel')}</button>}
        {can('settings.manage') && <F k="uhidPrefix"><input className={controls.input} defaultValue={s.uhid_prefix ?? ''} onBlur={(e) => e.target.value !== (s.uhid_prefix ?? '') && run(() => saveClinicSettings({ uhid_prefix: e.target.value }))} style={{ maxWidth: '6rem' }} /></F>}
      </div>
      <div className={styles.bar}>
        <input className={controls.input} placeholder={bT('find')} value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: '16rem' }} />
        <button type="button" className={btn} onClick={() => downloadText('patients.csv', toCsv([['UHID', 'Name', 'Phone', 'Age', 'Sex', 'Visits', 'Bills', 'Balance'], ...rows.map((c) => { const x = stats(c); return [uhidOf(c), c.name, c.phone ?? '', ageOn(c, today) ?? '', c.patient?.sex ?? '', x.visits, x.bills, x.balance]; })]), 'text/csv')}>{svT('csv')}</button>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{bT('uhid')}</th><th>{bT('name')}</th><th>{bT('age')}</th><th>{bT('phone')}</th><th>{bT('v.opd')}</th><th>{bT('bills')}</th><th>{bT('balance')}</th></tr></thead>
          <tbody>
            {rows.map((c) => { const x = stats(c); return <tr key={c.id} onClick={() => edit(c)} data-patient={uhidOf(c)}><td>{uhidOf(c)}</td><td>{c.name}</td><td>{[ageOn(c, today), c.patient?.sex].filter((y) => y != null).join(' / ')}</td><td>{c.phone}</td><td>{x.visits}</td><td>{x.bills}</td><td>{money(x.balance)}</td></tr>; })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── OPD ── */
function Opd({ run, patients, doctors, tick }: Ctx) {
  const nav = useNavigate();
  const [day, setDay] = useState(todayInput());
  const [pt, setPt] = useState('');
  const [doc, setDoc] = useState('');
  const [ref, setRef] = useState('');
  const [extra, setExtra] = useState<Record<string, string[]>>({});
  /* eslint-disable react-hooks/exhaustive-deps */
  const visits = useMemo(() => loadVisits().filter((x) => x.date === day), [tick, day]);
  const appts = useMemo(() => loadAppointments().filter((a) => a.date === day && (a.status === 'arrived' || a.status === 'in_service') && !loadVisits().some((x) => x.appointment_id === a.id)), [tick, day]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const catalogue = useMemo(() => localDb.items.getAll().filter((i) => i.name?.trim()), []);
  const add = () => {
    const p = patients.find((x) => x.id === pt);
    if (run(() => saveVisit({ date: day, patient_id: p?.id, patient_name: p?.name ?? '', doctor_id: doc || undefined, referrer: refOf(doctors, ref) }), bT('visitSaved'))) setPt('');
  };
  const bill = (id: string) => {
    let inv: InvoiceRecord | undefined;
    const lines: InvoiceItem[] = (extra[id] ?? []).map((n) => catalogue.find((c) => c.name === n)).filter((c): c is InvoiceItem => !!c).map((c) => clinicLine(c.name, Number(c.rate) || 0, { date: day, cls: c.sv_class, hsn: c.hsn, taxRate: c.sv_class ? undefined : Number(c.tax_rate) || 0 }));
    if (run(() => { inv = billVisit(id, lines, day); }, bT('billed')) && inv) open(nav, inv);
  };
  const byDoc = [...new Set(visits.map((x) => x.doctor_name ?? ''))];
  const NEXT = { waiting: 'with_doctor', with_doctor: 'done' } as const;
  return (
    <>
      <div className={styles.form}>
        <F k="date"><input className={controls.input} type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></F>
        <PatientPick patients={patients} value={pt} onChange={(c) => setPt(c?.id ?? '')} />
        <DocPick doctors={doctors} value={doc} onChange={setDoc} />
        <DocPick doctors={doctors} value={ref} onChange={setRef} k="referredBy" />
      </div>
      <div className={styles.actions}><button type="button" className={controls.btnPrimary} onClick={add} data-visit-new>{bT('newVisit')}</button></div>
      {appts.length > 0 && <p className={styles.muted}>{bT('arrived')}: {appts.map((a) => <button key={a.id} type="button" className={btn} onClick={() => run(() => visitFromAppointment(a), bT('visitSaved'))}>{a.start} {a.client_name}</button>)}</p>}
      {!visits.length && <p className={controls.hint}>{bT('noVisits')}</p>}
      {byDoc.map((d) => (
        <div key={d || '_'} className={surface.tableWrap} data-token-board={d}>
          <h4>{d || bT('noDoctor')}</h4>
          <table className={surface.table}>
            <thead><tr><th>{bT('token')}</th><th>{bT('patient')}</th><th>{bT('kind')}</th><th>{bT('fee')}</th><th>{bT('status')}</th><th /></tr></thead>
            <tbody>
              {visits.filter((x) => (x.doctor_name ?? '') === d).sort((a, b) => a.token - b.token).map((x) => (
                <tr key={x.id} data-visit={x.number}>
                  <td><strong>{x.token}</strong></td><td>{x.patient_name}{x.uhid ? ` · ${x.uhid}` : ''}</td><td>{bT(x.kind === 'new' ? 'k.new' : 'k.fu')}</td><td>{money(x.fee)}</td><td>{bT(`vs.${x.status}`)}</td>
                  <td>
                    {(x.status === 'waiting' || x.status === 'with_doctor') && <button type="button" className={btn} onClick={() => run(() => updateVisit(x.id, { status: NEXT[x.status as keyof typeof NEXT] }))}>{bT(`vs.${NEXT[x.status as keyof typeof NEXT]}`)}</button>}
                    {x.status !== 'billed' && (
                      <>
                        <select className={controls.select} value="" aria-label={bT('addItem')} onChange={(e) => e.target.value && setExtra({ ...extra, [x.id]: [...(extra[x.id] ?? []), e.target.value] })}>
                          <option value="">+ {bT('addItem')}</option>{catalogue.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                        {(extra[x.id] ?? []).join(', ')}
                        <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={() => bill(x.id)} data-visit-bill>{svT('bill')}</button>
                      </>
                    )}
                    {x.status === 'billed' && liveInvoice(x.invoice_id) && <button type="button" className={btn} onClick={() => open(nav, liveInvoice(x.invoice_id)!)}>{bT('openBill')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <Doctors run={run} doctors={doctors} />
    </>
  );
}

function Doctors({ run, doctors }: Pick<Ctx, 'run' | 'doctors'>) {
  const staff = useMemo(() => loadStaff(), []);
  const blank = { id: '', name: '', reg_no: '', council: '', qualification: '', speciality: '', consult_fee: '', follow_up_fee: '', follow_up_days: '', staff_id: '', in_house: true, pct: '', per_visit: '' };
  const [f, setF] = useState(blank);
  const set = (p: Partial<typeof blank>) => setF((x) => ({ ...x, ...p }));
  const n = (s: string) => (s === '' ? undefined : Number(s));
  const save = () => run(() => {
    doctorsDb.save({ ...(f.id ? { id: f.id } : {}), name: f.name, reg_no: f.reg_no || undefined, council: f.council || undefined, qualification: f.qualification || undefined, speciality: f.speciality || undefined, consult_fee: n(f.consult_fee), follow_up_fee: n(f.follow_up_fee), follow_up_days: n(f.follow_up_days), staff_id: f.staff_id || undefined, in_house: f.in_house, share: f.pct || f.per_visit ? { ...(f.pct ? { pct: Number(f.pct) } : { per_visit: Number(f.per_visit) }) } : undefined });
    setF(blank);
  });
  const txt = (k: 'name' | 'reg_no' | 'council' | 'qualification' | 'speciality', l: BKey) => <F k={l}><input className={controls.input} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} data-doctor-field={k} /></F>;
  const numF = (k: 'consult_fee' | 'follow_up_fee' | 'follow_up_days' | 'pct' | 'per_visit', l: BKey) => <F k={l}><input className={controls.input} type="number" min={0} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} data-doctor-field={k} /></F>;
  return (
    <details className={surface.card} style={{ marginTop: '1rem' }}>
      <summary>{bT('doctors')} ({doctors.length})</summary>
      <div className={styles.form}>
        {txt('name', 'name')}{txt('qualification', 'qual')}{txt('council', 'council')}{txt('reg_no', 'regNo')}{txt('speciality', 'speciality')}
        {numF('consult_fee', 'consultFee')}{numF('follow_up_fee', 'fuFee')}{numF('follow_up_days', 'fuDays')}
        <F k="staffLink"><select className={controls.select} value={f.staff_id} onChange={(e) => set({ staff_id: e.target.value })}><option value="">-</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></F>
        <label className={controls.check}><input type="checkbox" checked={f.in_house} onChange={(e) => set({ in_house: e.target.checked })} /> {bT('inHouse')}</label>
        {numF('pct', 'sharePct')}{numF('per_visit', 'sharePer')}
      </div>
      <div className={styles.actions}><button type="button" className={controls.btnPrimary} onClick={save} data-doctor-save>{svT('save')}</button></div>
      <ul className={styles.list}>
        {doctors.map((d) => <li key={d.id}><button type="button" className={controls.btnGhost} onClick={() => setF({ ...blank, id: d.id, name: d.name, reg_no: d.reg_no ?? '', council: d.council ?? '', qualification: d.qualification ?? '', speciality: d.speciality ?? '', consult_fee: String(d.consult_fee ?? ''), follow_up_fee: String(d.follow_up_fee ?? ''), follow_up_days: String(d.follow_up_days ?? ''), staff_id: d.staff_id ?? '', in_house: d.in_house !== false, pct: String(d.share?.pct ?? ''), per_visit: String(d.share?.per_visit ?? '') })}>{d.name}</button> {[d.speciality, d.reg_no, d.consult_fee != null && money(d.consult_fee)].filter(Boolean).join(' · ')}</li>)}
      </ul>
    </details>
  );
}

/* ── In-patients ── */
function Ipd({ run, patients, doctors, tick, notify }: Ctx) {
  const nav = useNavigate();
  const today = todayInput();
  const s = readClinicSettings();
  const mode = s.room_day ?? 'midnight';
  const [f, setF] = useState({ pt: '', doc: '', ref: '', room: '', claim: '', date: today, time: '' });
  const [ch, setCh] = useState({ name: '', qty: '1', rate: '', item: '' });
  const [amt, setAmt] = useState('');
  const [sel, setSel] = useState('');
  /* eslint-disable react-hooks/exhaustive-deps */
  const list = useMemo(() => loadAdmissions().sort((a, b) => b.admit_date.localeCompare(a.admit_date)), [tick]);
  const claims = useMemo(() => loadClaims().filter((c) => !c.payer_invoice_id), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const stock = useMemo(() => getTable<{ id: string; name: string; hsn?: string; sale_price?: number }>('stock_items').filter((x) => x?.name), []);
  const rooms = s.rooms ?? [];
  const admit = () => {
    const p = patients.find((x) => x.id === f.pt);
    const r = rooms.find((x) => x.id === f.room);
    run(() => saveAdmission({ admit_date: f.date, ...(f.time ? { admit_time: f.time } : {}), patient_id: p?.id, patient_name: p?.name ?? '', doctor_ids: f.doc ? [f.doc] : [], ...(r ? { room: r } : {}), ...(f.claim ? { claim_id: f.claim } : {}), referrer: refOf(doctors, f.ref) }), bT('admitted'));
  };
  const a = list.find((x) => x.id === sel);
  const addCh = () => a && run(() => {
    const it = stock.find((x) => x.id === ch.item);
    addCharge(a.id, { date: today, name: it?.name ?? ch.name, qty: Number(ch.qty) || 1, rate: Number(ch.rate || it?.sale_price) || 0, ...(it ? { item_id: it.id, hsn: it.hsn } : {}) });
    setCh({ name: '', qty: '1', rate: '', item: '' });
  });
  const deposit = () => a && run(() => {
    const adv = saveAdvance({ date: today, client: { id: a.patient_id, name: a.patient_name }, place_of_supply: senderStateCode(localDb.settings.activeProfile()), supply: 'services', tax_rate: 0, amount: Number(amt), method: 'Cash', description: `Deposit: admission ${a.number}` });
    attachDeposit(a.id, adv.id);
    setAmt('');
  }, bT('depositSaved'));
  const final = () => a && run(() => { const r = finalBill(a.id, today, mode); open(nav, r.bill); }, bT('billed'));
  const refund = () => a && run(() => {
    for (const id of a.deposits ?? []) {
      const left = depositsOpen({ deposits: [id] });
      if (left > 0) refundAdvance(id, { amount: left, date: today, method: 'Cash', note: `Excess deposit: ${a.number}` });
    }
  });
  const saveRooms = (text: string) => run(() => saveClinicSettings({ rooms: text.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((x) => x[0]).map(([name, kind, rate], i) => ({ id: rooms[i]?.id ?? `r${i}-${name}`, name, kind: (kind || 'general') as ClinicRoom['kind'], rate: Number(rate) || 0 })) }));
  return (
    <>
      <div className={styles.form}>
        <PatientPick patients={patients} value={f.pt} onChange={(c) => setF({ ...f, pt: c?.id ?? '' })} />
        <DocPick doctors={doctors} value={f.doc} onChange={(doc) => setF({ ...f, doc })} />
        <F k="room"><select className={controls.select} value={f.room} onChange={(e) => setF({ ...f, room: e.target.value })} data-admit-room><option value="">-</option>{rooms.map((r) => <option key={r.id} value={r.id}>{`${r.name} · ${r.kind} · ${money(r.rate)}`}</option>)}</select></F>
        <F k="date"><input className={controls.input} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></F>
        <F k="time"><input className={controls.input} type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></F>
        <F k="claim"><select className={controls.select} value={f.claim} onChange={(e) => setF({ ...f, claim: e.target.value })}><option value="">-</option>{claims.map((c) => <option key={c.id} value={c.id}>{`${c.number} · ${c.payer_name}`}</option>)}</select></F>
        <DocPick doctors={doctors} value={f.ref} onChange={(ref) => setF({ ...f, ref })} k="referredBy" />
      </div>
      <div className={styles.actions}><button type="button" className={controls.btnPrimary} onClick={admit} data-admit>{bT('admit')}</button></div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>#</th><th>{bT('patient')}</th><th>{bT('room')}</th><th>{bT('charges')}</th><th>{bT('deposits')}</th><th>{bT('status')}</th></tr></thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.id} onClick={() => setSel(x.id)} aria-selected={x.id === sel} data-admission={x.number}>
                <td>{x.number}</td><td>{x.patient_name}</td><td>{x.room ? `${x.room.name} (${money(x.room.rate)})` : '-'}</td><td>{money(linesGross(admissionLines(x, today, mode)))}</td><td>{money(depositsOpen(x))}</td><td>{bT(`as.${x.status}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {a && (
        <div className={surface.card} data-admission-open={a.number}>
          <h4>{a.number} · {a.patient_name}</h4>
          <ul className={styles.list}>{admissionLines(a, today, mode).map((l) => <li key={l.id}>{l.name} · {l.quantity} × {money(Number(l.rate))}{Number(l.tax_rate) ? ` + ${l.tax_rate}%` : ` · ${bT('exempt')}`}</li>)}</ul>
          {a.status !== 'billed' && (
            <div className={styles.bar}>
              <select className={controls.select} value={ch.item} onChange={(e) => setCh({ ...ch, item: e.target.value })} aria-label={bT('medicine')}><option value="">{bT('medicine')}</option>{stock.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <input className={controls.input} placeholder={bT('charge')} value={ch.name} onChange={(e) => setCh({ ...ch, name: e.target.value })} data-charge-name />
              <input className={controls.input} type="number" min={0} placeholder={bT('qty')} value={ch.qty} onChange={(e) => setCh({ ...ch, qty: e.target.value })} style={{ maxWidth: '5rem' }} />
              <input className={controls.input} type="number" min={0} placeholder={bT('rate')} value={ch.rate} onChange={(e) => setCh({ ...ch, rate: e.target.value })} style={{ maxWidth: '7rem' }} data-charge-rate />
              <button type="button" className={btn} onClick={addCh} data-charge-add>{bT('addCharge')}</button>
              <input className={controls.input} type="number" min={0} placeholder={bT('deposit')} value={amt} onChange={(e) => setAmt(e.target.value)} style={{ maxWidth: '7rem' }} />
              <button type="button" className={btn} onClick={deposit}>{bT('takeDeposit')}</button>
            </div>
          )}
          <div className={styles.actions}>
            <button type="button" className={btn} onClick={() => printHtmlDocument(interimHtml(a, { asOn: today, business: localDb.settings.activeProfile()?.companyName ?? '', deposits: depositsOpen(a), mode, money }), fallback)}>{bT('interim')}</button>
            {a.status === 'admitted' && <button type="button" className={btn} onClick={() => run(() => discharge(a.id, today, new Date().toTimeString().slice(0, 5)))} data-discharge>{bT('discharge')}</button>}
            {a.status === 'discharged' && <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={final} data-final-bill>{bT('finalBill')}</button>}
            {a.status === 'billed' && <><button type="button" className={btn} onClick={() => run(() => notify(money(applyDeposits(a.id))))}>{bT('applyDeposits')}</button><button type="button" className={btn} onClick={refund}>{bT('refund')}</button></>}
          </div>
        </div>
      )}
      {can('settings.manage') && (
        <details style={{ marginTop: '1rem' }}>
          <summary>{bT('roomsSetup')}</summary>
          <F k="roomsHint"><textarea className={controls.textarea} rows={4} defaultValue={rooms.map((r) => `${r.name}, ${r.kind}, ${r.rate}`).join('\n')} onBlur={(e) => saveRooms(e.target.value)} data-rooms /></F>
          <F k="roomDay"><select className={controls.select} value={mode} onChange={(e) => run(() => saveClinicSettings({ room_day: e.target.value as ClinicSettings['room_day'] }))}><option value="midnight">{bT('midnight')}</option><option value="24h">{bT('h24')}</option></select></F>
          <F k="depositAlert"><input className={controls.input} type="number" min={0} defaultValue={s.deposit_alert ?? 0} onBlur={(e) => run(() => saveClinicSettings({ deposit_alert: Number(e.target.value) }))} /></F>
        </details>
      )}
      <Suspense fallback={null}><ClaimsView notify={notify} /></Suspense>
    </>
  );
}

/* ── Lab ── */
function Lab({ run, patients, doctors, tick }: Ctx) {
  const nav = useNavigate();
  const today = todayInput();
  const [day, setDay] = useState(today);
  const [pt, setPt] = useState('');
  const [ref, setRef] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [sel, setSel] = useState('');
  const [period, setPeriod] = useState({ from: today.slice(0, 8) + '01', to: today, bill: '' });
  /* eslint-disable react-hooks/exhaustive-deps */
  const tests = useMemo(() => loadTests(), [tick]);
  const orders = useMemo(() => loadOrders(), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const book = () => {
    const p = patients.find((x) => x.id === pt);
    if (run(() => saveOrder({ date: day, patient_id: p?.id, patient_name: p?.name ?? '', sex: p?.patient?.sex, age: p ? ageOn(p, day) : undefined, referrer: refOf(doctors, ref), test_ids: picked }), bT('ordered'))) setPicked([]);
  };
  const o = orders.find((x) => x.id === sel);
  const now = new Date();
  const due = outsourcedDue(orders, period.from, period.to);
  return (
    <>
      <div className={styles.form}>
        <F k="date"><input className={controls.input} type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></F>
        <PatientPick patients={patients} value={pt} onChange={(c) => setPt(c?.id ?? '')} />
        <DocPick doctors={doctors} value={ref} onChange={setRef} k="referredBy" />
      </div>
      <div className={styles.bar}>{tests.map((t) => <label key={t.id} className={controls.check}><input type="checkbox" checked={picked.includes(t.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, t.id] : picked.filter((x) => x !== t.id))} data-lab-test={t.code} /> {t.code} {t.name}</label>)}</div>
      <div className={styles.actions}><button type="button" className={controls.btnPrimary} onClick={book} data-lab-order>{bT('order')}</button></div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>#</th><th>{bT('patient')}</th><th>{bT('v.tests')}</th><th>{bT('samples')}</th><th>{bT('report')}</th></tr></thead>
          <tbody>
            {orders.filter((x) => x.date === day).map((x) => (
              <tr key={x.id} onClick={() => setSel(x.id)} data-order={x.number} style={tatBreached(x, now) ? { color: 'var(--danger)' } : undefined}>
                <td>{x.number}</td><td>{x.patient_name}</td><td>{x.tests.map((t) => t.code).join(', ')}</td>
                <td>{x.samples.map((s, i) => <button key={i} type="button" className={btn} onClick={(e) => { e.stopPropagation(); run(() => advanceSample(x.id, i)); }}>{s.type}: {bT(`ss.${s.status}`)}</button>)}</td>
                <td>{bT(`rs.${x.report}`)}{x.amended_at ? ` · ${bT('amended')}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {o && <Results key={o.id + tick} o={o} run={run} onBill={() => { let inv: InvoiceRecord | undefined; if (run(() => { inv = billOrder(o.id, today); }, bT('billed')) && inv) open(nav, inv); }} />}
      <details style={{ marginTop: '1rem' }}>
        <summary>{bT('outsourced')}</summary>
        <div className={styles.bar}>
          <input className={controls.input} type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} aria-label={bT('from')} />
          <input className={controls.input} type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} aria-label={bT('to')} />
          <input className={controls.input} placeholder={bT('billNo')} value={period.bill} onChange={(e) => setPeriod({ ...period, bill: e.target.value })} />
        </div>
        <ul className={styles.list}>{due.map((d) => <li key={d.vendor_id || d.vendor}>{d.vendor} · {money(d.cost)} · {d.orders.length} <button type="button" className={btn} onClick={() => run(() => bookOutsourcedBill(d.vendor_id || d.vendor, period.from, period.to, period.bill))}>{bT('bookBill')}</button></li>)}</ul>
      </details>
    </>
  );
}

function Results({ o, run, onBill }: { o: LabOrder; run: Run; onBill: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(o.results);
  const [csv, setCsv] = useState('');
  const staff = useMemo(() => loadStaff(), []);
  const [by, setBy] = useState<string[]>(o.verified_by ?? []);
  const [show, setShow] = useState(false);
  const save = () => {
    const crit = o.tests.flatMap((t) => t.params.filter((p) => ['CH', 'CL'].includes(flagOf(p, vals[resultKey(t.id, p.code)] ?? '', o.sex, o.age))).map((p) => p.name));
    if (crit.length && !window.confirm(bT('critical', { list: crit.join(', ') }))) return;
    run(() => enterResults(o.id, vals, by));
  };
  const input = (tid: string, p: LabParam) => {
    const k = resultKey(tid, p.code);
    const props = { className: controls.input, value: vals[k] ?? '', 'aria-label': p.name, 'data-result': p.code, onChange: (e: { target: { value: string } }) => setVals({ ...vals, [k]: e.target.value }) };
    return p.kind === 'option' ? <select {...props} className={controls.select}><option value="" />{(p.options ?? []).map((x) => <option key={x}>{x}</option>)}</select> : <input {...props} inputMode={p.kind === 'numeric' ? 'decimal' : undefined} />;
  };
  return (
    <div className={surface.card} data-results={o.number}>
      <h4>{o.number} · {o.patient_name}</h4>
      <table className={styles.lines}>
        <tbody>
          {o.tests.flatMap((t) => t.params.map((p) => {
            const fl = flagOf(p, vals[resultKey(t.id, p.code)] ?? '', o.sex, o.age);
            return <tr key={resultKey(t.id, p.code)}><td>{t.name} : {p.name}</td><td>{input(t.id, p)}</td><td>{p.unit}</td><td><strong>{fl}</strong></td></tr>;
          }))}
        </tbody>
      </table>
      <F k="csvPaste"><textarea className={controls.textarea} rows={2} value={csv} onChange={(e) => setCsv(e.target.value)} /></F>
      <div className={styles.actions}>
        <button type="button" className={btn} onClick={() => { const r = parseResultsCsv(csv, o.tests); setVals({ ...vals, ...r.results }); if (r.unknown.length) window.alert(bT('unknown', { list: r.unknown.join(', ') })); }}>{bT('applyCsv')}</button>
        {[0, 1].map((i) => <select key={i} className={controls.select} value={by[i] ?? ''} onChange={(e) => { const n = [...by]; n[i] = e.target.value; setBy(n); }} aria-label={bT('verifiedBy')}><option value="">{bT('verifiedBy')}</option>{staff.map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}</select>)}
        <button type="button" className={controls.btnPrimary} onClick={save} data-results-save>{svT('save')}</button>
        <button type="button" className={btn} onClick={() => setShow(!show)} data-report-preview>{bT('report')}</button>
        {!liveInvoice(o.invoice_id) && <button type="button" className={btn} onClick={onBill}>{svT('bill')}</button>}
        <button type="button" className={btn} onClick={() => run(() => logDelivery(o.id, 'whatsapp'))}>{bT('sentWa')}</button>
        <button type="button" className={btn} onClick={() => printHtmlDocument(labelSheetHtml(o.samples.map((x) => ({ name: `${o.patient_name} · ${x.type}`, code: o.number.replace(/\//g, '-'), copies: 1, note: [o.uhid, o.date].filter(Boolean).join(' · ') })), { layout: layoutById('lab-sample'), price: 'none' }), fallback)}>{bT('labels')}</button>
      </div>
      {show && <LabReportPrint o={{ ...o, results: vals }} signers={by.filter(Boolean).map((n) => { const s = staff.find((x) => x.name === n); const d = s?.doctor_id ? doctorsDb.get(s.doctor_id) : undefined; return { name: n, qual: d?.qualification }; })} onPrint={() => run(() => logDelivery(o.id, 'print'))} />}
    </div>
  );
}

/* ── Test master ── */
function Tests({ run, tick }: Ctx) {
  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  const tests = useMemo(() => loadTests(), [tick]);
  const blank = { id: '', code: '', name: '', dept: '', sample: '', tat: '', price: '', note: '', vendor: '', cost: '', panel: [] as string[], params: '' };
  const [f, setF] = useState(blank);
  const set = (p: Partial<typeof blank>) => setF((x) => ({ ...x, ...p }));
  // Parameters, one per line: code, name, unit, ranges, critical low, critical high (ranges "M 13-17; F 12-15", text = text result).
  const params = (text: string): LabParam[] => text.split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((x) => x[0] && x[1]).map(([code, name, unit, ranges, cl, ch]) => {
    const rs = parseRanges(ranges ?? '');
    return { code, name, ...(unit ? { unit } : {}), kind: rs.some((r) => r.text) ? 'text' : 'numeric', ranges: rs, ...(cl ? { crit_low: Number(cl) } : {}), ...(ch ? { crit_high: Number(ch) } : {}) };
  });
  const save = () => run(() => {
    saveTest({ ...(f.id ? { id: f.id } : {}), code: f.code, name: f.name, dept: f.dept || undefined, sample: f.sample || undefined, tat: Number(f.tat) || undefined, price: Number(f.price) || 0, note: f.note || undefined, panel: f.panel.length ? f.panel : undefined, params: params(f.params), ...(Number(f.cost) > 0 ? { outsourced: { vendor_name: f.vendor || undefined, cost: Number(f.cost) } } : {}) });
    setF(blank);
  });
  const edit = (t: LabTest) => setF({ id: t.id, code: t.code, name: t.name, dept: t.dept ?? '', sample: t.sample ?? '', tat: String(t.tat ?? ''), price: String(t.price), note: t.note ?? '', vendor: t.outsourced?.vendor_name ?? '', cost: String(t.outsourced?.cost ?? ''), panel: t.panel ?? [], params: t.params.map((p) => [p.code, p.name, p.unit ?? '', rangesText(p.ranges), p.crit_low ?? '', p.crit_high ?? ''].join(', ')).join('\n') });
  const importCsv = (text: string) => run(() => { for (const t of testsFromCsv(parseCsv(text))) saveTest({ ...t, id: tests.find((x) => x.code.toUpperCase() === t.code.toUpperCase())?.id }); });
  const txt = (k: 'code' | 'name' | 'dept' | 'sample' | 'tat' | 'price' | 'note' | 'vendor' | 'cost', l: BKey) => <F k={l}><input className={controls.input} value={f[k]} onChange={(e) => set({ [k]: e.target.value })} data-test-field={k} /></F>;
  return (
    <>
      <div className={styles.form}>{txt('code', 'code')}{txt('name', 'name')}{txt('dept', 'dept')}{txt('sample', 'sample')}{txt('tat', 'tat')}{txt('price', 'price')}{txt('vendor', 'refLab')}{txt('cost', 'refCost')}{txt('note', 'interp')}</div>
      <F k="paramsHint"><textarea className={controls.textarea} rows={4} value={f.params} onChange={(e) => set({ params: e.target.value })} data-test-params /></F>
      <div className={styles.bar}>{bT('panelOf')}: {tests.filter((t) => t.id !== f.id).map((t) => <label key={t.id} className={controls.check}><input type="checkbox" checked={f.panel.includes(t.id)} onChange={(e) => set({ panel: e.target.checked ? [...f.panel, t.id] : f.panel.filter((x) => x !== t.id) })} /> {t.code}</label>)}</div>
      <div className={styles.actions}>
        <button type="button" className={controls.btnPrimary} onClick={save} data-test-save>{svT('save')}</button>
        <button type="button" className={btn} onClick={() => downloadText('lab-tests.csv', toCsv(testsCsvRows(tests)), 'text/csv')}>{svT('csv')}</button>
        <label className={btn}>{bT('importCsv')}<input type="file" accept=".csv,text/csv" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void file.text().then(importCsv); }} /></label>
      </div>
      <ul className={styles.list}>{tests.map((t) => <li key={t.id}><button type="button" className={controls.btnGhost} onClick={() => edit(t)}>{t.code} · {t.name}</button> {money(t.price)} · {t.panel?.length ? `${bT('panel')} (${t.panel.length})` : `${t.params.length} ${bT('params')}`}</li>)}</ul>
    </>
  );
}

/* ── Referrals ── */
function Referrals({ run, doctors, tick, notify }: Ctx) {
  const today = todayInput();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [rf, setRf] = useState({ doc: '', amount: '', kind: 'cash' as 'cash' | 'benefit' });
  const [tds, setTds] = useState(true);
  const s = readClinicSettings();
  /* eslint-disable react-hooks/exhaustive-deps */
  const invoices = useMemo(() => getTable<InvoiceRecord>('invoices'), [tick]);
  const payouts = useMemo(() => loadPayouts(), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const staff = useMemo(() => loadStaff(), []);
  const from = `${month}-01`;
  const to = `${month}-31`;
  const rows = referralReport({ invoices, visits: loadVisits(), orders: loadOrders(), admissions: loadAdmissions() }, from, to);
  const consultants = doctors.filter((d) => d.share && d.staff_id);
  const rule = referralRule(today);
  return (
    <>
      <div className={styles.bar}>
        <input className={controls.input} type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={svT('month')} style={{ maxWidth: '11rem' }} />
        <button type="button" className={btn} onClick={() => downloadText(`referrals-${month}.csv`, toCsv(referralCsvRows(rows)), 'text/csv')}>{svT('csv')}</button>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-referral-report>
          <thead><tr><th>{bT('referredBy')}</th><th>{bT('patients')}</th><th>{bT('documents')}</th><th>{bT('value')}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.key}><td>{r.name}</td><td>{r.patients}</td><td>{r.documents}</td><td>{money(r.value)}</td></tr>)}</tbody>
        </table>
      </div>
      <h4>{bT('feeShare')}</h4>
      <label className={controls.check}><input type="checkbox" checked={tds} onChange={(e) => setTds(e.target.checked)} /> {svT('payoutTds')}</label>
      <ul className={styles.list}>
        {consultants.map((d) => {
          const st = feeShare(d, month, invoices);
          const person = staff.find((x) => x.id === d.staff_id);
          const done = person ? paidOut(payouts, person.id, month) : false;
          return <li key={d.id} data-fee-share={d.name}>{d.name} · {d.share?.pct ? `${d.share.pct}%` : `₹${d.share?.per_visit} / ${bT('visit')}`} · {st.lines.length} · <strong>{money(st.total)}</strong> {done ? svT('paidOut') : person && st.total > 0 && <button type="button" className={btn} onClick={() => run(() => payFeeShare(person, month, st, today, tds))}>{svT('payout')}</button>}</li>;
        })}
      </ul>
      <h4>{bT('refPay')}</h4>
      <p className={controls.hint} role="note" data-referral-caution>{rule.caution}</p>
      {can('settings.manage') && <label className={controls.check}><input type="checkbox" checked={!!s.record_referral_payments} onChange={(e) => run(() => saveClinicSettings({ record_referral_payments: e.target.checked }))} /> {bT('refSwitch', { ledger: rule.ledger })}</label>}
      {s.record_referral_payments && (
        <div className={styles.bar}>
          <select className={controls.select} value={rf.doc} onChange={(e) => setRf({ ...rf, doc: e.target.value })} aria-label={bT('doctor')}><option value="">{bT('doctor')}</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <input className={controls.input} type="number" min={0} value={rf.amount} onChange={(e) => setRf({ ...rf, amount: e.target.value })} aria-label={bT('value')} style={{ maxWidth: '8rem' }} />
          <select className={controls.select} value={rf.kind} onChange={(e) => setRf({ ...rf, kind: e.target.value as 'cash' })}><option value="cash">{bT('refCash')}</option><option value="benefit">{bT('refKind')}</option></select>
          <button type="button" className={btn} onClick={() => { const d = doctors.find((x) => x.id === rf.doc); if (d) run(() => { const r = bookReferral(d, Number(rf.amount), today, rf.kind, true); if (r.remind194R) notify(bT('r194'), 'info'); }); }}>{bT('book')}</button>
        </div>
      )}
    </>
  );
}

/* ── Rate list ── */
function Rates({ run, tick }: Ctx) {
  /* eslint-disable-next-line react-hooks/exhaustive-deps */
  const s = useMemo(() => readClinicSettings(), [tick]);
  const items = useMemo(() => [...localDb.items.getAll(), ...getTable<{ id: string; name: string; sale_price?: number; unit?: string; sv_class?: never }>('stock_items')], []);
  const [names, setNames] = useState<Record<string, string>>(s.rate_names ?? {});
  const [lang, setLang] = useState(s.rate_lang ?? 'हिन्दी');
  const [size, setSize] = useState<'A4' | 'A3'>('A4');
  const rows = rateRows(items, { rate_names: names });
  const today = todayInput();
  const print = () => {
    printHtmlDocument(rateListHtml(rows, { business: localDb.settings.activeProfile()?.companyName ?? '', asOn: today, lang, size, money }), fallback);
    if (can('settings.manage')) run(() => saveClinicSettings({ rate_names: names, rate_lang: lang, rates_printed: printedStamp(rows, today) }));
  };
  return (
    <>
      {ratesOutOfDate(rows, s) && <p className={controls.hint} role="alert" data-rates-stale>{bT('stale')}</p>}
      <div className={styles.bar}>
        <F k="lang"><input className={controls.input} value={lang} onChange={(e) => setLang(e.target.value)} /></F>
        <select className={controls.select} value={size} onChange={(e) => setSize(e.target.value as 'A4')} aria-label="A4 / A3"><option>A4</option><option>A3</option></select>
        <button type="button" className={controls.btnPrimary} onClick={print}>{svT('print')}</button>
      </div>
      {!rows.length && <p className={controls.hint}>{bT('noRates')}</p>}
      <table className={styles.lines}>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{r.name}</td><td><input className={controls.input} value={names[r.id] ?? ''} onChange={(e) => setNames({ ...names, [r.id]: e.target.value })} aria-label={lang} /></td><td>{money(r.rate)}</td><td>{r.unit}</td></tr>)}</tbody>
      </table>
    </>
  );
}
