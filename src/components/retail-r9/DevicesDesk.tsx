/**
 * RT-D Devices desk (Inventory → Devices, pack `electronics`) and its host parts — ONE lazy chunk: views *IMEI* (lookup by
 * IMEI 1 / IMEI 2, blocked-IMEI check log), *Finance* (DOs, disbursements, financier summary), *Buy-back* (URD vouchers,
 * exchange on a bill, resale margin) and *Repairs* (job sheets, warranty claims, billing); plus `PosDevices` (POS: IMEI
 * scan, finance / exchange tenders, margin scheme, cash guard) and `EditorDevices` (editor: IMEI scan, margin scheme).
 * Working papers — verify with your CA (RT10–RT15).
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HandCoins, Printer, RefreshCw, ScanLine, Settings } from 'lucide-react';
import { useT } from '../../i18n';
import { rtdT } from '../../i18n/areas/retail-r9d';
import { SerialLookup } from '../inventory/SerialLookup';
import FinanceTender, { type FinTender } from './FinanceTender';
import ExchangeTender, { type ExTender } from './ExchangeTender';
import { printJobCard } from './JobCardPrint';
import { deleteImeiCheck, loadImeiChecks, logImeiCheck, pairIndex, pairsOf, resaleCheckIssue, serialHit, serialIndex } from '../../lib/retail/rt-imei';
import { cancelDeal, dealOpen, feeSplit, financeCsv, financierSummary, loadDeals, pendingDos, recordDisbursement, recordFinance, undoDisbursement } from '../../lib/retail/rt-finance';
import { applyExchange, buyBackOf, buyBackRows, deleteBuyBack, marginIssue, marginLines, openVouchers, recordBuyBack } from '../../lib/retail/rt-buyback';
import { cashReceiptIssue, sameDayCash } from '../../lib/retail/rt-cash-guard';
import { addJob, billJob, canMove, deleteJob, isOpenJob, jobAge, jobLink, loadJobs, moveJob, nextServiceStatus, repairRule, setClaim, updateJob } from '../../lib/retail/rt-service-jobs';
import { readRetailSettings } from '../../lib/retail/rt-settings';
import { serialScan } from '../../lib/scan';
import { loadTracking } from '../../lib/stock-tracking';
import { godownsDb } from '../../lib/godowns';
import { stockDb } from '../../lib/inventory';
import { purchasesDb } from '../../lib/purchases';
import { localDb } from '../../lib/localDb';
import { generateId, getTable } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { formatCurrency, todayInput } from '../../lib/utils';
import { shiftDay } from '../../lib/dates';
import { RT_SERIES } from '../../lib/retail/rt-shared';
import type { RepairKind } from '../../lib/retail-rules';
import type { InvoiceItem, InvoiceRecord, Payment } from '../../types/invoice';
import type { ServiceJob, ServicePart } from '../../types/retail-r9';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { downloadTextFile } from '../receivables/exportUtils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

type Done = (msg: string, error?: boolean) => void;
type Form = Record<string, string>;
const VIEWS = [['imei', ScanLine], ['finance', HandCoins], ['buyback', RefreshCw], ['service', Settings]] as const;
const sm = `${controls.btnOutline} ${controls.btnSm}`;
const gh = `${controls.btnGhost} ${controls.btnSm}`;
const row = { flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' } as const;
const invoiceByNo = (no: string) => getTable<InvoiceRecord>('invoices').find((i) => i?.invoice_number?.toUpperCase() === no.trim().toUpperCase());

/** A labelled text input bound to a form key (`data-dev-<key>` for the e2e). */
function In({ k, f, set, type, w }: { k: string; f: Form; set: (k: string, v: string) => void; type?: string; w?: number }) {
  return (
    <label className={controls.field} style={w ? { maxWidth: w } : undefined}>
      <span className={controls.label}>{rtdT(k as never)}</span>
      <input className={controls.input} type={type} inputMode={type === 'number' ? 'decimal' : undefined} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} {...{ [`data-dev-${k.toLowerCase()}`]: '' }} />
    </label>
  );
}
const useForm = (init: Form) => {
  const [f, setF] = useState<Form>(init);
  return [f, (k: string, v: string) => setF((x) => ({ ...x, [k]: v })), () => setF(init)] as const;
};

