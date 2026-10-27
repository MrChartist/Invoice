/**
 * RT-B Pharmacy desk (`/inventory?tab=pharmacy&view=`): one lazy chunk with every view of the pack —
 *  - `rx` (default): bills with a prescription or a scheduled drug in a period, *Make refill* from a bill;
 *  - `doctors`: the doctors master and doctor-wise sales (CSV);
 *  - `registers`: Schedule H1 / H / X registers and the narcotic book (CSV and a page-numbered A4 book), retention,
 *    narcotic items, drug licences + pharmacist + "Require prescription" (owner);
 *  - `refills`: the due list (3 days + overdue) with WhatsApp and *Bill now* (a held POS cart), every schedule;
 *  - `prices`: ceiling prices (typed / CSV), loose price from the strip MRP, PTS, the margin view (CSV).
 * Working papers — verify with your drug inspector / CA.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, Download, FileSpreadsheet, Printer, ShieldAlert, Trash2, Users } from 'lucide-react';
import { useT } from '../../i18n';
import { rtbT } from '../../i18n/areas/retail-r9b';
import { can } from '../../lib/access';
import { downloadText } from '../../lib/download';
import { printHtmlDocument } from '../../lib/voucher-print';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { h1Register, liveScheduleIndex } from '../../lib/pharma';
import { holdCart, loadHeld, saveHeld } from '../../lib/pos-hold';
import { unitChoices } from '../../lib/units';
import type { StockItem } from '../../lib/inventory';
import { doctorSalesCsv, doctorWiseSales, doctorsDb, readRxSettings, saveRxSettings, scheduledLines } from '../../lib/retail/rt-pharmacy-rx';
import { H1_HEAD, NARCOTIC_HEAD, X_HEAD, h1Cells, licenceNotices, narcoticCells, narcoticRegister, registerBook, registerCsv, retentionAt, xCells, xRegister } from '../../lib/retail/rt-pharmacy-registers';
import { dueRefills, loadRefills, refillCart, refillFromBill, refillWaLink, removeRefill, saveRefill, syncRefills } from '../../lib/retail/rt-refills';
import { addCeiling, applyLoosePrice, importCeilings, loosePack, marginCsv, marginRows, parseCeilingCsv, patchStockItem } from '../../lib/retail/rt-pharmacy-prices';
import type { InvoiceRecord } from '../../types/invoice';
import type { Doctor, DrugLicence, DrugLicenceForm, Pharmacist } from '../../types/retail-r9';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

type Done = (msg: string, error?: boolean) => void;
const VIEWS = ['rx', 'doctors', 'registers', 'refills', 'prices'] as const;
type View = (typeof VIEWS)[number];
const FORMS: DrugLicenceForm[] = ['20', '21', '20B', '21B', '20F', '21G', '21C', 'other'];
const wrap = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' } as const;

const monthStart = (d: string) => `${d.slice(0, 8)}01`;
const invoices = () => localDb.invoices.getAll() as InvoiceRecord[];
const stockItems = () => getTable<StockItem>('stock_items');

/** Run a data-layer call, then report (its message, or the error). */
function useRun(onDone: Done) {
  const [tick, setTick] = useState(0);
  const run = (fn: () => string) => {
    try {
      const m = fn();
      setTick((t) => t + 1);
      if (m) onDone(m);
    } catch (err) {
      onDone((err as Error).message, true);
    }
  };
  return { tick, run };
}

