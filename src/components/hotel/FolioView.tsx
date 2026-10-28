/**
 * R7-B folios view (`/tables?tab=frontdesk&view=folios`, lazy through FrontDesk's `EXTRA_VIEWS`): folio windows with
 * post / split / transfer / void, bill-to (company / agent, TDS default, routing, commission), check-out and interim
 * invoices, cancellation / no-show charges and OTA payouts. One module, FrontDesk's form kit and strings reused (size).
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Receipt, ReceiptText, Split, Wallet, XCircle } from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import type { Folio, FolioLineKind, Reservation } from '../../types/hotel-r7';
import { Fields, Row, Tbl, type Ctx, type Spec } from './FrontDesk';
import { Modal } from '../ui/Modal';
import { useT } from '../../i18n';
import { hT } from '../../i18n/areas/hotel-frontdesk-r7';
import { bT } from '../../i18n/areas/hotel-billing-r7';
import { localDb } from '../../lib/localDb';
import { checkPinWithGuard } from '../../lib/auth';
import { round2 } from '../../lib/invoice-calc';
import { formatMoney as money } from '../../lib/utils';
import { hotelDb } from '../../lib/hotel/hotel-store';
import { lineDates } from '../../lib/hotel/availability';
import { LINE_KINDS, POST_KINDS } from '../../lib/hotel/routing';
import { VoidPinRequired, openHouseFolio, postCharge, splitLine, stayFolios, transferLines, voidLine } from '../../lib/hotel/folio';
import { TDS_DEFAULTS, billKind, setBillTo, tdsCode, tdsLabel } from '../../lib/hotel/bill-to';
import { commissionDue, recordCommission } from '../../lib/hotel/agent-commission';
import { billable, interimDates } from '../../lib/hotel/checkout';
import { advancesFor, draftFor, nightsToPost, reconcileFolios, saveCheckout } from '../../lib/hotel/checkout-save';
import { catchUpLine } from '../../lib/hotel/night-audit';
import { nextDay } from '../../lib/hotel/business-date';
import { undoRoomCharge } from '../../lib/hotel/charge-to-room';
import { cancelCharge, chargeCancellation } from '../../lib/hotel/cancellation';
import { payoutCandidates, payoutPlan, postPayout } from '../../lib/hotel/ota-payout';
import { B, errText, printHtml } from '../transport/shared';
import styles from './hotel.module.css';

type Rec = Record<string, unknown>;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const sum = (f: Pick<Folio, 'lines'>, all = false) => round2((all ? f.lines.filter((l) => !l.void) : billable(f)).reduce((s, l) => s + l.amount, 0));
const METHODS = ['UPI', 'Cash', 'Card', 'Bank transfer'];
const num = (v: unknown) => Number(v) || 0;

export default function FolioView({ ctx }: { ctx: Ctx }) {
  useT();
  const [tab, setTab] = useState('folios');
  return (
    <div className={styles.stack} data-hotel-folios>
      <Row>{(['folios', 'cancel', 'ota'] as const).map((x) => <button key={x} type="button" className={tab === x ? styles.viewOn : styles.view} onClick={() => setTab(x)} data-folio-tab={x}>{bT(`tab.${x}`)}</button>)}</Row>
      {tab === 'folios' ? <Folios ctx={ctx} /> : tab === 'cancel' ? <Cancels ctx={ctx} /> : <Payouts ctx={ctx} />}
      <p className={styles.note}>{bT('wp')}</p>
    </div>
  );
}

/* ── Folio list and panel (B1, B4) ─────────────────────────────── */

