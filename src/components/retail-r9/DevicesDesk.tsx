/**
 * RT-D Devices desk (Inventory → Devices, pack `electronics`) and its host parts — ONE lazy chunk: views *IMEI* (lookup by
 * IMEI 1 / IMEI 2, blocked-IMEI check log), *Finance* (DOs, disbursements, CSV), *Buy-back* (URD vouchers, exchange on a
 * bill, resale margin) and *Repairs* (job sheets, warranty claims, billing); plus `PosDevices` (POS: IMEI scan, finance /
 * exchange tenders, margin scheme, cash guard) and `EditorDevices` (editor: IMEI scan, margin scheme).
 * Working papers — verify with your CA (RT10–RT15).
 */
import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { HandCoins, RefreshCw, ScanLine, Settings } from 'lucide-react';
import { useT } from '../../i18n';
import { rtdT } from '../../i18n/areas/retail-r9d';
import FinanceTender, { type FinTender } from './FinanceTender';
import ExchangeTender, { type ExTender } from './ExchangeTender';
import { printJobCard } from './JobCardPrint';
import { loadImeiChecks, logImeiCheck, pairIndex, pairsOf, resaleCheckIssue, serialHit, serialIndex } from '../../lib/retail/rt-imei';
import { cancelDeal, dealOpen, feeSplit, financeCsv, loadDeals, pendingDos, recordDisbursement, recordFinance, undoDisbursement } from '../../lib/retail/rt-finance';
import { applyExchange, buyBackOf, buyBackRows, deleteBuyBack, marginIssue, marginLines, openVouchers, recordBuyBack } from '../../lib/retail/rt-buyback';
import { cashReceiptIssue, sameDayCash } from '../../lib/retail/rt-cash-guard';
import { addJob, billJob, canMove, deleteJob, isOpenJob, jobLink, loadJobs, moveJob, nextServiceStatus, repairRule, setClaim, updateJob } from '../../lib/retail/rt-service-jobs';
import { readRetailSettings } from '../../lib/retail/rt-settings';
import { serialScan } from '../../lib/scan';
import { loadTracking, lookupSerial } from '../../lib/stock-tracking';
import { stockDb } from '../../lib/inventory';
import { purchasesDb } from '../../lib/purchases';
import { localDb } from '../../lib/localDb';
import { generateId, getTable } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { formatCurrency, todayInput } from '../../lib/utils';
import { RT_SERIES } from '../../lib/retail/rt-shared';
import type { RepairKind } from '../../lib/retail-rules';
import type { InvoiceItem, InvoiceRecord, Payment } from '../../types/invoice';
import type { ServiceJob, ServicePart, WarrantyClaim } from '../../types/retail-r9';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { downloadTextFile } from '../receivables/exportUtils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

type Run = (fn: () => string | Promise<string>) => void;
type Form = Record<string, string>;
const VIEWS = [['imei', ScanLine], ['finance', HandCoins], ['buyback', RefreshCw], ['service', Settings]] as const;
const sm = `${controls.btnOutline} ${controls.btnSm}`;
const gh = `${controls.btnGhost} ${controls.btnSm}`;
const rowStyle = { flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' } as const;
const billNo = (no: string | null | undefined) => {
  const inv = no ? getTable<InvoiceRecord>('invoices').find((i) => i?.invoice_number?.toUpperCase() === no.trim().toUpperCase()) : undefined;
  if (!inv) throw new Error(rtdT('noBill', { number: no ?? '' }));
  return inv;
};
const ok = (m: string) => `${m} ✓`;

/** A form: labelled inputs per key (`data-dev-<key>`), a Save button, reset after a good save. */
function FormRow({ keys, init, onSave, run, types = {} }: { keys: readonly string[]; init?: Form; onSave: (f: Form) => string; run: Run; types?: Form }) {
  const [f, setF] = useState<Form>(init ?? {});
  return (
    <div className={controls.row} style={rowStyle}>
      {keys.map((k) => (
        <label key={k} className={controls.field}>
          <span className={controls.label}>{rtdT(k as never)}</span>
          <input className={controls.input} type={types[k]} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...{ [`data-dev-${k.toLowerCase()}`]: '' }} />
        </label>
      ))}
      <button type="button" className={controls.btnPrimary} onClick={() => run(() => { const m = onSave(f); setF(init ?? {}); return m; })} data-dev-save>{rtdT('save')}</button>
    </div>
  );
}