function Period({ from, to, onFrom, onTo }: { from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  return (
    <>
      <label className={controls.field}><span className={controls.label}>{rtbT('from')}</span><input type="date" className={controls.input} value={from} onChange={(e) => onFrom(e.target.value)} /></label>
      <label className={controls.field}><span className={controls.label}>{rtbT('to')}</span><input type="date" className={controls.input} value={to} onChange={(e) => onTo(e.target.value)} /></label>
    </>
  );
}

function Table({ head, rows, flagged }: { head: readonly ReactNode[]; rows: readonly ReactNode[][]; flagged?: readonly boolean[] }) {
  if (!rows.length) return <p className={controls.hint}>{rtbT('none')}</p>;
  return (
    <div className={surface.tableWrap}>
      <table className={surface.table}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} data-rtb-row style={flagged?.[i] ? { background: 'var(--muted)' } : undefined}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/* ── rx: bills with a prescription, Make refill ── */

function RxView({ onDone }: { onDone: Done }) {
  const day = todayInput();
  const [from, setFrom] = useState(monthStart(day));
  const [to, setTo] = useState(day);
  const [every, setEvery] = useState(30);
  const { tick, run } = useRun(onDone);
  const index = useMemo(() => liveScheduleIndex(), []);
  const doctors = useMemo(() => new Map(doctorsDb.all().map((d) => [d.id, d.name])), []);
  const rows = useMemo(() => {
    void tick;
    return invoices()
      .filter((i) => i.issue_date >= from && i.issue_date <= to && i.status !== 'Draft' && i.status !== 'Cancelled' && (i.rx || scheduledLines(i.items ?? [], index).length))
      .sort((a, b) => b.issue_date.localeCompare(a.issue_date));
  }, [from, to, index, tick]);
  const made = useMemo(() => new Set(loadRefills().map((r) => r.invoice_id)), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div style={wrap}>
        <Period from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <label className={controls.field} style={{ maxWidth: 140 }}><span className={controls.label}>{rtbT('everyDays')}</span><NumberInput className={controls.input} value={every} onChange={setEvery} /></label>
      </div>
      <Table
        head={[rtbT('date'), rtbT('bill'), rtbT('patient'), rtbT('doctor'), rtbT('schedules'), '']}
        flagged={rows.map((i) => !i.rx?.patient?.trim() || !i.rx?.prescriber?.trim())}
        rows={rows.map((i) => [
          i.issue_date, i.invoice_number, [i.rx?.patient, i.rx?.age ? `${i.rx.age}${i.rx.gender ?? ''}` : ''].filter(Boolean).join(' · ') || i.client?.name || '—',
          (i.rx?.doctor_id && doctors.get(i.rx.doctor_id)) || i.rx?.prescriber || '—',
          [...new Set(scheduledLines(i.items ?? [], index).map((l) => l.schedule))].join(' / ') || '—',
          made.has(i.id) ? rtbT('refillMade') : <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => run(() => { const r = saveRefill(refillFromBill(i, every)); return rtbT('refillSaved', { name: r.name, date: r.next_due }); })} data-rtb-make-refill>{rtbT('makeRefill')}</button>,
        ])}
      />
      <p className={controls.hint}>{rtbT('rxNote')}</p>
    </>
  );
}

/* ── doctors: master + doctor-wise sales ── */

const BLANK: Partial<Doctor> & { name: string } = { name: '' };

function DoctorsView({ onDone }: { onDone: Done }) {
  const day = todayInput();
  const [form, setForm] = useState(BLANK);
  const [from, setFrom] = useState(monthStart(day));
  const [to, setTo] = useState(day);
  const { tick, run } = useRun(onDone);
  const list = useMemo(() => (tick >= 0 ? doctorsDb.all() : []), [tick]);
  const sales = useMemo(() => doctorWiseSales(invoices(), list, liveScheduleIndex(), { from, to }), [list, from, to]);
  const field = (k: 'name' | 'qualification' | 'reg_no' | 'council' | 'clinic' | 'phone', label: string) => (
    <label className={controls.field}><span className={controls.label}>{label}</span><input className={controls.input} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} data-doc-field={k} /></label>
  );
  return (
    <>
      <div style={wrap}>
        {field('name', rtbT('doctorName'))}{field('qualification', rtbT('qualification'))}{field('reg_no', rtbT('regNo'))}{field('council', rtbT('council'))}{field('clinic', rtbT('clinic'))}{field('phone', rtbT('phone'))}
        <button type="button" className={controls.btnPrimary} disabled={!form.name.trim()} onClick={() => run(() => { const d = doctorsDb.save(form); setForm(BLANK); return rtbT('doctorSaved', { name: d.name }); })} data-doc-save>{rtbT('save')}</button>
      </div>
      <p className={controls.hint}>{rtbT('doctorNote')}</p>
      <Table
        head={[rtbT('doctorName'), rtbT('regNo'), rtbT('clinic'), rtbT('phone'), '']}
        rows={list.map((d) => [
          <>{d.name}{d.qualification ? ` (${d.qualification})` : ''}{d.active === false ? ` · ${rtbT('inactive')}` : ''}</>, [d.reg_no, d.council].filter(Boolean).join(', '), d.clinic ?? '', d.phone ?? '',
          <span key="a" className={surface.rowActions}>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setForm(d)}>{rtbT('edit')}</button>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(() => { doctorsDb.save({ ...d, active: d.active === false }); return rtbT('doctorSaved', { name: d.name }); })}>{d.active === false ? rtbT('activate') : rtbT('deactivate')}</button>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} aria-label={`${rtbT('delete')} ${d.name}`} onClick={() => window.confirm(rtbT('confirmDelete', { name: d.name })) && run(() => { doctorsDb.remove(d.id); return rtbT('deleted'); })}><Trash2 size={14} aria-hidden="true" /></button>
          </span>,
        ])}
      />
      <h3>{rtbT('doctorSales')}</h3>
      <div style={wrap}>
        <Period from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!sales.length} onClick={() => downloadText(`doctor-wise-sales-${from}-${to}.csv`, doctorSalesCsv(sales, { from, to }), 'text/csv')}><Download size={14} aria-hidden="true" /> CSV</button>
      </div>
      <Table head={[rtbT('doctorName'), rtbT('regNo'), rtbT('bills'), rtbT('value'), rtbT('scheduledLines')]} rows={sales.map((s) => [s.name, s.reg, s.bills, s.value.toFixed(2), s.scheduledLines])} />
    </>
  );
}

