import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, Copy, Library, Plus, Trash2 } from 'lucide-react';
import { NumberInput } from '../ui/NumberInput';
import { Typeahead } from '../ui/Typeahead';
import { localDb } from '../../lib/localDb';
import { makeSuggester } from '../../lib/suggest';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { type InvoiceItem } from '../../types/invoice';
import { gstRateOptions } from '../../lib/tax-rules';
import { edT } from '../../i18n/areas/editor';
import { liveUnits } from '../../lib/units-live';
import { lineFactor, lineUnitPatch } from '../../lib/units';
import { unitT } from '../../i18n/areas/units';
import { cn, formatCurrency } from '../../lib/utils';
import { lineKeyAction, shortCodeFirst } from './line-keys';
import { CostCentreSelect } from '../cost-centres/CostCentreSelect';
import { useCostCentres } from '../cost-centres/useCostCentres';
import { LineTracking } from './LineTracking';
import { editorStockContext } from '../../lib/stock-tracking';
import { saltIndex, saltOf } from '../../lib/salt-search'; // 8.84 substitutes
import { DB_PREFIX, KEYS, SINGLETON_KEYS, getTable, listKeys, readRaw } from '../../lib/storage';
import { afterLineChange, pickCatalogItem, setLineQuantity, setLineRate } from './pricing-actions';
import { tNodes, useT } from '../../i18n';
import '../../i18n/en-pages'; // page strings (5.4)
import controls from '../../styles/controls.module.css';
import { QuoteLineFlags } from './QuoteLineFlags';
import flagStyles from './QuoteLineFlags.module.css';
import { isExcludedLine } from '../../lib/invoice-calc';
import { lineValue } from '../../lib/proposal-sections';
import { s2T } from '../../i18n/areas/sales-r2';

// R2-B3: proposal sections editor, quotations only (lazy).
const ProposalSectionsCard = lazy(() => import('./ProposalSectionsCard').then((m) => ({ default: m.ProposalSectionsCard })));
// R8-C (TR-C1): agency lot picker on sales lines (agency pack only, lazy).
const LotPicker = lazy(() => import('../trade/LotPicker'));
// R8-A (TR-A1): compound / per-unit discount sub-row (Trade discounts setting or distributor / commodity pack, lazy).
const LineDiscountCell = lazy(() => import('../trade/LineDiscountCell'));
// R8-B (TR-B1): bags / weight sub-row (commodity / agency pack only, lazy).
const LineWeightRow = lazy(() => import('../trade/tr-b-hub').then((m) => ({ default: m.LineWeightRow })));
// R9 (RT-C1 / C2): price-band chip per line, band hook + size grid (apparel pack, or a document with band lines; lazy).
const BandChip = lazy(() => import('../retail-r9/ApparelDesk').then((m) => ({ default: m.BandChip })));
const EditorApparel = lazy(() => import('../retail-r9/ApparelDesk').then((m) => ({ default: m.EditorApparel })));
const EditorDevices = lazy(() => import('../retail-r9/DevicesDesk').then((m) => ({ default: m.EditorDevices }))); // R9 (RT-D1/D3)
import { impliedPacks } from '../../lib/shop-mode';
import styles from './ItemsTable.module.css';