const Table = ({ head, children }: { head: string[]; children: ReactNode }) => (
  <div className={surface.tableWrap}><table className={surface.table}><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table></div>
);

export default function DevicesDesk({ view, onDone }: { view?: string; onDone: (msg: string, error?: boolean) => void }) {
  useT();
  const v = VIEWS.some(([id]) => id === view) ? view : 'imei';
  const [tick, setTick] = useState(0);
  const run: Run = (fn) => {
    Promise.resolve().then(fn).then((m) => { setTick((t) => t + 1); onDone(m); }).catch((e: Error) => onDone(e.message, true));
  };
  const day = todayInput();
  return (
    <section className={surface.card} data-devices-desk={v}>
      <div className={surface.cardHead}>
        <span className={controls.segment}>
          {VIEWS.map(([id, Icon]) => (
            <Link key={id} to={`/inventory?tab=devices&view=${id}`} className={id === v ? `${controls.segmentBtn} ${controls.segmentBtnActive}` : controls.segmentBtn}><Icon size={14} aria-hidden="true" /> {rtdT(`view.${id}`)}</Link>
          ))}
        </span>
      </div>
      <div className={surface.cardBody} data-tick={tick}>
        {v === 'finance' ? <FinanceView run={run} day={day} /> : v === 'buyback' ? <BuyBackView run={run} day={day} /> : v === 'service' ? <ServiceView run={run} day={day} /> : <ImeiView run={run} day={day} />}
        <p className={controls.hint}>{rtdT('wp')}</p>
      </div>
    </section>
  );
}

/* ── RT-D1 IMEI ── */