export default function DevicesDesk({ view, onDone }: { view?: string; onDone: Done }) {
  useT();
  const v = VIEWS.some(([id]) => id === view) ? view : 'imei';
  const [tick, setTick] = useState(0);
  const run = (fn: () => string | Promise<string>) => {
    Promise.resolve().then(fn).then((m) => { setTick((t) => t + 1); onDone(m); }).catch((e: Error) => onDone(e.message, true));
  };
  return (
    <section className={surface.card} data-devices-desk={v}>
      <div className={surface.cardHead}>
        <span className={controls.segment}>
          {VIEWS.map(([id, Icon]) => (
            <Link key={id} to={`/inventory?tab=devices&view=${id}`} className={id === v ? `${controls.segmentBtn} ${controls.segmentBtnActive}` : controls.segmentBtn}><Icon size={14} aria-hidden="true" /> {rtdT(`view.${id}`)}</Link>
          ))}
        </span>
      </div>
      <div className={surface.cardBody} key={tick}>
        {v === 'finance' ? <FinanceView run={run} /> : v === 'buyback' ? <BuyBackView run={run} /> : v === 'service' ? <ServiceView run={run} /> : <ImeiView run={run} />}
        <p className={controls.hint}>{rtdT('wp')}</p>
      </div>
    </section>
  );
}
type Run = { run: (fn: () => string | Promise<string>) => void };

/* ── RT-D1 IMEI ── */

