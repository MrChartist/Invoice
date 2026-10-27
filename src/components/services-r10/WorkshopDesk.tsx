/**
 * SV-D workshop desk (Time → Workshop, pack `workshop`), one lazy chunk. Views: *jobs* (take a vehicle / appliance in,
 * the board by status with age colours, moves, parts issued to the job, technician clocks, job card / gate pass prints,
 * `wa.me` "ready", *Bill job*), *estimates* (labour ops × class rate, parts, outside work → a quotation; approvals log;
 * `wa.me` approval request), *claims* (motor claim on a job, the per-line / per-head split, then SV-A5's claims desk),
 * *reminders* (service and insurance due, AMC visits → job), *labour* (operations, workshop settings, efficiency) and
 * *vehicles* (master and history). Engines: `lib/services/sv-*` over RT-D4. Working papers — verify with your CA.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { ServiceJob, ServiceStatus } from '../../types/retail-r9';
import type { JobApproval, ServiceAsset, VehicleClass, WorkshopSettings } from '../../types/services-r10';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { stockDb } from '../../lib/inventory';
import { godownsDb, transfersDb } from '../../lib/godowns';
import { amcDb } from '../../lib/amc';
import { timeDb } from '../../lib/timesheets';
import { num, round2 } from '../../lib/invoice-calc';
import { formatCurrency, todayInput } from '../../lib/utils';
import { getLanguage, useT } from '../../i18n';
import { rtdT } from '../../i18n/areas/retail-r9d';
import { wsT, type WsKey } from '../../i18n/areas/services-r10d';
import { waLink } from '../../lib/services/sv-appointments';
import { readServiceSettings } from '../../lib/services/sv-settings';
import { loadStaff } from '../../lib/services/sv-staff';
import { loadClaims } from '../../lib/services/sv-claims';
import { ageMonths, assetJobs, assetLabel, DEFAULT_CHECKLIST, deleteAsset, lastKm, lastService, loadAssets, readWorkshopSettings, saveAsset, saveWorkshopSettings } from '../../lib/services/sv-assets';
import { ALL_STATUSES, board, loadWorkshopJobs, movesFrom, moveWorkshopJob, openJob } from '../../lib/services/sv-jobs-workshop';
import { approveEstimate, billWorkshopJob, labourLine, makeEstimate, partLine, subletLine } from '../../lib/services/sv-estimates';
import { issuedNet, issueParts, returnParts, WIP_NAME } from '../../lib/services/sv-parts-issue';
import { clockIn, clockOut, deleteLabourOp, efficiency, loadLabourOps, saveLabourOp } from '../../lib/services/sv-labour';
import { billMotorClaim, motorBuckets, openMotorClaim, PART_CATEGORIES, type PartCategory } from '../../lib/services/sv-motor-claims';
import { amcDue, dueList, reminderText } from '../../lib/services/sv-reminders';
import ClaimsView from './ClaimsView';
import { printWorkshop } from './WorkshopJobCardPrint';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './services.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
type Form = Record<string, string>;
type Run = (fn: () => string | void) => boolean;
const VIEWS = ['jobs', 'estimates', 'claims', 'reminders', 'labour', 'vehicles'] as const;
const CLASSES: readonly VehicleClass[] = ['hatch', 'sedan', 'suv', '2W', '3W', 'commercial'];
const sm = `${controls.btnOutline} ${controls.btnSm}`;
const gh = `${controls.btnGhost} ${controls.btnSm}`;
const pr = `${controls.btnPrimary} ${controls.btnSm}`;
const opts = (rows: readonly (readonly [string, string])[], blank = true) => <>{blank && <option value="">—</option>}{rows.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</>;

/** Labelled inputs: [key, type | options, label]; `data-ws-<key>` on each control. */
function Fields({ spec, f, set }: { spec: readonly (readonly [string, (string | readonly (readonly [string, string])[])?, string?])[]; f: Form; set: (f: Form) => void }) {
  return (
    <div className={styles.form}>
      {spec.map(([k, t, label]) => (
        <label key={k} className={controls.field}>
          <span className={controls.label}>{label ?? wsT(k as WsKey)}</span>
          {Array.isArray(t)
            ? <select className={controls.select} value={f[k] ?? ''} onChange={(e) => set({ ...f, [k]: e.target.value })} {...{ [`data-ws-${k}`]: '' }}>{opts(t)}</select>
            : t === 'area'
              ? <textarea className={controls.textarea} rows={3} value={f[k] ?? ''} onChange={(e) => set({ ...f, [k]: e.target.value })} {...{ [`data-ws-${k}`]: '' }} />
              : <input className={controls.input} type={(t as string) || 'text'} value={f[k] ?? ''} onChange={(e) => set({ ...f, [k]: e.target.value })} {...{ [`data-ws-${k}`]: '' }} />}
        </label>
      ))}
    </div>
  );
}