function ImeiView({ run, day }: { run: Run; day: string }) {
  const tracking = useMemo(() => loadTracking(), []);
  const pairs = useMemo(() => pairIndex(purchasesDb.all()), []);
  const [q, setQ] = useState('');
  const k = q.trim().toUpperCase();
  const one = pairs.get(k) ?? k;
  const r = k ? lookupSerial(tracking, one, day, 5).find((x) => x.serial.toUpperCase() === one) : undefined;
  const two = [...pairs].find(([, a]) => a.toUpperCase() === one)?.[0];
  return (
    <>
      <input className={controls.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="IMEI 1 / IMEI 2" aria-label="IMEI" style={{ maxWidth: 320 }} data-dev-lookup />
      {r && <p data-dev-hit>{r.item.name} · <span className={surface.mono}>{r.serial}{two ? ` / ${two}` : ''}</span> · {r.inStock ? rtdT('inStock') : rtdT('sold', { ref: r.sale?.refNumber ?? '', until: r.warrantyUntil || '—' })}</p>}
      <h3 className={surface.cardHeadIcon}>{rtdT('checkTitle')}</h3>
      <p className={surface.sectionNote}>{rtdT('checkNote')}</p>
      <FormRow keys={['imei', 'result', 'ref']} init={{ result: 'clear' }} run={run} onSave={(f) => (logImeiCheck({ date: day, imei: f.imei ?? '', result: f.result === 'blocked' ? 'blocked' : 'clear', portal_ref: f.ref }), ok(f.imei))} />
      <Table head={[rtdT('date'), 'IMEI', rtdT('result'), rtdT('ref')]}>
        {loadImeiChecks().reverse().slice(0, 100).map((c) => <tr key={c.id}><td>{c.date}</td><td className={surface.mono}>{c.imei}</td><td>{rtdT(c.result)}</td><td>{c.portal_ref}</td></tr>)}
      </Table>
    </>
  );
}

/* ── RT-D2 Finance ── */

function FinanceView({ run, day }: { run: Run; day: string }) {
  const deals = loadDeals().reverse();
  const fee = feeSplit(0, day);
  const late = pendingDos(deals, day).length;
  const recv = (id: string) => {
    const a = window.prompt(rtdT('recvAsk'))?.split(/[,\s]+/).map(num);
    if (a) run(() => (recordDisbursement(id, { date: day, amount: a[0], fee: a[1] ?? 0 }), rtdT('received')));
  };
  return (
    <>
      <p className={surface.sectionNote}>{rtdT('finNote', { sac: fee.sac, rate: fee.rate })}</p>
      <FormRow keys={['bill', 'financier', 'loan', 'doNo', 'scheme', 'loanAcc']} run={run} onSave={(f) => ok(recordFinance({ invoiceId: billNo(f.bill).id, financier: f.financier ?? '', loan: num(f.loan), doNo: f.doNo ?? '', scheme: f.scheme, loanAccount: f.loanAcc }).do_no)} />
      {late > 0 && <p className={controls.error} role="status">{rtdT('pending', { n: late })}</p>}
      <Table head={[rtdT('date'), rtdT('bill'), rtdT('financier'), rtdT('doNo'), rtdT('loan'), rtdT('open'), '']}>
        {deals.map((d) => (
          <tr key={d.id} data-dev-deal={d.do_no}>
            <td>{d.date}</td><td>{d.invoice_number} · {d.customer}</td><td>{d.financier} {d.scheme}</td><td className={surface.mono}>{d.do_no}</td>
            <td>{formatCurrency(d.loan)}</td><td>{formatCurrency(dealOpen(d))}</td>
            <td>
              {dealOpen(d) > 0.004 && <button type="button" className={sm} onClick={() => recv(d.id)}>{rtdT('received')}</button>}
              <button type="button" className={gh} onClick={() => run(() => (d.disbursements.length ? undoDisbursement(d.id, d.disbursements[d.disbursements.length - 1].id) : cancelDeal(d.id), rtdT('undo')))}>{rtdT('undo')}</button>
            </td>
          </tr>
        ))}
      </Table>
      {deals.length > 0 && <button type="button" className={sm} onClick={() => downloadTextFile(`Finance_DOs_${day}.csv`, financeCsv(deals, day))}>CSV</button>}
    </>
  );
}

/* ── RT-D3 Buy-back ── */

function BuyBackView({ run, day }: { run: Run; day: string }) {
  const left = new Set(openVouchers(purchasesDb.all(), getTable<Payment>('transactions')).map((x) => x.purchase.id));
  const checks = loadImeiChecks();
  return (
    <>
      <p className={surface.sectionNote}>{rtdT('bbNote', { series: `${RT_SERIES.urd}/FY…` })}</p>
      <FormRow keys={['customer', 'phone', 'model', 'imei', 'value', 'condition', 'idType', 'idLast4', 'gst']} init={{ gst: '18' }} run={run} onSave={(f) => {
        const imei = (f.imei ?? '').trim();
        const p = recordBuyBack({ date: day, customer: f.customer ?? '', phone: f.phone, model: f.model ?? '', serial: imei, value: num(f.value), hsn: '8517', taxRate: num(f.gst), goods: { condition: f.condition, id_type: f.idType, id_last4: f.idLast4?.slice(-4), imei_check_id: checks.find((c) => c.imei === imei)?.id } });
        const w = resaleCheckIssue(checks, imei, day);
        return `${ok(p.bill_number)}${w ? ` ${w}` : ''}`;
      }} />
      <Table head={['#', rtdT('customer'), rtdT('model'), rtdT('value'), rtdT('bill'), rtdT('margin'), '']}>
        {buyBackRows(purchasesDb.all(), getTable<InvoiceRecord>('invoices')).map(({ purchase: p, sale, margin }) => (
          <tr key={p.id} data-dev-bb={p.bill_number}>
            <td className={surface.mono}>{p.bill_number}</td><td>{p.vendor_name}</td><td>{p.used_goods.model} <small className={surface.mono}>{p.used_goods.serial}</small></td>
            <td>{formatCurrency(p.total)}{left.has(p.id) ? '' : ` · ${rtdT('settled')}`}</td><td>{sale?.invoice_number}</td><td>{margin === undefined ? '' : formatCurrency(margin)}</td>
            <td>
              {left.has(p.id) && <button type="button" className={sm} onClick={() => run(() => ok(String(applyExchange(billNo(window.prompt(rtdT('bill'))).id, p.id).amount)))} data-dev-bb-exchange>{rtdT('exchange')}</button>}
              <button type="button" className={gh} onClick={() => window.confirm(`${rtdT('del')} ${p.bill_number}?`) && run(() => (deleteBuyBack(p.id), ok(p.bill_number)))}>{rtdT('del')}</button>
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}

/* ── RT-D4 Repairs ── */

const KINDS: RepairKind[] = ['phone', 'computer', 'appliance', 'vehicle', 'other'];
const PART = /^(.*?)\s*[×x*]\s*([\d.]+)\s*@\s*([\d.]+)\s*(w)?$/i;
/** "Screen × 1 @ 2500 w" lines → parts (stock item matched by name: id, HSN, GST rate; else 18%). */
function parseParts(text: string): ServicePart[] {
  const items = stockDb.items();
  return text.split('\n').map((s) => s.trim()).filter(Boolean).map((s) => {
    const m = PART.exec(s);
    if (!m) throw new Error(`${rtdT('parts')}: ${s}`);
    const it = items.find((i) => i.name.trim().toLowerCase() === m[1].trim().toLowerCase());
    return { id: generateId(), name: m[1].trim(), qty: num(m[2]), rate: num(m[3]), tax_rate: it?.tax_rate ?? 18, ...(it ? { item_id: it.id, hsn: it.hsn } : {}), ...(m[4] ? { warranty: true } : {}) };
  });
}

function ServiceView({ run, day }: { run: Run; day: string }) {
  const navigate = useNavigate();
  const shop = localDb.settings.activeProfile()?.companyName ?? '';
  const [all, setAll] = useState(false);
  const [kind, setKind] = useState<RepairKind>('phone');
  const [open, setOpen] = useState('');
  const r = repairRule(kind, day);
  return (
    <>
      <p className={surface.sectionNote}>{rtdT('sacNote', { sac: r.sac, rate: r.rate })}</p>
      <select className={controls.select} value={kind} onChange={(e) => setKind(e.target.value as RepairKind)} aria-label={rtdT('kind')}>{KINDS.map((k) => <option key={k} value={k}>{rtdT(`k.${k}`)}</option>)}</select>
      <FormRow keys={['customer', 'phone', 'model', 'imei', 'complaint', 'accessories', 'estimate', 'due', 'tech']} types={{ due: 'date' }} run={run} onSave={(f) => {
        const j = addJob({ date: day, kind, customer: f.customer ?? '', phone: f.phone, asset: { model: f.model ?? '', ...(f.imei?.trim() ? { serial: f.imei.trim() } : {}) }, complaint: f.complaint ?? '', accessories: f.accessories, estimate: num(f.estimate), due: f.due || undefined, technician: f.tech }, loadTracking());
        setOpen(j.id);
        return ok(j.number);
      }} />
      <label className={controls.check}><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {rtdT('all')}</label>
      <Table head={['#', rtdT('customer'), rtdT('model'), rtdT('status'), '']}>
        {loadJobs().filter((j) => all || isOpenJob(j)).reverse().map((j) => {
          const nx = nextServiceStatus(j.status);
          const wa = jobLink(j, rtdT('waMsg', { model: j.asset.model, number: j.number, status: rtdT(`s.${j.status}`), shop }));
          return [
            <tr key={j.id} data-dev-job={j.number}>
              <td><button type="button" className={controls.btnGhost} onClick={() => setOpen(open === j.id ? '' : j.id)}>{j.number}</button></td>
              <td>{j.customer} {j.phone}</td>
              <td>{j.asset.model} <small>{j.complaint} · {rtdT(`w.${j.warranty?.status ?? 'none'}`, { until: j.warranty?.until ?? '' })}</small></td>
              <td>{rtdT(`s.${j.status}`)}{j.due && j.due < day && isOpenJob(j) && j.status !== 'ready' ? ` · ${rtdT('overdue')}` : ''}{j.invoice_number ? ` · ${j.invoice_number}` : ''}</td>
              <td>
                {nx && canMove(j.status, nx) && <button type="button" className={sm} onClick={() => run(() => (moveJob(j.id, nx, day), rtdT(`s.${nx}`)))} data-dev-job-next={nx}>{rtdT(`s.${nx}`)}</button>}
                {canMove(j.status, 'at_service_centre') && <button type="button" className={gh} onClick={() => run(() => (moveJob(j.id, 'at_service_centre', day), rtdT('s.at_service_centre')))}>{rtdT('s.at_service_centre')}</button>}
                {wa && <a className={gh} href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
                <button type="button" className={gh} onClick={() => printJobCard(j, shop)}>{rtdT('print')}</button>
              </td>
            </tr>,
            open === j.id && <tr key={`${j.id}w`}><td colSpan={5}><JobWork job={j} run={run} day={day} onBill={(id) => navigate(`/invoice/${id}`)} /></td></tr>,
          ];
        })}
      </Table>
    </>
  );
}

function JobWork({ job: j, run, day, onBill }: { job: ServiceJob; run: Run; day: string; onBill: (id: string) => void }) {
  const [parts, setParts] = useState(j.parts.map((p) => `${p.name} × ${p.qty} @ ${p.rate}${p.warranty ? ' w' : ''}`).join('\n'));
  const [labour, setLabour] = useState(String(j.labour || ''));
  const done = !!j.invoice_id;
  const claim = (status: WarrantyClaim['status']) => {
    const c = status === 'sent' ? window.prompt(rtdT('claim'))?.split(',') : [j.claim?.vendor_name ?? '', j.claim?.claim_no ?? ''];
    if (c) run(() => (setClaim(j.id, { vendor_name: c[0] ?? '', claim_no: c[1]?.trim(), status, date: day }), rtdT(`c.${status}`)));
  };
  return (
    <div className={controls.row} style={rowStyle} data-dev-job-work={j.number}>
      <label className={controls.field} style={{ minWidth: 260 }}><span className={controls.label}>{rtdT('parts')}</span><textarea className={controls.textarea} rows={3} value={parts} disabled={done} onChange={(e) => setParts(e.target.value)} data-dev-parts /></label>
      <label className={controls.field} style={{ maxWidth: 110 }}><span className={controls.label}>{rtdT('labour')}</span><input className={controls.input} inputMode="decimal" value={labour} disabled={done} onChange={(e) => setLabour(e.target.value)} data-dev-labour /></label>
      {!done && <button type="button" className={sm} onClick={() => run(() => (updateJob(j.id, { parts: parseParts(parts), labour: num(labour) }), ok(j.number)))} data-dev-work>{rtdT('save')}</button>}
      {j.warranty?.status === 'active' && (['sent', 'approved', 'rejected', 'settled'] as const).map((s) => <button key={s} type="button" className={gh} onClick={() => claim(s)}>{rtdT(`c.${s}`)}</button>)}
      {j.claim && <small>{j.claim.vendor_name} {j.claim.claim_no} · {rtdT(`c.${j.claim.status}`)}</small>}
      {!done && (j.status === 'ready' || j.status === 'delivered') && <button type="button" className={controls.btnPrimary} onClick={() => run(() => {
        const inv = billJob(j.id, day);
        if (inv) onBill(inv.id);
        return inv ? ok(inv.invoice_number) : rtdT('noCharge');
      })} data-dev-bill>{rtdT('billIt')}</button>}
      {canMove(j.status, 'returned') && <button type="button" className={gh} onClick={() => run(() => (moveJob(j.id, 'returned', day), rtdT('s.returned')))}>{rtdT('s.returned')}</button>}
      {!done && <button type="button" className={gh} onClick={() => window.confirm(`${rtdT('del')} ${j.number}?`) && run(() => (deleteJob(j.id), ok(j.number)))}>{rtdT('del')}</button>}
    </div>
  );
}

/* ── Host parts ── */

/** Registers the IMEI scan fallback (`scan.ts`) while mounted; the index is built on the first unknown code. */
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

/** Margin scheme buttons on second-hand lines (a buy-back serial, not split yet) and the resale IMEI check. */
function MarginRow({ record, apply }: { record: InvoiceRecord; apply: (lineId: string, lines: InvoiceItem[]) => void }) {
  const ps = purchasesDb.all();
  const issue = marginIssue(record);
  return (
    <>
      {record.items.filter((l) => !l.margin && l.serials?.length === 1).map((l) => {
        const bb = buyBackOf(l.serials![0], ps);
        return bb && (
          <p key={l.id} className={controls.hint}>
            <button type="button" className={gh} disabled={!!issue} onClick={() => apply(l.id, marginLines(l, { id: bb.purchase.id, value: bb.value }, !!record.price_includes_tax, generateId))} data-dev-margin>{rtdT('marginBtn')}: {l.name}</button>
            {' '}{issue || resaleCheckIssue(loadImeiChecks(), l.serials![0], record.issue_date, l.serial_pairs?.[l.serials![0]])}
          </p>
        );
      })}
    </>
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
  const pays = useMemo(() => getTable<Payment>('transactions'), []);
  const vouchers = useMemo(() => openVouchers(purchasesDb.all(), pays), [pays]);
  const financiers = useMemo(() => [...new Set([...localDb.clients.getAll().filter((c) => c.financier).map((c) => c.name), ...loadDeals().map((d) => d.financier)])], []);
  const [fin, setFin] = useState<FinTender | null>(null);
  const [ex, setEx] = useState<ExTender | null>(null);
  // Dual IMEI: a serial picked by hand gets its IMEI 2 from the purchase line (printed on the bill).
  useEffect(() => {
    const ps = purchasesDb.all();
    const by = new Map(record.items.filter((l) => l.serials?.length && !l.serial_pairs).map((l) => [l.id, pairsOf(ps, l.serials!)]));
    if ([...by.values()].some(Boolean)) setItems((cur) => cur.map((l) => (by.get(l.id) ? { ...l, serial_pairs: by.get(l.id) } : l)));
  }, [record.items, setItems]);
  const guard = cashReceiptIssue(readRetailSettings().cash_guard, cash, sameDayCash(record.client, record.issue_date, getTable<InvoiceRecord>('invoices'), pays), record.issue_date);
  const exAmt = ex ? Math.min(ex.amount, record.total) : 0;
  const finAmt = fin ? num(fin.loan) : 0;
  const error = guard?.block ? guard.message
    : fin && !(fin.financier.trim() && fin.doNo.trim() && finAmt > 0) ? `${rtdT('finTender')}: ${rtdT('financier')}, ${rtdT('loan')}, ${rtdT('doNo')}`
      : ex && ex.party.trim().toLowerCase() !== String(record.client?.name ?? '').trim().toLowerCase() ? rtdT('needName', { name: ex.party }) : '';
  useEffect(() => {
    onPay(fin || ex || error ? {
      amount: finAmt + exAmt, error,
      post: (saved) => {
        try {
          if (ex && exAmt > 0) applyExchange(saved.id, ex.purchaseId, exAmt);
          if (fin) recordFinance({ invoiceId: saved.id, financier: fin.financier, loan: finAmt, doNo: fin.doNo, scheme: fin.scheme });
        } catch (e) {
          notify(`${saved.invoice_number}: ${(e as Error).message}`, 'error');
        }
        return localDb.invoices.getById(saved.id) ?? saved;
      },
    } : null);
  }, [fin, ex, finAmt, exAmt, error, onPay, notify]);
  return (
    <div data-pos-devices>
      <MarginRow record={record} apply={(id, lines) => setItems((cur) => cur.flatMap((l) => (l.id === id ? lines : [l])))} />
      <FinanceTender value={fin} financiers={financiers} onChange={setFin} />
      <ExchangeTender value={ex} vouchers={vouchers} onChange={setEx} />
      {guard && <p className={guard.block ? controls.error : controls.hint} role="status" data-pos-cash-guard>{guard.message}</p>}
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