/* ── registers: H1 / H / X / narcotic, retention, licences ── */

type Reg = 'H1' | 'H' | 'X' | 'narcotic';

function RegistersView({ onDone }: { onDone: Done }) {
  const day = todayInput();
  const [kind, setKind] = useState<Reg>('H1');
  const [from, setFrom] = useState(monthStart(day));
  const [to, setTo] = useState(day);
  const { tick, run } = useRun(onDone);
  const items = useMemo(() => (tick >= 0 ? stockItems() : []), [tick]);
  const period = { from, to };
  const reg = useMemo(() => {
    const inv = invoices();
    if (kind === 'X') { const r = xRegister(inv, liveScheduleIndex(), { from, to }); return { head: X_HEAD, rows: r.map(xCells), flagged: r.map((x) => x.missingRx) }; }
    if (kind === 'narcotic') { const r = narcoticRegister(items, getTable('purchases'), inv, { from, to }); return { head: NARCOTIC_HEAD, rows: r.map(narcoticCells), flagged: [] }; }
    const r = h1Register(inv, liveScheduleIndex(), { from, to }, [kind]);
    return { head: H1_HEAD, rows: r.map(h1Cells), flagged: r.map((x) => x.missingRx) };
  }, [kind, from, to, items]);
  const title = rtbT(`reg.${kind}`);
  const profile = localDb.settings.activeProfile();
  const ret = retentionAt(day);
  const missing = reg.flagged.filter(Boolean).length;
  const [pick, setPick] = useState('');
  return (
    <>
      <div style={wrap}>
        <div className={controls.segment} role="tablist">
          {(['H1', 'H', 'X', 'narcotic'] as const).map((k) => <button key={k} type="button" role="tab" aria-selected={kind === k} className={kind === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setKind(k)} data-rtb-reg={k}>{rtbT(`reg.${k}`)}</button>)}
        </div>
        <Period from={from} to={to} onFrom={setFrom} onTo={setTo} />
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!reg.rows.length} onClick={() => downloadText(`${kind.toLowerCase()}-register-${from}-${to}.csv`, registerCsv(title, period, reg.head, reg.rows), 'text/csv')}><Download size={14} aria-hidden="true" /> CSV</button>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => { const html = registerBook({ title, shop: profile?.companyName ?? '', licence: profile?.drug_licence, period, head: reg.head, rows: reg.rows, flagged: reg.flagged }); printHtmlDocument(html, (h) => downloadText(`${kind.toLowerCase()}-register-${from}-${to}.html`, h, 'text/html')); }} data-rtb-print><Printer size={14} aria-hidden="true" /> {rtbT('printBook')}</button>
      </div>
      {missing > 0 && <p className={controls.error}><ShieldAlert size={14} aria-hidden="true" /> {rtbT('rowsMissing', { n: missing })}</p>}
      <Table head={[...reg.head]} rows={reg.rows} flagged={reg.flagged} />
      <p className={controls.hint} data-rtb-retention>{rtbT('retention', { h1: ret.h1Years, x: ret.xPrescriptionYears, memo: ret.cashMemoYears })}</p>
      {kind === 'narcotic' && (
        <div style={wrap}>
          <label className={controls.field}><span className={controls.label}>{rtbT('narcoticItems')}</span>
            <select className={controls.select} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">—</option>
              {items.filter((i) => !i.narcotic).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select></label>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!pick} onClick={() => run(() => { patchStockItem(pick, { narcotic: true }); setPick(''); return rtbT('saved'); })}>{rtbT('markNarcotic')}</button>
          {items.filter((i) => i.narcotic).map((i) => <button key={i.id} type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(() => { patchStockItem(i.id, { narcotic: false }); return rtbT('saved'); })}>{i.name} ✕</button>)}
        </div>
      )}
      {can('settings.manage') && <Licences onDone={onDone} />}
    </>
  );
}