function Folios({ ctx }: { ctx: Ctx }) {
  const d = useMemo(() => (reconcileFolios(), { folios: hotelDb.folios(), clients: localDb.clients.getAll().filter((c) => c.id).map((c) => [c.id!, c.company || c.name] as const) }), [ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [params] = useSearchParams(); // PENDING 9: `&folio=<id>&checkout=1` from Reservations / night audit
  const [q, setQ] = useState<Rec>(() => ({ q: '', house: '', sel: params.get('folio') ?? '' }));
  const [auto] = useState(() => (params.get('checkout') === '1' ? { id: params.get('folio'), tick: ctx.tick } : null)); // opens once
  const s = String(q.q).trim().toLowerCase();
  const f = d.folios.find((x) => x.id === q.sel);
  return (
    <>
      <Row>
        <Fields v={q} set={(p) => setQ({ ...q, ...p })} spec={[['q', 'search'], ['house', bT('house'), [['', '—'], ...d.clients]]]} />
        <button type="button" className={B.o} disabled={!q.house} onClick={() => ctx.run(() => setQ({ ...q, sel: openHouseFolio({ client_id: String(q.house), name: d.clients.find((c) => c[0] === q.house)?.[1] ?? '' }).id }))}><Wallet size={16} aria-hidden="true" /> {bT('house')}</button>
      </Row>
      <Tbl head={[bT('folio'), bT('payer'), hT('total'), bT('toBill')]} rows={d.folios.filter((x) => x.status === 'open' && `${x.name} ${x.payer.name}`.toLowerCase().includes(s)).map((x) => [
        <button type="button" className={B.gs} onClick={() => setQ({ ...q, sel: x.id })} data-folio-open={x.name}>{x.name}</button>, x.payer.name, money(sum(x, true)), money(sum(x))])} />
      {f && <Panel key={`${f.id}${ctx.tick}`} ctx={ctx} f={f} all={d.folios} clients={d.clients} out0={auto && auto.id === f.id && auto.tick === ctx.tick ? 'final' : ''} />}
    </>
  );
}

function Panel({ ctx, f, all, clients, out0 = '' }: { ctx: Ctx; f: Folio; all: Folio[]; clients: readonly (readonly [string, string])[]; out0?: string }) {
  const res = f.reservation_id ? hotelDb.reservation(f.reservation_id) : undefined;
  const items = useMemo(() => localDb.items.getAll(), []);
  const [pick, setPick] = useState<string[]>([]);
  const [op, setOp] = useState<Rec>({ window: '2', to: '' });
  const [c, setC] = useState<Rec>({ kind: 'laundry', qty: 1, item: '' });
  const [out, setOut] = useState(out0);
  const run = (fn: () => unknown) => ctx.run(() => { fn(); setPick([]); });
  const post = () => ctx.run(() => {
    const it = items.find((i) => i.id === c.item);
    postCharge(res && f.line_id ? { resId: res.id, lineId: f.line_id } : { folioId: f.id }, {
      kind: c.kind as FolioLineKind, desc: String(c.desc || it?.name || c.kind), qty: num(c.qty), rate: num(c.rate ?? it?.rate),
      tax_rate: c.gst === undefined ? it?.tax_rate ?? localDb.settings.get().defaultTaxRate : num(c.gst), ...(it?.hsn ? { sac: it.hsn } : {}),
    });
  });
  const doVoid = async (ownerOk = false): Promise<void> => {
    try {
      voidLine(f.id, pick[0], String(op.reason ?? ''), { ownerOk });
      setPick([]);
      ctx.refresh();
    } catch (e) {
      if (!(e instanceof VoidPinRequired) || ownerOk) return ctx.notify(errText(e), 'error');
      const pin = window.prompt(bT('pin'));
      if (pin && (await checkPinWithGuard(pin)).ok) return doVoid(true);
      ctx.notify(bT('pinBad'), 'error');
    }
  };
  const hs = hotelDb.settings();
  const line = res?.lines.find((l) => l.id === f.line_id);
  const ld = res && line ? lineDates(res, line) : null;
  const due = ld ? interimDates(ld.arrival, ld.departure, hs.interim_days, hs.interim_year_end).filter((x) => x <= ctx.day && billable(f).some((l) => l.date < x)) : [];
  const live = f.lines.filter((l) => !l.void);
  const order = pick.length === 1 ? f.lines.find((l) => l.id === pick[0])?.src?.table_order_id : undefined;
  const print = () => printHtml(`<h2>${esc(localDb.settings.activeProfile()?.companyName)} · ${esc(f.name)}</h2><p><b>${bT('proforma')}</b> · ${esc(f.payer.name)}</p><table border="1" cellpadding="4">${live.map((l) => `<tr><td>${l.date}</td><td>${esc(l.desc)}</td><td>${l.qty}</td><td>${money(l.amount)}</td></tr>`).join('')}</table><p>${hT('total')}: ${money(sum(f, true))}</p>`, f.name);
  return (
    <div className={styles.box} data-folio-panel={f.name}>
      <Row><strong>{f.name} · {f.payer.name}</strong>{bT('toBill')}: {money(sum(f))}{due.length > 0 && <span className={styles.warn}>{bT('interimDue', { d: due[due.length - 1] })}</span>}</Row>
      <Tbl head={['', bT('date'), hT('kind'), bT('desc'), bT('qty'), hT('amount'), bT('gst')]} rows={f.lines.map((l) => [
        <input type="checkbox" aria-label={l.desc} disabled={!!l.void || !!l.src?.invoice_id} checked={pick.includes(l.id)} onChange={(e) => setPick(e.target.checked ? [...pick, l.id] : pick.filter((x) => x !== l.id))} />,
        l.date, l.kind, <span style={l.void ? { textDecoration: 'line-through' } : undefined}>{l.desc}{l.moved_from ? ` (${bT('moved', { f: l.moved_from })})` : ''}{l.void ? ` · ${l.void.reason} · ${l.void.by}` : ''}{l.src?.invoice_id ? ' ✓' : ''}</span>,
        l.qty, money(l.amount), l.tax_rate ?? '',
      ])} />
      {pick.length > 0 && <Row>
        <Fields v={op} set={(p) => setOp({ ...op, ...p })} spec={[...(f.line_id ? [['window', bT('window'), ['1', '2', '3', '4']] as Spec] : []), ['to', bT('toFolio'), [['', '—'], ...all.filter((x) => x.status === 'open' && x.id !== f.id).map((x) => [x.id, `${x.name} · ${x.payer.name}`] as const)]], ['amount', 'amount', 'n'], ['qty', bT('qty'), 'n'], ['reason', 'reason']]} />
        <button type="button" className={B.os} disabled={pick.length !== 1 || !f.line_id} onClick={() => run(() => splitLine(f.id, pick[0], op.qty ? { qty: num(op.qty) } : { amount: num(op.amount) }, num(op.window)))}><Split size={14} aria-hidden="true" /> {bT('split')}</button>
        <button type="button" className={B.os} onClick={() => run(() => transferLines(f.id, pick, op.to ? { folioId: String(op.to) } : { window: num(op.window) }))}><ArrowLeftRight size={14} aria-hidden="true" /> {bT('transfer')}</button>
        <button type="button" className={B.gs} disabled={pick.length !== 1} onClick={() => void doVoid()}><XCircle size={14} aria-hidden="true" /> {bT('void')}</button>
        {order && <button type="button" className={B.os} onClick={() => run(() => undoRoomCharge(order))} data-undo-room-charge>{bT('undo')}</button>}
      </Row>}
      <Row>
        <Fields v={c} set={(p) => setC({ ...c, ...p })} spec={[['kind', 'kind', POST_KINDS], ['item', bT('item'), [['', '—'], ...items.map((i) => [i.id, i.name] as const)]], ['desc', bT('desc')], ['qty', bT('qty'), 'n'], ['rate', bT('rate'), 'n'], ['gst', bT('gst'), 'n']]} />
        <button type="button" className={B.p} onClick={post} data-post-charge><Receipt size={16} aria-hidden="true" /> {bT('post')}</button>
      </Row>
      {res && <BillTo ctx={ctx} res={res} clients={clients} />}
      <Row>
        <button type="button" className={B.o} onClick={print}>{hT('print')}</button>
        <button type="button" className={B.o} onClick={() => setOut('interim')}>{bT('interim')}</button>
        <button type="button" className={B.p} onClick={() => setOut('final')} data-folio-checkout><ReceiptText size={16} aria-hidden="true" /> {hT('checkOut')}</button>
      </Row>
      {out && <Checkout ctx={ctx} f={f} res={res} interim={out === 'interim'} close={() => setOut('')} />}
    </div>
  );
}

function BillTo({ ctx, res, clients }: { ctx: Ctx; res: Reservation; clients: readonly (readonly [string, string])[] }) {
  const cl = (id: unknown) => localDb.clients.getById(String(id));
  const h = cl(res.bill_to?.client_id)?.hotel;
  const [b, setB] = useState<Rec>(() => ({ kind: billKind(res), client: res.bill_to?.client_id ?? '', tds: h?.tds_default ?? 'none', pct: h?.commission_pct, ...Object.fromEntries([2, 3, 4].map((w) => [`w${w}`, (res.routing ?? []).find((r) => r.window === w)?.kinds.join(' ') ?? ''])) }));
  const save = () => ctx.run(() => {
    const c = cl(b.client);
    if (c && b.kind !== 'guest') localDb.clients.upsert({ ...c, hotel: { ...c.hotel, tds_default: b.tds as 'none', commission_pct: num(b.pct) || undefined } });
    const rules = [2, 3, 4].map((w) => ({ window: w, kinds: String(b[`w${w}`] ?? '').split(/[\s,]+/).filter((k): k is FolioLineKind => (LINE_KINDS as readonly string[]).includes(k)) })).filter((r) => r.kinds.length);
    setBillTo(res.id, b.kind as 'guest', c, rules.length ? rules : undefined);
  });
  const due = b.kind === 'agent' ? commissionDue({ ...res, bill_kind: 'agent' }, { hotel: { commission_pct: num(b.pct) } }) : null;
  const code = tdsCode(String(b.tds));
  return (
    <div className={styles.box}>
      <Row>
        <Fields v={b} set={(p) => setB({ ...b, ...p })} spec={[
          ['kind', 'billTo', (['guest', 'company', 'agent'] as const).map((k) => [k, bT(`bk.${k}`)] as const)],
          ...(b.kind === 'guest' ? [] : [['client', bT('client'), [['', '—'], ...clients]], ['tds', bT('tdsDefault'), TDS_DEFAULTS], ['pct', bT('commissionPct'), 'n']] as Spec[]),
          ...[2, 3, 4].map((w) => [`w${w}`, bT('routing', { w })] as Spec),
        ]} />
        <button type="button" className={B.o} onClick={save}>{hT('save')}</button>
      </Row>
      {code && <p className={styles.note}>TDS: {tdsLabel(code, ctx.day)}</p>}
      {due && <p className={styles.note}>{bT('commission', { a: money(due.amount) })}</p>}
      {due && res.bill_to && !res.commission && <button type="button" className={B.o} onClick={() => ctx.run(() => recordCommission(res.id), bT('agentDone'))} data-folio-agent-comm>{bT('agentBill')}</button>}{/* R16-C5 */}
    </div>
  );
}

/* ── Check-out / interim (B3) ──────────────────────────────────── */

function Checkout({ ctx, f, res, interim, close }: { ctx: Ctx; f: Folio; res?: Reservation; interim: boolean; close: () => void }) {
  const wins = useMemo(() => (res && f.line_id ? stayFolios(hotelDb.folios(), res.id, f.line_id) : [f]).filter((w) => w.status === 'open').map((w) => ({ w, advs: advancesFor(w, res) })), [f, res]);
  const [p, setP] = useState<Record<string, Rec>>(() => Object.fromEntries(wins.map(({ w, advs }) => [w.id, { method: 'UPI', ...Object.fromEntries(advs.map((a) => [a.id, a.own])) }])));
  const toPost = nightsToPost(f, interim, ctx.day);
  const [done, setDone] = useState<InvoiceRecord[]>([]);
  const rows = wins.map(({ w, advs }) => {
    const s = p[w.id];
    const guest = w.payer.kind === 'guest' && s.gstin ? { name: String(s.company || w.payer.name), company: String(s.company ?? ''), gstin: String(s.gstin).toUpperCase() } : undefined;
    const dr = draftFor(w, ctx.day, { guest, interim });
    const used = advs.filter((a) => s[a.id]);
    const pay = s.amount ?? (w.payer.kind === 'guest' ? Math.max(round2(dr.record.total - (dr.record.tds_amount ?? 0) - used.reduce((t, a) => t + a.open, 0)), 0) : 0);
    return { w, s, advs, guest, dr, used, pay };
  });
  const save = () => {
    try {
      const out = saveCheckout({
        interim, checkout: !interim && res && f.line_id ? { resId: res.id, lineId: f.line_id } : undefined,
        windows: rows.map((r) => ({ folioId: r.w.id, guest: r.guest, advances: r.used.map((a) => ({ id: a.id, amount: a.open })), ...(num(r.pay) > 0 ? { pay: { method: String(r.s.method), amount: num(r.pay) } } : {}) })),
      });
      setDone(out);
      ctx.notify(bT('saved', { n: out.map((i) => i.invoice_number).join(', ') }));
      ctx.refresh();
    } catch (e) {
      ctx.notify(errText(e), 'error');
    }
  };
  return (
    <Modal open size="lg" onClose={close} title={`${interim ? bT('interim') : hT('checkOut')} · ${f.name}`}
      footer={<>{!done.length && <button type="button" className={B.p} onClick={save} data-checkout-save><ReceiptText size={16} aria-hidden="true" /> {bT('saveInvoices')}</button>}<button type="button" className={B.o} onClick={close}>{hT('close')}</button></>}>
      <div className={styles.stack}>
        {!done.length && toPost.length > 0 && res && f.line_id && <Row>
          <span className={styles.warn} data-nights-to-post={toPost.length}>{bT('toPost', { n: toPost.length, d: toPost.join(', ') })}</span>
          <button type="button" className={B.os} onClick={() => ctx.run(() => { catchUpLine(res.id, f.line_id!, nextDay(toPost[toPost.length - 1])); close(); })}>{bT('postNow')}</button>
        </Row>}
        {done.length ? <Row>{done.map((i) => <Link key={i.id} className={B.o} to={`/invoice/${i.id}`} data-checkout-invoice>{i.invoice_number}</Link>)}</Row> : rows.map(({ w, s, advs, dr, pay }) => (
          <div key={w.id} className={styles.box} data-checkout-window={w.window}>
            <strong>{w.name} · {w.payer.name}</strong>
            <Tbl head={[bT('desc'), bT('qty'), bT('rate'), bT('gst'), hT('amount')]} rows={dr.record.items.map((i) => [`${i.name} ${i.description ?? ''}`, i.quantity, money(i.rate), `${i.tax_rate}%`, money(i.amount)])} />
            {dr.lineIds.length > 0 && <>
              <Row>
                {money(dr.record.taxable_value)} + GST {money(dr.record.tax_amount)} = <b>{money(dr.record.total)}</b>
                {dr.band && <span className={styles.note}>{bT(`band.${dr.band}`)}</span>}
                {dr.rateChange && <span className={styles.warn}>{bT('rateChip', { d: dr.rateChange.from, n: dr.rateChange.nights })}</span>}
                {dr.record.tds_section && <span className={styles.note}>TDS {tdsLabel(dr.record.tds_section, ctx.day)}: {money(dr.record.tds_amount ?? 0)}</span>}
              </Row>
              <Row><Fields v={{ ...s, amount: pay }} set={(x) => setP({ ...p, [w.id]: { ...s, ...x } })} spec={[
                ...(w.payer.kind === 'guest' ? [['company', bT('company')], ['gstin', 'GSTIN']] as Spec[] : []),
                ...advs.map((a) => [a.id, `${bT('adv')} ${a.number} (${money(a.open)})`, 'c'] as Spec),
                ['method', 'method', METHODS], ['amount', w.payer.kind === 'guest' ? bT('pay') : bT('credit'), 'n'],
              ]} /></Row>
            </>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ── Cancellation / no-show (B6) ───────────────────────────────── */

function Cancels({ ctx }: { ctx: Ctx }) {
  const d = useMemo(() => ({ res: hotelDb.reservations().filter((r) => (r.status === 'cancelled' || r.status === 'no_show') && !r.cancellation), plans: hotelDb.ratePlans(), hs: hotelDb.settings() }), [ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [s, setS] = useState<Rec>({});
  return <Tbl head={[hT('booking'), hT('guest'), hT('status'), hT('charge'), '']} rows={d.res.map((r) => {
    const c = cancelCharge(r, d.plans, r.status as 'no_show', new Date(), d.hs.checkin_time);
    return [r.number, r.guest.name, hT(`st.${r.status}`), c.free && !c.amount ? bT('free') : money(c.amount), s.id === r.id ? (
      <Row>
        <Fields v={s} set={(p) => setS({ ...s, ...p })} spec={[['amount', 'amount', 'n'], ['reason', 'reason'], ['waive', bT('waive'), 'c'], ['refund', bT('refund'), ['', ...METHODS]]]} />
        <button type="button" className={B.ps} onClick={() => ctx.run(() => chargeCancellation(r.id, { amount: num(s.amount), waive: !!s.waive, reason: String(s.reason ?? ''), refund: s.refund ? { method: String(s.refund) } : undefined }))} data-cancel-charge>{hT('charge')}</button>
      </Row>
    ) : <button type="button" className={B.os} onClick={() => setS({ id: r.id, amount: c.amount, refund: 'UPI' })}>{hT('charge')}</button>];
  })} />;
}

/* ── OTA payouts (B5) ──────────────────────────────────────────── */

function Payouts({ ctx }: { ctx: Ctx }) {
  const all = useMemo(() => payoutCandidates(), [ctx.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const otas = [...new Set(all.map((x) => x.ota))];
  const [p, setP] = useState<Rec>({ ota: otas[0] ?? '', date: ctx.day, method: 'Bank transfer', amount: 0, pct: 15 });
  const [off, setOff] = useState<Rec>({});
  const rows = all.filter((x) => x.ota === p.ota).map((x) => {
    const commission = round2((x.inv.taxable_value * num(p.pct)) / 100);
    return { x, r: { invoiceId: x.inv.id, commission, gst: round2(commission * 0.18), tcs: x.tcs } };
  });
  const picked = rows.filter((r) => !off[r.r.invoiceId]).map((r) => r.r);
  const gap = payoutPlan(picked, (id) => all.find((x) => x.inv.id === id)?.due ?? 0, num(p.amount)).gap;
  const post = () => postPayout({ ota: String(p.ota), gstin: rows[0]?.x.inv.eco_gstin, date: String(p.date), amount: num(p.amount), method: String(p.method), ref: String(p.ref ?? ''), rows: picked })
    .then(() => { ctx.notify(bT('saved', { n: picked.length })); ctx.refresh(); }, (e) => ctx.notify(errText(e), 'error'));
  return (
    <div className={styles.stack}>
      <Row><Fields v={p} set={(x) => setP({ ...p, ...x })} spec={[['ota', 'otaName', otas], ['date', bT('date'), 'd'], ['amount', bT('payout'), 'n'], ['method', 'method', METHODS], ['ref', bT('ref')], ['pct', bT('commPct'), 'n']]} /></Row>
      <Tbl head={['', bT('folio'), hT('guest'), bT('due'), bT('commPct'), 'GST', 'TCS', bT('net')]} rows={rows.map(({ x, r }) => [
        <input type="checkbox" aria-label={x.inv.invoice_number} checked={!off[x.inv.id]} onChange={(e) => setOff({ ...off, [x.inv.id]: !e.target.checked })} />, x.inv.invoice_number, x.inv.client.name, money(x.due),
        money(r.commission), money(r.gst), money(r.tcs), money(round2(x.due - r.commission - r.gst - r.tcs)),
      ])} />
      <Row>
        <span className={Math.abs(gap) > 0.004 ? styles.warn : styles.note}>{bT('gap', { g: money(gap) })}</span>
        <button type="button" className={B.p} disabled={!picked.length || Math.abs(gap) > 0.004} onClick={() => void post()} data-ota-post><Wallet size={16} aria-hidden="true" /> {bT('postPayout')}</button>
      </Row>
    </div>
  );
}
