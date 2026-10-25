import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Keyboard, Minus, Plus, Printer, ReceiptText, Save, Tags, Trash2, UserRound, X } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/useToast';
import { NumberInput } from '../components/ui/NumberInput';
import { Typeahead } from '../components/ui/Typeahead';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { ScanField } from '../components/scan/ScanField';
import { SerialPicker } from '../components/inventory/SerialPicker';
import { BankAccountSelect } from '../components/bank/BankAccountSelect';
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
  POS_SHORTCUTS, WALK_IN_NAME, buildPosRecord, fillRest, posShortcut, savePosBill, tenderSummary,
  type PosAction, type Tender, type TenderMethod,
} from '../lib/pos';
import { DOCUMENT_LABELS, type Client, type InvoiceItem, type InvoiceRecord } from '../types/invoice';
import { cn, formatCurrency, todayInput } from '../lib/utils';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from '../components/pos/pos.module.css';

const ZReportModal = lazy(() => import('../components/pos/ZReportModal').then((m) => ({ default: m.ZReportModal })));
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
    ctx: editorStockContext({ doc_type: 'INVOICE', issue_date: todayInput() }),
  };
}

/** One-screen counter billing (6.8): scan / search, tender, save as an invoice, print the 80 mm bill. */
export function Pos() {
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
  const searchRef = useRef<HTMLInputElement>(null);

  const settings = useMemo(() => localDb.settings.get(), []);
  const sender = useMemo(() => localDb.settings.activeProfile(), []);
  const day = todayInput();
  const level = data.pricing && party.client ? levelForClient(party.client, data.pricing.levels) : null;

  const record = useMemo(
    () => buildPosRecord({ items, party: { client: party.client, name: party.name, phone: party.phone }, settings, sender, templateId: localDb.template.get(), day, deliverToClientState: dispatch }),
    [items, party, settings, sender, day, dispatch],
  );
  const tenders: Tender[] = useMemo(
    () => (Object.keys(tender) as TenderMethod[]).map((m) => ({
      method: m, amount: tender[m],
      ...(m === 'UPI' && upiRef.trim() ? { reference: upiRef.trim() } : {}),
      ...(m !== 'Cash' && bankId ? { bank_account_id: bankId } : {}),
    })),
    [tender, upiRef, bankId],
  );
  const summary = tenderSummary(record.total, tenders);

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
      return syncSchemeLines(priced, p.schemes, day, generateId);
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

  const setQty = (id: string, qty: number) =>
    setItems((cur) => finish(cur.map((l) => (l.id === id ? { ...l, quantity: Math.max(round2(qty), 0), amount: round2(Math.max(qty, 0) * num(l.rate)) } : l)), id));
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
    setDispatch(false);
    setCustomerText('');
    setItems((cur) => (cur.length ? finish(cur, undefined, false, client) : cur));
  };

  /* ── Scan / search ─────────────────────────────────────────── */

  const hits = useMemo(
    () =>
      suggest(query, data.sources, {
        label: (i) => i.name,
        extra: (i) => [i.hsn, i.sku, i.barcode],
        sub: (i) => [formatCurrency(num(i.rate)), i.sku && `SKU ${i.sku}`].filter(Boolean).join(' · '),
        limit: 8,
      }),
    [query, data.sources],
  );

  const onCode = (code: string) => {
    const match = findByCode(code, data.catalog, data.stock);
    if (!match) return { ok: false, message: `No item has the code ${code}.` };
    addSource(match.item);
    return { ok: true, message: `Added ${match.item.name}` };
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
    setTender((t) => ({ ...t, [m]: fillRest(record.total, (Object.keys(t) as TenderMethod[]).map((k) => ({ method: k, amount: t[k] })), m) }));
    setTimeout(() => (document.getElementById(`pos-${m}`) as HTMLInputElement | null)?.select(), 0);
  };

  /* ── Save ──────────────────────────────────────────────────── */

  const reset = () => {
    setItems([]);
    setParty(WALK_IN);
    setDispatch(false);
    setCustomerText('');
    setTender(NO_TENDER);
    setUpiRef('');
    setErrors([]);
    setData(loadCounter());
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const save = (expiredOk = false) => {
    if (items.length === 0) {
      setErrors(['Scan or add at least one item.']);
      return;
    }
    const res = savePosBill({ record, tenders, expiredOk, allowCredit: !!party.client });
    if (res.expired?.length) {
      setExpiredAsk(res.expired);
      return;
    }
    if (!res.ok || !res.record) {
      setErrors(res.errors);
      notify(res.errors[0] ?? 'Could not save the bill.', 'error');
      if (res.record) reset(); // invoice saved, a payment failed: never bill twice
      return;
    }
    const change = res.summary?.change ?? 0;
    notify(`${DOCUMENT_LABELS[res.record.doc_type]} ${res.record.invoice_number} saved${change > 0 ? ` — give ${formatCurrency(change)} change` : ''}`);
    setLastBill(res.record);
    if (autoPrint) setPrinting(res.record);
    reset();
  };

  /* ── Keyboard ──────────────────────────────────────────────── */

  const act = (a: PosAction) => {
    if (a === 'search') searchRef.current?.focus();
    else if (a === 'customer') document.getElementById('pos-customer')?.focus();
    else if (a === 'cash' || a === 'upi' || a === 'card') fill(a === 'cash' ? 'Cash' : a === 'upi' ? 'UPI' : 'Card');
    else if (a === 'save') save();
    else if (a === 'new') reset();
    else if (a === 'zreport') setZOpen(true);
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
  const docLabel = DOCUMENT_LABELS[record.doc_type];

  return (
    <div className={cn(surface.page, styles.page)}>
      <PageHeader
        title="POS quick bill"
        subtitle={`${docLabel} · ${sender?.companyName || 'Set up your business in Settings'} · works offline`}
        actions={
          <>
            {lastBill && (
              <button type="button" className={controls.btnOutline} onClick={() => setPrinting(lastBill)}>
                <Printer size={16} /> Reprint {lastBill.invoice_number}
              </button>
            )}
            <button type="button" className={controls.btnOutline} onClick={() => setZOpen(true)}>
              <ReceiptText size={16} /> Z report
            </button>
          </>
        }
      />

      <div className={styles.layout}>
        <section className={cn(surface.card, styles.cart)} aria-label="Bill items">
          <div className={styles.scan}>
            <ScanField
              id="pos-scan"
              label="Scan barcode or search items"
              placeholder="Scan a barcode or type an item / SKU (F2)"
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
              <ul className={styles.hits} role="listbox" aria-label="Matching items">
                {hits.map((h, n) => {
                  const lvl = stockOf(h.row);
                  return (
                    <li key={h.row.id} role="option" aria-selected={n === active}>
                      <button type="button" className={cn(styles.hit, n === active && styles.hitActive)} onMouseDown={(e) => e.preventDefault()} onClick={() => { addSource(h.row); setQuery(''); searchRef.current?.focus(); }}>
                        <span>{h.label}</span>
                        <span className={styles.muted}>{h.sub}{lvl ? ` · ${lvl.qty} in stock` : ''}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {items.length === 0 ? (
            <p className={styles.empty}>Scan an item or search by name to start the bill.</p>
          ) : (
            <div className={styles.lines} role="table" aria-label="Lines">
              <div className={cn(styles.line, styles.lineHead)} role="row">
                <span role="columnheader">Item</span>
                <span role="columnheader">Qty</span>
                <span role="columnheader" className={styles.r}>Rate</span>
                <span role="columnheader" className={styles.r}>Disc %</span>
                <span role="columnheader" className={styles.r}>Amount</span>
                <span role="columnheader"><span className={surface.srOnly}>Remove</span></span>
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
                          {[l.hsn && `HSN ${l.hsn}`, typeof l.tax_rate === 'number' && record.gst_mode !== 'NONE' && `GST ${l.tax_rate}%`, lvl && `${lvl.qty} ${lvl.unit} in stock`].filter(Boolean).join(' · ')}
                        </span>
                        {(l.price_basis || free) && <span className={styles.chip}><Tags size={12} aria-hidden="true" /> {free ? 'Free (scheme)' : `${l.price_basis} price`}</span>}
                      </div>
                      <div role="cell" className={styles.qty}>
                        <button type="button" className={controls.btnIcon} onClick={() => setQty(l.id, num(l.quantity) - 1)} disabled={free || num(l.quantity) <= 1} aria-label={`Less ${l.name}`}><Minus size={14} /></button>
                        <NumberInput className={cn(controls.input, controls.inputNumeric, styles.qtyInput)} value={l.quantity} blankZero={false} onChange={(q) => setQty(l.id, q)} disabled={free} aria-label={`Quantity of ${l.name} (line ${n + 1})`} />
                        <button type="button" className={controls.btnIcon} onClick={() => setQty(l.id, num(l.quantity) + 1)} disabled={free} aria-label={`More ${l.name}`}><Plus size={14} /></button>
                      </div>
                      <div role="cell" className={styles.r}>
                        <NumberInput className={cn(controls.input, controls.inputNumeric, styles.num)} value={l.rate} onChange={(r) => setRate(l.id, r)} disabled={free} placeholder="Rate" aria-label={`Rate of ${l.name} (line ${n + 1})`} />
                      </div>
                      <div role="cell" className={styles.r}>
                        <NumberInput className={cn(controls.input, controls.inputNumeric, styles.num)} value={l.discount_percent ?? 0} onChange={(d) => setDisc(l.id, d)} disabled={free} placeholder="Disc %" aria-label={`Discount % of ${l.name} (line ${n + 1})`} />
                      </div>
                      <div role="cell" className={cn(styles.r, styles.amount)}>{formatCurrency(calc ? round2(num(calc.quantity) * num(calc.rate) * (1 - num(calc.discount_percent) / 100)) : 0)}</div>
                      <div role="cell">
                        {!free && (
                          <button type="button" className={controls.btnDanger} onClick={() => removeLine(l.id)} aria-label={`Remove ${l.name}`}><Trash2 size={14} /></button>
                        )}
                      </div>
                    </div>
                    {stockItem?.track_serials && (
                      <div className={styles.serials}>
                        <SerialPicker
                          label={`Serial / IMEI for ${l.name}`}
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
        </section>

        <aside className={styles.side}>
          <section className={surface.card} aria-label="Customer">
            <div className={surface.cardHead}><span className={surface.cardHeadIcon}><UserRound size={16} /> Customer <kbd className={styles.kbd}>F3</kbd></span></div>
            <div className={cn(surface.cardBody, styles.stack)}>
              {party.client ? (
                <div className={styles.picked}>
                  <div>
                    <strong>{party.client.name}</strong>
                    <span className={styles.muted}>{[party.client.phone, party.client.gstin].filter(Boolean).join(' · ') || 'Saved customer'}</span>
                    {level && <span className={styles.chip}><Tags size={12} aria-hidden="true" /> {level.name} prices</span>}
                  </div>
                  <button type="button" className={controls.btnIcon} onClick={() => chooseClient(null)} aria-label="Back to walk-in customer"><X size={16} /></button>
                </div>
              ) : null}
              {party.client && (
                <label className={controls.check} title="Over the counter the place of supply is your own state (Sec 10(1) IGST Act). Tick only when the goods are dispatched to the customer's state. Verify with your CA.">
                  <input type="checkbox" checked={dispatch} onChange={(e) => setDispatch(e.target.checked)} />
                  Deliver to the customer&apos;s state (dispatch)
                </label>
              )}
              {party.client ? null : (
                <>
                  <Typeahead
                    id="pos-customer"
                    className={controls.input}
                    value={customerText}
                    onChange={setCustomerText}
                    getSuggestions={clientSuggestions}
                    onPick={(c) => chooseClient(c)}
                    placeholder={`${WALK_IN_NAME} — or search saved customers`}
                    aria-label="Saved customer"
                  />
                  <div className={controls.row}>
                    <input className={controls.input} value={party.name} onChange={(e) => setParty({ ...party, name: e.target.value })} placeholder="Name (optional)" aria-label="Walk-in name" />
                    <input className={controls.input} value={party.phone} inputMode="tel" onChange={(e) => setParty({ ...party, phone: e.target.value })} placeholder="Phone (optional)" aria-label="Walk-in phone" />
                  </div>
                </>
              )}
            </div>
          </section>

          <section className={surface.card} aria-label="Totals">
            <div className={cn(surface.cardBody, styles.totals)}>
              <div><span>Items</span><span>{formatCurrency(record.subtotal)}</span></div>
              {record.discount_amount > 0 && <div><span>Discount</span><span>−{formatCurrency(record.discount_amount)}</span></div>}
              {record.cgst_amount > 0 && <div><span>CGST</span><span>{formatCurrency(record.cgst_amount)}</span></div>}
              {record.sgst_amount > 0 && <div><span>SGST</span><span>{formatCurrency(record.sgst_amount)}</span></div>}
              {record.igst_amount > 0 && <div><span>IGST</span><span>{formatCurrency(record.igst_amount)}</span></div>}
              {(record.cess_amount ?? 0) > 0 && <div><span>Cess</span><span>{formatCurrency(record.cess_amount ?? 0)}</span></div>}
              {record.round_off !== 0 && <div><span>Round-off</span><span>{formatCurrency(record.round_off)}</span></div>}
              <div className={styles.grand}><span>Total</span><span data-pos-total>{formatCurrency(record.total)}</span></div>
            </div>
          </section>

          <section className={surface.card} aria-label="Payment">
            <div className={cn(surface.cardBody, styles.stack)}>
              {(['Cash', 'UPI', 'Card'] as TenderMethod[]).map((m) => (
                <div key={m} className={styles.tender}>
                  <label htmlFor={`pos-${m}`} className={styles.tenderLabel}>{m} <kbd className={styles.kbd}>{m === 'Cash' ? 'F4' : m === 'UPI' ? 'F6' : 'F7'}</kbd></label>
                  <NumberInput id={`pos-${m}`} className={cn(controls.input, controls.inputNumeric)} value={tender[m]} onChange={(v) => setTender((t) => ({ ...t, [m]: v }))} placeholder="0" />
                  <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => fill(m)}>Rest</button>
                </div>
              ))}
              {tender.UPI > 0 && <input className={controls.input} value={upiRef} onChange={(e) => setUpiRef(e.target.value)} placeholder="UPI reference / UTR (optional)" aria-label="UPI reference" />}
              {(tender.UPI > 0 || tender.Card > 0) && (
                <BankAccountSelect id="pos-bank" label="Received into" method={tender.UPI > 0 ? 'UPI' : 'Card'} value={bankId} onChange={setBankId} />
              )}
              <div className={styles.changeRow}>
                {summary.change > 0 ? (
                  <><span>Change to give</span><strong data-pos-change>{formatCurrency(summary.change)}</strong></>
                ) : summary.due > 0 && record.total > 0 ? (
                  <><span>{party.client ? 'Left on account' : 'Still to pay'}</span><strong className={styles.due}>{formatCurrency(summary.due)}</strong></>
                ) : (
                  <><span>Paid in full</span><strong>{formatCurrency(summary.tendered)}</strong></>
                )}
              </div>
              {errors.length > 0 && (
                <ul className={styles.errors} role="alert">
                  {errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              )}
              <button type="button" className={cn(controls.btnPrimary, controls.btnLg, controls.btnBlock)} onClick={() => save()} disabled={items.length === 0}>
                <Save size={18} /> Save bill <kbd className={styles.kbdOn}>F9</kbd>
              </button>
              <label className={controls.check}>
                <input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} /> Print the 80 mm bill after saving
              </label>
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={reset}>New bill (F8)</button>
            </div>
          </section>

          <details className={styles.keys}>
            <summary><Keyboard size={14} aria-hidden="true" /> Keyboard shortcuts</summary>
            <ul>
              {POS_SHORTCUTS.map((s) => <li key={s.keys}><kbd className={styles.kbd}>{s.keys}</kbd> {s.label}</li>)}
              <li><kbd className={styles.kbd}>Ctrl</kbd>+<kbd className={styles.kbd}>Enter</kbd> Save</li>
              <li><kbd className={styles.kbd}>↑</kbd>/<kbd className={styles.kbd}>↓</kbd> pick a search result, <kbd className={styles.kbd}>Enter</kbd> adds it</li>
            </ul>
            <p className={styles.muted}>
              Bills are saved as normal invoices (see <Link to="/transactions">Invoices</Link>), numbered in the {docLabel} series and paid by the tenders above.
            </p>
          </details>
        </aside>
      </div>

      {toastNode}
      <ConfirmDialog
        open={!!expiredAsk}
        destructive
        title="Sell an expired batch?"
        message={`${expiredAsk?.join(' ') ?? ''} Selling expired goods is usually not allowed.`}
        confirmLabel="Sell anyway"
        cancelLabel="Go back"
        onClose={() => setExpiredAsk(null)}
        onConfirm={() => {
          setExpiredAsk(null);
          save(true);
        }}
      />
      {zOpen && (
        <Suspense fallback={null}>
          <ZReportModal open={zOpen} onClose={() => setZOpen(false)} notify={notify} />
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
