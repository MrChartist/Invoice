import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { History, Keyboard, Minus, Pause, Plus, Printer, ReceiptText, RotateCcw, Save, Tags, Trash2, UserRound, X } from 'lucide-react';
import { Camera, Clock, MessageCircle, Monitor, Settings2, Store } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/useToast';
import { NumberInput } from '../components/ui/NumberInput';
import { Typeahead } from '../components/ui/Typeahead';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Modal } from '../components/ui/Modal';
import { ScanField } from '../components/scan/ScanField';
import { SerialPicker } from '../components/inventory/SerialPicker';
import { BankAccountSelect } from '../components/bank/BankAccountSelect';
import { HeldBills } from '../components/pos/HeldBills';
import { PosTiles } from '../components/pos/PosTiles';
import { localDb } from '../lib/localDb';
import { DB_PREFIX, KEYS, generateId, getJson, getTable, peekTable } from '../lib/storage';
import type { DeliveryInfo, PosRx, RetailSettings, SaleKyc } from '../types/retail-r9';
import { readPharmaSettings } from '../lib/pharma-gate';
import { num, round2 } from '../lib/invoice-calc';
import { makeSuggester } from '../lib/suggest';
import { addScannedLine, findByCode, findByShortCode } from '../lib/scan';
import { TABLES, findLevel, loadPositions, type StockItem } from '../lib/inventory';
import { editorStockContext, liveHeldStock, serialKey, serialsInStock } from '../lib/stock-tracking';
import { customFieldsDb, snapshotFromMap } from '../lib/custom-fields';
import {
  catalogItemFor, levelForClient, loadPricing, pricingInUse, resolvePrice, syncSchemeLines,
} from '../lib/pricing';
import {
  POS_SHORTCUTS, buildPosRecord, fillRest, posShortcut, savePosBill, tenderSummary,
  type MoneyTender, type PosAction, type Tender,
} from '../lib/pos';
// R4-B1 / B3: promotional gift voucher discount; store price lists and the counter's branch.
import { applyPromoDiscount, promoVoucherIssue } from '../lib/retail/gift-voucher-core';
import { isPackOn } from '../lib/industry-packs';
import { BRANCH_PRICES_TABLE, branchContext, posBranch, storePricingInUse, writePosBranch } from '../lib/retail/store-prices';
import { loadBranches, type Branch } from '../lib/branch';
import { defineArea } from '../i18n/area';
import type { BranchPrice } from '../types/stores-r4';
import type { AppliedVoucher } from '../components/retail/GiftVoucherTender';
import type { DevPay } from '../components/retail-r9/DevicesDesk';
// 8E retail speed pack: entry parsing, keymap, scale labels, shifts, customer display, price lists, WhatsApp.
import { effectiveKeys, loadKeymap, looksLikeCode, parseCounterEntry, rateFromGross, searchTermOf, type PosKeymap } from '../lib/pos-keys';
import { findByPlu, loadScaleProfile, parseScaleBarcode, scaleLine, type ScaleProfile, type ScaleRead } from '../lib/scale-barcode';
import { shiftsDb, type PosShift } from '../lib/pos-shifts';
import { openBroadcast } from '../lib/cross-tab';
import { DISPLAY_CHANNEL, DISPLAY_PATH, billMessage, idleMessage, readDisplayMessage, thanksMessage, type DisplayMessage } from '../lib/pos-display';
import { PRICE_LIST_BASIS, priceListRate } from '../lib/price-list';
import { upiLink } from '../lib/share';
import { posWhatsappHref } from '../lib/pos-share';
import { creditCheck, masterFor } from '../lib/credit-limit';
import { can } from '../lib/access';
import { retailT } from '../i18n/areas/retail';
import retail from '../components/pos-retail/retail.module.css';
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
import { rPosT } from '../i18n/areas/restaurant-pos'; // R3-A

const ScreenTip = lazy(() => import('../components/help/ScreenTip')); // R6-A6 one-time tip
const ZReportModal = lazy(() => import('../components/pos/ZReportModal').then((m) => ({ default: m.ZReportModal })));
// WP-9: return / exchange screen and the exchange-credit banner (own files, loaded on demand).
const PosReturnModal = lazy(() => import('../components/pos-returns/PosReturnModal').then((m) => ({ default: m.PosReturnModal })));
const ExchangeCredit = lazy(() => import('../components/pos-returns/ExchangeCredit').then((m) => ({ default: m.ExchangeCredit })));
const LoyaltyRedeem = lazy(() => import('../components/loyalty/LoyaltyRedeem').then((m) => ({ default: m.LoyaltyRedeem })));
const PosPrinterButton = lazy(() => import('../components/extras7u/PosPrinter').then((m) => ({ default: m.PosPrinterButton }))); // 7U ESC/POS
// 8.22: customer-facing UPI QR (qrcode.react loads only once a UPI amount is typed).
const PosUpiQr = lazy(() => import('../components/pos/PosUpiQr').then((m) => ({ default: m.PosUpiQr })));
const PosDistExtras = lazy(() => import('../components/distribution/PosDistExtras')); // 8F agent + credit notice
const UsualTiles = lazy(() => import('../components/creator/UsualTiles')); // R3-B6 "Usual" tiles for a saved customer
const PosReceiptPrint = lazy(() => import('../components/pos/PosReceiptPrint').then((m) => ({ default: m.PosReceiptPrint })));
// 8E: help, day summary, bill browser, counter settings, shifts, create-item sheet (each loads on first use).
const PosHelp = lazy(() => import('../components/pos-retail/PosHelp').then((m) => ({ default: m.PosHelp })));
const DaySummary = lazy(() => import('../components/pos-retail/DaySummary').then((m) => ({ default: m.DaySummary })));
const BillBrowser = lazy(() => import('../components/pos-retail/BillBrowser').then((m) => ({ default: m.BillBrowser })));
const RetailSettings = lazy(() => import('../components/pos-retail/RetailSettings').then((m) => ({ default: m.RetailSettings })));
const ShiftPanel = lazy(() => import('../components/pos-retail/ShiftPanel').then((m) => ({ default: m.ShiftPanel })));
const QuickItemSheet = lazy(() => import('../components/pos/QuickItemSheet').then((m) => ({ default: m.QuickItemSheet })));
// R3-A: modifier picker (when a linked item is added) and the bill as an image — both load on first use.
const ModifierPicker = lazy(() => import('../components/restaurant/ModifierPicker').then((m) => ({ default: m.ModifierPicker })));
const BillImageShare = lazy(() => import('../components/restaurant/BillImageShare').then((m) => ({ default: m.BillImageShare })));
type ModGroup = import('../types/restaurant').ModifierGroup;