const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className={surface.tableWrap}><table className={surface.table}><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
);

interface Ctx {
  jobs: ServiceJob[];
  assets: ServiceAsset[];
  invoices: InvoiceRecord[];
  settings: WorkshopSettings;
  staff: { id: string; name: string }[];
  day: string;
  shop: string;
  run: Run;
}

export default function WorkshopDesk({ view, notify }: { view?: string; notify: Notify }) {
  useT();
  const v = (VIEWS as readonly string[]).includes(view ?? '') ? (view as (typeof VIEWS)[number]) : 'jobs';
  const [tick, setTick] = useState(0);
  const run: Run = (fn) => {
    try {
      notify(fn() || wsT('save') + ' ✓');
      setTick((n) => n + 1);
      return true;
    } catch (e) {
      notify((e as Error).message, 'error');
      return false;
    }
  };
  /* eslint-disable react-hooks/exhaustive-deps */
  const data = useMemo(() => ({
    jobs: loadWorkshopJobs(), assets: loadAssets(), invoices: getTable<InvoiceRecord>('invoices'), settings: readWorkshopSettings(), staff: loadStaff(),
    day: todayInput(), shop: localDb.settings.activeProfile()?.companyName ?? '',
  }), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const c: Ctx = { ...data, run };
  return (
    <section className={surface.card} data-workshop-desk={v}>
      <div className={surface.cardHead}>
        <span className={controls.segment}>
          {VIEWS.map((id) => <Link key={id} to={`/time?tab=workshop&view=${id}`} className={id === v ? controls.segmentBtnActive : controls.segmentBtn}>{wsT(`v.${id}`)}</Link>)}
        </span>
      </div>
      <div className={surface.cardBody} data-tick={tick}>
        {v === 'estimates' ? <Estimates c={c} /> : v === 'claims' ? <MotorClaims c={c} /> : v === 'reminders' ? <Reminders c={c} /> : v === 'labour' ? <Labour c={c} /> : v === 'vehicles' ? <Vehicles c={c} /> : <Jobs c={c} />}
        <p className={controls.hint}>{wsT('wp')}</p>
      </div>
      {v === 'claims' && <ClaimsView notify={notify} />}
    </section>
  );
}

const assetOpts = (c: Ctx) => c.assets.map((a) => [a.id, `${assetLabel(a)} · ${a.owner_name}`] as const);
const jobOpts = (jobs: readonly ServiceJob[]) => jobs.map((j) => [j.id, `${j.number} · ${j.asset.reg_no ?? j.asset.serial ?? j.asset.model} · ${j.customer}`] as const);
const ageCls = (n: number) => (n <= 1 ? surface.badgePaid : n <= 3 ? surface.badgePartial : surface.badgeOverdue);

/* ── SV-D1 jobs ── */

function Jobs({ c }: { c: Ctx }) {
  const navigate = useNavigate();
  const [f, setF] = useState<Form>({});
  const [chk, setChk] = useState<string[]>([]);
  const [techs, setTechs] = useState<string[]>([]);
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState('');
  const asset = c.assets.find((a) => a.id === f.asset);
  const bays = (readServiceSettings().resources ?? []).filter((r) => r.active !== false).map((r) => [r.id, r.name] as const);
  const cols = board(c.jobs, c.day);
  const rows = all ? [...c.jobs].reverse() : ALL_STATUSES.flatMap((s) => cols[s] ?? []);
  const take = () => c.run(() => {
    if (!asset) throw new Error(wsT('asset'));
    const r = openJob({ date: c.day, asset, odometer: num(f.odometer) || undefined, fuel: f.fuel, complaints: (f.complaints ?? '').split('\n'), checklist: chk, promised: f.promised, bay: f.bay, technicians: techs, visit_at: f.visit_at, site: f.site || asset.site });
    setF({});
    setChk([]);
    return r.warning || r.job.number;
  });
  const move = (j: ServiceJob, to: ServiceStatus) => c.run(() => {
    const out = to === 'delivered' && j.asset_id ? num(window.prompt(wsT('odoOut'))) || undefined : undefined;
    return moveWorkshopJob(j.id, to, c.day, out).warning || rtdT(`s.${to}`);
  });
  return (
    <>
      <Fields f={f} set={setF} spec={[['asset', assetOpts(c)], ['odometer', 'number'], ['fuel', ['E', '1/4', '1/2', '3/4', 'F'].map((x) => [x, x] as const)], ['complaints', 'area'], ['promised', 'datetime-local'], ['bay', bays], ...(asset?.kind === 'appliance' ? [['visit_at', 'datetime-local'], ['site']] as const : [])]} />
      <fieldset className={styles.bar}>
        <legend className={controls.label}>{wsT('checklist')}</legend>
        {(c.settings.checklists?.length ? c.settings.checklists : DEFAULT_CHECKLIST).map((x) => <label key={x} className={controls.check}><input type="checkbox" checked={chk.includes(x)} onChange={() => setChk(chk.includes(x) ? chk.filter((y) => y !== x) : [...chk, x])} /> {x}</label>)}
      </fieldset>
      {c.staff.length > 0 && <fieldset className={styles.bar}><legend className={controls.label}>{wsT('technicians')}</legend>{c.staff.map((s) => <label key={s.id} className={controls.check}><input type="checkbox" checked={techs.includes(s.id)} onChange={() => setTechs(techs.includes(s.id) ? techs.filter((y) => y !== s.id) : [...techs, s.id])} /> {s.name}</label>)}</fieldset>}
      <div className={styles.actions}><button type="button" className={controls.btnPrimary} onClick={take} data-ws-open>{wsT('open')}</button><label className={controls.check}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {wsT('all')}</label></div>
      <Table head={['#', wsT('asset'), wsT('owner_name'), rtdT('status'), '']}>
        {rows.map((j) => {
          const a = c.assets.find((x) => x.id === j.asset_id);
          const age = 'age' in j ? (j as { age: number }).age : undefined;
          const ready = waLink(j.phone, wsT('ready', { what: `${a?.reg_no ?? ''} ${j.asset.model}`.trim(), shop: c.shop }));
          return [
            <tr key={j.id} data-ws-job={j.number}>
              <td><button type="button" className={controls.btnGhost} onClick={() => setOpen(open === j.id ? '' : j.id)}>{j.number}</button></td>
              <td>{a ? assetLabel(a) : j.asset.model}{j.bay ? ` · ${bays.find(([id]) => id === j.bay)?.[1] ?? ''}` : ''}</td>
              <td>{j.customer}</td>
              <td>{rtdT(`s.${j.status}`)} {age !== undefined && <span className={`${surface.badge} ${ageCls(age)}`}>{wsT('age', { n: age })}</span>}{j.invoice_number ? ` · ${j.invoice_number}` : ''}</td>
              <td>
                {movesFrom(j.status).map((s) => <button key={s} type="button" className={sm} onClick={() => move(j, s)} data-ws-move={s}>{rtdT(`s.${s}`)}</button>)}
                {!j.invoice_id && !j.billed_on && (j.status === 'ready' || j.status === 'delivered' || j.status === 'quality_check') && <button type="button" className={pr} onClick={() => c.run(() => { const inv = billWorkshopJob(j.id, c.day); navigate(`/invoice/${inv.id}`); return inv.invoice_number; })} data-ws-bill>{wsT('bill')}</button>}
                {j.status === 'ready' && ready && <a className={gh} href={ready} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                <button type="button" className={gh} onClick={() => printWorkshop(j.status === 'delivered' ? 'gate' : 'card', j, a, c.shop, c.settings.terms)}>{wsT(j.status === 'delivered' ? 'gate' : 'print')}</button>
              </td>
            </tr>,
            open === j.id && <tr key={`${j.id}m`}><td colSpan={5}><JobMore c={c} job={j} /></td></tr>,
          ];
        })}
      </Table>
      {!rows.length && <p className={controls.hint}>{wsT('none')}</p>}
    </>
  );
}

function JobMore({ c, job }: { c: Ctx; job: ServiceJob }) {
  const [f, setF] = useState<Form>({});
  const items = useMemo(() => stockDb.items(), []);
  const wip = godownsDb.list().find((g) => g.kind === 'wip' && g.name === WIP_NAME);
  const net = wip ? issuedNet(job, transfersDb.all(), wip.id) : new Map<string, number>();
  const est = new Map<string, number>();
  for (const q of c.invoices.filter((i) => job.quote_ids?.includes(i.id))) for (const l of q.items) if (l.type === 'Product') est.set(l.name.toLowerCase(), (est.get(l.name.toLowerCase()) ?? 0) + num(l.quantity));
  const last = job.asset_id ? lastService(job.asset_id, c.jobs, job.id) : undefined;
  const line = () => [{ item_id: f.item, qty: num(f.qty) }];
  return (
    <div data-ws-more={job.number}>
      {last && <p className={controls.hint}>{wsT('last', { number: last.number, date: last.date })}</p>}
      <p className={controls.hint}>{job.complaints?.join(' · ')}</p>
      {items.filter((i) => net.get(i.id) || est.get(i.name.toLowerCase())).map((i) => <p key={i.id} className={controls.hint}>{i.name}: {wsT('issued', { issued: net.get(i.id) ?? 0, est: est.get(i.name.toLowerCase()) ?? 0 })}</p>)}
      <div className={styles.bar}>
        <Fields f={f} set={setF} spec={[['item', items.map((i) => [i.id, i.name] as const)], ['qty', 'number']]} />
        <button type="button" className={sm} onClick={() => c.run(() => issueParts(job, line(), c.day).transfer_number)} data-ws-issue>{wsT('issue')}</button>
        <button type="button" className={gh} onClick={() => c.run(() => returnParts(job, line(), c.day).transfer_number)}>{wsT('back')}</button>
        {(job.technicians ?? []).map((id) => {
          const s = c.staff.find((x) => x.id === id) ?? { id, name: id };
          return job.clocks?.[id]
            ? <button key={id} type="button" className={sm} onClick={() => c.run(() => `${clockOut(job, s).minutes} min`)}>{wsT('clockOut', { name: s.name })}</button>
            : <button key={id} type="button" className={gh} onClick={() => c.run(() => void clockIn(job, id))}>{wsT('clockIn', { name: s.name })}</button>;
        })}
      </div>
    </div>
  );
}

/* ── SV-D2 estimates ── */

function Estimates({ c }: { c: Ctx }) {
  const [f, setF] = useState<Form>({});
  const [lines, setLines] = useState<InvoiceItem[]>([]);
  const [ap, setAp] = useState<Form>({ how: 'phone' });
  const ops = useMemo(() => loadLabourOps(), []);
  const items = useMemo(() => stockDb.items(), []);
  const open = c.jobs.filter((j) => !j.invoice_id && !j.billed_on && j.status !== 'returned');
  const job = open.find((j) => j.id === f.job);
  const asset = c.assets.find((a) => a.id === job?.asset_id);
  const quotes = c.invoices.filter((i) => job?.quote_ids?.includes(i.id));
  const add = (l: InvoiceItem) => setLines([...lines, l]);
  const addOp = () => { const op = ops.find((o) => o.id === f.op); if (op && job) add(labourLine(op, { cls: (f.cls || asset?.vclass) as VehicleClass, kind: job.kind, settings: c.settings, date: c.day, staffId: job.technicians?.[0] })); };
  const addPart = () => { const it = items.find((i) => i.id === f.item); if (it) add(partLine(it, num(f.qty) || 1)); };
  return (
    <>
      <Fields f={f} set={setF} spec={[['job', jobOpts(open)], ['cls', CLASSES.map((x) => [x, x] as const)], ['op', ops.map((o) => [o.id, `${o.code} · ${o.name}`] as const)], ['item', items.map((i) => [i.id, i.name] as const)], ['qty', 'number'], ['sublet'], ['cost', 'number'], ['markup', 'number']]} />
      <div className={styles.actions}>
        <button type="button" className={sm} disabled={!job || !f.op} onClick={addOp} data-ws-add-op>{wsT('op')} +</button>
        <button type="button" className={sm} disabled={!f.item} onClick={addPart} data-ws-add-part>{wsT('item')} +</button>
        <button type="button" className={sm} disabled={!job || !f.sublet} onClick={() => job && add(subletLine(f.sublet, num(f.cost), num(f.markup), job.kind, c.day))}>{wsT('sublet')} +</button>
      </div>
      {lines.length > 0 && (
        <Table head={[wsT('lines'), wsT('qty'), '₹', 'GST', '']}>
          {lines.map((l, i) => <tr key={l.id}><td>{l.name}</td><td>{l.quantity} {l.unit}</td><td>{formatCurrency(l.amount)}</td><td>{l.tax_rate}%</td><td><button type="button" className={gh} onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label={wsT('del')}>×</button></td></tr>)}
        </Table>
      )}
      <div className={styles.actions}><button type="button" className={controls.btnPrimary} disabled={!job || !lines.length} onClick={() => job && c.run(() => { const q = makeEstimate(job.id, lines, c.day); setLines([]); return q.invoice_number; })} data-ws-estimate>{wsT('estimate')}</button></div>
      {job && quotes.length > 0 && (
        <>
          <Table head={['#', '₹', wsT('approved'), '']}>
            {quotes.map((q) => {
              const ok = job.approvals?.filter((x) => x.quote_id === q.id).map((x) => `${x.by} · ${wsT(`h.${x.how}`)}${x.note ? ` · ${x.note}` : ''}`).join('; ');
              const wa = waLink(job.phone, wsT('waEst', { number: q.invoice_number, what: asset ? assetLabel(asset) : job.asset.model, total: formatCurrency(q.total), shop: c.shop }));
              return <tr key={q.id}><td>{q.invoice_number}</td><td>{formatCurrency(q.total)}</td><td>{ok || '—'}</td><td>{wa && <a className={gh} href={wa} target="_blank" rel="noopener noreferrer">{wsT('ask')}</a>}</td></tr>;
            })}
          </Table>
          <Fields f={ap} set={setAp} spec={[['quote', quotes.map((q) => [q.id, q.invoice_number] as const), wsT('estimate')], ['by'], ['how', (['signature', 'phone', 'whatsapp', 'in person'] as const).map((h) => [h, wsT(`h.${h}`)] as const)], ['note']]} />
          <div className={styles.actions}><button type="button" className={controls.btnPrimary} onClick={() => c.run(() => { approveEstimate(job.id, { quote_id: ap.quote ?? '', by: ap.by ?? '', how: ap.how as JobApproval['how'], note: ap.note?.trim() || undefined }); setAp({ how: 'phone' }); })} data-ws-approve>{wsT('approve')}</button></div>
        </>
      )}
    </>
  );
}

/* ── SV-D3 motor claims (SV-A5's claims desk follows) ── */

function MotorClaims({ c }: { c: Ctx }) {
  const [f, setF] = useState<Form>({ mode: 'cashless', date: c.day });
  const [s, setS] = useState<Form>({});
  const claims = loadClaims();
  const b = motorBuckets(claims, c.jobs, c.invoices, c.day);
  const clients = localDb.clients.getAll().filter((x) => x.id && x.name?.trim()).map((x) => [x.id!, x.name] as const);
  const free = c.jobs.filter((j) => !j.claim_id && j.status !== 'delivered' && j.status !== 'returned');
  const splitJobs = c.jobs.filter((j) => j.claim_id && j.invoice_id && c.invoices.find((i) => i.id === j.invoice_id)?.status === 'Draft' && !claims.find((x) => x.id === j.claim_id)?.payer_invoice_id);
  const job = splitJobs.find((j) => j.id === s.job);
  const bill = c.invoices.find((i) => i.id === job?.invoice_id);
  const asset = c.assets.find((a) => a.id === job?.asset_id);
  const split = () => c.run(() => {
    if (!job || !bill) throw new Error(wsT('needDraft'));
    const per = bill.items.some((l) => s[`a:${l.id}`]);
    const r = billMotorClaim(job.id, per
      ? { motor: { approved: Object.fromEntries(bill.items.map((l) => [l.id, num(s[`a:${l.id}`])])), category: Object.fromEntries(bill.items.filter((l) => s[`c:${l.id}`]).map((l) => [l.id, s[`c:${l.id}`] as PartCategory])), excess: num(s.excess), ageMonths: num(s.ageM || (asset ? ageMonths(asset, c.day) : 0)) } }
      : { approved: num(s.apr) }, c.settings, c.day);
    setS({});
    return [r.payer?.invoice_number, r.beneficiary?.invoice_number].filter(Boolean).join(' + ');
  });
  return (
    <>
      <p className={styles.bar}>{(['survey', 'approval', 'unpaid', 'short'] as const).map((k) => <span key={k} className={`${surface.badge} ${b[k] ? surface.badgePartial : surface.badgeDraft}`}>{wsT(`b.${k}`)}: {b[k]}</span>)}</p>
      <Fields f={f} set={setF} spec={[['job', jobOpts(free), wsT('job')], ['insurer', clients], ['policy'], ['claimNo'], ['surveyor'], ['survey', 'date'], ['mode', [['cashless', wsT('m.cashless')], ['reimbursement', wsT('m.reimbursement')]]], ['est', 'number'], ['apr', 'number'], ['salvage']]} />
      <div className={styles.actions}><button type="button" className={controls.btnPrimary} onClick={() => c.run(() => {
        const j = free.find((x) => x.id === f.job);
        const ins = clients.find(([id]) => id === f.insurer);
        if (!j || !ins) throw new Error(`${wsT('job')}, ${wsT('insurer')}`);
        const cl = openMotorClaim(j, { date: c.day, payer_id: ins[0], payer_name: ins[1], policy_no: f.policy, claim_no: f.claimNo, surveyor: f.surveyor, survey_date: f.survey || undefined, mode: f.mode as 'cashless', estimate: num(f.est), approved: num(f.apr), salvage: f.salvage?.trim() || undefined });
        setF({ mode: 'cashless' });
        return cl.number;
      })} data-ws-claim>{wsT('claim')}</button></div>
      <h3>{wsT('split')}</h3>
      <Fields f={s} set={setS} spec={[['job', jobOpts(splitJobs), wsT('job')], ['apr', 'number'], ['excess', 'number'], ['ageM', 'number']]} />
      {bill && <p className={controls.hint}>{wsT('perLine')}</p>}
      {bill?.items.map((l) => (
        <div key={l.id} className={styles.bar}>
          <span>{l.name} · {formatCurrency(round2(num(l.quantity) * num(l.rate)))}</span>
          <input className={controls.input} type="number" value={s[`a:${l.id}`] ?? ''} onChange={(e) => setS({ ...s, [`a:${l.id}`]: e.target.value })} aria-label={`${wsT('approved')} ${l.name}`} style={{ maxWidth: 120 }} />
          {l.type === 'Product' && <select className={controls.select} value={s[`c:${l.id}`] ?? ''} onChange={(e) => setS({ ...s, [`c:${l.id}`]: e.target.value })} aria-label={wsT('cat')}>{opts(PART_CATEGORIES.map((x) => [x, x] as const))}</select>}
        </div>
      ))}
      <div className={styles.actions}><button type="button" className={controls.btnPrimary} disabled={!bill} onClick={split} data-ws-split>{wsT('split')}</button>{!splitJobs.length && <span className={controls.hint}>{wsT('needDraft')}</span>}</div>
    </>
  );
}

/* ── SV-D4 reminders and AMC ── */

function Reminders({ c }: { c: Ctx }) {
  const rows = dueList(c.assets, c.day);
  const due = amcDue(amcDb.all(), c.jobs, c.day);
  const lang = getLanguage() === 'hi' ? 'hi' : 'en';
  return (
    <>
      <Table head={[wsT('asset'), wsT('owner_name'), '', '', '']}>
        {rows.map((r) => {
          const wa = waLink(r.asset.phone, reminderText(r, c.shop, lang));
          return (
            <tr key={`${r.asset.id}${r.kind}`} data-ws-due={r.kind}>
              <td>{assetLabel(r.asset)}</td><td>{r.asset.owner_name}</td><td>{wsT(r.kind)}</td><td>{r.date}{r.overdue ? ` · ${wsT('overdue')}` : ''}</td>
              <td>{wa && <a className={gh} href={wa} target="_blank" rel="noopener noreferrer">{wsT('remind')}</a>}<Link className={gh} to="/time?tab=appointments">{wsT('book')}</Link></td>
            </tr>
          );
        })}
      </Table>
      <h3>{wsT('amc')}</h3>
      <Table head={['AMC', wsT('asset'), '', '']}>
        {due.map((d) => {
          const a = c.assets.find((x) => x.id === d.asset_id);
          return (
            <tr key={`${d.contract.id}${d.asset_id}`}>
              <td>{d.contract.title} · {d.contract.client_name}</td><td>{a ? assetLabel(a) : d.asset_id}</td><td>{d.date} · {d.visit} / {d.of}</td>
              <td>{a && <button type="button" className={sm} onClick={() => c.run(() => openJob({ date: c.day, asset: a, complaints: [`AMC visit ${d.visit} of ${d.of}`], amc_id: d.contract.id, site: a.site }).job.number)}>{wsT('mkJob')}</button>}</td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}

/* ── SV-D2 labour operations, settings, efficiency ── */

const classSpec = (key: string, label: WsKey) => ['all', ...CLASSES].map((k) => [`${key}${k}`, 'number', wsT(label, { cls: k })] as const);

function Labour({ c }: { c: Ctx }) {
  const [f, setF] = useState<Form>({});
  const st = c.settings;
  const [s, setS] = useState<Form>(() => ({ ...Object.fromEntries(Object.entries(st.labour_rate ?? {}).map(([k, v]) => [`r${k}`, String(v)])), checklist: (st.checklists ?? DEFAULT_CHECKLIST).join('\n'), terms: st.terms ?? '', interval_days: String(st.default_interval?.days ?? ''), interval_km: String(st.default_interval?.km ?? ''), warranty: String(st.parts_warranty_months ?? '') }));
  const ops = loadLabourOps();
  const month = c.day.slice(0, 8) + '01';
  const eff = efficiency(timeDb.all(), c.invoices, month, c.day);
  const save = () => c.run(() => {
    const hours = Object.fromEntries(['all', ...CLASSES].filter((k) => num(f[`h${k}`]) > 0).map((k) => [k, num(f[`h${k}`])]));
    const op = saveLabourOp({ code: f.code ?? '', name: f.name ?? '', ...(f.sac?.trim() ? { sac: f.sac.trim() } : {}), hours, ...(num(f.price) > 0 ? { price: num(f.price) } : {}), ...(num(f.interval_days) > 0 ? { interval_days: num(f.interval_days) } : {}), ...(num(f.interval_km) > 0 ? { interval_km: num(f.interval_km) } : {}) });
    setF({});
    return op.code;
  });
  return (
    <>
      <Fields f={f} set={setF} spec={[['code'], ['name'], ['sac'], ['price', 'number'], ['interval_days', 'number'], ['interval_km', 'number'], ...classSpec('h', 'hours')]} />
      <div className={styles.actions}><button type="button" className={controls.btnPrimary} onClick={save} data-ws-op-save>{wsT('save')}</button></div>
      <Table head={[wsT('code'), wsT('name'), wsT('sac'), wsT('hours', { cls: '' }), wsT('price'), '']}>
        {ops.map((o) => <tr key={o.id}><td>{o.code}</td><td>{o.name}</td><td>{o.sac}</td><td>{Object.entries(o.hours ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}</td><td>{o.price ? formatCurrency(o.price) : ''}</td><td><button type="button" className={gh} onClick={() => window.confirm(`${wsT('del')} ${o.code}?`) && c.run(() => deleteLabourOp(o.id))}>{wsT('del')}</button></td></tr>)}
      </Table>
      <h3>{wsT('settings')}</h3>
      <Fields f={s} set={setS} spec={[...classSpec('r', 'rate'), ['interval_days', 'number'], ['interval_km', 'number'], ['warranty', 'number'], ['checklist', 'area'], ['terms', 'area']]} />
      <div className={styles.actions}><button type="button" className={controls.btnPrimary} onClick={() => c.run(() => void saveWorkshopSettings({
        labour_rate: Object.fromEntries(['all', ...CLASSES].map((k) => [k, num(s[`r${k}`])])), checklists: (s.checklist ?? '').split('\n'), terms: s.terms?.trim() || undefined,
        default_interval: { days: num(s.interval_days) || undefined, km: num(s.interval_km) || undefined }, parts_warranty_months: num(s.warranty) || undefined,
      }))} data-ws-settings-save>{wsT('save')}</button></div>
      <h3>{wsT('eff')}</h3>
      <Table head={[wsT('technicians'), wsT('billed'), wsT('clocked'), '%']}>
        {eff.map((r) => <tr key={r.staff_id}><td>{c.staff.find((x) => x.id === r.staff_id)?.name ?? r.staff_id}</td><td>{r.billed}</td><td>{r.clocked}</td><td>{r.pct}</td></tr>)}
      </Table>
    </>
  );
}

/* ── SV-D1 vehicles / appliances ── */

const ASSET_KEYS = ['reg_no', 'make', 'model', 'variant', 'fuel', 'year', 'vin', 'engine_no', 'colour', 'serial', 'site', 'owner_name', 'phone', 'insurer', 'policy_no', 'policy_expiry'] as const;

function Vehicles({ c }: { c: Ctx }) {
  const [f, setF] = useState<Form>({ kind: 'vehicle' });
  const [open, setOpen] = useState('');
  const clients = localDb.clients.getAll().filter((x) => x.id && x.name?.trim());
  const save = () => c.run(() => {
    const owner = clients.find((x) => x.id === f.owner);
    const rest = Object.fromEntries(ASSET_KEYS.filter((k) => f[k]?.trim()).map((k) => [k, k === 'year' ? num(f[k]) : f[k].trim()]));
    const a = saveAsset({ ...rest, kind: f.kind as 'vehicle', model: f.model ?? '', owner_name: f.owner_name?.trim() || owner?.name || '', ...(owner ? { client_id: owner.id, phone: f.phone?.trim() || owner.phone } : {}), ...(f.cls ? { vclass: f.cls as VehicleClass } : {}) });
    setF({ kind: f.kind });
    return assetLabel(a);
  });
  return (
    <>
      <Fields f={f} set={setF} spec={[['kind', [['vehicle', wsT('k.vehicle')], ['appliance', wsT('k.appliance')]]], ['owner', clients.map((x) => [x.id!, x.name] as const)], ['cls', CLASSES.map((x) => [x, x] as const)], ...ASSET_KEYS.filter((k) => (f.kind === 'appliance' ? !['reg_no', 'variant', 'fuel', 'vin', 'engine_no', 'insurer', 'policy_no', 'policy_expiry'].includes(k) : !['serial', 'site'].includes(k))).map((k) => [k, k === 'year' ? 'number' : k === 'policy_expiry' ? 'date' : '', k === 'policy_no' ? wsT('policy') : undefined] as const)]} />
      <div className={styles.actions}><button type="button" className={controls.btnPrimary} onClick={save} data-ws-asset-save>{wsT('save')}</button></div>
      <Table head={[wsT('asset'), wsT('owner_name'), wsT('odometer'), wsT('service'), '']}>
        {c.assets.map((a) => [
          <tr key={a.id} data-ws-asset={a.reg_no ?? a.serial}>
            <td><button type="button" className={controls.btnGhost} onClick={() => setOpen(open === a.id ? '' : a.id)}>{assetLabel(a)}</button></td><td>{a.owner_name} {a.phone}</td><td>{lastKm(a) ?? ''}</td>
            <td>{[a.next_service_date, a.next_service_km && `${a.next_service_km} km`].filter(Boolean).join(' · ')}</td>
            <td><button type="button" className={gh} onClick={() => window.confirm(`${wsT('del')} ${assetLabel(a)}?`) && c.run(() => deleteAsset(a.id, c.jobs))}>{wsT('del')}</button></td>
          </tr>,
          open === a.id && (
            <tr key={`${a.id}h`}><td colSpan={5} data-ws-history>
              <strong>{wsT('history')}</strong>
              {assetJobs(a.id, c.jobs).map((j) => <p key={j.id} className={controls.hint}>{j.date} · {j.number} · {rtdT(`s.${j.status}`)}{j.odometer_in ? ` · ${j.odometer_in} km` : ''}{j.invoice_number ? ` · ${j.invoice_number} ${formatCurrency(c.invoices.find((i) => i.id === j.invoice_id)?.total ?? 0)}` : ''} · {j.complaints?.join(', ')}</p>)}
              <p className={controls.hint}>{wsT('readings')}: {(a.odometer ?? []).map((r) => `${r.date} ${r.km}`).join(' · ')}</p>
            </td></tr>
          ),
        ])}
      </Table>
    </>
  );
}
