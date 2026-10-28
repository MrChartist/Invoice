/**
 * R19-C customs view (`/time?tab=shipments&view=customs`, pack `customs`): per job — the client's authorisation and
 * KYC (Rule 33 limb (i), CBLR Reg 10(n)), the deposit position (short / excess), disbursements on the client's behalf
 * with the Rule 33 checklist (warns, never blocks) and write-off, duty deposits with apply / refund; for every job the
 * unrecovered ageing and the CBLR Reg 10(k) register (print + CSV). Disbursements are billed by B's charge sheet or the
 * invoice editor's billable costs (Rule 33 lines). Working papers — verify with your CA (LG10–LG12, LG26, LG27).
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { lgT } from '../../i18n/areas/logistics-r19a';
import { lgcList, lgcT } from '../../i18n/areas/logistics-r19c';
import { localDb } from '../../lib/localDb';
import { getIndianFY } from '../../lib/invoice-number';
import { formatCurrency, todayInput } from '../../lib/utils';
import { escHtml } from '../../lib/html-esc';
import { printHtmlDocument } from '../../lib/voucher-print';
import { downloadText } from '../../lib/download';
import { currentActor } from '../../lib/access';
import { loadJobs, saveJob } from '../../lib/logistics/lg-save';
import { readLogisticsSettings } from '../../lib/logistics/lg-settings';
import { ageBuckets, LG_DISB_KINDS, rule33Gaps, sumOf, unrecovered, type LgDisbKind } from '../../lib/logistics/lg-disb';
import { depositPosition, depositShortfall } from '../../lib/logistics/lg-deposits';
import { kycMissing, registerCsv, registerRows, registerTitle, REGISTER_COLS, REGISTER_HEAD } from '../../lib/logistics/lg-register';
import { addDeposit, addDisbursement, applyDeposit, importDocRefs, jobOpenInvoices, loadDeposits, loadDisb, refundDeposit, saveKyc, writeOffDisb } from '../../lib/logistics/lg-recv-io';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { In, Pick, type LgViewProps } from './lg-ui';
import { numIn, row } from './lg-form';

const sm = (c: string) => `${c} ${controls.btnSm}`;
const KYC_HOW = ['documents', 'visit', 'both'] as const;
type KycHow = (typeof KYC_HOW)[number];
const Check = ({ label, on, set, off }: { label: string; on: boolean; set?: (v: boolean) => void; off?: boolean }) => <label className={controls.check}><input type="checkbox" checked={on} disabled={off} onChange={(e) => set?.(e.target.checked)} /> {label}</label>;

export default function CustomsView({ notify }: LgViewProps) {
  useT();
  const today = todayInput();
  const [tick, setTick] = useState(0);
  const [jobId, setJobId] = useState('');
  const [d, setD] = useState({ kind: 'duty' as LgDisbKind, payee: '', ref: '', amount: undefined as number | undefined, date: today, inName: true, extra: true, paid: true });
  const [dep, setDep] = useState({ amount: undefined as number | undefined, date: today, method: 'Bank transfer', ref: '' });
  const [reason, setReason] = useState('');
  const [inv, setInv] = useState('');
  const [rg, setRg] = useState({ from: `${getIndianFY(today).startYear}-04-01`, to: today });
  const [k, setK] = useState({ ref: '', date: '', iec: '', on: '', how: '' });
  const data = useMemo(() => {
    void tick;
    return { jobs: loadJobs(), clients: localDb.clients.getAll(), disb: loadDisb(today), deps: loadDeposits() };
  }, [tick, today]);
  const run = (fn: () => string | void) => { try { notify(fn() || lgcT('done')); setTick((t) => t + 1); } catch (e) { notify((e as Error).message, 'error'); } };
  const job = data.jobs.find((j) => j.id === jobId);
  const client = data.clients.find((c) => c.id === job?.client_id);
  const mine = data.disb.filter((r) => r.job_id === jobId);
  const deps = data.deps.filter((x) => x.job_id === jobId);
  const invs = job ? jobOpenInvoices(job.id) : [];
  const pos = depositPosition(deps, sumOf(unrecovered(mine)), sumOf(invs.map((i) => ({ amount: i.open }))));
  const open = unrecovered(data.disb);
  const name = (id: string) => data.clients.find((c) => c.id === id)?.name ?? id;
  const regRows = registerRows({ jobs: data.jobs, clients: data.clients, invoices: localDb.invoices.getAll(), disb: data.disb, deposits: data.deps, ...rg });
  const saveDisb = () => run(() => {
    if (!job) throw new Error(lgcT('pick'));
    addDisbursement({ job, kind: d.kind, payee: d.payee, ref: d.ref, amount: d.amount ?? 0, date: d.date, in_client_name: d.inName }, d.paid ? { method: 'Bank transfer' } : undefined);
    const after = depositPosition(deps, pos.unrecovered + (d.amount ?? 0), pos.owed);
    const short = depositShortfall(readLogisticsSettings(), d.kind, after);
    setD({ ...d, payee: '', ref: '', amount: undefined });
    return [lgcT('done'), ...rule33Gaps({ auth: job.auth, extra: d.extra, inName: d.inName }).map((n) => lgcT('wLimb', { n })), ...(short ? [lgcT('hDep', { a: formatCurrency(short) })] : [])].join(' ');
  });
  const print = () => {
    const t = registerTitle(today);
    const body = regRows.map((r) => `<tr>${REGISTER_COLS.map((k) => `<td>${escHtml(typeof r[k] === 'number' ? formatCurrency(r[k] as number) : r[k])}</td>`).join('')}</tr>`).join('');
    printHtmlDocument(`<!doctype html><meta charset="utf-8"><title>${escHtml(t)}</title><body><h2>${escHtml(t)}</h2><p>${escHtml(`${rg.from} – ${rg.to}`)}</p><table border="1" cellpadding="4"><tr>${REGISTER_HEAD.map((h) => `<th>${escHtml(h)}</th>`).join('')}</tr>${body}</table><p>${escHtml(lgT('wp'))}</p></body>`, (h) => downloadText('cb-register.html', h, 'text/html'));
  };
  const pickJob = (id: string) => {
    const j = data.jobs.find((x) => x.id === id);
    const c = data.clients.find((x) => x.id === j?.client_id)?.lg;
    setJobId(id);
    setK({ ref: j?.auth?.ref ?? '', date: j?.auth?.date ?? '', iec: c?.iec ?? '', on: c?.kyc?.verified_on ?? '', how: c?.kyc?.method ?? '' });
  };
  const saveAuth = () => run(() => {
    if (!job || !client) return;
    saveJob({ ...job, auth: { ...(k.ref.trim() ? { ref: k.ref.trim() } : {}), ...(k.date ? { date: k.date } : {}) } }, readLogisticsSettings().job_prefix);
    const kyc = client.lg?.kyc;
    saveKyc(client, { ...client.lg, ...(k.iec.trim() ? { iec: k.iec.trim().toUpperCase() } : { iec: undefined }), kyc: { ...kyc, verified_on: k.on || undefined, method: (k.how || undefined) as KycHow | undefined, ...(k.on && k.on !== kyc?.verified_on ? { by: currentActor()?.name } : {}) } });
  });
  return (
    <section data-lg-customs>
      <div style={row}>
        <Pick label={lgcT('job')} value={jobId} ids={data.jobs.map((j) => j.id)} name={(id) => { const j = data.jobs.find((x) => x.id === id)!; return `${j.number} · ${name(j.client_id)}`; }} blank="" onChange={pickJob} attr="customs-job" />
        <label className={controls.btnOutline}>{lgcT('importRefs')}<input type="file" accept=".csv,text/csv" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void f.text().then((x) => run(() => { const r = importDocRefs(x); return [lgcT('imported', { n: r.updated }), ...r.errors.slice(0, 5)].join(' '); })); }} data-lg-import-refs /></label>
      </div>
      {job && (
        <>
          {kycMissing(client) && <p className={controls.hint} data-lg-kyc-hint>{lgcT('noKyc', { c: client?.name ?? '' })}</p>}
          <div style={row}>
            <In label={lgcT('auth')} value={k.ref} onChange={(v) => setK({ ...k, ref: v })} attr="auth-ref" />
            <In label={lgcT('authDate')} type="date" value={k.date} onChange={(v) => setK({ ...k, date: v })} />
            <In label={lgcT('iec')} value={k.iec} onChange={(v) => setK({ ...k, iec: v })} attr="iec" />
            <In label={lgcT('verified')} type="date" value={k.on} onChange={(v) => setK({ ...k, on: v })} attr="kyc-on" />
            <Pick label={lgcT('how')} value={k.how} ids={KYC_HOW} name={(x) => lgcList('kyc_methods', KYC_HOW, x)} blank="" onChange={(v) => setK({ ...k, how: v })} />
            <button type="button" className={controls.btnOutline} onClick={saveAuth} data-lg-save-auth>{lgcT('saveAuth')}</button>
          </div>
          <p data-lg-position={pos.state}>
            {lgcT('received')} {formatCurrency(pos.received)} · {lgcT('unapplied')} {formatCurrency(pos.open)} · {lgcT('unrec')} {formatCurrency(pos.unrecovered)} · {lgcT('owed')} {formatCurrency(pos.owed)}{' '}
            {pos.state !== 'even' && <span className={surface.badge}>{lgcT(pos.state, { a: formatCurrency(Math.abs(pos.gap)) })}</span>}
          </p>
          <h4>{lgcT('disb')}</h4>
          <div style={row}>
            <Pick label={lgcT('kind')} value={d.kind} ids={LG_DISB_KINDS} name={(x) => lgcList('kinds', LG_DISB_KINDS, x)} onChange={(v) => setD({ ...d, kind: v as LgDisbKind })} attr="disb-kind" />
            <In label={lgcT('payee')} value={d.payee} onChange={(v) => setD({ ...d, payee: v })} attr="disb-payee" />
            <In label={lgcT('ref')} value={d.ref} onChange={(v) => setD({ ...d, ref: v })} attr="disb-ref" />
            <In label={lgcT('amount')} type="number" value={d.amount} onChange={(v) => setD({ ...d, amount: numIn(v) })} attr="disb-amount" />
            <In label={lgcT('date')} type="date" value={d.date} onChange={(v) => setD({ ...d, date: v })} />
          </div>
          <div style={row}>
            <Check label={lgcT('l1')} on={!rule33Gaps({ auth: job.auth, extra: true, inName: true }).length} off />
            <Check label={lgcT('l2')} on off />
            <Check label={lgcT('l3')} on={d.extra} set={(v) => setD({ ...d, extra: v })} />
            <Check label={lgcT('l4')} on={d.inName} set={(v) => setD({ ...d, inName: v })} />
            <Check label={lgcT('paid')} on={d.paid} set={(v) => setD({ ...d, paid: v })} />
            <button type="button" className={controls.btnPrimary} onClick={saveDisb} data-lg-add-disb>{lgcT('addDisb')}</button>
          </div>
          {mine.length > 0 && (
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <tbody>
                  {mine.map((r) => (
                    <tr key={r.id} data-lg-disb={r.kind}>
                      <td>{r.date}</td><td>{lgcList('kinds', LG_DISB_KINDS, r.kind)}</td><td>{r.ref}</td><td>{r.payee}</td><td className={surface.numeric}>{formatCurrency(r.amount)}</td>
                      <td>{r.wo ? lgcT('off') : r.billed ? lgcT('billed') : lgcT('toRecover')}</td>
                      <td>{!r.billed && !r.wo && <button type="button" className={sm(controls.btnGhost)} onClick={() => run(() => writeOffDisb(r.id, today, reason, currentActor()?.name))}>{lgcT('wo')}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={row}><In label={lgcT('reason')} value={reason} onChange={setReason} /></div>
          <p className={controls.hint}>{lgcT('seam')}</p>
          <h4>{lgcT('deps')}</h4>
          <div style={row}>
            <In label={lgcT('amount')} type="number" value={dep.amount} onChange={(v) => setDep({ ...dep, amount: numIn(v) })} attr="dep-amount" />
            <In label={lgcT('date')} type="date" value={dep.date} onChange={(v) => setDep({ ...dep, date: v })} />
            <In label={lgcT('method')} value={dep.method} onChange={(v) => setDep({ ...dep, method: v })} />
            <In label={lgcT('ref')} value={dep.ref} onChange={(v) => setDep({ ...dep, ref: v })} />
            <button type="button" className={controls.btnPrimary} onClick={() => run(() => { addDeposit(job, { ...dep, amount: dep.amount ?? 0, reference: dep.ref }); setDep({ ...dep, amount: undefined, ref: '' }); })} data-lg-add-dep>{lgcT('addDep')}</button>
          </div>
          {deps.length > 0 && (
            <>
              <div style={row}>{invs.length ? <Pick label={lgcT('invoice')} value={inv} ids={invs.map((i) => i.id)} name={(id) => { const i = invs.find((x) => x.id === id)!; return `${i.number} · ${formatCurrency(i.open)}`; }} blank="" onChange={setInv} attr="dep-invoice" /> : <p className={controls.hint}>{lgcT('noInv')}</p>}</div>
              <div className={surface.tableWrap}>
                <table className={surface.table}>
                  <tbody>
                    {deps.map((x) => (
                      <tr key={x.id} data-lg-dep={x.number}>
                        <td>{x.number}</td><td>{x.date}</td><td className={surface.numeric}>{formatCurrency(x.amount)}</td><td className={surface.numeric}>{formatCurrency(x.open)}</td>
                        <td>{x.open > 0 && <>
                          <button type="button" className={sm(controls.btnOutline)} disabled={!inv} onClick={() => run(() => void applyDeposit(x, inv))} data-lg-apply>{lgcT('apply')}</button>
                          <button type="button" className={sm(controls.btnGhost)} onClick={() => run(() => void refundDeposit(x, job.number, today, dep.method))}>{lgcT('refund')}</button>
                        </>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
      <h4>{lgcT('age')}</h4>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-lg-ageing>
          <thead><tr><th>{lgcT('job')}</th>{['0–30', '31–60', '61–90', '90+'].map((b) => <th key={b} className={surface.numeric}>{b}</th>)}</tr></thead>
          <tbody>
            {[...new Set(open.map((r) => r.job_id))].map((id) => (
              <tr key={id}><td>{data.jobs.find((j) => j.id === id)?.number ?? id}</td>{ageBuckets(open.filter((r) => r.job_id === id)).map((n, k) => <td key={k} className={surface.numeric}>{formatCurrency(n)}</td>)}</tr>
            ))}
          </tbody>
          <tfoot><tr><th>{lgT('total')}</th>{ageBuckets(open).map((n, k) => <td key={k} className={surface.numeric}>{formatCurrency(n)}</td>)}</tr></tfoot>
        </table>
      </div>
      <h4>{lgcT('register')}</h4>
      <div style={row}>
        <In label={lgcT('from')} type="date" value={rg.from} onChange={(v) => setRg({ ...rg, from: v })} />
        <In label={lgcT('to')} type="date" value={rg.to} onChange={(v) => setRg({ ...rg, to: v })} />
        <button type="button" className={controls.btnOutline} onClick={print} data-lg-register-print>{lgcT('print')} ({regRows.length})</button>
        <button type="button" className={controls.btnOutline} onClick={() => downloadText(`cb-register-${rg.from}-${rg.to}.csv`, registerCsv(regRows), 'text/csv')} data-lg-register-csv>{lgcT('csv')}</button>
      </div>
    </section>
  );
}