interface Party {
  client: Client | null;
  name: string;
  phone: string;
}
const WALK_IN: Party = { client: null, name: '', phone: '' };
const NO_TENDER = { Cash: 0, UPI: 0, Card: 0, Cheque: 0, Wallet: 0 } as Record<MoneyTender, number>;
const TENDER_KEY: Record<MoneyTender, PosAction> = { Cash: 'cash', UPI: 'upi', Card: 'card', Cheque: 'cheque', Wallet: 'wallet' };
// R4-B1: the gift-voucher tender panel loads only when the company has vouchers.
const GiftVoucherTender = lazy(() => import('../components/retail/GiftVoucherTender'));
const RoomPicker = lazy(() => import('../components/hotel/FrontDesk').then((m) => ({ default: m.RoomPicker }))); // R7-B2 "Room" tender (hotel pack only)
const PosRetailStrip = lazy(() => import('../components/retail-r9/rt-a-hub').then((m) => ({ default: m.PosRetailStrip }))); // R9 (RT-A2/A3/A4)
const RxStrip = lazy(() => import('../components/retail-r9/PharmacyDesk').then((m) => ({ default: m.RxStrip }))); // R9 (RT-B1/B2/B3) pharma switch only
const PosApparel = lazy(() => import('../components/retail-r9/ApparelDesk').then((m) => ({ default: m.PosApparel }))); // R9 (RT-C1/C3)
const PosDevices = lazy(() => import('../components/retail-r9/DevicesDesk').then((m) => ({ default: m.PosDevices }))); // R9 (RT-D) IMEI, finance, exchange, cash guard
const PosJewel = lazy(() => import('../components/retail-r9/JewelleryDesk').then((m) => ({ default: m.PosJewel }))); // R9 (RT-E2/E3) tag box, cash / PAN guard
const PosAppointment = lazy(() => import('../components/services-r10/PosAppointment')); // R10 (SV-A2) `?appt=` bill from the front desk
const PosPackages = lazy(() => import('../components/services-r10/SvRedeem').then((m) => ({ default: m.PosPackages }))); // R10 (SV-C1) "Use package"
// R4-B3: the counter's branch (store price list). Inline labels, so the POS does not load the stores catalogue.
const storeT = defineArea({ counter: 'This counter is branch', none: 'No branch' } as const, { counter: 'यह काउंटर इस शाखा का है', none: 'कोई शाखा नहीं' });

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
    // QA5-2 F9: stock held in QC / expiry / transit godowns is not available to sell.
    held: stock.some((s) => s.track_stock) ? liveHeldStock() : new Map<string, number>(),
    units: unitsDb.stored(),
    salts: saltIndex(stock), // 8.84 substitute search
    ctx: editorStockContext({ doc_type: 'INVOICE', issue_date: todayInput() }),
    // 8.22: quick-item tiles — stock groups and recent POS bills (most sold, when nothing is starred).
    groups: getTable<{ id: string; name: string; parent_id?: string }>('stock_groups'),
    // PERF-2: filtered from the shared parsed rows (read-only: the tiles and bill browser only read them).
    posBills: peekTable<InvoiceRecord>(KEYS.invoices).filter((i) => i.pos),
    // 8E (8.145): selling price lists (stock items with dated prices) apply on the POS as in the editor.
    lists: stock.some((s) => s.selling_prices?.length),
    // R4-B1: show the gift-voucher tender only once the company has vouchers.
    gv: peekTable('gift_vouchers').length > 0,
    // R4-B3: store price lists (branches with a price list, or dated store overrides).
    store: (() => {
      const branches = loadBranches();
      const prices = peekTable<BranchPrice>(BRANCH_PRICES_TABLE);
      return branches.length && storePricingInUse(branches, prices) ? { branches, prices, levels: pricing.levels } : null;
    })(),
    branches: loadBranches().filter((b) => !b.inactive),
    // R3-A4: modifier groups (Settings → Tables) and the stock group of each item (for group-linked modifiers).
    modGroups: getTable<ModGroup>('modifier_groups'),
    groupOf: new Map(stock.map((s) => [s.name.trim().toLowerCase(), s.group_id])),
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
  const [gvApplied, setGvApplied] = useState<AppliedVoucher[]>([]); // R4-B1
  // 8.21: bills on hold (this device, this company).
  const [held, setHeld] = useState<HeldCart[]>(loadHeld);
  const [heldOpen, setHeldOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [agentId, setAgentId] = useState(''); // 8F: sales agent on the bill
  const [creditAsk, setCreditAsk] = useState(''); // 8.80: owner override prompt
  const [creditOver, setCreditOver] = useState(false);
  /* 8E retail speed pack */
  const [keymap, setKeymap] = useState<PosKeymap>(loadKeymap);
  const [scale, setScale] = useState<ScaleProfile>(loadScaleProfile);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dayOpen, setDayOpen] = useState(false);
  const [browse, setBrowse] = useState<number | null>(null);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shift, setShift] = useState<PosShift | undefined>(() => shiftsDb.current());
  const [pendingQty, setPendingQty] = useState<number | null>(null);
  const [grossFor, setGrossFor] = useState<string | null>(null);
  const [grossText, setGrossText] = useState('');
  const [unknown, setUnknown] = useState<{ code: string; qty?: number } | null>(null);
  const [onAccount, setOnAccount] = useState(0);
  const [chequeRef, setChequeRef] = useState('');
  const [creditOk, setCreditOk] = useState(false);
  const [waFor, setWaFor] = useState<InvoiceRecord | null>(null);
  const [waPhone, setWaPhone] = useState('');
  const [changeStrip, setChangeStrip] = useState<{ amount: number; key: number } | null>(null);
  const [modFor, setModFor] = useState<{ item: InvoiceItem; groups: ModGroup[]; qty?: number } | null>(null); // R3-A4
  const [imageFor, setImageFor] = useState<InvoiceRecord | null>(null); // R3-A5
  const [lastShare, setLastShare] = useState<InvoiceRecord | null>(null);
  const [delivery, setDelivery] = useState<DeliveryInfo | null>(null); // R9 (RT-A3)
  const [rxPos, setRxPos] = useState<PosRx | null>(null); // R9 (RT-B1) prescription strip
  const [devPay, setDevPay] = useState<DevPay | null>(null); // R9 (RT-D2/D3) finance + exchange tenders, cash guard
  const [jwPos, setJwPos] = useState<{ kyc?: SaleKyc; errors: string[] } | null>(null); // R9 (RT-E3) cash / PAN guard
  const pharmaOn = useMemo(() => readPharmaSettings().enabled, []);
  /** The line the last scan / pick went to (Alt+Q), the quantity field last focused (Alt+W live weight). */
  const lastLine = useRef<string | null>(null);
  const focusedQty = useRef<string | null>(null);
  /** Lines priced by a price-embedded scale label: never re-priced (the label price is final). */
  const locked = useRef(new Set<string>());
  const stripSeq = useRef(0);
  const keys = useMemo(() => effectiveKeys(keymap), [keymap]);

  const settings = useMemo(() => localDb.settings.get(), []);
  const sender = useMemo(() => localDb.settings.activeProfile(), []);
  const day = todayInput();
  const level = data.pricing && party.client ? levelForClient(party.client, data.pricing.levels) : null;
  // R4-B3: "This counter is branch …" (device-local), defaulting to the branch of the business profile.
  const [counterId, setCounterId] = useState(() => posBranch(data.branches, sender?.id)?.id ?? '');
  const counterBranch: Branch | undefined = useMemo(() => data.branches.find((b) => b.id === counterId), [data.branches, counterId]);

  const built = useMemo(
    () => buildPosRecord({ items, party: { client: party.client, name: party.name, phone: party.phone }, settings, sender, templateId: localDb.template.get(), day, deliverToClientState: dispatch }),
    [items, party, settings, sender, day, dispatch],
  );
  // Loyalty points redeemed as an amount discount (WP-9); a refused redemption leaves the bill as built.
  const redeemed = useMemo(() => (redeemPts > 0 && party.client ? redeemOnBill(built, redeemPts) : null), [built, redeemPts, party.client]);
  // R4-B1: a promotional gift voucher is an amount discount (like loyalty points); a refused one leaves the bill as is.
  const promoV = gvApplied.find((a) => a.promo);
  const promoMany = promoVoucherIssue(gvApplied); // QA6 F12: only one promotional voucher is applied and recorded
  const promo = useMemo(() => {
    const base = redeemed?.record ?? built;
    if (promoMany) return { record: null, error: promoMany };
    return promoV ? applyPromoDiscount(base, promoV.amount) : { record: base, error: '' };
  }, [redeemed, built, promoV, promoMany]);
  const promoted = promo.record ?? redeemed?.record ?? built;
  // 7U: a running bill-value offer applies after the price level / slab and the loyalty redemption.
  const offered = useMemo(() => applyBillOffer(promoted, data.pricing?.schemes ?? [], { retotalRecord: true }), [promoted, data.pricing]);
  const jwKyc = jwPos?.kyc; // R9 (RT-E3)
  const record = useMemo(() => (agentId || delivery || rxPos || jwKyc ? { ...offered, ...(agentId ? { agent_id: agentId } : {}), ...(delivery?.address.trim() ? { delivery } : {}), ...(rxPos?.rx ? { rx: rxPos.rx } : {}), ...(rxPos?.att?.length ? { attachments: rxPos.att } : {}), ...(jwKyc ? { kyc: jwKyc } : {}) } : offered), [offered, agentId, delivery, rxPos, jwKyc]);
  // R9: retail checks (MRP guard, deliveries, short book) read once; the strip loads only when one is on.
  const retailRs = useMemo(() => getJson<RetailSettings | null>(`${DB_PREFIX}retail_settings`, null) ?? {}, []);
  const retailStrip = (!!retailRs.mrp_guard && retailRs.mrp_guard !== 'off') || !!retailRs.delivery?.enabled || !!retailRs.short_book?.enabled;
  const devicesOn = isPackOn(settings, 'electronics') || (!!retailRs.cash_guard && retailRs.cash_guard !== 'off'); // R9 (RT-D)
  const devCatalog = useCallback(() => data.catalog, [data.catalog]);
  const tenders: Tender[] = useMemo(
    () => [
      ...(Object.keys(tender) as MoneyTender[]).map((m) => ({
        method: m, amount: tender[m],
        ...(m === 'UPI' && upiRef.trim() ? { reference: upiRef.trim() } : {}),
        ...(m === 'Cheque' && chequeRef.trim() ? { reference: chequeRef.trim() } : {}),
        ...(m !== 'Cash' && bankId ? { bank_account_id: bankId } : {}),
      })),
      // R4-B1: one tender per sold gift voucher (each keeps its id).
      ...gvApplied.filter((a) => !a.promo).map((a) => ({ method: 'Gift voucher' as const, amount: a.amount, reference: a.number, gift_voucher_id: a.id })),
    ],
    [tender, upiRef, chequeRef, bankId, gvApplied],
  );
  // An exchange credit (WP-9) pays part of the bill; the tenders cover the rest.
  const credit = exchange ? Math.min(exchange.amount, record.total) : 0;
  const payable = round2(record.total - credit - (devPay?.amount ?? 0));
  const summary = tenderSummary(payable, tenders);
  // 8.22: the number this bill will take, for the UPI QR's transaction reference (tr).
  const upiOn = tender.UPI > 0;
  const prefix = record.sender?.invoicePrefix;
  const upiBillNo = useMemo(
    () => (upiOn ? localDb.invoices.nextNumber(record.issue_date, record.doc_type, prefix || undefined) : ''),
    [upiOn, record.issue_date, record.doc_type, prefix],
  );
  // Stock on hand by item name (tracked items), for red zero / negative stock in search and tiles.
  const qtyByName = useMemo(() => new Map(data.positions.filter((p) => p.item.track_stock).map((p) => [p.item.name.trim().toLowerCase(), p.qty - (data.held.get(p.item.id) ?? 0)])), [data.positions, data.held]);
  const qtyOf = useCallback((i: InvoiceItem) => qtyByName.get(i.name.trim().toLowerCase()) ?? null, [qtyByName]);

  /* ── Lines ─────────────────────────────────────────────────── */

  /** Price (level + slab) and scheme lines after a change; typed rates (no basis) stay. */
  const finish = useCallback(
    (next: InvoiceItem[], repriceId?: string, force = false, client: Client | null = party.client): InvoiceItem[] => {
      const p = data.pricing;
      if (!p && !data.lists && !data.store) return next;
      const lvl = p && client ? levelForClient(client, p.levels) : null;
      const store = data.store ? counterBranch : undefined; // R4-B3
      const priced = next.map((l) => {
        if (l.free_of || locked.current.has(l.id) || (repriceId && l.id !== repriceId)) return l;
        const cat = catalogItemFor(p?.catalog ?? data.catalog, l.name);
        // 8E (8.145): a selling price list in force replaces the catalogue's base rate (as in the editor).
        const list = data.lists ? priceListRate(data.stock, l.name, l.hsn, day) : undefined;
        if (!cat && list === undefined) return l;
        const base = list ?? num(cat?.rate);
        if (!force && !l.price_basis && num(l.rate) !== base) return l;
        const branchCtx = store && data.store ? branchContext(store, cat?.id ?? '', day, data.store.prices, data.store.levels) : null;
        const q = resolvePrice({ id: cat?.id ?? '', rate: base, qty_slabs: cat?.qty_slabs, mrp: cat?.mrp }, num(l.quantity), lvl, branchCtx);
        const basis = q.source === 'base' && list !== undefined ? PRICE_LIST_BASIS : q.basis;
        const out = { ...l, rate: q.rate, amount: round2(q.rate * num(l.quantity)) };
        if (basis) out.price_basis = basis;
        else delete out.price_basis;
        return out;
      });
      return p ? syncSchemeLines(priced, p.schemes, day, generateId, p.catalog) : priced;
    },
    [data.pricing, data.lists, data.catalog, data.stock, data.store, counterBranch, party.client, day],
  );

  const addSource = useCallback(
    (source: InvoiceItem, qty?: number) => {
      setItems((cur) => {
        const r = addScannedLine(cur, source, { newId: generateId, fallbackTaxRate: settings.defaultTaxRate, qty });
        lastLine.current = r.lineId;
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

  /** R3-A4: an item "not available today" asks first; one with modifier groups opens the picker. */
  const day86 = todayInput();
  const addPicked = (source: InvoiceItem, qty?: number) => {
    if (source.unavailable_on === day86 && !window.confirm(rPosT('unavailable', { name: source.name }))) return;
    const gid = source.group_id ?? data.groupOf.get(source.name.trim().toLowerCase());
    const groups = data.modGroups.filter((g) => g.item_ids?.includes(source.id) || (gid && g.group_ids?.includes(gid)));
    if (groups.length) setModFor({ item: source, groups, qty });
    else addSource(source, qty);
  };
  const addWithModifiers = async (m: { item: InvoiceItem; groups: ModGroup[]; qty?: number }, picks: Record<string, string[]>) => {
    const { modifierLines } = await import('../lib/restaurant/modifiers');
    setItems((cur) => {
      const parent = addScannedLine([], m.item, { newId: generateId, qty: m.qty, fallbackTaxRate: settings.defaultTaxRate }).items[0];
      const r = modifierLines(parent, m.groups, picks, data.catalog, generateId);
      if (r.note) Object.assign(parent, { note: r.note, description: r.note });
      const kids: InvoiceItem[] = r.children.map(({ item_id: _i, option_id: _o, ...c }) => ({ ...c, modifier_of: parent.id }));
      lastLine.current = parent.id;
      return finish([...cur, parent, ...kids]);
    });
  };

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
  const removeLine = (id: string) => setItems((cur) => finish(cur.filter((l) => l.id !== id && l.free_of !== id && l.modifier_of !== id)));

  /** 8E (8.140): a weighing-scale label — always its own line; a price label's amount is final. */
  const addScaleLine = (item: InvoiceItem, read: ScaleRead) => {
    const sl = scaleLine(read, num(item.rate));
    setItems((cur) => {
      const line = addScannedLine([], { ...item, rate: sl.rate }, { newId: generateId, qty: sl.quantity, fallbackTaxRate: settings.defaultTaxRate }).items[0];
      lastLine.current = line.id;
      if (read.kind === 'price') {
        locked.current.add(line.id);
        return finish([...cur, line]);
      }
      return finish([...cur, line], line.id, true);
    });
    setErrors([]);
  };

  /** 8E (8.141): "=500" / the rate field's "=" key — set a line's amount, the rate is worked back. */
  const applyGross = (id: string | null, amount: number): boolean => {
    const line = id ? items.find((l) => l.id === id && !l.free_of) : undefined;
    if (!line) return false;
    locked.current.delete(line.id);
    setRate(line.id, rateFromGross(amount, num(line.quantity), num(line.discount_percent)));
    return true;
  };

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

  // PERF-2: the item list is folded once per counter load, not per keystroke.
  const itemSuggester = useMemo(
    () =>
      makeSuggester(data.sources, {
        label: (i) => i.name,
        extra: (i) => [i.hsn, i.sku, i.barcode, i.short_code, saltOf(data.salts, i.name)],
        sub: (i) => [formatCurrency(num(i.rate)), i.sku && `SKU ${i.sku}`, saltOf(data.salts, i.name)].filter(Boolean).join(' · '),
        limit: 8,
      }),
    [data.sources, data.salts],
  );
  const hits = useMemo(() => itemSuggester(searchTermOf(query)), [itemSuggester, query]);

  /** 8E: a code, a short code or a scale label → added (with `qty`); null when the term is none of them. */
  const resolveTerm = (term: string, qty?: number): { ok: boolean; message: string } | null => {
    const match = findByCode(term, data.catalog, data.stock);
    const short = match ? null : findByShortCode(term, data.sources);
    const item = match?.item ?? short;
    if (item) {
      addSource(item, qty);
      return { ok: true, message: posT('added', { name: item.name }) + (qty && qty !== 1 ? ` × ${qty}` : '') };
    }
    const read = parseScaleBarcode(term, scale);
    if (!read) return null;
    const plu = findByPlu(data.catalog, read.plu);
    if (!plu) return { ok: false, message: retailT('noPlu', { plu: read.plu }) };
    addScaleLine(plu, read);
    return { ok: true, message: retailT('scaleAdded', { name: plu.name, value: read.kind === 'price' ? formatCurrency(read.value) : `${read.value.toFixed(3)} kg` }) };
  };

  const askUnknown = (code: string, qty?: number) => {
    if (can('master.edit')) setUnknown({ code, qty });
  };

  const onCode = (code: string) => {
    const r = resolveTerm(code);
    if (r) return r;
    askUnknown(code);
    return { ok: false, message: posT('noCode', { code }) };
  };

  const onEnter = (text: string) => {
    const e = parseCounterEntry(text);
    if (e.kind === 'empty') return true;
    if (e.kind === 'gross') {
      return applyGross(lastLine.current ?? items[items.length - 1]?.id ?? null, e.amount)
        ? { ok: true, message: retailT('grossSet', { amount: formatCurrency(e.amount) }) }
        : { ok: false, message: retailT('grossNoLine') };
    }
    const qty = e.qty ?? pendingQty ?? undefined;
    if (!e.term && e.qty) {
      setPendingQty(e.qty);
      return { ok: true, message: retailT('qtyNext', { n: e.qty }) };
    }
    const done = resolveTerm(e.term, qty);
    if (done) {
      if (done.ok) setPendingQty(null);
      return done;
    }
    const hit = hits[active] ?? hits[0];
    if (hit) {
      addPicked(hit.row, e.loose ? pendingQty ?? undefined : qty);
      setPendingQty(null);
      setActive(0);
      return { ok: true, message: posT('added', { name: hit.row.name }) };
    }
    // Nothing matched: keep the text for a name search, and offer to create the item for a code.
    if (looksLikeCode(e.term) || e.qty) askUnknown(e.term, qty);
    return { ok: false, message: posT('noCode', { code: e.term }), keep: true as const };
  };

  /* ── Tender ────────────────────────────────────────────────── */

  const fill = (m: MoneyTender) => {
    const gv = gvApplied.filter((a) => !a.promo).map((a) => ({ method: 'Gift voucher' as const, amount: a.amount }));
    setTender((t) => ({ ...t, [m]: fillRest(payable, [...(Object.keys(t) as MoneyTender[]).map((k) => ({ method: k, amount: t[k] })), ...gv], m) }));
    setTimeout(() => (document.getElementById(`pos-${m}`) as HTMLInputElement | null)?.select(), 0);
  };
  /** 8E (8.144): On account takes what is still due (saved customers only). */
  const fillAccount = () => {
    if (!party.client) return;
    setOnAccount(summary.due);
    setTimeout(() => (document.getElementById('pos-Account') as HTMLInputElement | null)?.select(), 0);
  };
  // Credit limit (6.25) for what this bill leaves on account.
  const credit6 = useMemo(() => {
    if (!party.client || summary.due <= 0.004) return null;
    const master = masterFor(party.client, data.clients) ?? party.client;
    const c = creditCheck({ client: master, draft: { doc_type: record.doc_type, total: record.total, amount_paid: round2(record.total - summary.due) }, invoices: localDb.invoices.getAll(), today: day });
    return c.overBy > 0 ? c : null;
  }, [party.client, summary.due, record.doc_type, record.total, data.clients, day]);

  /* ── Save ──────────────────────────────────────────────────── */

  const reset = () => {
    setItems([]);
    setDelivery(null); // R9 (RT-A3)
    setRxPos(null); // R9 (RT-B1)
    setDevPay(null); // R9 (RT-D)
    setJwPos(null); // R9 (RT-E3)
    setRedeemPts(0);
    setGvApplied([]);
    setParty(WALK_IN);
    setAgentId('');
    setCreditOver(false);
    setDispatch(false);
    setCustomerText('');
    setTender(NO_TENDER);
    setUpiRef('');
    setChequeRef('');
    setOnAccount(0);
    setCreditOk(false);
    setPendingQty(null);
    setGrossFor(null);
    lastLine.current = null;
    focusedQty.current = null;
    locked.current.clear();
    setErrors([]);
    setData(loadCounter());
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const save = (expiredOk = false, creditOverride = false) => {
    if (items.length === 0) {
      setErrors([posT('errEmpty')]);
      return;
    }
    if (promoMany) {
      setErrors([promoMany]);
      return;
    }
    if (rxPos?.errors.length) return setErrors(rxPos.errors); // R9 (RT-B1): "Require prescription for H1 / X"
    if (devPay?.error) return setErrors([devPay.error]); // R9 (RT-D)
    if (jwPos?.errors.length) return setErrors(jwPos.errors); // R9 (RT-E3): cash 269ST / PAN 114B
    // 8E (8.144): an "On account" amount must be what is left unpaid.
    if (onAccount > 0.004 && Math.abs(onAccount - summary.due) > 0.004) {
      setErrors([retailT('accountMismatch', { due: formatCurrency(summary.due) })]);
      return;
    }
    // 8.80: a saved customer over the credit limit (Block) — the unpaid part adds credit.
    const overridden = creditOverride || creditOver;
    const blocked = party.client && !overridden ? creditStatus(record, { unpaid: summary.due })?.blocked : '';
    if (blocked) {
      if (canOverrideCredit()) setCreditAsk(blocked);
      else setErrors([crT('posBlocked'), blocked]);
      return;
    }
    // 6.25 warn-only limit: the first Save warns, a second Save goes through.
    if (credit6 && !creditOk && !overridden) {
      setErrors([credit6.warnings[0] ?? retailT('overLimit'), retailT('overLimitAgain')]);
      setCreditOk(true);
      return;
    }
    const res = savePosBill({ record, tenders, expiredOk, allowCredit: !!party.client || !!record.delivery?.cod || !!devPay?.amount, exchangeReturnId: exchange?.id, ...(promoV && promo.record ? { promoVoucher: { id: promoV.id, amount: promoV.amount } } : {}) });
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
    const saved = devPay?.post ? devPay.post(res.record) : res.record; // R9 (RT-D): finance / exchange settle the rest
    if (shift) shiftsDb.addBill(shift.id, saved.id); // 8.142: the bill counts in this cashier's shift
    // 8E (8.147 / 8.148): the change in a big strip for 3 s; WhatsApp the bill from the toast.
    if (change > 0) setChangeStrip({ amount: change, key: ++stripSeq.current });
    notify(posT('saved', { doc: docName(saved.doc_type), number: saved.invoice_number }), 'success', { action: { label: retailT('whatsapp'), onClick: () => sendWhatsapp(saved) }, duration: 6000 });
    setLastShare(saved); // R3-A5: "Share as image" in the header for the bill just saved
    postDisplay(thanksMessage(saved.sender?.companyName ?? '', saved.total, change), true);
    setLastBill(saved);
    setExchange(null);
    if (autoPrint) setPrinting(saved);
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

  /** 8.148: WhatsApp a saved bill to its customer's phone; asks for a number when it has none. */
  const sendWhatsapp = (bill: InvoiceRecord) => {
    const href = posWhatsappHref(bill);
    if (href) window.open(href, '_blank', 'noopener');
    else {
      setWaPhone('');
      setWaFor(bill);
    }
  };

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
    setTender({ ...NO_TENDER, ...(c.tender ?? {}) });
    setUpiRef(c.upi_ref ?? '');
    setRedeemPts(0);
    setGvApplied([]);
    setErrors([]);
    setHeldOpen(false);
    notify(parked?.ok ? `${posT('heldRecalled')}. ${posT('heldReplace')}` : posT('heldRecalled'));
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const drop = (id: string) => storeHeld(loadHeld().filter((c) => c.id !== id));
  // R9 (RT-B1): Pharmacy → Refills "Bill now" opens `/pos?refill=<id>`: the refill is parked as a held cart and recalled.
  useEffect(() => {
    const id = params.get('refill');
    if (!id) return;
    const next = new URLSearchParams(params);
    next.delete('refill');
    setParams(next, { replace: true });
    void import('../components/retail-r9/PharmacyDesk').then((m) => {
      const cart = m.refillCartById(id);
      const r = cart && holdCart(loadHeld(), cart);
      if (cart && r?.ok && storeHeld(r.list)) recall(cart.id);
      else if (cart) notify(posT('heldFull'), 'error');
    });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 8E: bills to browse, live weight, customer display ───── */

  const posBillsSorted = useMemo(
    () => [...data.posBills].sort((a, b) => (a.created_at ?? a.issue_date).localeCompare(b.created_at ?? b.issue_date) || a.invoice_number.localeCompare(b.invoice_number, undefined, { numeric: true })),
    [data.posBills],
  );

  /** Alt+W: read a stable weight from a serial scale into the focused (or last) line's quantity. */
  const weigh = async () => {
    const id = focusedQty.current ?? lastLine.current ?? items[items.length - 1]?.id;
    if (!id) return notify(retailT('weighNoLine'), 'error');
    try {
      const m = await import('../lib/scale-serial');
      if (!m.scaleSerialSupported()) return notify(retailT('noSerial'), 'error');
      const w = await m.readScaleWeight(scale.baud);
      if (!w || !(w.weight > 0)) return notify(retailT('scaleNothing'), 'error');
      if (!w.stable) return notify(retailT('scaleUnstable', { kg: w.weight.toFixed(3) }), 'error');
      setQty(id, w.weight);
      notify(retailT('weighed', { kg: w.weight.toFixed(3) }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const channel = useRef<BroadcastChannel | null>(null);
  const lastMsg = useRef<DisplayMessage | null>(null);
  const thanking = useRef(false);
  const postDisplay = (m: DisplayMessage, thanks = false) => {
    lastMsg.current = m;
    thanking.current = thanks;
    try {
      channel.current?.postMessage(m);
    } catch {
      /* display closed */
    }
  };
  useEffect(() => {
    const ch = openBroadcast(DISPLAY_CHANNEL);
    channel.current = ch;
    if (!ch) return;
    ch.onmessage = (e: MessageEvent) => {
      if (readDisplayMessage(e.data)?.type === 'hello' && lastMsg.current) ch.postMessage(lastMsg.current);
    };
    return () => {
      ch.close();
      channel.current = null;
    };
  }, []);
  const business = record.sender?.companyName || sender?.companyName || '';
  const displayUpi = useMemo(
    () => (tender.UPI > 0 ? upiLink({ pa: record.sender?.upiId || sender?.upiId || '', pn: business, amount: round2(tender.UPI), tr: upiBillNo, note: upiBillNo ? `Bill ${upiBillNo}` : undefined }) : null),
    [tender.UPI, record.sender?.upiId, sender?.upiId, business, upiBillNo],
  );
  useEffect(() => {
    if (items.length) postDisplay(billMessage(record, { link: displayUpi, amount: round2(tender.UPI) }));
    else if (!thanking.current) postDisplay(idleMessage(business));
  }, [record, displayUpi, tender.UPI, items.length, business]);
  const openDisplay = () => {
    const w = window.open(DISPLAY_PATH, 'mrchartist-pos-display', 'popup,width=960,height=640');
    if (!w) notify(retailT('displayBlocked'), 'error');
  };

  useEffect(() => {
    if (!changeStrip) return;
    const t = window.setTimeout(() => setChangeStrip(null), 3000);
    return () => window.clearTimeout(t);
  }, [changeStrip]);

  /* ── Keyboard ──────────────────────────────────────────────── */

  const act = (a: PosAction) => {
    if (a === 'search') searchRef.current?.focus();
    else if (a === 'customer') document.getElementById('pos-customer')?.focus();
    else if (a === 'cash' || a === 'upi' || a === 'card') fill(a === 'cash' ? 'Cash' : a === 'upi' ? 'UPI' : 'Card');
    else if (a === 'cheque' || a === 'wallet') fill(a === 'cheque' ? 'Cheque' : 'Wallet');
    else if (a === 'account') fillAccount();
    else if (a === 'help') setHelpOpen(true);
    else if (a === 'daySummary') setDayOpen(true);
    else if (a === 'prevBill') setBrowse(data.posBills.length ? posBillsSorted.length - 1 : 0);
    else if (a === 'nextBill') searchRef.current?.focus(); // already on the newest (the counter)
    else if (a === 'lastQty') {
      const id = lastLine.current ?? items[items.length - 1]?.id;
      const el = id ? (document.querySelector(`[data-qty-for="${id}"]`) as HTMLInputElement | null) : null;
      el?.focus();
      el?.select();
    } else if (a === 'weigh') void weigh();
    else if (a === 'display') openDisplay();
    else if (a === 'save') save();
    else if (a === 'new') reset();
    else if (a === 'zreport') setZOpen(true);
    else if (a === 'hold') hold();
    else if (a === 'held') {
      setHeld(loadHeld());
      setHeldOpen(true);
    }
  };
  const keymapRef = useRef(keymap);
  useEffect(() => {
    keymapRef.current = keymap;
  }, [keymap]);
  const actRef = useRef(act);
  useEffect(() => {
    actRef.current = act;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return; // a dialog owns the keyboard
      const a = posShortcut(e, keymapRef.current);
      if (!a) return;
      e.preventDefault();
      actRef.current(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ── Render ────────────────────────────────────────────────── */

  const clientSuggestions = useMemo(
    () => makeSuggester(data.clients, { label: (c) => c.name, extra: (c) => [c.phone, c.company, c.gstin], sub: (c) => [c.phone, c.gstin].filter(Boolean).join(' · ') }),
    [data.clients],
  );
  const stockOf = (l: InvoiceItem) => (data.positions.length ? findLevel(data.positions, l.name, l.hsn, data.held) : null);
  const docLabel = record.doc_type in DOCUMENT_LABELS ? docName(record.doc_type) : DOCUMENT_LABELS.INVOICE;

  return (
    <div className={cn(surface.page, styles.page)}>
      <Suspense fallback={null}><ScreenTip id="pos" /></Suspense>
      <PageHeader
        title={posT('title')}
        subtitle={posT('subtitle', { doc: docLabel, business: sender?.companyName || posT('setUp') })}
        actions={
          // QA-3 F26: on a phone the counter tools are one scrolling row, so the cart total and Save stay in view.
          <div className={counter.tools} data-pos-tools>
            {lastBill && (
              <button type="button" className={controls.btnOutline} onClick={() => setPrinting(lastBill)}>
                <Printer size={16} /> {posT('reprint', { number: lastBill.invoice_number })}
              </button>
            )}
            {lastBill && (posWhatsappHref(lastBill) ? (
              <a className={controls.btnOutline} href={posWhatsappHref(lastBill) ?? undefined} target="_blank" rel="noopener noreferrer" data-pos-whatsapp>
                <MessageCircle size={16} /> {retailT('whatsapp')}
              </a>
            ) : (
              <button type="button" className={controls.btnOutline} onClick={() => sendWhatsapp(lastBill)} data-pos-whatsapp>
                <MessageCircle size={16} /> {retailT('whatsapp')}
              </button>
            ))}
            {lastShare && (
              <button type="button" className={controls.btnOutline} onClick={() => setImageFor(lastShare)} data-pos-share-image>
                <Camera size={16} /> {rPosT('shareImage')}
              </button>
            )}
            <Link className={controls.btnOutline} to="/tables" data-pos-tables><Store size={16} /> {rPosT('tables')}</Link>
            <button type="button" className={controls.btnOutline} onClick={() => setShiftOpen(true)} data-pos-shift>
              <Clock size={16} /> {shift ? retailT('shiftN', { n: shift.number }) : retailT('shift')}
            </button>
            <button type="button" className={controls.btnOutline} onClick={openDisplay} title={keys.display} data-pos-display-open>
              <Monitor size={16} /> {retailT('display')}
            </button>
            <button type="button" className={controls.btnIcon} onClick={() => setSettingsOpen(true)} aria-label={retailT('setTitle')} title={retailT('setTitle')} data-pos-settings>
              <Settings2 size={16} />
            </button>
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
          </div>
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
            {pendingQty && <span className={retail.pending} data-pos-pending>{retailT('qtyNext', { n: pendingQty })}</span>}
            {hits.length > 0 && query.trim() && (
              <ul className={styles.hits} role="listbox" aria-label={posT('matching')}>
                {hits.map((h, n) => {
                  const lvl = stockOf(h.row);
                  const cls = stockClass(lvl ? lvl.qty : null);
                  return (
                    <li key={h.row.id} role="option" aria-selected={n === active}>
                      <button type="button" className={cn(styles.hit, n === active && styles.hitActive, (cls === 'zero' || cls === 'neg' || h.row.unavailable_on === day86) && counter.noStock)} onMouseDown={(e) => e.preventDefault()} onClick={() => { addPicked(h.row); setQuery(''); searchRef.current?.focus(); }}>
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
                        <NumberInput
                          className={cn(controls.input, controls.inputNumeric, styles.qtyInput)}
                          value={l.quantity}
                          blankZero={false}
                          onChange={(q) => setQty(l.id, q)}
                          disabled={free}
                          aria-label={posT('qtyOf', { name: l.name, n: n + 1 })}
                          data-qty-for={l.id}
                          onFocus={() => { focusedQty.current = l.id; }}
                          onBlur={() => { if (focusedQty.current === l.id) setTimeout(() => { if (focusedQty.current === l.id && document.activeElement?.getAttribute('data-qty-for') !== l.id) focusedQty.current = null; }, 0); }}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); searchRef.current?.focus(); } }}
                        />
                        <button type="button" className={controls.btnIcon} onClick={() => setQty(l.id, num(l.quantity) + 1)} disabled={free} aria-label={posT('more', { name: l.name })}><Plus size={14} /></button>
                      </div>
                      <div role="cell" className={styles.r}>
                        {grossFor === l.id ? (
                          <input
                            className={cn(controls.input, controls.inputNumeric, retail.grossInput)}
                            value={grossText}
                            autoFocus
                            inputMode="decimal"
                            placeholder={retailT('grossPh')}
                            aria-label={retailT('grossOf', { name: l.name })}
                            data-gross-for={l.id}
                            onChange={(e) => setGrossText(e.target.value.replace(/[^0-9.]/g, ''))}
                            onBlur={() => setGrossFor(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') { e.preventDefault(); setGrossFor(null); }
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                if (Number(grossText) > 0) applyGross(l.id, Number(grossText));
                                setGrossFor(null);
                                searchRef.current?.focus();
                              }
                            }}
                          />
                        ) : (
                          <NumberInput
                            className={cn(controls.input, controls.inputNumeric, styles.num)}
                            value={l.rate}
                            onChange={(r) => { locked.current.delete(l.id); setRate(l.id, r); }}
                            disabled={free}
                            placeholder={posT('rate')}
                            aria-label={posT('rateOf', { name: l.name, n: n + 1 })}
                            title={retailT('rateEqHint')}
                            onKeyDown={(e) => { if (e.key === '=') { e.preventDefault(); setGrossText(''); setGrossFor(l.id); } }}
                          />
                        )}
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
            unavailable={(i) => i.unavailable_on === day86}
            onPick={(item) => {
              addPicked(item);
              searchRef.current?.focus();
            }}
          />
        </section>

        <aside className={styles.side}>
          <section className={surface.card} aria-label={posT('customer')}>
            <div className={surface.cardHead}><span className={surface.cardHeadIcon}><UserRound size={16} /> {posT('customer')} <kbd className={styles.kbd}>F3</kbd></span></div>
            <div className={cn(surface.cardBody, styles.stack)}>
              {data.store && (
                <label className={controls.field}>
                  <span className={controls.label}><Store size={12} aria-hidden="true" /> {storeT('counter')}</span>
                  <select className={controls.select} value={counterId} data-pos-branch onChange={(e) => {
                    setCounterId(e.target.value);
                    writePosBranch(e.target.value);
                  }}>
                    <option value="">{storeT('none')}</option>
                    {data.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </label>
              )}
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
              {party.client && <Suspense fallback={null}><UsualTiles key={party.client.id || party.client.name} client={party.client} onPick={addSource} /></Suspense>}
              <Suspense fallback={null}>
                <PosDistExtras client={party.client} record={record} unpaid={summary.due} agentId={agentId} onAgent={setAgentId} />
              </Suspense>
              {retailStrip && <Suspense fallback={null}><PosRetailStrip record={record} query={query} delivery={delivery} onDelivery={setDelivery} onAddLine={(l) => setItems((prev) => [...prev.filter((x) => x.name !== 'Delivery charge'), l])} deliveryOn={!!retailRs.delivery?.enabled} shortBookOn={!!retailRs.short_book?.enabled} notify={notify} /></Suspense>}
              {pharmaOn && <Suspense fallback={null}><RxStrip record={record} value={rxPos} onChange={setRxPos} /></Suspense>}
              {params.get('appt') && <Suspense fallback={null}><PosAppointment id={params.get('appt')!} onLoad={(lines, p) => { setItems(lines); setParty(p); setParams((q) => { q.delete('appt'); return q; }, { replace: true }); }} /></Suspense>}
              {party.client && (isPackOn(settings, 'salon') || isPackOn(settings, 'fitness')) && <Suspense fallback={null}><PosPackages client={party.client} items={items} setItems={setItems} notify={notify} /></Suspense>}
              {isPackOn(settings, 'apparel') && <Suspense fallback={null}><PosApparel record={record} setItems={setItems} /></Suspense>}
              {(isPackOn(settings, 'jewellery') || !!retailRs.require_pan) && <Suspense fallback={null}><PosJewel record={record} cash={devicesOn ? 0 : Math.max(summary.cash - summary.change, 0)} setItems={setItems} onChange={setJwPos} /></Suspense>}
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
              {(['Cash', 'UPI', 'Card', 'Cheque', 'Wallet'] as MoneyTender[]).map((m) => (
                <div key={m} className={styles.tender}>
                  <label htmlFor={`pos-${m}`} className={styles.tenderLabel}>{m === 'Cash' || m === 'UPI' || m === 'Card' ? posT(`m.${m}`) : retailT(`t.${m}`)} <kbd className={styles.kbd}>{keys[TENDER_KEY[m]]}</kbd></label>
                  <NumberInput id={`pos-${m}`} className={cn(controls.input, controls.inputNumeric)} value={tender[m]} onChange={(v) => setTender((t) => ({ ...t, [m]: v }))} placeholder="0" />
                  <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => fill(m)}>{posT('rest')}</button>
                </div>
              ))}
              {party.client && (
                <div className={styles.tender}>
                  <label htmlFor="pos-Account" className={styles.tenderLabel}>{retailT('t.Account')} <kbd className={styles.kbd}>{keys.account}</kbd></label>
                  <NumberInput id="pos-Account" className={cn(controls.input, controls.inputNumeric)} value={onAccount} onChange={setOnAccount} placeholder="0" />
                  <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={fillAccount}>{posT('rest')}</button>
                </div>
              )}
              {(data.gv || gvApplied.length > 0) && (
                <Suspense fallback={null}>
                  <GiftVoucherTender day={record.issue_date} due={summary.due} applied={gvApplied} onChange={setGvApplied} />
                </Suspense>
              )}
              {devicesOn && <Suspense fallback={null}><PosDevices key={lastBill?.id} record={record} cash={summary.cash - summary.change} setItems={setItems} onPay={setDevPay} notify={notify} catalog={devCatalog} /></Suspense>}
              {isPackOn(settings, 'hotel') && items.length > 0 && <Suspense fallback={null}><RoomPicker record={record} notify={notify} onDone={reset} /></Suspense>}
              {promo.error && <p className={controls.error} role="alert">{promo.error}</p>}
              {tender.Cheque > 0 && (
                <input className={controls.input} value={chequeRef} onChange={(e) => setChequeRef(e.target.value)} placeholder={retailT('chequePh')} aria-label={retailT('chequePh')} id="pos-cheque-ref" />
              )}
              {credit6 && <p className={retail.warn} role="status" data-pos-credit>{credit6.warnings[0]}</p>}
              {tender.UPI > 0 && (
                <Suspense fallback={<input className={controls.input} value={upiRef} onChange={(e) => setUpiRef(e.target.value)} placeholder={posT('upiPh')} aria-label={posT('upiAria')} />}>
                  <PosUpiQr vpa={record.sender?.upiId || sender?.upiId} payee={record.sender?.companyName || sender?.companyName} amount={round2(tender.UPI)} billNo={upiBillNo} utr={upiRef} onUtr={setUpiRef} />
                </Suspense>
              )}
              {(tender.UPI > 0 || tender.Card > 0 || tender.Cheque > 0 || tender.Wallet > 0) && (
                <BankAccountSelect id="pos-bank" label={posT('receivedInto')} method={tender.UPI > 0 ? 'UPI' : tender.Card > 0 ? 'Card' : tender.Cheque > 0 ? 'Cheque' : 'UPI'} value={bankId} onChange={setBankId} />
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
              {POS_SHORTCUTS.slice(0, 10).map((s) => <li key={s.keys}><kbd className={styles.kbd}>{keys[s.action]}</kbd> {retailT(`a.${s.action}`)}</li>)}
              <li><kbd className={styles.kbd}>{keys.help}</kbd> <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setHelpOpen(true)} data-pos-help-open>{retailT('a.help')}</button></li>
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
      {/* 8E retail speed pack */}
      {changeStrip && (
        <div className={retail.changeStrip} role="status" aria-live="assertive" data-pos-change-strip key={changeStrip.key}>
          {retailT('changeStrip', { amount: formatCurrency(changeStrip.amount) })}
        </div>
      )}
      <Suspense fallback={null}>
        {helpOpen && <PosHelp open={helpOpen} onClose={() => setHelpOpen(false)} keymap={keymap} onCustomise={() => { setHelpOpen(false); setSettingsOpen(true); }} />}
        {dayOpen && <DaySummary open={dayOpen} onClose={() => { setDayOpen(false); searchRef.current?.focus(); }} held={held.length} />}
        {browse !== null && (
          <BillBrowser
            bills={posBillsSorted}
            index={Math.max(Math.min(browse, posBillsSorted.length - 1), 0)}
            onIndex={(n) => setBrowse(Math.max(n, 0))}
            onClose={() => { setBrowse(null); searchRef.current?.focus(); }}
            onReprint={(b) => setPrinting(b)}
          />
        )}
        {settingsOpen && (
          <RetailSettings
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            keymap={keymap}
            scale={scale}
            onSaved={(k, sc) => { setKeymap(k); setScale(sc); notify(retailT('settingsSaved')); }}
          />
        )}
        {shiftOpen && <ShiftPanel open={shiftOpen} onClose={() => setShiftOpen(false)} held={held.length} notify={notify} onChanged={setShift} />}
        {unknown && (
          <QuickItemSheet
            code={unknown.code}
            defaultTax={settings.defaultTaxRate}
            onClose={() => setUnknown(null)}
            onSearch={() => { setUnknown(null); searchRef.current?.focus(); }}
            onSaved={(item) => {
              const qty = unknown.qty;
              setUnknown(null);
              setData(loadCounter());
              addSource(item, qty);
              setPendingQty(null);
              notify(retailT('qiAdded', { name: item.name }));
              setTimeout(() => searchRef.current?.focus(), 0);
            }}
          />
        )}
      </Suspense>
      <Suspense fallback={null}>
        {modFor && (
          <ModifierPicker
            name={modFor.item.name}
            groups={modFor.groups}
            onClose={() => setModFor(null)}
            onPick={(picks) => {
              const m = modFor;
              setModFor(null);
              void addWithModifiers(m, picks);
              searchRef.current?.focus();
            }}
          />
        )}
        {imageFor && <BillImageShare invoice={imageFor} onDone={(r) => { setImageFor(null); if (!r.ok) notify(r.message ?? posT('saveFailed'), 'error'); }} />}
      </Suspense>
      {waFor && (
        <Modal
          open
          size="sm"
          onClose={() => setWaFor(null)}
          title={retailT('waTitle')}
          footer={
            <>
              <button type="button" className={controls.btnOutline} onClick={() => setWaFor(null)}>{retailT('cancel')}</button>
              {posWhatsappHref(waFor, waPhone) ? (
                <a className={controls.btnPrimary} href={posWhatsappHref(waFor, waPhone) ?? undefined} target="_blank" rel="noopener noreferrer" onClick={() => setWaFor(null)} data-pos-wa-link>
                  <MessageCircle size={16} /> {retailT('waSend')}
                </a>
              ) : (
                <button type="button" className={controls.btnPrimary} disabled>{retailT('waSend')}</button>
              )}
            </>
          }
        >
          <label className={controls.field}>
            <span className={controls.label}>{retailT('waPhone')}</span>
            <input id="pos-wa-phone" className={controls.input} value={waPhone} inputMode="tel" autoFocus onChange={(e) => setWaPhone(e.target.value)} />
          </label>
        </Modal>
      )}
    </div>
  );
}