function ImeiView({ run }: Run) {
  const day = todayInput();
  const tracking = useMemo(() => loadTracking(), []);
  const index = useMemo(() => serialIndex(tracking, pairIndex(purchasesDb.all())), [tracking]);
  const [q, setQ] = useState('');
  const hit = q.trim() ? index.get(q.trim().toUpperCase()) : undefined;
  const checks = loadImeiChecks().sort((a, b) => b.date.localeCompare(a.date));
  const [f, set, reset] = useForm({ imei: '', result: 'clear', ref: '', date: day });
  return (
    <>
      <h3 className={surface.cardHeadIcon}><ScanLine size={16} aria-hidden="true" /> {rtdT('lookupTitle')}</h3>
      <input className={controls.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="IMEI" aria-label={rtdT('lookupTitle')} style={{ maxWidth: 320 }} data-dev-lookup />
      {hit && <p data-dev-hit>{hit.item.name} · <span className={surface.mono}>{hit.serial}{hit.pair ? ` / ${hit.pair}` : ''}</span></p>}
      <SerialLookup key={hit?.serial ?? ''} tracking={tracking} today={day} godowns={godownsDb.list()} initialQuery={hit?.serial ?? ''} />
      <h3 className={surface.cardHeadIcon}>{rtdT('checkTitle')}</h3>
      <p className={surface.sectionNote}>{rtdT('checkNote')}</p>
      <div className={controls.row} style={row}>
        <In k="imei" f={f} set={set} />
        <label className={controls.field}><span className={controls.label}>{rtdT('result')}</span>
          <select className={controls.select} value={f.result} onChange={(e) => set('result', e.target.value)} data-dev-result><option value="clear">{rtdT('clear')}</option><option value="blocked">{rtdT('blocked')}</option></select>
        </label>
        <In k="ref" f={f} set={set} />
        <In k="date" f={f} set={set} type="date" />
        <button type="button" className={controls.btnPrimary} disabled={!f.imei.trim()} onClick={() => run(() => (logImeiCheck({ date: f.date, imei: f.imei, result: f.result as 'clear', portal_ref: f.ref }), reset(), rtdT('logged')))} data-dev-check-save>{rtdT('save')}</button>
      </div>
      {checks.length > 0 && (
        <div className={surface.tableWrap}><table className={surface.table}><tbody>
          {checks.slice(0, 100).map((c) => <tr key={c.id} data-dev-check={c.imei}><td>{c.date}</td><td className={surface.mono}>{c.imei}</td><td>{rtdT(c.result)}</td><td>{c.portal_ref ?? ''}</td><td><button type="button" className={gh} onClick={() => run(() => (deleteImeiCheck(c.id), rtdT('del')))}>{rtdT('del')}</button></td></tr>)}
        </tbody></table></div>
      )}
    </>
  );
}

/* ── RT-D2 Finance ── */

function FinanceView({ run }: Run) {
  const day = todayInput();
  const deals = loadDeals().sort((a, b) => b.date.localeCompare(a.date));
  const [f, set, reset] = useForm({ bill: '', financier: '', loan: '', doNo: '', scheme: '', loanAcc: '' });
  const [rx, setRx] = useState<{ id: string; amount: string; fee: string; date: string } | null>(null);
  const fee = feeSplit(0, day);
  const late = pendingDos(deals, day).length;
  const save = () => run(() => {
    const inv = invoiceByNo(f.bill);
    if (!inv) throw new Error(rtdT('noBill', { number: f.bill }));
    const d = recordFinance({ invoiceId: inv.id, financier: f.financier, loan: num(f.loan), doNo: f.doNo, scheme: f.scheme, loanAccount: f.loanAcc });
    reset();
    return rtdT('finSaved', { no: d.do_no });
  });
  return (
    <>
      <h3 className={surface.cardHeadIcon}><HandCoins size={16} aria-hidden="true" /> {rtdT('finTitle')}</h3>
      <p className={surface.sectionNote}>{rtdT('finNote', { sac: fee.sac, rate: fee.rate })}</p>
      <div className={controls.row} style={row}>
        {['bill', 'financier', 'loan', 'doNo', 'scheme', 'loanAcc'].map((k) => <In key={k} k={k} f={f} set={set} type={k === 'loan' ? 'number' : undefined} w={k === 'scheme' || k === 'loanAcc' ? 120 : undefined} />)}
        <button type="button" className={controls.btnPrimary} onClick={save} data-dev-fin-save>{rtdT('save')}</button>
      </div>
      {late > 0 && <p className={controls.error} role="status">{rtdT('pending', { n: late })}</p>}
      {deals.length === 0 ? <p className={controls.hint}>{rtdT('none')}</p> : (
        <>
          <div className={surface.tableWrap}><table className={surface.table}>
            <thead><tr><th>{rtdT('date')}</th><th>{rtdT('bill')}</th><th>{rtdT('financier')}</th><th>{rtdT('doNo')}</th><th className={surface.numeric}>{rtdT('loan')}</th><th className={surface.numeric}>{rtdT('open')}</th><th /></tr></thead>
            <tbody>{deals.map((d) => (
              <tr key={d.id} data-dev-deal={d.do_no}>
                <td>{d.date}</td><td>{d.invoice_number}<br /><small>{d.customer}</small></td><td>{d.financier}{d.scheme ? <small> · {d.scheme}</small> : null}</td><td className={surface.mono}>{d.do_no}</td>
                <td className={surface.numeric}>{formatCurrency(d.loan)}</td><td className={surface.numeric}>{formatCurrency(dealOpen(d))}</td>
                <td style={{ textAlign: 'right' }}>
                  {rx?.id === d.id ? (
                    <span className={controls.row} style={row}>
                      <input className={controls.input} type="date" value={rx.date} onChange={(e) => setRx({ ...rx, date: e.target.value })} aria-label={rtdT('date')} />
                      <input className={controls.input} inputMode="decimal" placeholder={rtdT('amount')} aria-label={rtdT('amount')} value={rx.amount} onChange={(e) => setRx({ ...rx, amount: e.target.value })} style={{ maxWidth: 110 }} />
                      <input className={controls.input} inputMode="decimal" placeholder={rtdT('fee')} aria-label={rtdT('fee')} value={rx.fee} onChange={(e) => setRx({ ...rx, fee: e.target.value })} style={{ maxWidth: 100 }} />
                      <button type="button" className={sm} onClick={() => run(() => (recordDisbursement(d.id, { date: rx.date, amount: num(rx.amount), fee: num(rx.fee) }), setRx(null), rtdT('received')))}>{rtdT('save')}</button>
                    </span>
                  ) : dealOpen(d) > 0.004 && <button type="button" className={sm} onClick={() => setRx({ id: d.id, amount: String(dealOpen(d) - num(d.expected_fee)), fee: String(num(d.expected_fee) || ''), date: day })}>{rtdT('received')}</button>}
                  {d.disbursements.length > 0 && <button type="button" className={gh} onClick={() => run(() => (undoDisbursement(d.id, d.disbursements[d.disbursements.length - 1].id), rtdT('undo')))}>{rtdT('undo')}</button>}
                  {!d.disbursements.length && <button type="button" className={gh} onClick={() => window.confirm(`${rtdT('cancel')} ${d.do_no}?`) && run(() => (cancelDeal(d.id), rtdT('cancel')))}>{rtdT('cancel')}</button>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          <ul className={controls.hint}>{financierSummary(deals).map((s) => <li key={s.financier}>{s.financier}: {s.deals} · {formatCurrency(s.loan)} · {rtdT('received')} {formatCurrency(s.received)} · {rtdT('fee')} {formatCurrency(s.fees)} · {rtdT('open')} {formatCurrency(s.open)}</li>)}</ul>
          <button type="button" className={sm} onClick={() => downloadTextFile(`Finance_DOs_${day}.csv`, financeCsv(deals, day))}>{rtdT('csv')}</button>
        </>
      )}
    </>
  );
}

/* ── RT-D3 Buy-back ── */

function BuyBackView({ run }: Run) {
  const day = todayInput();
  const rows = buyBackRows(purchasesDb.all(), getTable<InvoiceRecord>('invoices'));
  const pays = getTable<Payment>('transactions');
  const left = new Map(openVouchers(purchasesDb.all(), pays).map((x) => [x.purchase.id, x.left]));
  const checks = loadImeiChecks();
  const [f, set, reset] = useForm({ customer: '', phone: '', model: '', imei: '', value: '', condition: '', idType: '', idLast4: '', gst: '18' });
  const save = () => run(() => {
    const p = recordBuyBack({ date: day, customer: f.customer, phone: f.phone, model: f.model, serial: f.imei, value: num(f.value), hsn: '8517', taxRate: num(f.gst), goods: { condition: f.condition, id_type: f.idType, id_last4: f.idLast4.slice(-4), imei_check_id: [...checks].reverse().find((c) => c.imei === f.imei.trim())?.id } });
    reset();
    return rtdT('bbSaved', { number: p.bill_number });
  });
  const exchange = (id: string) => {
    const no = window.prompt(rtdT('bill'));
    if (no) run(() => {
      const inv = invoiceByNo(no);
      if (!inv) throw new Error(rtdT('noBill', { number: no }));
      return `${applyExchange(inv.id, id).amount} ✓`;
    });
  };
  const warn = f.imei.trim() ? resaleCheckIssue(checks, f.imei.trim(), day) : '';
  return (
    <>
      <h3 className={surface.cardHeadIcon}><RefreshCw size={16} aria-hidden="true" /> {rtdT('bbTitle')}</h3>
      <p className={surface.sectionNote}>{rtdT('bbNote', { series: `${RT_SERIES.urd}/FY…` })}</p>
      <div className={controls.row} style={row}>
        {['customer', 'phone', 'model', 'imei', 'value', 'condition', 'idType', 'idLast4', 'gst'].map((k) => <In key={k} k={k} f={f} set={set} type={k === 'value' || k === 'gst' ? 'number' : undefined} w={k === 'gst' || k === 'idLast4' ? 90 : undefined} />)}
        <button type="button" className={controls.btnPrimary} onClick={save} data-dev-bb-save>{rtdT('save')}</button>
      </div>
      {warn && <p className={controls.hint} role="status">{rtdT('checkWarn')}: {warn}</p>}
      {num(f.value) > 10000 && <p className={controls.hint}>{rtdT('cash40')}</p>}
      {rows.length === 0 ? <p className={controls.hint}>{rtdT('none')}</p> : (
        <div className={surface.tableWrap}><table className={surface.table}>
          <thead><tr><th>#</th><th>{rtdT('customer')}</th><th>{rtdT('model')}</th><th className={surface.numeric}>{rtdT('value')}</th><th>{rtdT('resale')}</th><th className={surface.numeric}>{rtdT('margin')}</th><th /></tr></thead>
          <tbody>{rows.map(({ purchase: p, sale, margin }) => (
            <tr key={p.id} data-dev-bb={p.bill_number}>
              <td className={surface.mono}>{p.bill_number}<br /><small>{p.date}</small></td><td>{p.vendor_name}</td>
              <td>{p.used_goods.model}<br /><small className={surface.mono}>{p.used_goods.serial}</small></td>
              <td className={surface.numeric}>{formatCurrency(p.total)}{left.has(p.id) ? null : <small> · {rtdT('settled')}</small>}</td>
              <td>{sale?.invoice_number ?? '—'}</td><td className={surface.numeric}>{margin === undefined ? '' : formatCurrency(margin)}</td>
              <td style={{ textAlign: 'right' }}>
                {left.has(p.id) && <button type="button" className={sm} onClick={() => exchange(p.id)} data-dev-bb-exchange>{rtdT('exchange')}</button>}
                <button type="button" className={gh} onClick={() => window.confirm(`${rtdT('del')} ${p.bill_number}?`) && run(() => (deleteBuyBack(p.id), rtdT('del')))}>{rtdT('del')}</button>
              </td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </>
  );
}

/* ── RT-D4 Repairs ── */

const KINDS: RepairKind[] = ['phone', 'computer', 'appliance', 'vehicle', 'other'];
const PART = /^(.*?)\s*[×x*]\s*([\d.]+)\s*@\s*([\d.]+)\s*(w)?$/i;
const partsText = (parts: readonly ServicePart[]) => parts.map((p) => `${p.name} × ${p.qty} @ ${p.rate}${p.warranty ? ' w' : ''}`).join('\n');
function parseParts(text: string): ServicePart[] {
  const items = stockDb.items();
  return text.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = PART.exec(s);
    if (!m) throw new Error(`"${s}": ${rtdT('parts')}`);
    const it = items.find((i) => i.name.trim().toLowerCase() === m[1].trim().toLowerCase());
    return { id: generateId(), name: m[1].trim(), qty: num(m[2]), rate: num(m[3]), tax_rate: typeof it?.tax_rate === 'number' ? it.tax_rate : 18, ...(it ? { item_id: it.id, hsn: it.hsn } : {}), ...(m[4] ? { warranty: true } : {}) };
  });
}

function ServiceView({ run }: Run) {
  const day = todayInput();
  const navigate = useNavigate();
  const shop = localDb.settings.activeProfile()?.companyName ?? '';
  const [all, setAll] = useState(false);
  const jobs = loadJobs().filter((j) => all || isOpenJob(j)).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  const [f, set, reset] = useForm({ customer: '', phone: '', kind: 'phone', model: '', imei: '', complaint: '', accessories: '', estimate: '', due: shiftDay(day, 2), tech: '' });
  const [open, setOpen] = useState('');
  const save = () => run(() => {
    const j = addJob({ date: day, kind: f.kind as RepairKind, customer: f.customer, phone: f.phone, asset: { model: f.model, ...(f.imei.trim() ? { serial: f.imei.trim() } : {}) }, complaint: f.complaint, accessories: f.accessories, estimate: num(f.estimate), due: f.due, technician: f.tech }, loadTracking());
    reset();
    setOpen(j.id);
    return rtdT('jobSaved', { number: j.number });
  });
  const r = repairRule('phone', day);
  return (
    <>
      <h3 className={surface.cardHeadIcon}><Settings size={16} aria-hidden="true" /> {rtdT('jobTitle')}</h3>
      <p className={surface.sectionNote}>{rtdT('sacNote', { sac: r.sac, rate: r.rate })}</p>
      <div className={controls.row} style={row}>
        <label className={controls.field}><span className={controls.label}>{rtdT('kind')}</span>
          <select className={controls.select} value={f.kind} onChange={(e) => set('kind', e.target.value)}>{KINDS.map((k) => <option key={k} value={k}>{rtdT(`k.${k}`)}</option>)}</select>
        </label>
        {['customer', 'phone', 'model', 'imei', 'complaint', 'accessories', 'estimate', 'due', 'tech'].map((k) => <In key={k} k={k} f={f} set={set} type={k === 'due' ? 'date' : k === 'estimate' ? 'number' : undefined} />)}
        <button type="button" className={controls.btnPrimary} onClick={save} data-dev-job-save>{rtdT('save')}</button>
      </div>
      <div className={controls.segment} style={{ margin: '0.75rem 0 0.25rem' }}>
        {[false, true].map((x) => <button key={String(x)} type="button" className={x === all ? `${controls.segmentBtn} ${controls.segmentBtnActive}` : controls.segmentBtn} onClick={() => setAll(x)}>{rtdT(x ? 'all' : 'open2')}</button>)}
      </div>
      {jobs.length === 0 ? <p className={controls.hint}>{rtdT('none')}</p> : (
        <div className={surface.tableWrap}><table className={surface.table}>
          <thead><tr><th>#</th><th>{rtdT('customer')}</th><th>{rtdT('model')}</th><th>{rtdT('status')}</th><th className={surface.numeric}>{rtdT('age')}</th><th /></tr></thead>
          <tbody>{jobs.map((j) => {
            const nx = nextServiceStatus(j.status);
            const wa = jobLink(j, rtdT('waMsg', { name: j.customer, model: j.asset.model, number: j.number, status: rtdT(`s.${j.status}`), shop }));
            return [
              <tr key={j.id} data-dev-job={j.number}>
                <td><button type="button" className={controls.btnGhost} onClick={() => setOpen(open === j.id ? '' : j.id)}>{j.number}</button></td>
                <td>{[j.customer, j.phone].filter(Boolean).join(' · ')}</td>
                <td>{j.asset.model}<br /><small>{j.complaint} · {rtdT(`w.${j.warranty?.status ?? 'none'}`, { until: j.warranty?.until ?? '' })}</small></td>
                <td>{rtdT(`s.${j.status}`)}{j.due && j.due < day && isOpenJob(j) && j.status !== 'ready' ? <small style={{ color: 'var(--loss)' }}> {rtdT('overdue')}</small> : null}{j.invoice_number ? <><br /><small>{rtdT('billed', { number: j.invoice_number })}</small></> : null}</td>
                <td className={surface.numeric}>{jobAge(j, day)}</td>
                <td style={{ textAlign: 'right' }}>
                  {nx && canMove(j.status, nx) && <button type="button" className={sm} onClick={() => run(() => (moveJob(j.id, nx, day), rtdT(`s.${nx}`)))} data-dev-job-next={nx}>{rtdT(`s.${nx}`)}</button>}
                  {canMove(j.status, 'at_service_centre') && <button type="button" className={gh} onClick={() => run(() => (moveJob(j.id, 'at_service_centre', day), rtdT('s.at_service_centre')))}>{rtdT('toCentre')}</button>}
                  {wa && <a className={gh} href={wa} target="_blank" rel="noopener noreferrer">{rtdT('wa')}</a>}
                  <button type="button" className={gh} onClick={() => printJobCard(j, shop)}><Printer size={14} aria-hidden="true" /> {rtdT('print')}</button>
                </td>
              </tr>,
              open === j.id && <tr key={`${j.id}-w`}><td colSpan={6}><JobWork job={j} run={run} onBill={(id) => navigate(`/invoice/${id}`)} /></td></tr>,
            ];
          })}</tbody>
        </table></div>
      )}
    </>
  );
}

function JobWork({ job: j, run, onBill }: Run & { job: ServiceJob; onBill: (id: string) => void }) {
  const day = todayInput();
  const [parts, setParts] = useState(partsText(j.parts));
  const [labour, setLabour] = useState(String(j.labour || ''));
  const [c, setC] = useState({ vendor: j.claim?.vendor_name ?? '', no: j.claim?.claim_no ?? '', status: j.claim?.status ?? 'sent' });
  const done = !!j.invoice_id;
  return (
    <div className={controls.row} style={row} data-dev-job-work={j.number}>
      <label className={controls.field} style={{ minWidth: 260 }}><span className={controls.label}>{rtdT('parts')}</span><textarea className={controls.textarea} rows={3} value={parts} disabled={done} onChange={(e) => setParts(e.target.value)} data-dev-parts /></label>
      <label className={controls.field} style={{ maxWidth: 110 }}><span className={controls.label}>{rtdT('labour')}</span><input className={controls.input} inputMode="decimal" value={labour} disabled={done} onChange={(e) => setLabour(e.target.value)} data-dev-labour /></label>
      {!done && <button type="button" className={sm} onClick={() => run(() => (updateJob(j.id, { parts: parseParts(parts), labour: num(labour) }), rtdT('work')))} data-dev-work>{rtdT('work')}</button>}
      {j.warranty?.status === 'active' && (
        <>
          <label className={controls.field}><span className={controls.label}>{rtdT('centre')}</span><input className={controls.input} value={c.vendor} onChange={(e) => setC({ ...c, vendor: e.target.value })} /></label>
          <label className={controls.field} style={{ maxWidth: 120 }}><span className={controls.label}>{rtdT('claim')}</span><input className={controls.input} value={c.no} onChange={(e) => setC({ ...c, no: e.target.value })} /></label>
          <select className={controls.select} value={c.status} onChange={(e) => setC({ ...c, status: e.target.value as 'sent' })} aria-label={rtdT('claim')}>{(['sent', 'approved', 'rejected', 'settled'] as const).map((s) => <option key={s} value={s}>{rtdT(`c.${s}`)}</option>)}</select>
          <button type="button" className={sm} onClick={() => run(() => (setClaim(j.id, { vendor_name: c.vendor, claim_no: c.no, status: c.status, date: day }), rtdT(`c.${c.status}`)))}>{rtdT('save')}</button>
        </>
      )}
      {!done && (j.status === 'ready' || j.status === 'delivered') && <button type="button" className={controls.btnPrimary} onClick={() => run(() => {
        const inv = billJob(j.id, day);
        if (inv) onBill(inv.id);
        return inv ? rtdT('billed', { number: inv.invoice_number }) : rtdT('noCharge');
      })} data-dev-bill>{rtdT('billIt')}</button>}
      {canMove(j.status, 'returned') && <button type="button" className={gh} onClick={() => run(() => (moveJob(j.id, 'returned', day), rtdT('s.returned')))}>{rtdT('returnIt')}</button>}
      {!done && <button type="button" className={gh} onClick={() => window.confirm(`${rtdT('del')} ${j.number}?`) && run(() => (deleteJob(j.id), rtdT('del')))}>{rtdT('del')}</button>}
    </div>
  );
}

/* ── Host parts ── */

/** Registers the IMEI scan fallback (`scan.ts`) while mounted; built lazily from the stock-tracking map. */
function useSerialScan(catalog: () => InvoiceItem[]) {
  useEffect(() => {
    let index: ReturnType<typeof serialIndex> | undefined;
    serialScan.find = (code) => {
      index ??= serialIndex(loadTracking(), pairIndex(purchasesDb.all()));
      const item = serialHit(index, code, catalog());
      return item ? { item, via: 'serial' } : null;
    };
    return () => { serialScan.find = undefined; };
  }, [catalog]);
}

/** Second-hand lines that can go under the margin scheme (a buy-back serial, not split yet). */
function marginCandidates(items: readonly InvoiceItem[]) {
  const ps = purchasesDb.all();
  return items.filter((l) => !l.margin && l.serials?.length === 1).map((l) => ({ line: l, bb: buyBackOf(l.serials![0], ps) })).filter((x) => x.bb);
}

/** Margin scheme buttons + resale IMEI check warnings (POS and editor). */
function MarginRow({ record, apply }: { record: InvoiceRecord; apply: (lineId: string, lines: InvoiceItem[]) => void }) {
  const cands = marginCandidates(record.items);
  const issue = marginIssue(record);
  const checks = loadImeiChecks();
  if (!cands.length) return null;
  return (
    <div className={controls.hint} data-dev-margin>
      {cands.map(({ line, bb }) => {
        const w = resaleCheckIssue(checks, line.serials![0], record.issue_date, line.serial_pairs?.[line.serials![0]]);
        return (
          <div key={line.id}>
            <button type="button" className={gh} title={rtdT('marginTip')} disabled={!!issue} onClick={() => apply(line.id, marginLines(line, { id: bb!.purchase.id, value: bb!.value }, !!record.price_includes_tax, generateId))} data-dev-margin-apply>{rtdT('marginBtn')}: {line.name}</button>
            {w && <span> {rtdT('checkWarn')}: {w}</span>}
          </div>
        );
      })}
      {issue && <p>{issue}</p>}
    </div>
  );
}

export interface DevPay {
  amount: number;
  error?: string;
  /** Runs after the bill is saved; returns the bill as it then stands. */
  post?: (saved: InvoiceRecord) => InvoiceRecord;
}

/** POS: IMEI scan, dual-IMEI pairs on picked serials, margin scheme, finance / exchange tenders and the cash guard. */
export function PosDevices({ record, cash, setItems, onPay, notify, catalog }: {
  record: InvoiceRecord; cash: number; setItems: Dispatch<SetStateAction<InvoiceItem[]>>; onPay: (p: DevPay | null) => void;
  notify: (msg: string, kind?: 'error') => void; catalog: () => InvoiceItem[];
}) {
  useT();
  useSerialScan(catalog);
  const rs = useMemo(() => readRetailSettings(), []);
  const pays = useMemo(() => getTable<Payment>('transactions'), []);
  const vouchers = useMemo(() => openVouchers(purchasesDb.all(), pays), [pays]);
  const financiers = useMemo(() => [...new Set([...localDb.clients.getAll().filter((c) => c.financier).map((c) => c.name), ...loadDeals().map((d) => d.financier)])], []);
  const [fin, setFin] = useState<FinTender | null>(null);
  const [ex, setEx] = useState<ExTender | null>(null);
  // Dual IMEI: a serial picked by hand gets its IMEI 2 from the purchase line (printed on the bill).
  useEffect(() => {
    const need = record.items.filter((l) => l.serials?.length && !l.serial_pairs);
    if (!need.length) return;
    const ps = purchasesDb.all();
    const by = new Map(need.map((l) => [l.id, pairsOf(ps, l.serials!)]));
    if ([...by.values()].some(Boolean)) setItems((cur) => cur.map((l) => (by.get(l.id) ? { ...l, serial_pairs: by.get(l.id) } : l)));
  }, [record.items, setItems]);
  const guard = cashReceiptIssue(rs.cash_guard, cash, sameDayCash(record.client, record.issue_date, getTable<InvoiceRecord>('invoices'), pays), record.issue_date);
  const exAmt = ex ? Math.min(ex.amount, record.total) : 0;
  const finAmt = fin ? num(fin.loan) : 0;
  const error = guard?.block ? guard.message
    : fin && (!fin.financier.trim() || !fin.doNo.trim() || !(finAmt > 0)) ? `${rtdT('finTender')}: ${rtdT('financier')}, ${rtdT('loan')}, ${rtdT('doNo')}`
      : ex && ex.party.trim().toLowerCase() !== String(record.client?.name ?? '').trim().toLowerCase() ? rtdT('needName', { name: ex.party }) : '';
  useEffect(() => {
    if (!fin && !ex && !error) return onPay(null);
    onPay({
      amount: Math.max(finAmt + exAmt, 0), error,
      post: (saved) => {
        try {
          if (ex && exAmt > 0) applyExchange(saved.id, ex.purchaseId, exAmt);
          if (fin) recordFinance({ invoiceId: saved.id, financier: fin.financier, loan: finAmt, doNo: fin.doNo, scheme: fin.scheme });
        } catch (e) {
          notify(`${saved.invoice_number}: ${(e as Error).message}`, 'error');
        }
        return localDb.invoices.getById(saved.id) ?? saved;
      },
    });
  }, [fin, ex, finAmt, exAmt, error, onPay, notify]);
  return (
    <div data-pos-devices>
      <MarginRow record={record} apply={(id, lines) => setItems((cur) => cur.flatMap((l) => (l.id === id ? lines : [l])))} />
      <FinanceTender value={fin} financiers={financiers} onChange={setFin} />
      <ExchangeTender value={ex} vouchers={vouchers} onChange={setEx} />
      {guard && <p className={guard.block ? controls.error : controls.hint} role="status" data-pos-cash-guard>{rtdT('cashGuard')}: {guard.message}</p>}
    </div>
  );
}

/** Editor: IMEI scan in the scan bar and the margin scheme on second-hand lines. */
export function EditorDevices() {
  useT();
  const catalog = useMemo(() => () => localDb.items.getAll(), []);
  useSerialScan(catalog);
  const st = useInvoiceStore();
  return <MarginRow record={st as unknown as InvoiceRecord} apply={(id, lines) => st.patch({ items: st.items.flatMap((l) => (l.id === id ? lines : [l])) })} />;
}