function Licences({ onDone }: { onDone: Done }) {
  const day = todayInput();
  const init = useMemo(() => readRxSettings(), []);
  const [lics, setLics] = useState<DrugLicence[]>(init.licences);
  const [ph, setPh] = useState<Pharmacist>(init.pharmacist ?? { name: '', reg_no: '' });
  const [req, setReq] = useState(!!init.require_rx);
  const { run } = useRun(onDone);
  const patch = (i: number, p: Partial<DrugLicence>) => setLics(lics.map((l, n) => (n === i ? { ...l, ...p } : l)));
  const notices = licenceNotices(lics, day);
  return (
    <section className={surface.panel} data-rtb-licences>
      <h3>{rtbT('licences')}</h3>
      {notices.map((n) => <p key={`${n.licence.form}${n.licence.number}`} className={controls.error}>{rtbT(n.expired ? 'a.licExpired' : 'a.licDue', { form: n.licence.form, number: n.licence.number, date: n.licence.valid_to ?? '' })}</p>)}
      {lics.map((l, i) => (
        <div key={i} style={wrap}>
          <label className={controls.field} style={{ maxWidth: 110 }}><span className={controls.label}>{rtbT('form')}</span>
            <select className={controls.select} value={l.form} onChange={(e) => patch(i, { form: e.target.value as DrugLicenceForm })}>{FORMS.map((f) => <option key={f} value={f}>{f === 'other' ? rtbT('other') : `Form ${f}`}</option>)}</select></label>
          <label className={controls.field}><span className={controls.label}>{rtbT('licenceNo')}</span><input className={controls.input} value={l.number} onChange={(e) => patch(i, { number: e.target.value })} data-rtb-lic-no /></label>
          <label className={controls.field}><span className={controls.label}>{rtbT('validFrom')}</span><input type="date" className={controls.input} value={l.valid_from ?? ''} onChange={(e) => patch(i, { valid_from: e.target.value || undefined })} /></label>
          <label className={controls.field}><span className={controls.label}>{rtbT('validTo')}</span><input type="date" className={controls.input} value={l.valid_to ?? ''} onChange={(e) => patch(i, { valid_to: e.target.value || undefined })} data-rtb-lic-to /></label>
          <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} aria-label={rtbT('delete')} onClick={() => setLics(lics.filter((_, n) => n !== i))}><Trash2 size={14} aria-hidden="true" /></button>
        </div>
      ))}
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setLics([...lics, { form: '20', number: '' }])} data-rtb-lic-add>{rtbT('addLicence')}</button>
      <div style={wrap}>
        <label className={controls.field}><span className={controls.label}>{rtbT('pharmacist')}</span><input className={controls.input} value={ph.name} onChange={(e) => setPh({ ...ph, name: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{rtbT('regNo')}</span><input className={controls.input} value={ph.reg_no} onChange={(e) => setPh({ ...ph, reg_no: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{rtbT('council')}</span><input className={controls.input} value={ph.council ?? ''} onChange={(e) => setPh({ ...ph, council: e.target.value })} /></label>
      </div>
      <label className={controls.check}><input type="checkbox" checked={req} onChange={(e) => setReq(e.target.checked)} data-rtb-require /> {rtbT('requireRx')}</label>
      <p><button type="button" className={controls.btnPrimary} onClick={() => run(() => { saveRxSettings({ licences: lics, pharmacist: ph, require_rx: req }); return rtbT('saved'); })} data-rtb-lic-save>{rtbT('save')}</button></p>
      <p className={controls.hint}>{rtbT('licenceNote')}</p>
    </section>
  );
}

/* ── refills: due list, Bill now ── */

function RefillsView({ onDone }: { onDone: Done }) {
  const day = todayInput();
  const navigate = useNavigate();
  const { tick, run } = useRun(onDone);
  // Bills made since move each schedule forward (written once on open; derived from the bills).
  const all = useMemo(() => {
    try { syncRefills(invoices()); } catch { /* a viewer cannot write: the list below still shows the saved days */ }
    return tick >= 0 ? loadRefills() : [];
  }, [tick]);
  const due = dueRefills(all, day);
  const shop = localDb.settings.activeProfile()?.companyName ?? '';
  const billNow = (id: string) => run(() => {
    const r = all.find((x) => x.id === id);
    if (!r) return '';
    const client = r.client_id ? localDb.clients.getAll().find((c) => c.id === r.client_id) ?? null : null;
    const held = holdCart(loadHeld(), refillCart(r, localDb.items.getAll(), client));
    if (!held.ok) throw new Error(rtbT('heldFull'));
    saveHeld(held.list);
    navigate(`/pos?recall=${held.list[held.list.length - 1].id}`);
    return '';
  });
  const left = (n: number) => (n < 0 ? rtbT('overdue', { n: -n }) : n === 0 ? rtbT('dueToday') : rtbT('dueIn', { n }));
  return (
    <>
      <h3><CalendarClock size={16} aria-hidden="true" /> {rtbT('dueTitle', { n: due.length })}</h3>
      <Table
        head={[rtbT('patient'), rtbT('medicines'), rtbT('nextDue'), '']}
        rows={due.map(({ refill: r, daysLeft }) => {
          const wa = refillWaLink(r, rtbT('waMsg', { name: r.name, items: r.items.map((i) => i.name).join(', '), date: r.next_due, shop }));
          return [
            <>{r.name}{r.phone ? ` · ${r.phone}` : ''}</>, r.items.map((i) => `${i.name} × ${i.quantity}`).join(', '), <>{r.next_due} <small>{left(daysLeft)}</small></>,
            <span key="a" className={surface.rowActions}>
              {wa && <a className={`${controls.btnGhost} ${controls.btnSm}`} href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a>}
              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => billNow(r.id)} data-rtb-bill-now>{rtbT('billNow')}</button>
            </span>,
          ];
        })}
      />
      <h3>{rtbT('allRefills')}</h3>
      <Table
        head={[rtbT('patient'), rtbT('everyDays'), rtbT('nextDue'), '']}
        rows={all.map((r) => [
          <>{r.name}{r.active ? '' : ` · ${rtbT('inactive')}`}</>, r.every_days, r.next_due,
          <span key="a" className={surface.rowActions}>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(() => { saveRefill({ ...r, active: !r.active }); return rtbT('saved'); })}>{r.active ? rtbT('deactivate') : rtbT('activate')}</button>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} aria-label={`${rtbT('delete')} ${r.name}`} onClick={() => window.confirm(rtbT('confirmDelete', { name: r.name })) && run(() => { removeRefill(r.id); return rtbT('deleted'); })}><Trash2 size={14} aria-hidden="true" /></button>
          </span>,
        ])}
      />
      <p className={controls.hint}>{rtbT('refillNote')}</p>
    </>
  );
}

/* ── prices: ceilings, loose price, PTS, margins ── */

function PricesView({ onDone }: { onDone: Done }) {
  const day = todayInput();
  const { tick, run } = useRun(onDone);
  const items = useMemo(() => (tick >= 0 ? stockItems() : []), [tick]);
  const [id, setId] = useState('');
  const [c, setC] = useState({ from: day, price: 0, unit: '' });
  const [strip, setStrip] = useState(0);
  const [csv, setCsv] = useState('');
  const it = items.find((i) => i.id === id);
  const pack = it ? loosePack(it) : undefined;
  const margins = useMemo(() => marginRows(getTable('purchases'), items, localDb.items.getAll()), [items]);
  return (
    <>
      <div style={wrap}>
        <label className={controls.field}><span className={controls.label}>{rtbT('item')}</span>
          <select className={controls.select} value={id} onChange={(e) => setId(e.target.value)} data-rtb-price-item>
            <option value="">—</option>
            {items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select></label>
      </div>
      {it && (
        <section className={surface.panel}>
          <p className={controls.hint}>{(it.ceiling_prices ?? []).map((x) => rtbT('ceilingRow', { from: x.from, price: x.price_per_unit.toFixed(2), unit: x.unit || it.unit || '' })).join(' · ') || rtbT('noCeiling')}</p>
          <div style={wrap}>
            <label className={controls.field}><span className={controls.label}>{rtbT('orderDate')}</span><input type="date" className={controls.input} value={c.from} onChange={(e) => setC({ ...c, from: e.target.value })} /></label>
            <label className={controls.field} style={{ maxWidth: 140 }}><span className={controls.label}>{rtbT('ceiling')}</span><NumberInput className={controls.input} value={c.price} onChange={(price) => setC({ ...c, price })} data-rtb-ceiling /></label>
            <label className={controls.field} style={{ maxWidth: 120 }}><span className={controls.label}>{rtbT('unit')}</span>
              <select className={controls.select} value={c.unit} onChange={(e) => setC({ ...c, unit: e.target.value })}>{unitChoices(it).map((u) => <option key={u.unit} value={u.factor === 1 ? '' : u.unit}>{u.unit}</option>)}</select></label>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!(c.price > 0)} onClick={() => run(() => { patchStockItem(it.id, { ceiling_prices: addCeiling(it.ceiling_prices, { from: c.from, price_per_unit: c.price, unit: c.unit || undefined }) }); return rtbT('saved'); })} data-rtb-ceiling-add>{rtbT('addCeiling')}</button>
          </div>
          <div style={wrap}>
            <label className={controls.field} style={{ maxWidth: 140 }}><span className={controls.label}>{pack ? rtbT('packMrp', { unit: pack.unit, n: pack.factor, base: it.unit || 'NOS' }) : rtbT('noPack')}</span><NumberInput className={controls.input} value={strip} onChange={setStrip} disabled={!pack} data-rtb-strip /></label>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!pack || !(strip > 0)} onClick={() => run(() => rtbT('looseDone', { rate: applyLoosePrice(it.id, strip).toFixed(2), unit: it.unit || 'NOS' }))} data-rtb-loose>{rtbT('loosePrice')}</button>
            <label className={controls.field} style={{ maxWidth: 120 }}><span className={controls.label}>PTS</span><NumberInput className={controls.input} value={it.pts ?? 0} onChange={(pts) => run(() => { patchStockItem(it.id, { pts }); return ''; })} /></label>
          </div>
        </section>
      )}
      <label className={controls.field}><span className={controls.label}>{rtbT('ceilingCsv')}</span>
        <textarea className={controls.textarea} rows={3} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder="Paracetamol 500 TAB, 1.82, TAB, 01-04-2026" /></label>
      <p><button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!csv.trim()} onClick={() => run(() => { const r = importCeilings(parseCeilingCsv(csv)); setCsv(''); return rtbT('csvDone', { n: r.added, missing: r.missing.join(', ') || '—' }); })}><FileSpreadsheet size={14} aria-hidden="true" /> {rtbT('importCsv')}</button></p>
      <p className={controls.hint}>{rtbT('ceilingNote')}</p>
      <h3>{rtbT('margins')} <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!margins.length} onClick={() => downloadText(`margins-${day}.csv`, marginCsv(margins), 'text/csv')}><Download size={14} aria-hidden="true" /> CSV</button></h3>
      <Table
        head={[rtbT('item'), rtbT('batch'), 'PTR', rtbT('costAfterFree'), 'PTS', 'MRP', rtbT('sellRate'), rtbT('marginPtr'), rtbT('scheme')]}
        rows={margins.map((m) => [m.item, m.batch || '—', m.ptr.toFixed(2), m.cost.toFixed(2), m.pts?.toFixed(2) ?? '', m.mrp.toFixed(2), m.sell.toFixed(2), m.margin === null ? '—' : `${m.margin}%`, m.scheme])}
      />
    </>
  );
}

const VIEW_OF: Record<View, (p: { onDone: Done }) => ReactNode> = { rx: RxView, doctors: DoctorsView, registers: RegistersView, refills: RefillsView, prices: PricesView };

export default function PharmacyDesk({ view, onDone }: { view?: string; onDone: Done }) {
  useT();
  const [, setParams] = useSearchParams();
  const v: View = (VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : 'rx';
  const Body = VIEW_OF[v];
  return (
    <section className={surface.card} data-pharmacy-desk={v}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><Users size={16} aria-hidden="true" /> {rtbT('title')}</span>
        <div className={controls.segment} role="tablist">
          {VIEWS.map((x) => <button key={x} type="button" role="tab" aria-selected={v === x} className={v === x ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParams({ tab: 'pharmacy', view: x }, { replace: true })} data-rtb-view={x}>{rtbT(`v.${x}`)}</button>)}
        </div>
      </div>
      <div className={surface.cardBody}><Body onDone={onDone} /></div>
      <p className={controls.hint} style={{ padding: '0 1rem 1rem' }}>{rtbT('workingPaper')}</p>
    </section>
  );
}
