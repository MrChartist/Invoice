import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { History, Keyboard, Minus, Pause, Plus, Printer, ReceiptText, RotateCcw, Save, Tags, Trash2, UserRound, X } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/useToast';
import { NumberInput } from '../components/ui/NumberInput';
import { Typeahead } from '../components/ui/Typeahead';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ScanField } from '../components/scan/ScanField';
import { SerialPicker } from '../components/inventory/SerialPicker';
import { BankAccountSelect } from '../components/bank/BankAccountSelect';
import { HeldBills } from '../components/pos/HeldBills';
import { PosTiles } from '../components/pos/PosTiles';
import { localDb } from '../lib/localDb';
import { generateId, getTable } from '../lib/storage';
import { num, round2 } from '../lib/invoice-calc';
import { suggest } from '../lib/suggest';
import { addScannedLine, findByCode } from '../lib/scan';
import { TABLES, findLevel, loadPositions, type StockItem } from '../lib/inventory';
import { editorStockContext, serialKey, serialsInStock } from '../lib/stock-tracking';
import { customFieldsDb, snapshotFromMap } from '../lib/custom-fields';
import {
  catalogItemFor, levelForClient, loadPricing, pricingInUse, resolvePrice, syncSchemeLines,
} from '../lib/pricing';
import {
  POS_SHORTCUTS, buildPosRecord, fillRest, posShortcut, savePosBill, tenderSummary,
  type PosAction, type Tender, type TenderMethod,
} from '../lib/pos';
import { holdCart, loadHeld, recallCart, saveHeld, type HeldCart } from '../lib/pos-hold';
import { stockClass } from '../lib/pos-tiles';
import { redeemOnBill } from '../lib/loyalty';
import { applyBillOffer } from '../lib/offers';
import { DOCUMENT_LABELS, type Client, type InvoiceItem, type InvoiceRecord } from '../types/invoice';
import { cn, formatCurrency, todayInput } from '../lib/utils';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from '../components/pos/pos.module.css';
import counter from '../components/pos/counter.module.css';
import { useT } from '../i18n';
import { docLabel as docName } from '../i18n/labels';
import { posT } from '../i18n/areas/pos';
import { returnsT } from '../i18n/areas/extras';
import { areaNodes } from '../i18n/areas/nodes';
import { unitT } from '../i18n/areas/units';
import { cleanAltUnits, lineUnitPatch, roundTypedQty, unitChoices, unitsDb } from '../lib/units';
import { canOverrideCredit, creditStatus, recordCreditOverride } from '../lib/credit-policy'; // 8.80
import { saltIndex, saltOf } from '../lib/salt-search'; // 8.84
import { crT } from '../i18n/areas/credit';

const ZReportModal = lazy(() => import('../components/pos/ZReportModal').then((m) => ({ default: m.ZReportModal })));
// WP-9: return / exchange screen and the exchange-credit banner (own files, loaded on demand).
const PosReturnModal = lazy(() => import('../components/pos-returns/PosReturnModal').then((m) => ({ default: m.PosReturnModal })));
const ExchangeCredit = lazy(() => import('../components/pos-returns/ExchangeCredit').then((m) => ({ default: m.ExchangeCredit })));
const LoyaltyRedeem = lazy(() => import('../components/loyalty/LoyaltyRedeem').then((m) => ({ default: m.LoyaltyRedeem })));
const PosPrinterButton = lazy(() => import('../components/extras7u/PosPrinter').then((m) => ({ default: m.PosPrinterButton }))); // 7U ESC/POS
// 8.22: customer-facing UPI QR (qrcode.react loads only once a UPI amount is typed).
const PosUpiQr = lazy(() => import('../components/pos/PosUpiQr').then((m) => ({ default: m.PosUpiQr })));
const PosDistExtras = lazy(() => import('../components/distribution/PosDistExtras')); // 8F agent + credit notice
const PosReceiptPrint = lazy(() => import('../components/pos/PosReceiptPrint').then((m) => ({ default: m.PosReceiptPrint })));

interface Party {
  client: Client | null;
  name: string;
  phone: string;
}
const WALK_IN: Party = { client: null, name: '', phone: '' };
const NO_TENDER = { Cash: 0, UPI: 0, Card: 0 } as Record<TenderMethod, number>;

