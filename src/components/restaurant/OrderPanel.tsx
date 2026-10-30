import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { ArrowRight, ArrowRightLeft, Layers, Minus, Plus, Printer, ReceiptText, RotateCcw, Send, Split, Trash2, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { PosTiles } from '../pos/PosTiles';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { CancelReason, DiningTable, Kot, ModifierGroup, TableOrder } from '../../types/restaurant';
import { num, round2 } from '../../lib/invoice-calc';
import { suggest } from '../../lib/suggest';
import { generateId } from '../../lib/storage';
import { findByCode } from '../../lib/scan';
import { parseCounterEntry, searchTermOf } from '../../lib/pos-keys';
import { fillRest, tenderSummary, type Tender, type TenderMethod, type MoneyTender } from '../../lib/pos';
import { checkPinWithGuard } from '../../lib/auth';
import { isLive, lineValue, orderSubtotal, serviceChargeOn, serviceChargePct } from '../../lib/restaurant/tables';
import { CANCEL_REASONS, sentQty } from '../../lib/restaurant/kot';
import { groupsFor, isUnavailable, modifierLines, type Picks } from '../../lib/restaurant/modifiers';
import { payersDue } from '../../lib/restaurant/split-bill';
import {
  addToOrder, changeLineQty, isOwnerPinRequired, mergeInto, moveToTable, noteReprint, patchLine, payPayer, previewBill,
  printBill, reopenOrder, sendOrderKot, setServiceCharge, settleOrder, transferTo, voidOrder,
} from '../../lib/restaurant/orders-store';
import { cn, formatCurrency } from '../../lib/utils';
import { isPackOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import { useT } from '../../i18n';
import { rT } from '../../i18n/areas/restaurant';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './restaurant.module.css';

const SplitBillDialog = lazy(() => import('./SplitBillDialog').then((m) => ({ default: m.SplitBillDialog })));
const ModifierPicker = lazy(() => import('./ModifierPicker').then((m) => ({ default: m.ModifierPicker })));
const PosReceiptPrint = lazy(() => import('../pos/PosReceiptPrint').then((m) => ({ default: m.PosReceiptPrint })));
const BillImageShare = lazy(() => import('./BillImageShare').then((m) => ({ default: m.BillImageShare })));
const RoomPicker = lazy(() => import('../hotel/FrontDesk').then((m) => ({ default: m.RoomPicker }))); // R7-B2 "charge to room" (hotel pack only)

const METHODS: MoneyTender[] = ['Cash', 'UPI', 'Card'];
type Notify = (m: string, tone?: 'success' | 'error' | 'info', opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => void;

export interface MenuItem extends InvoiceItem {
  group_id?: string;
}

export interface OrderPanelProps {
  order: TableOrder;
  orders: readonly TableOrder[];
  tables: readonly DiningTable[];
  menu: readonly MenuItem[];
  stock: readonly { name: string; group_id?: string }[];
  groups: readonly { id: string; name: string; parent_id?: string }[];
  modifierGroups: readonly ModifierGroup[];
  posBills: readonly InvoiceRecord[];
  day: string;
  /** Print kitchen tickets on send (device toggle). */
  printTickets: boolean;
  whereOf: (o: TableOrder) => string;
  notify: Notify;
  onChanged: () => void;
  onClose: () => void;
}

type Pending = { kind: 'cancel'; lineId: string; qty: number } | { kind: 'void' } | null;

/** One running order: add items, KOT, print bill, settle / split, move / merge / transfer (R3-A1–A4). */
export function OrderPanel(p: OrderPanelProps) {
  const { lang } = useT(); // QA19 U4: `hits` carry a label
  const { order, notify, onChanged } = p;
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const [tender, setTender] = useState<Record<MoneyTender, number>>({ Cash: 0, UPI: 0, Card: 0, Cheque: 0, Wallet: 0 });
  const [settleOpen, setSettleOpen] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);
  const [modFor, setModFor] = useState<{ item: MenuItem; groups: ModifierGroup[]; qty?: number } | null>(null);
  const [ask86, setAsk86] = useState<{ item: MenuItem; qty?: number } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState<CancelReason>('wrong_order');
  const [pinFor, setPinFor] = useState<Pending>(null);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [moveOpen, setMoveOpen] = useState<'move' | 'merge' | 'transfer' | null>(null);
  const [target, setTarget] = useState('');
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [printing, setPrinting] = useState<InvoiceRecord | null>(null);
  const [imageFor, setImageFor] = useState<{ bill: InvoiceRecord; copy?: boolean } | null>(null);
  const [payerMethod, setPayerMethod] = useState<TenderMethod>('Cash');

  const frozen = order.status === 'printed';
  const live = isLive(order);
  const bill = useMemo(() => (order.lines.length ? previewBill(order, p.day) : null), [order, p.day]);
  const subtotal = orderSubtotal(order);
  const scPct = serviceChargePct(order);
  const where = p.whereOf(order);
  const tenders: Tender[] = METHODS.map((m) => ({ method: m, amount: tender[m] }));
  const summary = tenderSummary(bill?.total ?? 0, tenders);

  const run = (fn: () => void) => {
    try {
      fn();
      onChanged();
    } catch (err) {
      if (isOwnerPinRequired(err)) return;
      notify((err as Error).message, 'error');
    }
  };

  /* ── Items ─────────────────────────────────────────────── */
  const hits = useMemo(
    () => suggest(searchTermOf(query), p.menu, { label: (i) => i.name, extra: (i) => [i.hsn, i.sku, i.barcode, i.short_code], sub: (i) => [formatCurrency(num(i.rate)), isUnavailable(i, p.day) && rT('unavailable')].filter(Boolean).join(' · '), limit: 8 }),
    [query, p.menu, p.day, lang],
  );

  const add = (item: MenuItem, qty?: number, picks?: Picks, groups?: ModifierGroup[]) => {
    run(() => {
      let children;
      let note;
      if (picks && groups) {
        const m = modifierLines({ hsn: item.hsn, tax_rate: item.tax_rate, cess_rate: item.cess_rate, quantity: qty ?? 1, type: item.type, unit: item.unit }, groups, picks, p.menu, generateId);
        children = m.children;
        note = m.note;
      }
      addToOrder(order.id, item, { qty, children, note });
    });
    setQuery('');
    setActive(0);
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  /** Pick an item: confirm when it is 86'd, then its modifiers, then add. */
  const pick = (item: MenuItem, qty?: number, skip86 = false) => {
    if (frozen) return notify(rT('frozen'), 'error');
    if (!skip86 && isUnavailable(item, p.day)) return setAsk86({ item, qty });
    const groups = groupsFor(item, p.modifierGroups);
    if (groups.length) return setModFor({ item, groups, qty });
    add(item, qty);
  };

  const onEnter = () => {
    const e = parseCounterEntry(query);
    if (e.kind !== 'item') return;
    const code = findByCode(e.term, p.menu, []);
    const item = (code?.item as MenuItem | undefined) ?? hits[active]?.row ?? hits[0]?.row;
    if (item) pick(item, e.qty);
  };

  /* ── Lines ─────────────────────────────────────────────── */
  const setQty = (lineId: string, qty: number) => {
    const q = Math.max(round2(qty), 0);
    if (q < sentQty(order, lineId) - 1e-9) return setPending({ kind: 'cancel', lineId, qty: q });
    run(() => changeLineQty(order.id, lineId, q));
  };

  const confirmPending = (ownerOk = false, what: Pending = pending) => {
    if (!what) return;
    try {
      let kots: Kot[] = [];
      if (what.kind === 'cancel') {
        const r = changeLineQty(order.id, what.lineId, what.qty, { reason, ownerOk });
        if (r.kot) kots = [r.kot];
      } else {
        kots = voidOrder(order.id, { reason, ownerOk }).kots;
      }
      setPending(null);
      setPinFor(null);
      void printTickets(kots);
      onChanged();
    } catch (err) {
      if (isOwnerPinRequired(err)) {
        setPending(null);
        setPin('');
        setPinError('');
        setPinFor(what);
      } else notify((err as Error).message, 'error');
    }
  };

  const submitPin = async () => {
    const r = await checkPinWithGuard(pin);
    if (!r.ok) {
      setPinError(r.locked ? `${Math.ceil(r.retryInMs / 1000)} s` : '✕');
      setPin('');
      return;
    }
    confirmPending(true, pinFor);
  };

  /* ── KOT ───────────────────────────────────────────────── */
  const ticketCtx = (k: Kot) => ({
    where,
    covers: order.covers || undefined,
    captain: order.captain_name,
    time: new Date(k.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }),
  });
  const printTickets = async (kots: Kot[], duplicate = false) => {
    if (!kots.length || !p.printTickets) return;
    try {
      const m = await import('../../lib/restaurant/kot-print');
      const failed = await m.printKots(kots, ticketCtx, { duplicate });
      if (failed.length) notify(failed.map((f) => `${f.station}: ${f.error}`).join('; '), 'error');
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const sendKot = () => {
    try {
      const r = sendOrderKot(order.id);
      if (!r.kots.length) return notify(rT('nothingNew'), 'info');
      notify(rT('kotSent', { list: r.kots.map((k) => `${k.number} ${k.station}`).join(', ') }));
      void printTickets(r.kots);
      onChanged();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const doPrintBill = () => {
    try {
      const r = printBill(order.id);
      void printTickets(r.kots);
      onChanged();
      const draft = previewBill(r.order, p.day);
      setPrinting({ ...draft, invoice_number: '' });
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  /* ── Settle ────────────────────────────────────────────── */
  const afterSaved = (bills: InvoiceRecord[]) => {
    const first = bills[0];
    notify(rT('settled', { number: bills.map((b) => b.invoice_number).join(', ') }), 'success', {
      action: { label: rT('shareImage'), onClick: () => setImageFor({ bill: first }) },
      duration: 8000,
    });
    setSettleOpen(false);
    setSplitOpen(false);
    onChanged();
  };
  const settle = () => {
    const res = settleOrder(order.id, tenders, { day: p.day });
    if (!res.ok || !res.records?.length) return notify(res.errors[0] ?? '', 'error');
    afterSaved(res.records);
  };
  const fill = (m: MoneyTender) => setTender((t) => ({ ...t, [m]: fillRest(bill?.total ?? 0, METHODS.map((k) => ({ method: k, amount: t[k] })), m) }));

  const payRow = (i: number) => {
    const res = payPayer(order.id, i, { method: payerMethod, amount: 0 }, { day: p.day });
    if (!res.ok) return notify(res.errors[0] ?? '', 'error');
    if (res.order?.status === 'settled' && res.record) afterSaved([res.record]);
    else onChanged();
  };

  /* ── Move / merge / transfer ───────────────────────────── */
  const others = p.orders.filter((o) => o.id !== order.id && isLive(o));
  const freeTables = p.tables.filter((t) => !p.orders.some((o) => isLive(o) && o.table_id === t.id));
  const doMove = () => {
    if (!target) return;
    run(() => {
      if (moveOpen === 'move') {
        const o = moveToTable(order.id, target);
        notify(rT('moved', { name: p.tables.find((t) => t.id === o.table_id)?.name ?? '' }));
      } else if (moveOpen === 'merge') {
        mergeInto(order.id, target);
        notify(rT('mergedMsg'));
      } else {
        const sel = Object.entries(picked).filter(([, q]) => q > 0).map(([line_id, qty]) => ({ line_id, qty }));
        transferTo(order.id, target, sel);
        notify(rT('transferred'));
      }
      setMoveOpen(null);
      setTarget('');
      setPicked({});
    });
  };

  return (
    <section className={cn(surface.card)} aria-label={where} data-order-panel={order.id}>
      <div className={cn(surface.cardBody, styles.panel)}>
        <div className={styles.panelHead}>
          <div>
            <h2 className={styles.panelTitle}>{where}</h2>
            <span className={styles.muted}>
              {[order.covers ? rT('coversN', { n: order.covers }) : '', order.captain_name, order.client?.name, order.eco_name, order.ref].filter(Boolean).join(' · ')}
            </span>
          </div>
          <button type="button" className={controls.btnIcon} onClick={p.onClose} aria-label={rT('close')}><X size={16} /></button>
        </div>

        {order.channel === 'aggregator' && <p className={styles.small}>{rT('ecoNote')}</p>}

        {live && !frozen && !order.payers?.length && (
          <div className={styles.search}>
            <input
              ref={searchRef}
              id="order-search"
              className={controls.input}
              value={query}
              placeholder={rT('searchPh')}
              aria-label={rT('addItems')}
              autoComplete="off"
              onChange={(e) => { setQuery(e.target.value); setActive(0); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                if (e.key === 'Escape') setQuery('');
              }}
            />
            {query.trim() && hits.length > 0 && (
              <ul className={styles.hits} role="listbox" aria-label={rT('addItems')}>
                {hits.map((h, n) => (
                  <li key={h.row.id} role="option" aria-selected={n === active}>
                    <button type="button" className={cn(styles.hit, n === active && styles.hitOn)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(h.row, parseCounterEntry(query).kind === 'item' ? (parseCounterEntry(query) as { qty?: number }).qty : undefined)}>
                      <span className={cn(isUnavailable(h.row, p.day) && styles.off)}>{h.label}</span>
                      <span className={styles.small}>{h.sub}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {!order.lines.length ? (
          <p className={styles.muted}>{rT('noItems')}</p>
        ) : (
          <div className={styles.lines} role="list" aria-label={rT('addItems')}>
            {order.lines.map((l, n) => {
              const sent = sentQty(order, l.id);
              const child = !!l.modifier_of;
              return (
                <div key={l.id} className={cn(styles.line, child && styles.child)} role="listitem" data-order-line={l.name}>
                  <div className={styles.lineName}>
                    <strong>{child ? `+ ${l.name}` : l.name}</strong>
                    <span className={styles.small}>
                      {[formatCurrency(l.rate), l.price_basis, l.seat ? `${rT('seat')} ${l.seat}` : '', l.note].filter(Boolean).join(' · ')}
                    </span>
                    {sent > 0 && <span className={styles.chip} data-sent={sent}><Send size={11} aria-hidden="true" /> {rT('sent', { n: sent })}</span>}
                  </div>
                  <div className={styles.qty}>
                    {!child && live && !frozen && (
                      <>
                        <button type="button" className={controls.btnIcon} onClick={() => setQty(l.id, num(l.quantity) - 1)} aria-label={rT('less', { name: l.name })}><Minus size={14} /></button>
                        <NumberInput className={cn(controls.input, controls.inputNumeric, styles.qtyInput)} value={l.quantity} blankZero={false} onChange={(q) => setQty(l.id, q)} aria-label={rT('qtyOf', { name: rT('lineOf', { name: l.name, n: n + 1 }) })} />
                        <button type="button" className={controls.btnIcon} onClick={() => setQty(l.id, num(l.quantity) + 1)} aria-label={rT('more', { name: l.name })}><Plus size={14} /></button>
                      </>
                    )}
                    {(child || !live || frozen) && <span>{l.quantity}</span>}
                  </div>
                  <div className={styles.amt}>{formatCurrency(lineValue(l))}</div>
                  {!child && live && !frozen && (
                    <div className={styles.lineExtra}>
                      <NumberInput className={cn(controls.input, styles.seatInput)} value={l.seat ?? 0} onChange={(v) => run(() => patchLine(order.id, l.id, { seat: v }))} placeholder={rT('seat')} aria-label={`${rT('seat')} ${l.name}`} />
                      <input className={cn(controls.input, styles.noteInput)} defaultValue={l.note ?? ''} placeholder={rT('note')} aria-label={`${rT('note')} ${l.name}`} onBlur={(e) => e.target.value !== (l.note ?? '') && run(() => patchLine(order.id, l.id, { note: e.target.value }))} />
                      <button type="button" className={controls.btnDanger} onClick={() => setQty(l.id, 0)} aria-label={rT('remove', { name: l.name })}><Trash2 size={14} /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {live && !frozen && !order.payers?.length && (
          <PosTiles
            sources={p.menu}
            stock={p.stock}
            groups={p.groups}
            invoices={p.posBills}
            qtyOf={() => null}
            unavailable={(i) => isUnavailable(i, p.day)}
            onPick={(i) => pick(i as MenuItem)}
          />
        )}

        {bill && (
          <div className={styles.totals} data-order-totals>
            <div><span>{rT('subtotal')}</span><span>{formatCurrency(subtotal)}</span></div>
            {scPct > 0 && (
              <div title={rT('scHelp')}>
                <span>
                  {rT('serviceCharge', { pct: scPct })}{' '}
                  {live && !frozen && <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => run(() => setServiceCharge(order.id, true))} data-sc-remove>{rT('removeSc')}</button>}
                </span>
                <span>{formatCurrency(serviceChargeOn(subtotal, scPct))}</span>
              </div>
            )}
            {order.service_charge_off && num(order.service_charge_pct) > 0 && live && !frozen && (
              <div><button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => run(() => setServiceCharge(order.id, false))}>{rT('restoreSc')}</button></div>
            )}
            {bill.tax_amount > 0 && <div><span>{rT('tax')}</span><span>{formatCurrency(bill.tax_amount)}</span></div>}
            {bill.round_off !== 0 && <div><span>{rT('roundOff')}</span><span>{formatCurrency(bill.round_off)}</span></div>}
            <div className={styles.grand}><span>{rT('total')}</span><span data-order-total>{formatCurrency(bill.total)}</span></div>
          </div>
        )}
        {scPct > 0 && <p className={styles.small}>{rT('scHelp')}</p>}

        {order.payers?.length ? (
          <div className={styles.parts} data-payers>
            <p className={styles.muted}>{rT('payersNote')}</p>
            <label className={controls.field}>
              <span className={controls.label}>{rT('method')}</span>
              <select className={controls.select} value={payerMethod} onChange={(e) => setPayerMethod(e.target.value as TenderMethod)}>
                {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            {order.payers.map((r, i) => (
              <div key={i} className={styles.partRow}>
                <span>{r.name || rT('payerN', { n: i + 1 })} · {formatCurrency(r.amount)}{r.paid ? ` · ${rT('paid')} (${r.method})` : ''}</span>
                {!r.paid && <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => payRow(i)} data-pay-payer={i}>{rT('payThis', { amount: formatCurrency(r.amount) })}</button>}
              </div>
            ))}
            <span className={styles.small}>{formatCurrency(payersDue(order.payers))}</span>
          </div>
        ) : live ? (
          <div className={styles.actions}>
            {!frozen && <button type="button" className={controls.btnOutline} onClick={sendKot} disabled={!order.lines.length} data-send-kot><Send size={16} /> {rT('sendKot')}</button>}
            {!frozen ? (
              <button type="button" className={controls.btnOutline} onClick={doPrintBill} disabled={!order.lines.length} data-print-bill><Printer size={16} /> {rT('printBill')}</button>
            ) : (
              <button type="button" className={controls.btnOutline} onClick={() => run(() => reopenOrder(order.id))} data-reopen><RotateCcw size={16} /> {rT('reopen')}</button>
            )}
            <button type="button" className={controls.btnPrimary} onClick={() => setSettleOpen(true)} disabled={!order.lines.length} data-settle><ReceiptText size={16} /> {rT('settle')}</button>
            <button type="button" className={controls.btnOutline} onClick={() => setSplitOpen(true)} disabled={!order.lines.length} data-split><Split size={16} /> {rT('split')}</button>
            {!frozen && <button type="button" className={controls.btnGhost} onClick={() => { setTarget(''); setMoveOpen('move'); }}><ArrowRight size={16} /> {rT('move')}</button>}
            {!frozen && <button type="button" className={controls.btnGhost} onClick={() => { setTarget(''); setMoveOpen('merge'); }}><Layers size={16} /> {rT('merge')}</button>}
            {!frozen && <button type="button" className={controls.btnGhost} onClick={() => { setTarget(''); setPicked({}); setMoveOpen('transfer'); }}><ArrowRightLeft size={16} /> {rT('transfer')}</button>}
            {!frozen && <button type="button" className={controls.btnGhost} onClick={() => setPending({ kind: 'void' })}><Trash2 size={16} /> {rT('void')}</button>}
          </div>
        ) : null}

        {order.kots.length > 0 && (
          <details>
            <summary>{rT('kots')} ({order.kots.length})</summary>
            <ul className={styles.kotList}>
              {order.kots.map((k) => (
                <li key={k.id}>
                  <span>{k.number} · {k.station}{k.kind === 'cancel' ? ` · ${rT('cancelTicket')}` : ''}{k.reprints ? ` · ${rT('duplicate')} ×${k.reprints}` : ''}</span>
                  <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => { try { noteReprint(order.id, k.id); void printTickets([k], true); onChanged(); } catch (err) { notify((err as Error).message, 'error'); } }}>{rT('reprint')}</button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {settleOpen && bill && (
        <Modal
          open
          size="sm"
          onClose={() => setSettleOpen(false)}
          title={rT('settleTitle', { where })}
          footer={
            <>
              <button type="button" className={controls.btnOutline} onClick={() => setSettleOpen(false)}>{rT('cancel')}</button>
              {isPackOn(localDb.settings.get(), 'hotel') && <Suspense fallback={null}><RoomPicker order={order.id} notify={notify} onDone={() => { setSettleOpen(false); onChanged(); }} /></Suspense>}
              <button type="button" className={controls.btnPrimary} onClick={settle} data-settle-now>{rT('settleNow', { amount: formatCurrency(bill.total) })}</button>
            </>
          }
        >
          <div className={styles.tenders}>
            {METHODS.map((m) => (
              <div key={m} style={{ display: 'contents' }}>
                <label htmlFor={`settle-${m}`}>{m}</label>
                <NumberInput id={`settle-${m}`} className={cn(controls.input, controls.inputNumeric)} value={tender[m]} onChange={(v) => setTender((t) => ({ ...t, [m]: v }))} placeholder="0" />
                <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => fill(m)} data-fill={m}>{rT('rest')}</button>
              </div>
            ))}
          </div>
          <p className={styles.muted}>{summary.change > 0 ? `↩ ${formatCurrency(summary.change)}` : summary.due > 0 ? `${formatCurrency(summary.due)}` : '✓'}</p>
        </Modal>
      )}

      <Suspense fallback={null}>
        {splitOpen && (
          <SplitBillDialog
            order={order}
            onClose={() => setSplitOpen(false)}
            onDone={(r) => {
              if (r.result?.records?.length) afterSaved(r.result.records);
              else {
                setSplitOpen(false);
                onChanged();
              }
            }}
          />
        )}
        {modFor && (
          <ModifierPicker
            name={modFor.item.name}
            groups={modFor.groups}
            onClose={() => setModFor(null)}
            onPick={(picks) => {
              const m = modFor;
              setModFor(null);
              add(m.item, m.qty, picks, m.groups);
            }}
          />
        )}
        {printing && <PosReceiptPrint invoice={printing} onDone={() => setPrinting(null)} />}
        {imageFor && (
          <BillImageShare
            invoice={imageFor.bill}
            copy={imageFor.copy}
            onDone={(r) => {
              setImageFor(null);
              if (!r.ok) notify(rT('imageFailed', { reason: r.message ?? '' }), 'error');
              else if (r.copied) notify(rT('imageCopied'));
            }}
          />
        )}
      </Suspense>

      <ConfirmDialog
        open={!!ask86}
        title={rT('unavailable')}
        message={rT('addAnyway', { name: ask86?.item.name ?? '' })}
        confirmLabel={rT('modAdd')}
        cancelLabel={rT('cancel')}
        onClose={() => setAsk86(null)}
        onConfirm={() => {
          const a = ask86;
          setAsk86(null);
          if (a) pick(a.item, a.qty, true);
        }}
      />

      {pending && (
        <Modal
          open
          size="sm"
          onClose={() => setPending(null)}
          title={pending.kind === 'void' ? rT('void') : rT('cancelTitle')}
          footer={
            <>
              <button type="button" className={controls.btnOutline} onClick={() => setPending(null)}>{rT('cancel')}</button>
              <button type="button" className={controls.btnDanger} onClick={() => confirmPending()} data-cancel-confirm>{rT('confirm')}</button>
            </>
          }
        >
          <p>
            {pending.kind === 'void'
              ? rT('voidMsg')
              : rT('cancelMsg', { qty: round2(sentQty(order, pending.lineId) - pending.qty), name: order.lines.find((l) => l.id === pending.lineId)?.name ?? '' })}
          </p>
          <label className={controls.field}>
            <span className={controls.label}>{rT('reason')}</span>
            <select className={controls.select} value={reason} onChange={(e) => setReason(e.target.value as CancelReason)} id="cancel-reason">
              {CANCEL_REASONS.map((r) => <option key={r} value={r}>{rT(`r.${r}`)}</option>)}
            </select>
          </label>
        </Modal>
      )}

      {pinFor && (
        <Modal
          open
          size="sm"
          onClose={() => setPinFor(null)}
          title={rT('ownerPin')}
          footer={
            <>
              <button type="button" className={controls.btnOutline} onClick={() => setPinFor(null)}>{rT('cancel')}</button>
              <button type="button" className={controls.btnPrimary} onClick={() => void submitPin()} disabled={!pin}>{rT('confirm')}</button>
            </>
          }
        >
          <p>{rT('ownerPinMsg')}</p>
          <input className={controls.input} type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label={rT('ownerPin')} onKeyDown={(e) => e.key === 'Enter' && pin && void submitPin()} />
          {pinError && <p className={styles.error} role="alert">{pinError}</p>}
        </Modal>
      )}

      {moveOpen && (
        <Modal
          open
          size="sm"
          onClose={() => setMoveOpen(null)}
          title={rT(moveOpen === 'move' ? 'moveTitle' : moveOpen === 'merge' ? 'mergeTitle' : 'transferTitle')}
          footer={
            <>
              <button type="button" className={controls.btnOutline} onClick={() => setMoveOpen(null)}>{rT('cancel')}</button>
              <button type="button" className={controls.btnPrimary} onClick={doMove} disabled={!target}>{rT('confirm')}</button>
            </>
          }
        >
          {moveOpen === 'move' ? (
            freeTables.length ? (
              <select className={controls.select} value={target} onChange={(e) => setTarget(e.target.value)} aria-label={rT('pickTable')}>
                <option value="">-</option>
                {freeTables.map((t) => <option key={t.id} value={t.id}>{rT('tableN', { name: t.name })}</option>)}
              </select>
            ) : <p>{rT('noFree')}</p>
          ) : others.length ? (
            <>
              <select className={controls.select} value={target} onChange={(e) => setTarget(e.target.value)} aria-label={rT('pickOrder')}>
                <option value="">-</option>
                {others.map((o) => <option key={o.id} value={o.id}>{p.whereOf(o)}</option>)}
              </select>
              {moveOpen === 'transfer' && (
                <div className={styles.parts}>
                  {order.lines.filter((l) => !l.modifier_of).map((l) => (
                    <label key={l.id} className={styles.partRow}>
                      <span>{l.quantity} × {l.name}</span>
                      <NumberInput className={cn(controls.input, styles.qtyInput)} value={picked[l.id] ?? 0} onChange={(v) => setPicked((x) => ({ ...x, [l.id]: Math.min(Math.max(v, 0), num(l.quantity)) }))} aria-label={`${rT('qtyToMove')} ${l.name}`} />
                    </label>
                  ))}
                </div>
              )}
            </>
          ) : <p>{rT('noOther')}</p>}
        </Modal>
      )}
    </section>
  );
}