export function ItemsTable({ onPickCatalog }: { onPickCatalog: (itemId: string) => void }) {
  const { t } = useT();
  const items = useInvoiceStore((s) => s.items);
  const totals = useInvoiceStore((s) => s.totals);
  const gstMode = useInvoiceStore((s) => s.gst_mode);
  const currency = useInvoiceStore((s) => s.currency);
  const docType = useInvoiceStore((s) => s.doc_type);
  const docId = useInvoiceStore((s) => s.id);
  const issueDate = useInvoiceStore((s) => s.issue_date);
  const docStatus = useInvoiceStore((s) => s.status);
  const agencyOn = useMemo(() => impliedPacks(localDb.settings.get()).includes('agency'), []); // R8-C
  const tradeOn = useMemo(() => ((s) => !!s.trade_discounts || impliedPacks(s).some((p) => p === 'distributor' || p === 'commodity'))(localDb.settings.get()), []); // R8-A
  const weighOn = useMemo(() => impliedPacks(localDb.settings.get()).some((p) => p === 'commodity' || p === 'agency'), []); // R8-B
  const apparelOn = useMemo(() => impliedPacks(localDb.settings.get()).includes('apparel'), []); // R9 (RT-C)
  const devicesOn = useMemo(() => impliedPacks(localDb.settings.get()).includes('electronics'), []); // R9 (RT-D)
  // Batch / serial / godown pickers (null for simple users: nothing tracked, one godown).
  // `stockTick` re-reads live stock when an item name gains focus (another tab may have sold some).
  const [stockTick, setStockTick] = useState(0);
  const stockCtx = useMemo(
    () => editorStockContext({ id: docId, doc_type: docType, issue_date: issueDate, status: docStatus }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, docType, issueDate, docStatus, stockTick],
  );
  // Units master + alternate units (WP-8), re-read with the stock context (on name focus), never per keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const units = useMemo(() => liveUnits(), [stockTick]);
  const { addItem, updateItem, patchItem, duplicateItem, moveItem, removeItem } = useInvoiceStore.getState();
  // Catalogue snapshot, refreshed whenever an item name gains focus.
  const [catalog, setCatalog] = useState<InvoiceItem[]>([]);
  // 8.84: salt / composition of stock items, re-read with the catalogue (typing a salt lists its substitutes).
  const salts = useMemo(() => saltIndex(getTable<{ name: string; salt?: string }>('stock_items')), [catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  // PERF-2: the catalogue is folded once per snapshot (not per keystroke).
  const itemSuggester = useMemo(
    () =>
      makeSuggester(catalog, {
        label: (i) => i.name,
        extra: (i) => [i.hsn, i.short_code, saltOf(salts, i.name)],
        sub: (i) => [i.hsn && `HSN ${i.hsn}`, saltOf(salts, i.name), formatCurrency(i.rate, currency)].filter(Boolean).join(' · '),
      }),
    [catalog, currency, salts],
  );
  const itemSuggestions = useCallback((q: string) => shortCodeFirst(q, catalog, itemSuggester(q)), [catalog, itemSuggester]);
  // PERF-2: name focus re-reads the catalogue and live stock only when stored data (or the day) changed since
  // the last read: another tab's sale still shows, but tabbing through ten lines no longer recomputes stock ten times.
  const catalogRaw = useRef<string | null | undefined>(undefined);
  const stockStamp = useRef<(string | null)[] | null>(null);
  const refreshOnNameFocus = () => {
    const raw = readRaw(DB_PREFIX + KEYS.items);
    if (raw !== catalogRaw.current) {
      catalogRaw.current = raw;
      setCatalog(localDb.items.getAll());
    }
    // The working draft (autosaved while typing) is not a stock input.
    const keys = listKeys(DB_PREFIX).filter((k) => k !== SINGLETON_KEYS.draft).sort();
    const stamp: (string | null)[] = [new Date().toDateString(), ...keys, ...keys.map((k) => readRaw(k))];
    const prev = stockStamp.current;
    if (prev && prev.length === stamp.length && prev.every((v, i) => v === stamp[i])) return;
    stockStamp.current = stamp;
    setStockTick((t) => t + 1);
  };
  const [cessOpen, setCessOpen] = useState<Record<string, boolean>>({});
  const centres = useCostCentres();
  // A Bill of Supply charges no GST: the rate / cess columns are hidden (Rule 49).
  const showTax = gstMode !== 'NONE' && docType !== 'BILL_OF_SUPPLY';
  const priced = docType !== 'DELIVERY_CHALLAN';
  const wrapRef = useRef<HTMLDivElement>(null);
  // Where focus should land after the next render (a new line, or a line that just moved).
  const focusReq = useRef<{ id?: string; index?: number; field: string } | null>(null);

  useEffect(() => {
    const req = focusReq.current;
    if (!req) return;
    focusReq.current = null;
    const rows = Array.from(wrapRef.current?.querySelectorAll<HTMLElement>('[data-line]') ?? []);
    const row = req.id ? rows.find((r) => r.dataset.line === req.id) : rows[req.index ?? rows.length - 1];
    row?.querySelector<HTMLElement>(`[data-field="${req.field}"]`)?.focus();
  }, [items]);

  const onRowKeyDown = (e: KeyboardEvent<HTMLDivElement>, id: string, index: number) => {
    const target = e.target as HTMLElement;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;
    const fields = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input, select')).filter(
      (el) => !(el as HTMLInputElement).disabled,
    );
    const action = lineKeyAction(e, { isLastCell: fields[fields.length - 1] === target, isLastLine: index === items.length - 1 });
    if (!action) return;
    e.preventDefault();
    if (action.type === 'move') {
      focusReq.current = { id, field: target.dataset.field ?? 'name' };
      moveItem(id, action.direction);
    } else if (action.type === 'add-line') {
      focusReq.current = { field: 'name' };
      addItem();
    } else {
      const rows = wrapRef.current?.querySelectorAll<HTMLElement>('[data-line]');
      rows?.[index + 1]?.querySelector<HTMLElement>('[data-field="name"]')?.focus();
    }
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <div className={cn(styles.row, styles.head)} aria-hidden="true">
        <span>{t('items.colItem')}</span>
        <span>{t('items.colHsn')}</span>
        <span className={styles.r}>{t('items.colQty')}</span>
        <span>{t('items.colUnit')}</span>
        {priced && <span className={styles.r}>{t('items.colRate')}</span>}
        {priced && <span className={styles.r}>{t('items.colDisc')}</span>}
        {priced && showTax && <span className={styles.r}>{t('items.colGst')}</span>}
        {priced && <span className={styles.r}>{t('items.colAmount')}</span>}
        <span />
      </div>

      {items.map((item, index) => {
        const line = totals.lines.find((l) => l.id === item.id);
        const amount = line ? line.gross - line.line_discount : 0;
        return (
          <div key={item.id} data-line={item.id} className={cn(styles.row, styles.body)} onKeyDown={(e) => onRowKeyDown(e, item.id, index)}>
            <div className={cn(styles.cell, styles.cName)} data-label={t('items.colItem')}>
              <div className={styles.nameWrap}>
                <Typeahead
                  className={controls.ghost}
                  data-field="name"
                  value={item.name}
                  onChange={(name) => updateItem(item.id, 'name', name)}
                  onFocus={refreshOnNameFocus}
                  getSuggestions={itemSuggestions}
                  onBlur={afterLineChange}
                  onPick={(c) => pickCatalogItem(item.id, c)}
                  placeholder={t('items.itemPh', { n: index + 1 })}
                  aria-label={t('items.itemName', { n: index + 1 })}
                />
                <button type="button" className={styles.catalogBtn} onClick={() => onPickCatalog(item.id)} title={t('items.pickCatalog')} aria-label={t('items.pickCatalog')}>
                  <Library size={15} />
                </button>
              </div>
              <input
                className={cn(controls.ghost, styles.desc)}
                data-field="description"
                value={item.description ?? ''}
                onChange={(e) => updateItem(item.id, 'description', e.target.value)}
                placeholder={t('items.descPh')}
                aria-label={t('items.itemDesc', { n: index + 1 })}
              />
              {item.price_basis || item.free_of ? (
                <div className={styles.customLine} title={item.free_of ? 'Free under a scheme' : 'Rate set by the price level / quantity slab — type a rate to override'}>
                  {item.free_of ? 'Free (scheme)' : `${item.price_basis} price`}
                </div>
              ) : null}
              {item.custom_values?.length ? (
                <div className={styles.customLine} title="Item details from the catalogue">
                  {item.custom_values.map((v) => `${v.label}: ${v.value}`).join(' · ')}
                </div>
              ) : null}
              {stockCtx && <LineTracking item={item} index={index} ctx={stockCtx} />}
              {/* QA8 T16: a saved line that carries the snapshot keeps its reconciler even with the pack off. */}
              {(tradeOn || !!item.disc_chain?.length || !!item.disc_per_unit) && priced && <Suspense fallback={null}><LineDiscountCell item={item} index={index} /></Suspense>}
              {(weighOn || !!item.wt) && <Suspense fallback={null}><LineWeightRow item={item} index={index} /></Suspense>}
              {item.band_rate && <Suspense fallback={null}><BandChip item={item} date={issueDate} /></Suspense>}
              {agencyOn && (docType === 'INVOICE' || docType === 'TAX_INVOICE' || docType === 'BILL_OF_SUPPLY') && <Suspense fallback={null}><LotPicker item={item} index={index} /></Suspense>}
              {docType === 'QUOTATION' && <QuoteLineFlags item={item} index={index} />}
              {showTax && priced && !(item.cess_rate || item.cess_per_unit || cessOpen[item.id]) && (
                <button type="button" className={styles.cessToggle} onClick={() => setCessOpen((o) => ({ ...o, [item.id]: true }))}>
                  + {edT('addCess')}
                </button>
              )}
              {showTax && priced && (item.cess_rate || item.cess_per_unit || cessOpen[item.id]) ? (
                <div className={styles.cessRow}>
                  <span>Cess %</span>
                  <NumberInput className={styles.cessInput} value={item.cess_rate ?? 0} onChange={(n) => updateItem(item.id, 'cess_rate', n)} placeholder="0" aria-label={`Item ${index + 1} cess percent`} />
                  <span>+ per unit</span>
                  <NumberInput className={styles.cessInput} value={item.cess_per_unit ?? 0} onChange={(n) => updateItem(item.id, 'cess_per_unit', n)} placeholder="0" aria-label={`Item ${index + 1} cess per unit`} />
                </div>
              ) : null}
              {priced && (
                <CostCentreSelect
                  id={`line-cc-${item.id}`}
                  className={cn(controls.ghost, styles.desc)}
                  centres={centres}
                  value={item.cost_centre_id}
                  onChange={(v) => updateItem(item.id, 'cost_centre_id', v ?? '')}
                  emptyLabel="Cost centre: same as document"
                  ariaLabel={`Item ${index + 1} cost centre`}
                />
              )}
            </div>

            <div className={styles.cell} data-label={t('items.colHsn')}>
              <input
                className={cn(controls.ghost, styles.mono)}
                data-field="hsn"
                value={item.hsn ?? ''}
                inputMode="numeric"
                maxLength={8}
                onChange={(e) => updateItem(item.id, 'hsn', e.target.value.replace(/\D/g, ''))}
                placeholder="—"
                aria-label={t('items.itemHsn', { n: index + 1 })}
              />
            </div>

            <div className={styles.cell} data-label={t('items.colQty')}>
              <NumberInput className={controls.ghostNumeric} data-field="quantity" value={item.quantity} blankZero={false} onChange={(n) => setLineQuantity(item.id, n)} aria-label={t('items.itemQty', { n: index + 1 })} />
            </div>

            <div className={styles.cell} data-label={t('items.colUnit')}>
              {(() => {
                // An item with alternate units offers its own units; the factor is snapshotted on the line.
                const alt = units.pick?.find(item.name, item.hsn);
                const current = item.unit || 'NOS';
                const options = alt ? alt.choices.map((c) => c.unit) : units.symbols;
                const list = options.some((u) => u.toUpperCase() === current.toUpperCase()) ? options : [...options, current];
                const f = lineFactor(item);
                return (
                  <>
                    <select
                      className={cn(controls.ghost, styles.unit)} data-field="unit" value={current}
                      onChange={(e) => (alt ? patchItem(item.id, lineUnitPatch(alt.item, item, e.target.value)) : item.unit_factor ? patchItem(item.id, { unit: e.target.value, unit_factor: undefined }) : updateItem(item.id, 'unit', e.target.value))}
                      aria-label={t('items.itemUnit', { n: index + 1 })}
                    >
                      {list.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                    {f !== 1 && alt && <span className={styles.unitHint}>{unitT('equals', { qty: Math.round(item.quantity * f * 1000) / 1000, unit: alt.item.unit })}</span>}
                  </>
                );
              })()}
            </div>

            {priced && (
              <div className={styles.cell} data-label={t('items.colRate')}>
                <NumberInput className={controls.ghostNumeric} data-field="rate" value={item.rate} onChange={(n) => setLineRate(item.id, n)} placeholder="0.00" aria-label={t('items.itemRate', { n: index + 1 })} />
              </div>
            )}

            {priced && (
              <div className={styles.cell} data-label={t('items.colDisc')}>
                <NumberInput className={controls.ghostNumeric} data-field="discount" value={item.discount_percent ?? 0} onChange={(n) => updateItem(item.id, 'discount_percent', Math.min(n, 100))} placeholder="0" aria-label={t('items.itemDisc', { n: index + 1 })} />
              </div>
            )}

            {priced && showTax && (
              <div className={styles.cell} data-label={t('items.colGst')}>
                <select
                  className={cn(controls.ghost, styles.rate)}
                  data-field="gst"
                  value={item.tax_rate ?? 0}
                  onChange={(e) => updateItem(item.id, 'tax_rate', Number(e.target.value))}
                  aria-label={t('items.itemGst', { n: index + 1 })}
                >
                  {gstRateOptions(issueDate, item.tax_rate).map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </select>
              </div>
            )}

            {priced && (
              <div className={cn(styles.cell, styles.amount)} data-label={t('items.colAmount')}>
                {isExcludedLine(item) ? (
                  // R2-B3: an unselected optional / alternative line — shown, but outside the total.
                  <span className={flagStyles.excluded} title={s2T('q.optionalAmount')}>{formatCurrency(lineValue(item), currency)}</span>
                ) : formatCurrency(amount, currency)}
              </div>
            )}

            <div className={cn(styles.cell, styles.actions)}>
              <button type="button" className={controls.btnIcon} onClick={() => moveItem(item.id, -1)} disabled={index === 0} aria-label={t('items.moveUp')}>
                <ArrowUp size={14} />
              </button>
              <button type="button" className={controls.btnIcon} onClick={() => moveItem(item.id, 1)} disabled={index === items.length - 1} aria-label={t('items.moveDown')}>
                <ArrowDown size={14} />
              </button>
              <button type="button" className={controls.btnIcon} onClick={() => duplicateItem(item.id)} aria-label={t('items.duplicate')}>
                <Copy size={14} />
              </button>
              <button type="button" className={controls.btnDanger} onClick={() => { removeItem(item.id); afterLineChange(); }} aria-label={t('items.remove')}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}

      <div className={styles.footer}>
        <button type="button" className={controls.btnOutline} onClick={addItem}>
          <Plus size={16} /> {t('items.addLine')}
        </button>
        {(apparelOn || items.some((i) => i.band_rate)) && <Suspense fallback={null}><EditorApparel gridOn={apparelOn && priced} /></Suspense>}
        {devicesOn && priced && <Suspense fallback={null}><EditorDevices /></Suspense>}
        <span className={styles.keyHint}>
          {tNodes('items.keyHint', { enter: <kbd>Enter</kbd>, alt: <kbd>Alt</kbd>, arrows: <><kbd>↑</kbd>/<kbd>↓</kbd></>, ctrl: <kbd>Ctrl</kbd> })}
        </span>
      </div>
      {docType === 'QUOTATION' && (
        <Suspense fallback={null}>
          <ProposalSectionsCard />
        </Suspense>
      )}
    </div>
  );
}