/** Everything the counter reads, loaded once per bill. */
function loadCounter() {
  const catalog = localDb.items.getAll();
  const stock = getTable<StockItem>(TABLES.items);
  const names = new Set(catalog.map((i) => i.name.trim().toLowerCase()));
  // Stock items that are not in the catalogue can be sold too (at their sale rate).
  const stockOnly: InvoiceItem[] = stock
    .filter((s) => !names.has(s.name.trim().toLowerCase()))
    .map((s) => ({
      id: s.id, name: s.name, type: 'Product', hsn: s.hsn ?? '', unit: s.unit || 'NOS', quantity: 1, rate: num(s.sale_rate),
      ...(typeof s.tax_rate === 'number' ? { tax_rate: s.tax_rate } : {}), amount: 0, barcode: s.barcode, sku: s.sku,
    }));
  const pricing = loadPricing();
  return {
    catalog,
    stock,
    sources: [...catalog, ...stockOnly],
    clients: localDb.clients.getAll(),
    pricing: pricingInUse(pricing) ? pricing : null,
    positions: stock.some((s) => s.track_stock) ? loadPositions() : [],
    units: unitsDb.stored(),
    salts: saltIndex(stock), // 8.84 substitute search
    ctx: editorStockContext({ doc_type: 'INVOICE', issue_date: todayInput() }),
    // 8.22: quick-item tiles — stock groups and recent POS bills (most sold, when nothing is starred).
    groups: getTable<{ id: string; name: string; parent_id?: string }>('stock_groups'),
    posBills: localDb.invoices.getAll().filter((i) => i.pos),
  };
}

/** One-screen counter billing (6.8): scan / search, tender, save as an invoice, print the 80 mm bill. */
export function Pos() {
  useT(); // re-render on a language switch (5.4)
  const { notify, toastNode } = useToast();
  const [data, setData] = useState(loadCounter);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [party, setParty] = useState<Party>(WALK_IN);
  // Counter sale by default (place of supply = the shop's state); tick to dispatch to the client's state.
  const [dispatch, setDispatch] = useState(false);
  const [customerText, setCustomerText] = useState('');
  const [tender, setTender] = useState(NO_TENDER);
  const [upiRef, setUpiRef] = useState('');
  const [bankId, setBankId] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [expiredAsk, setExpiredAsk] = useState<string[] | null>(null);
  const [printing, setPrinting] = useState<InvoiceRecord | null>(null);
  const [autoPrint, setAutoPrint] = useState(true);
  const [zOpen, setZOpen] = useState(false);
  const [lastBill, setLastBill] = useState<InvoiceRecord | null>(null);
  // `/pos?return=1` (palette "POS return / exchange") opens the return dialog straight away.
  const [params, setParams] = useSearchParams();
  const [retOpen, setRetOpen] = useState(() => params.get('return') === '1');
  const [seenReturn, setSeenReturn] = useState(params.get('return'));
  if (params.get('return') !== seenReturn) {
    // Already on /pos when the palette link is used: open on the URL change (state adjusted during render).
    setSeenReturn(params.get('return'));
    if (params.get('return') === '1') setRetOpen(true);
  }
  const [exchange, setExchange] = useState<{ id: string; amount: number; number: string } | null>(null);
  const [redeemPts, setRedeemPts] = useState(0);
  // 8.21: bills on hold (this device, this company).
  const [held, setHeld] = useState<HeldCart[]>(loadHeld);
  const [heldOpen, setHeldOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [agentId, setAgentId] = useState(''); // 8F: sales agent on the bill
  const [creditAsk, setCreditAsk] = useState(''); // 8.80: owner override prompt
  const [creditOver, setCreditOver] = useState(false);

  const settings = useMemo(() => localDb.settings.get(), []);
  const sender = useMemo(() => localDb.settings.activeProfile(), []);
  const day = todayInput();
  const level = data.pricing && party.client ? levelForClient(party.client, data.pricing.levels) : null;

  const built = useMemo(
    () => buildPosRecord({ items, party: { client: party.client, name: party.name, phone: party.phone }, settings, sender, templateId: localDb.template.get(), day, deliverToClientState: dispatch }),
    [items, party, settings, sender, day, dispatch],
  );
  // Loyalty points redeemed as an amount discount (WP-9); a refused redemption leaves the bill as built.
  const redeemed = useMemo(() => (redeemPts > 0 && party.client ? redeemOnBill(built, redeemPts) : null), [built, redeemPts, party.client]);
  // 7U: a running bill-value offer applies after the price level / slab and the loyalty redemption.
  const offered = useMemo(() => applyBillOffer(redeemed?.record ?? built, data.pricing?.schemes ?? [], { retotalRecord: true }), [redeemed, built, data.pricing]);
  const record = useMemo(() => (agentId ? { ...offered, agent_id: agentId } : offered), [offered, agentId]);
  const tenders: Tender[] = useMemo(
    () => (Object.keys(tender) as TenderMethod[]).map((m) => ({
      method: m, amount: tender[m],
      ...(m === 'UPI' && upiRef.trim() ? { reference: upiRef.trim() } : {}),
      ...(m !== 'Cash' && bankId ? { bank_account_id: bankId } : {}),
    })),
    [tender, upiRef, bankId],
  );
  // An exchange credit (WP-9) pays part of the bill; the tenders cover the rest.
  const credit = exchange ? Math.min(exchange.amount, record.total) : 0;
  const payable = round2(record.total - credit);
  const summary = tenderSummary(payable, tenders);
  // 8.22: the number this bill will take, for the UPI QR's transaction reference (tr).
  const upiOn = tender.UPI > 0;
  const prefix = record.sender?.invoicePrefix;
  const upiBillNo = useMemo(
    () => (upiOn ? localDb.invoices.nextNumber(record.issue_date, record.doc_type, prefix || undefined) : ''),
    [upiOn, record.issue_date, record.doc_type, prefix],
  );
  // Stock on hand by item name (tracked items), for red zero / negative stock in search and tiles.
  const qtyByName = useMemo(() => new Map(data.positions.filter((p) => p.item.track_stock).map((p) => [p.item.name.trim().toLowerCase(), p.qty])), [data.positions]);
  const qtyOf = useCallback((i: InvoiceItem) => qtyByName.get(i.name.trim().toLowerCase()) ?? null, [qtyByName]);

  /* ── Lines ─────────────────────────────────────────────────── */

  /** Price (level + slab) and scheme lines after a change; typed rates (no basis) stay. */
  const finish = useCallback(
    (next: InvoiceItem[], repriceId?: string, force = false, client: Client | null = party.client): InvoiceItem[] => {
      const p = data.pricing;
      if (!p) return next;
      const lvl = client ? levelForClient(client, p.levels) : null;
      const priced = next.map((l) => {
        if (l.free_of || (repriceId && l.id !== repriceId)) return l;
        const cat = catalogItemFor(p.catalog, l.name);
        if (!cat || (!force && !l.price_basis && num(l.rate) !== num(cat.rate))) return l;
        const q = resolvePrice(cat, num(l.quantity), lvl);
        const out = { ...l, rate: q.rate, amount: round2(q.rate * num(l.quantity)) };
        if (q.basis) out.price_basis = q.basis;
        else delete out.price_basis;
        return out;
      });
      return syncSchemeLines(priced, p.schemes, day, generateId, p.catalog);
    },
    [data.pricing, party.client, day],
  );

  const addSource = useCallback(
    (source: InvoiceItem) => {
      setItems((cur) => {
        const r = addScannedLine(cur, source, { newId: generateId, fallbackTaxRate: settings.defaultTaxRate });
        let next = r.items;
        if (!r.incremented) {
          // Item custom fields travel with the line, as in the editor.
          const values = snapshotFromMap(source.custom_fields, customFieldsDb.all(), 'item');
          if (values.length) next = next.map((l) => (l.id === r.lineId ? { ...l, custom_values: values } : l));
        }
        return finish(next, r.lineId, !r.incremented);
      });
      setErrors([]);
    },
    [finish, settings.defaultTaxRate],
  );

  // 7M: a typed quantity rounds to its unit's decimal places (units master: 2.5 NOS → 3, 1.2345 KG → 1.235).
  const setQty = (id: string, qty: number) =>
    setItems((cur) => finish(cur.map((l) => {
      if (l.id !== id) return l;
      const q = Math.max(roundTypedQty(qty, l.unit, data.units), 0);
      return { ...l, quantity: q, amount: round2(q * num(l.rate)) };
    }), id));
  /** 7M: sell a line in an alternate unit (1 BOX = 12 NOS): unit + factor snapshot, rate rescaled; a typed price. */
  const setUnit = (id: string, item: StockItem, unit: string) =>
    setItems((cur) => cur.map((l) => {
      if (l.id !== id) return l;
      const p = lineUnitPatch(item, l, unit);
      const q = roundTypedQty(l.quantity, p.unit, data.units);
      const out: InvoiceItem = { ...l, unit: p.unit, rate: p.rate, quantity: q, amount: round2(q * p.rate) };
      if (p.unit_factor) out.unit_factor = p.unit_factor;
      else delete out.unit_factor;
      delete out.price_basis;
      return out;
    }));
  const setRate = (id: string, rate: number) =>
    setItems((cur) => cur.map((l) => {
      if (l.id !== id) return l;
      const out = { ...l, rate, amount: round2(rate * num(l.quantity)) };
      delete out.price_basis; // a typed price wins
      return out;
    }));
  const setDisc = (id: string, d: number) => setItems((cur) => cur.map((l) => (l.id === id ? { ...l, discount_percent: Math.min(Math.max(d, 0), 100) } : l)));
  const setSerials = (id: string, serials: string[]) =>
    setItems((cur) => finish(cur.map((l) => {
      if (l.id !== id) return l;
      const out: InvoiceItem = { ...l, ...(serials.length ? { serials, quantity: serials.length } : {}) };
      if (!serials.length) delete out.serials;
      out.amount = round2(num(out.quantity) * num(out.rate));
      return out;
    }), id));
  const removeLine = (id: string) => setItems((cur) => finish(cur.filter((l) => l.id !== id && l.free_of !== id)));

  /** Pick (or clear) the saved customer; a new customer may buy at another level, so automatic lines are re-priced. */
  const chooseClient = (client: Client | null) => {
    setParty(client ? { client, name: '', phone: '' } : WALK_IN);
    setAgentId(client?.agent_id ?? '');
    setCreditOver(false);
    setRedeemPts(0);
    setDispatch(false);
    setCustomerText('');
    setItems((cur) => (cur.length ? finish(cur, undefined, false, client) : cur));
  };

  /* ── Scan / search ─────────────────────────────────────────── */

  const hits = useMemo(
    () =>
      suggest(query, data.sources, {
        label: (i) => i.name,
        extra: (i) => [i.hsn, i.sku, i.barcode, saltOf(data.salts, i.name)],
        sub: (i) => [formatCurrency(num(i.rate)), i.sku && `SKU ${i.sku}`, saltOf(data.salts, i.name)].filter(Boolean).join(' · '),
        limit: 8,
      }),
    [query, data.sources, data.salts],
  );

  const onCode = (code: string) => {
    const match = findByCode(code, data.catalog, data.stock);
    if (!match) return { ok: false, message: posT('noCode', { code }) };
    addSource(match.item);
    return { ok: true, message: posT('added', { name: match.item.name }) };
  };

  const onEnter = (text: string) => {
    if (!text.trim() || findByCode(text, data.catalog, data.stock)) return false; // a code: let onCode add it
    const hit = hits[active] ?? hits[0];
    if (!hit) return false;
    addSource(hit.row);
    setActive(0);
    return true;
  };

  /* ── Tender ────────────────────────────────────────────────── */

  const fill = (m: TenderMethod) => {
    setTender((t) => ({ ...t, [m]: fillRest(payable, (Object.keys(t) as TenderMethod[]).map((k) => ({ method: k, amount: t[k] })), m) }));
    setTimeout(() => (document.getElementById(`pos-${m}`) as HTMLInputElement | null)?.select(), 0);
  };

  /* ── Save ──────────────────────────────────────────────────── */

  const reset = () => {
    setItems([]);
    setRedeemPts(0);
    setParty(WALK_IN);
    setAgentId('');
    setCreditOver(false);
    setDispatch(false);
    setCustomerText('');
    setTender(NO_TENDER);
    setUpiRef('');
    setErrors([]);
    setData(loadCounter());
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const save = (expiredOk = false, creditOk = false) => {
    if (items.length === 0) {
      setErrors([posT('errEmpty')]);
      return;
    }
    // 8.80: a saved customer over the credit limit (Block) — the unpaid part adds credit.
    const blocked = party.client && !creditOk && !creditOver ? creditStatus(record, { unpaid: summary.due })?.blocked : '';
    if (blocked) {
      if (canOverrideCredit()) setCreditAsk(blocked);
      else setErrors([crT('posBlocked'), blocked]);
      return;
    }
    const res = savePosBill({ record, tenders, expiredOk, allowCredit: !!party.client, exchangeReturnId: exchange?.id });
    if (res.expired?.length) {
      setExpiredAsk(res.expired);
      return;
    }
    if (!res.ok || !res.record) {
      setErrors(res.errors);
      notify(res.errors[0] ?? posT('saveFailed'), 'error');
      if (res.record) reset(); // invoice saved, a payment failed: never bill twice
      return;
    }
    const change = res.summary?.change ?? 0;
    notify(posT('saved', { doc: docName(res.record.doc_type), number: res.record.invoice_number }) + (change > 0 ? posT('change', { amount: formatCurrency(change) }) : ''));
    setLastBill(res.record);
    setExchange(null);
    if (autoPrint) setPrinting(res.record);
    reset();
  };

  /* ── Hold & recall (8.21) ──────────────────────────────────── */

  const currentCart = (): HeldCart => ({
    id: generateId(),
    held_at: new Date().toISOString(),
    items,
    client: party.client,
    name: party.name,
    phone: party.phone,
    dispatch,
    tender,
    upi_ref: upiRef,
    total: record.total,
  });

  const storeHeld = (next: HeldCart[]): boolean => {
    try {
      saveHeld(next);
    } catch (err) {
      notify(posT('holdFailed', { reason: (err as Error).message }), 'error');
      return false;
    }
    setHeld(next);
    return true;
  };

  const hold = () => {
    if (!items.length) {
      setErrors([posT('errEmpty')]);
      return;
    }
    const r = holdCart(loadHeld(), currentCart());
    if (!r.ok) {
      notify(posT('heldFull'), 'error');
      setHeldOpen(true);
      return;
    }
    if (!storeHeld(r.list)) return;
    notify(posT('heldSaved', { n: r.list.length }));
    reset();
  };

  const recall = (id: string) => {
    const r = recallCart(loadHeld(), id);
    let next = r.list;
    if (!r.cart) {
      setHeld(next);
      return;
    }
    // The bill on the counter is parked first, so recalling never loses it (there is room: one just left).
    const parked = items.length ? holdCart(next, currentCart()) : null;
    if (parked?.ok) next = parked.list;
    if (!storeHeld(next)) return;
    const c = r.cart;
    const client = c.client ? (data.clients.find((x) => (c.client?.id && x.id === c.client.id) || x.name === c.client?.name) ?? c.client) : null;
    setItems(c.items);
    setParty(client ? { client, name: '', phone: '' } : { client: null, name: c.name ?? '', phone: c.phone ?? '' });
    setDispatch(!!c.dispatch && !!client);
    setCustomerText('');
    setTender(c.tender ?? NO_TENDER);
    setUpiRef(c.upi_ref ?? '');
    setRedeemPts(0);
    setErrors([]);
    setHeldOpen(false);
    notify(parked?.ok ? `${posT('heldRecalled')}. ${posT('heldReplace')}` : posT('heldRecalled'));
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const drop = (id: string) => storeHeld(loadHeld().filter((c) => c.id !== id));

  /* ── Keyboard ──────────────────────────────────────────────── */

  const act = (a: PosAction) => {
    if (a === 'search') searchRef.current?.focus();
    else if (a === 'customer') document.getElementById('pos-customer')?.focus();
    else if (a === 'cash' || a === 'upi' || a === 'card') fill(a === 'cash' ? 'Cash' : a === 'upi' ? 'UPI' : 'Card');
    else if (a === 'save') save();
    else if (a === 'new') reset();
    else if (a === 'zreport') setZOpen(true);
    else if (a === 'hold') hold();
    else if (a === 'held') {
      setHeld(loadHeld());
      setHeldOpen(true);
    }
  };
  const actRef = useRef(act);
  useEffect(() => {
    actRef.current = act;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return; // a dialog owns the keyboard
      const a = posShortcut(e);
      if (!a) return;
      e.preventDefault();
      actRef.current(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ── Render ────────────────────────────────────────────────── */

  const clientSuggestions = useCallback(
    (q: string) => suggest(q, data.clients, { label: (c) => c.name, extra: (c) => [c.phone, c.company, c.gstin], sub: (c) => [c.phone, c.gstin].filter(Boolean).join(' · ') }),
    [data.clients],
  );
  const stockOf = (l: InvoiceItem) => (data.positions.length ? findLevel(data.positions, l.name, l.hsn) : null);
  const docLabel = record.doc_type in DOCUMENT_LABELS ? docName(record.doc_type) : DOCUMENT_LABELS.INVOICE;

  return (
    <div className={cn(surface.page, styles.page)}>
      <PageHeader
        title={posT('title')}
        subtitle={posT('subtitle', { doc: docLabel, business: sender?.companyName || posT('setUp') })}
        actions={
          <>
            {lastBill && (
              <button type="button" className={controls.btnOutline} onClick={() => setPrinting(lastBill)}>
                <Printer size={16} /> {posT('reprint', { number: lastBill.invoice_number })}
              </button>
            )}
            <button type="button" className={controls.btnOutline} onClick={hold} disabled={items.length === 0} title="Shift+F8" data-pos-hold>
              <Pause size={16} /> {posT('hold')}
            </button>
            <button type="button" className={controls.btnOutline} onClick={() => act('held')} title="F1" data-pos-held>
              <History size={16} /> {posT('heldBills')} {held.length > 0 && <span className={counter.badge}>{held.length}</span>}
            </button>
            <button type="button" className={controls.btnOutline} onClick={() => setRetOpen(true)}>
              <RotateCcw size={16} /> {returnsT('title')}
            </button>
            <Suspense fallback={null}><PosPrinterButton /></Suspense>
            <button type="button" className={controls.btnOutline} onClick={() => setZOpen(true)}>
              <ReceiptText size={16} /> {posT('zReport')}
            </button>
          </>
        }
      />

      <div className={styles.layout}>
        <section className={cn(surface.card, styles.cart)} aria-label={posT('billItems')}>
          <div className={styles.scan}>
            <ScanField
              id="pos-scan"
              label={posT('scanLabel')}
              placeholder={posT('scanPh')}
              autoFocus
              continuous
              inputRef={searchRef}
              onCode={onCode}
              onText={(t) => { setQuery(t); setActive(0); }}
              onEnter={onEnter}
              onKeyDown={(e) => {
                if (!hits.length) return;
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
                if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                if (e.key === 'Escape') { e.preventDefault(); setQuery(''); }
              }}
            />
            {hits.length > 0 && query.trim() && (
              <ul className={styles.hits} role="listbox" aria-label={posT('matching')}>
                {hits.map((h, n) => {
                  const lvl = stockOf(h.row);
                  const cls = stockClass(lvl ? lvl.qty : null);
                  return (
                    <li key={h.row.id} role="option" aria-selected={n === active}>
                      <button type="button" className={cn(styles.hit, n === active && styles.hitActive, (cls === 'zero' || cls === 'neg') && counter.noStock)} onMouseDown={(e) => e.preventDefault()} onClick={() => { addSource(h.row); setQuery(''); searchRef.current?.focus(); }}>
                        <span>{h.label}</span>
                        <span className={styles.muted}>{h.sub}{lvl ? posT('inStock', { n: lvl.qty }) : ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {items.length === 0 ? (
            <p className={styles.empty}>{posT('empty')}</p>
          ) : (
            <div className={styles.lines} role="table" aria-label={posT('lines')}>
              <div className={cn(styles.line, styles.lineHead)} role="row">
                <span role="columnheader">{posT('item')}</span>
                <span role="columnheader">{posT('qty')}</span>
                <span role="columnheader" className={styles.r}>{posT('rate')}</span>
                <span role="columnheader" className={styles.r}>{posT('disc')}</span>
                <span role="columnheader" className={styles.r}>{posT('amount')}</span>
                <span role="columnheader"><span className={surface.srOnly}>{posT('remove')}</span></span>
              </div>
              {items.map((l, n) => {
                const calc = record.items.find((x) => x.id === l.id);
                const stockItem = data.ctx?.find(l.name, l.hsn);
                const lvl = stockOf(l);
                const free = !!l.free_of;
                return (
                  <div key={l.id} className={styles.lineWrap} role="row" data-pos-line={l.name}>
                    <div className={styles.line}>
                      <div role="cell" className={styles.name}>
                        <strong>{l.name}</strong>
                        <span className={styles.muted}>
                          {[l.hsn && `HSN ${l.hsn}`, typeof l.tax_rate === 'number' && record.gst_mode !== 'NONE' && `GST ${l.tax_rate}%`, lvl && posT('lineStock', { n: lvl.qty, unit: lvl.unit })].filter(Boolean).join(' · ')}
                        </span>
                        {stockItem && !stockItem.track_serials && !free && cleanAltUnits(stockItem.alt_units, stockItem.unit || 'NOS') && (
                          <select className={cn(controls.select, styles.unitSel)} value={l.unit || stockItem.unit} onChange={(e) => setUnit(l.id, stockItem, e.target.value)} aria-label={unitT('lineUnit', { n: n + 1 })}>
                            {unitChoices(stockItem).map((c) => <option key={c.unit} value={c.unit}>{c.unit}</option>)}
                          </select>
                        )}
                        {(l.price_basis || free) && <span className={styles.chip}><Tags size={12} aria-hidden="true" /> {free ? posT('free') : posT('basisPrice', { basis: l.price_basis ?? '' })}</span>}
                      </div>
                      <div role="cell" className={styles.qty}>
                        <button type="button" className={controls.btnIcon} onClick={() => setQty(l.id, num(l.quantity) - 1)} disabled={free || num(l.quantity) <= 1} aria-label={posT('less', { name: l.name })}><Minus size={14} /></button>
                        <NumberInput className={cn(controls.input, controls.inputNumeric, styles.qtyInput)} value={l.quantity} blankZero={false} onChange={(q) => setQty(l.id, q)} disabled={free} aria-label={posT('qtyOf', { name: l.name, n: n + 1 })} />
                        <button type="button" className={controls.btnIcon} onClick={() => setQty(l.id, num(l.quantity) + 1)} disabled={free} aria-label={posT('more', { name: l.name })}><Plus size={14} /></button>
                      </div>
                      <div role="cell" className={styles.r}>
                        <NumberInput className={cn(controls.input, controls.inputNumeric, styles.num)} value={l.rate} onChange={(r) => setRate(l.id, r)} disabled={free} placeholder={posT('rate')} aria-label={posT('rateOf', { name: l.name, n: n + 1 })} />
                      </div>
                      <div role="cell" className={styles.r}>
                        <NumberInput className={cn(controls.input, controls.inputNumeric, styles.num)} value={l.discount_percent ?? 0} onChange={(d) => setDisc(l.id, d)} disabled={free} placeholder={posT('disc')} aria-label={posT('discOf', { name: l.name, n: n + 1 })} />
                      </div>
                      <div role="cell" className={cn(styles.r, styles.amount)}>{formatCurrency(calc ? round2(num(calc.quantity) * num(calc.rate) * (1 - num(calc.discount_percent) / 100)) : 0)}</div>
                      <div role="cell">
                        {!free && (
                          <button type="button" className={controls.btnDanger} onClick={() => removeLine(l.id)} aria-label={posT('removeOf', { name: l.name })}><Trash2 size={14} /></button>
                        )}
                      </div>
                    </div>
                    {stockItem?.track_serials && (
                      <div className={styles.serials}>
                        <SerialPicker
                          label={posT('serialFor', { name: l.name })}
                          options={(() => {
                            const base = serialsInStock(data.ctx?.tracking.get(stockItem.id), data.ctx?.multi ? l.godown_id || data.ctx.defaultGodown : undefined);
                            const taken = new Set(items.filter((x) => x.id !== l.id).flatMap((x) => x.serials ?? []).map(serialKey));
                            return base.filter((s) => !taken.has(serialKey(s)));
                          })()}
                          value={l.serials ?? []}
                          want={num(l.quantity)}
                          onChange={(next) => setSerials(l.id, next)}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <PosTiles
            sources={data.sources}
            stock={data.stock}
            groups={data.groups}
            invoices={data.posBills}
            qtyOf={qtyOf}
            onPick={(item) => {
              addSource(item);
              searchRef.current?.focus();
            }}
          />
        </section>

        <aside className={styles.side}>
          <section className={surface.card} aria-label={posT('customer')}>
            <div className={surface.cardHead}><span className={surface.cardHeadIcon}><UserRound size={16} /> {posT('customer')} <kbd className={styles.kbd}>F3</kbd></span></div>
            <div className={cn(surface.cardBody, styles.stack)}>
              {party.client ? (
                <div className={styles.picked}>
                  <div>
                    <strong>{party.client.name}</strong>
                    <span className={styles.muted}>{[party.client.phone, party.client.gstin].filter(Boolean).join(' · ') || posT('savedCustomer')}</span>
                    {level && <span className={styles.chip}><Tags size={12} aria-hidden="true" /> {posT('levelPrices', { level: level.name })}</span>}
                  </div>
                  <button type="button" className={controls.btnIcon} onClick={() => chooseClient(null)} aria-label={posT('walkInBack')}><X size={16} /></button>
                </div>
              ) : null}
              {party.client && (
                <label className={controls.check} title={posT('dispatchTitle')}>
                  <input type="checkbox" checked={dispatch} onChange={(e) => setDispatch(e.target.checked)} />
                  {posT('dispatch')}
                </label>
              )}
              {party.client && (
                <Suspense fallback={null}>
                  <LoyaltyRedeem key={party.client.id || party.client.name} customer={party.client.name} points={redeemPts} errors={redeemed?.errors ?? []} onApply={setRedeemPts} />
                </Suspense>
              )}
              <Suspense fallback={null}>
                <PosDistExtras client={party.client} record={record} unpaid={summary.due} agentId={agentId} onAgent={setAgentId} />
              </Suspense>
              {party.client ? null : (
                <>
                  <Typeahead
                    id="pos-customer"
                    className={controls.input}
                    value={customerText}
                    onChange={setCustomerText}
                    getSuggestions={clientSuggestions}
                    onPick={(c) => chooseClient(c)}
                    placeholder={posT('customerPh')}
                    aria-label={posT('customerAria')}
                  />
                  <div className={controls.row}>
                    <input className={controls.input} value={party.name} onChange={(e) => setParty({ ...party, name: e.target.value })} placeholder={posT('namePh')} aria-label={posT('nameAria')} />
                    <input className={controls.input} value={party.phone} inputMode="tel" onChange={(e) => setParty({ ...party, phone: e.target.value })} placeholder={posT('phonePh')} aria-label={posT('phoneAria')} />
                  </div>
                </>
              )}
            </div>
          </section>

          <section className={surface.card} aria-label={posT('totals')}>
            <div className={cn(surface.cardBody, styles.totals)}>
              <div><span>{posT('items')}</span><span>{formatCurrency(record.subtotal)}</span></div>
              {record.discount_amount > 0 && <div><span>{posT('discount')}</span><span>−{formatCurrency(record.discount_amount)}</span></div>}
              {record.offer && <div data-pos-offer><span>{record.offer.label}</span><span>−{formatCurrency(record.offer.value)}</span></div>}
              {record.cgst_amount > 0 && <div><span>CGST</span><span>{formatCurrency(record.cgst_amount)}</span></div>}
              {record.sgst_amount > 0 && <div><span>SGST</span><span>{formatCurrency(record.sgst_amount)}</span></div>}
              {record.igst_amount > 0 && <div><span>IGST</span><span>{formatCurrency(record.igst_amount)}</span></div>}
              {(record.cess_amount ?? 0) > 0 && <div><span>{posT('cess')}</span><span>{formatCurrency(record.cess_amount ?? 0)}</span></div>}
              {record.round_off !== 0 && <div><span>{posT('roundOff')}</span><span>{formatCurrency(record.round_off)}</span></div>}
              <div className={styles.grand}><span>{posT('total')}</span><span data-pos-total>{formatCurrency(record.total)}</span></div>
              {exchange && (
                <Suspense fallback={null}>
                  <ExchangeCredit number={exchange.number} amount={exchange.amount} used={credit} onDrop={() => setExchange(null)} />
                </Suspense>
              )}
            </div>
          </section>

          <section className={surface.card} aria-label={posT('payment')}>
            <div className={cn(surface.cardBody, styles.stack)}>
              {(['Cash', 'UPI', 'Card'] as TenderMethod[]).map((m) => (
                <div key={m} className={styles.tender}>
                  <label htmlFor={`pos-${m}`} className={styles.tenderLabel}>{posT(`m.${m}`)} <kbd className={styles.kbd}>{m === 'Cash' ? 'F4' : m === 'UPI' ? 'F6' : 'F7'}</kbd></label>
                  <NumberInput id={`pos-${m}`} className={cn(controls.input, controls.inputNumeric)} value={tender[m]} onChange={(v) => setTender((t) => ({ ...t, [m]: v }))} placeholder="0" />
                  <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => fill(m)}>{posT('rest')}</button>
                </div>
              ))}
              {tender.UPI > 0 && (
                <Suspense fallback={<input className={controls.input} value={upiRef} onChange={(e) => setUpiRef(e.target.value)} placeholder={posT('upiPh')} aria-label={posT('upiAria')} />}>
                  <PosUpiQr vpa={record.sender?.upiId || sender?.upiId} payee={record.sender?.companyName || sender?.companyName} amount={round2(tender.UPI)} billNo={upiBillNo} utr={upiRef} onUtr={setUpiRef} />
                </Suspense>
              )}
              {(tender.UPI > 0 || tender.Card > 0) && (
                <BankAccountSelect id="pos-bank" label={posT('receivedInto')} method={tender.UPI > 0 ? 'UPI' : 'Card'} value={bankId} onChange={setBankId} />
              )}
              <div className={styles.changeRow}>
                {summary.change > 0 ? (
                  <><span>{posT('changeToGive')}</span><strong data-pos-change>{formatCurrency(summary.change)}</strong></>
                ) : summary.due > 0 && record.total > 0 ? (
                  <><span>{party.client ? posT('onAccount') : posT('stillToPay')}</span><strong className={styles.due}>{formatCurrency(summary.due)}</strong></>
                ) : (
                  <><span>{posT('paidFull')}</span><strong>{formatCurrency(summary.tendered)}</strong></>
                )}
              </div>
              {errors.length > 0 && (
                <ul className={styles.errors} role="alert">
                  {errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              )}
              <button type="button" className={cn(controls.btnPrimary, controls.btnLg, controls.btnBlock)} onClick={() => save()} disabled={items.length === 0}>
                <Save size={18} /> {posT('saveBill')} <kbd className={styles.kbdOn}>F9</kbd>
              </button>
              <label className={controls.check}>
                <input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} /> {posT('autoPrint')}
              </label>
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={reset}>{posT('newBill')}</button>
            </div>
          </section>

          <details className={styles.keys}>
            <summary><Keyboard size={14} aria-hidden="true" /> {posT('shortcuts')}</summary>
            <ul>
              {POS_SHORTCUTS.map((s) => <li key={s.keys}><kbd className={styles.kbd}>{s.keys}</kbd> {posT(`sc.${s.action}`)}</li>)}
              <li><kbd className={styles.kbd}>Ctrl</kbd>+<kbd className={styles.kbd}>Enter</kbd> {posT('scSave')}</li>
              <li><kbd className={styles.kbd}>↑</kbd>/<kbd className={styles.kbd}>↓</kbd> {areaNodes(posT('scPick'), { enter: <kbd className={styles.kbd}>Enter</kbd> })}</li>
            </ul>
            <p className={styles.muted}>
              {areaNodes(posT('savedAs', { doc: docLabel }), { link: <Link to="/transactions">{posT('invoices')}</Link> })}
            </p>
          </details>
        </aside>
      </div>

      {toastNode}
      <ConfirmDialog
        open={!!expiredAsk}
        destructive
        title={posT('expiredTitle')}
        message={posT('expiredMsg', { lines: expiredAsk?.join(' ') ?? '' })}
        confirmLabel={posT('sellAnyway')}
        cancelLabel={posT('goBack')}
        onClose={() => setExpiredAsk(null)}
        onConfirm={() => {
          setExpiredAsk(null);
          save(true);
        }}
      />
      <HeldBills open={heldOpen} list={held} onClose={() => setHeldOpen(false)} onRecall={recall} onDrop={drop} />
      <ConfirmDialog
        open={!!creditAsk}
        destructive
        title={crT('posOverride')}
        message={`${crT('posOverrideAsk')} ${creditAsk}`}
        confirmLabel={crT('posOverride')}
        cancelLabel={posT('goBack')}
        onClose={() => setCreditAsk('')}
        onConfirm={() => {
          recordCreditOverride(party.client?.name ?? '', creditAsk);
          setCreditAsk('');
          setCreditOver(true);
          save(false, true);
        }}
      />
      {zOpen && (
        <Suspense fallback={null}>
          <ZReportModal open={zOpen} onClose={() => setZOpen(false)} notify={notify} />
        </Suspense>
      )}
      {retOpen && (
        <Suspense fallback={null}>
          <PosReturnModal
            open={retOpen}
            onClose={() => {
              setRetOpen(false);
              if (params.has('return')) {
                const next = new URLSearchParams(params);
                next.delete('return');
                setParams(next, { replace: true });
              }
            }}
            notify={notify}
            onExchange={(r) => setExchange({ id: r.id, amount: r.amount, number: r.credit_note_number })}
          />
        </Suspense>
      )}
      {printing && (
        <Suspense fallback={null}>
          <PosReceiptPrint invoice={printing} onDone={() => setPrinting(null)} />
        </Suspense>
      )}
    </div>
  );
}
