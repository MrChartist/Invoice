import { lazy, Suspense, useMemo, useState } from 'react';
import { Barcode, Package, Pencil, Percent, Plus, Search, Trash2, X } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { CustomFieldInputs } from '../custom-fields/CustomFieldInputs';
import { cleanValueMap, customFieldsDb } from '../../lib/custom-fields';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { EmptyState } from '../ui/EmptyState';
import { NumberInput } from '../ui/NumberInput';
import {
  adjustCatalogRates,
  listCatalog,
  removeCatalogItem,
  saveCatalogItem,
  type CatalogDraft,
  type CatalogError,
  type RoundTo,
} from '../../lib/catalog';
import { GST_SLABS, UNITS, type InvoiceItem } from '../../types/invoice';
import { nextInStoreEan } from '../../lib/barcode';
import { levelRate, priceLevelsDb } from '../../lib/pricing';
import { getTable } from '../../lib/storage';
import { TABLES, type StockItem } from '../../lib/inventory';
import { cn, formatCurrency } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './CatalogPanel.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

// The label sheet (encoders + print HTML) loads only when opened.
const LabelSheetModal = lazy(() => import('./LabelSheetModal').then((m) => ({ default: m.LabelSheetModal })));

const BLANK: CatalogDraft = { name: '', type: 'Service', hsn: '', unit: 'NOS', rate: 0, tax_rate: 18, barcode: '', sku: '', mrp: 0, qty_slabs: [] };

const toDraft = (i: InvoiceItem): CatalogDraft => ({
  id: i.id,
  name: i.name ?? '',
  type: i.type || 'Service',
  hsn: i.hsn ?? '',
  unit: i.unit || 'NOS',
  rate: i.rate ?? 0,
  tax_rate: typeof i.tax_rate === 'number' ? i.tax_rate : 18,
  custom_fields: i.custom_fields,
  barcode: i.barcode ?? '',
  sku: i.sku ?? '',
  mrp: i.mrp ?? 0,
  qty_slabs: i.qty_slabs ?? [],
});

const ROUND_LABELS: Record<RoundTo, string> = {
  paise: 'Nearest paisa',
  rupee: 'Nearest rupee',
  five: 'Nearest ₹5',
  ten: 'Nearest ₹10',
};

/** Add, edit, remove and bulk-revise the saved items (default rate, HSN/SAC, unit, GST). */
export function CatalogPanel({ notify }: { notify: Notify }) {
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<CatalogDraft | null>(null);
  const [error, setError] = useState<CatalogError | null>(null);
  const [removing, setRemoving] = useState<InvoiceItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [revise, setRevise] = useState(false);
  const [percent, setPercent] = useState(10);
  const [roundMode, setRoundMode] = useState<RoundTo>('rupee');
  const [labels, setLabels] = useState(false);
  // Per-level own rates being edited for the open item (level id → text; blank = use the level's % off).
  const [levelRates, setLevelRates] = useState<Record<string, string>>({});
  const [levels, setLevels] = useState(() => priceLevelsDb.all());

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => listCatalog(), [version]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? items.filter((i) => i.name?.toLowerCase().includes(q) || i.hsn?.toLowerCase().includes(q)) : items;
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [items, query]);

  const reload = () => setVersion((v) => v + 1);
  const allShownSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  const openDraft = (d: CatalogDraft) => {
    setDraft(d);
    setError(null);
    const all = priceLevelsDb.all();
    setLevels(all);
    const own: Record<string, string> = {};
    for (const l of all) {
      const r = d.id ? l.rates?.[d.id] : undefined;
      own[l.id] = typeof r === 'number' ? String(r) : '';
    }
    setLevelRates(own);
  };

  const generateBarcode = () => {
    if (!draft) return;
    const taken = new Set<string>([
      ...items.map((i) => i.barcode ?? ''),
      ...getTable<StockItem>(TABLES.items).map((i) => i.barcode ?? ''),
    ]);
    setDraft({ ...draft, barcode: nextInStoreEan(taken, items.length + 1) });
  };

  const save = () => {
    if (!draft) return;
    const result = saveCatalogItem({ ...draft, custom_fields: cleanValueMap(draft.custom_fields, customFieldsDb.all()) });
    if (!result.ok) return setError(result.error);
    for (const l of levels) {
      const text = (levelRates[l.id] ?? '').trim();
      const n = text === '' ? undefined : Number(text);
      if (l.rates?.[result.item.id] !== n) priceLevelsDb.setItemRate(l.id, result.item.id, n);
    }
    notify(draft.id ? `${result.item.name} updated` : `${result.item.name} added`);
    setDraft(null);
    setError(null);
    reload();
  };

  const applyRevision = () => {
    const ids = selected.size > 0 ? selected : ('all' as const);
    const changed = adjustCatalogRates(ids, percent, roundMode);
    notify(changed ? `Updated the rate of ${changed} item${changed === 1 ? '' : 's'}` : 'No rates changed', changed ? 'success' : 'info');
    setRevise(false);
    reload();
  };

  const fieldError = (field: CatalogError['field']) => (error?.field === field ? error.message : null);

  return (
    <section className={surface.card}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}>
          <Package size={16} /> Items &amp; default rates
        </span>
        <div className={surface.pageActions}>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setLabels(true)} disabled={items.length === 0}>
            <Barcode size={14} /> Print labels
          </button>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setRevise(true)} disabled={items.length === 0}>
            <Percent size={14} /> Revise rates
          </button>
          <button
            type="button"
            className={cn(controls.btnPrimary, controls.btnSm)}
            onClick={() => openDraft({ ...BLANK })}
          >
            <Plus size={14} /> Add item
          </button>
        </div>
      </div>

      <p className={cn(surface.sectionNote, styles.note)}>
        These are the rates the invoice editor pre-fills when you pick an item. Changing one here does not touch invoices you have already issued.
      </p>

      {items.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No saved items yet"
          text="Add the services or products you bill most often, with their rate and GST. Items you use on a saved invoice are also remembered here."
        />
      ) : (
        <>
          <div className={styles.toolbar}>
            <label className={styles.search}>
              <Search size={15} />
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or HSN / SAC" aria-label="Search items" />
            </label>
            {selected.size > 0 && <span className={styles.selCount}>{selected.size} selected</span>}
          </div>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input
                      type="checkbox"
                      checked={allShownSelected}
                      onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map((i) => i.id)) : new Set())}
                      aria-label="Select all shown items"
                    />
                  </th>
                  <th>Item</th>
                  <th>HSN / SAC</th>
                  <th>Unit</th>
                  <th className={surface.numeric}>GST</th>
                  <th className={surface.numeric}>Default rate</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(i.id)}
                        onChange={(e) =>
                          setSelected((s) => {
                            const next = new Set(s);
                            if (e.target.checked) next.add(i.id);
                            else next.delete(i.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${i.name}`}
                      />
                    </td>
                    <td>
                      <div className={styles.name}>{i.name}</div>
                      <div className={styles.sub}>
                        {[i.type || 'Service', i.sku && `SKU ${i.sku}`, i.barcode && `Barcode ${i.barcode}`, i.qty_slabs?.length ? `${i.qty_slabs.length} qty slab${i.qty_slabs.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className={surface.mono}>{i.hsn || '—'}</td>
                    <td>{i.unit || '—'}</td>
                    <td className={surface.numeric}>{typeof i.tax_rate === 'number' ? `${i.tax_rate}%` : '—'}</td>
                    <td className={surface.numeric}>{formatCurrency(i.rate ?? 0)}</td>
                    <td>
                      <div className={surface.rowActions}>
                        <button
                          type="button"
                          className={controls.btnIcon}
                          aria-label={`Edit ${i.name}`}
                          title="Edit"
                          onClick={() => openDraft(toDraft(i))}
                        >
                          <Pencil size={16} />
                        </button>
                        <button type="button" className={controls.btnDanger} aria-label={`Remove ${i.name}`} title="Remove" onClick={() => setRemoving(i)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal
        open={!!draft}
        onClose={() => setDraft(null)}
        size="md"
        title={draft?.id ? 'Edit item' : 'Add item'}
        subtitle="Used to pre-fill new invoice lines"
        footer={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="submit" form="catalog-form" className={controls.btnPrimary}>
              {draft?.id ? 'Save changes' : 'Add item'}
            </button>
          </>
        }
      >
        {draft && (
          <form
            id="catalog-form"
            noValidate
            className={styles.form}
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label className={controls.field}>
              <span className={controls.label}>Name *</span>
              <input
                className={cn(controls.input, fieldError('name') && controls.inputInvalid)}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                autoFocus
                aria-invalid={!!fieldError('name')}
              />
              {fieldError('name') && <span className={controls.error}>{fieldError('name')}</span>}
            </label>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>Type</span>
                <select className={controls.select} value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                  <option>Service</option>
                  <option>Product</option>
                </select>
              </label>
              <label className={controls.field}>
                <span className={controls.label}>HSN / SAC</span>
                <input
                  className={cn(controls.input, controls.inputMono, fieldError('hsn') && controls.inputInvalid)}
                  value={draft.hsn}
                  inputMode="numeric"
                  maxLength={8}
                  onChange={(e) => setDraft({ ...draft, hsn: e.target.value.replace(/\D/g, '') })}
                  placeholder="998399"
                />
                {fieldError('hsn') && <span className={controls.error}>{fieldError('hsn')}</span>}
              </label>
            </div>
            <div className={controls.row3}>
              <label className={controls.field}>
                <span className={controls.label}>Default rate (₹)</span>
                <NumberInput
                  className={cn(controls.input, controls.inputNumeric, fieldError('rate') && controls.inputInvalid)}
                  value={draft.rate}
                  onChange={(n) => setDraft({ ...draft, rate: n })}
                  placeholder="0.00"
                />
                {fieldError('rate') && <span className={controls.error}>{fieldError('rate')}</span>}
              </label>
              <label className={controls.field}>
                <span className={controls.label}>GST rate</span>
                <select className={controls.select} value={draft.tax_rate} onChange={(e) => setDraft({ ...draft, tax_rate: Number(e.target.value) })}>
                  {GST_SLABS.map((r) => (
                    <option key={r} value={r}>
                      {r}%
                    </option>
                  ))}
                </select>
              </label>
              <label className={controls.field}>
                <span className={controls.label}>Unit</span>
                <select className={controls.select} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
                  {UNITS.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className={controls.row3}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="catalog-barcode">Barcode</label>
                <div className={styles.inline}>
                  <input
                    id="catalog-barcode"
                    className={cn(controls.input, controls.inputMono, fieldError('barcode') && controls.inputInvalid)}
                    value={draft.barcode ?? ''}
                    onChange={(e) => setDraft({ ...draft, barcode: e.target.value })}
                    placeholder="Scan or type"
                    aria-invalid={!!fieldError('barcode')}
                  />
                  {!draft.barcode && (
                    <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={generateBarcode} title="Assign an in-store EAN-13 (starts with 2)">
                      New
                    </button>
                  )}
                </div>
                {fieldError('barcode') && <span className={controls.error}>{fieldError('barcode')}</span>}
              </div>
              <label className={controls.field}>
                <span className={controls.label}>SKU / item code</span>
                <input
                  className={cn(controls.input, controls.inputMono, fieldError('sku') && controls.inputInvalid)}
                  value={draft.sku ?? ''}
                  onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                  aria-invalid={!!fieldError('sku')}
                />
                {fieldError('sku') && <span className={controls.error}>{fieldError('sku')}</span>}
              </label>
              <label className={controls.field}>
                <span className={controls.label}>MRP (₹)</span>
                <NumberInput className={cn(controls.input, controls.inputNumeric)} value={draft.mrp ?? 0} onChange={(n) => setDraft({ ...draft, mrp: n })} placeholder="For labels" />
              </label>
            </div>

            <fieldset className={styles.group}>
              <legend className={controls.label}>Quantity slabs (optional)</legend>
              {(draft.qty_slabs ?? []).map((slab, n) => (
                <div key={n} className={styles.inline}>
                  <span className={styles.sub}>Qty ≥</span>
                  <NumberInput
                    className={cn(controls.input, controls.inputNumeric, styles.small)}
                    value={slab.min_qty}
                    onChange={(v) => setDraft({ ...draft, qty_slabs: (draft.qty_slabs ?? []).map((x, k) => (k === n ? { ...x, min_qty: v } : x)) })}
                    aria-label={`Slab ${n + 1} minimum quantity`}
                  />
                  <span className={styles.sub}>rate ₹</span>
                  <NumberInput
                    className={cn(controls.input, controls.inputNumeric, styles.small)}
                    value={slab.rate}
                    onChange={(v) => setDraft({ ...draft, qty_slabs: (draft.qty_slabs ?? []).map((x, k) => (k === n ? { ...x, rate: v } : x)) })}
                    aria-label={`Slab ${n + 1} rate`}
                  />
                  <button type="button" className={controls.btnIcon} aria-label={`Remove slab ${n + 1}`} onClick={() => setDraft({ ...draft, qty_slabs: (draft.qty_slabs ?? []).filter((_, k) => k !== n) })}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setDraft({ ...draft, qty_slabs: [...(draft.qty_slabs ?? []), { min_qty: 0, rate: draft.rate }] })}>
                <Plus size={14} /> Add slab
              </button>
              <span className={controls.hint}>A line of at least that quantity gets the slab rate (the lower of a party&apos;s level rate and the slab wins).</span>
            </fieldset>

            {levels.length > 0 && (
              <fieldset className={styles.group}>
                <legend className={controls.label}>Price levels</legend>
                <div className={controls.row3}>
                  {levels.map((l) => {
                    const fromPct = levelRate({ ...l, rates: undefined }, { id: draft.id ?? '', rate: draft.rate });
                    return (
                      <label key={l.id} className={controls.field}>
                        <span className={controls.label}>{l.name} (₹)</span>
                        <input
                          className={cn(controls.input, controls.inputNumeric)}
                          inputMode="decimal"
                          value={levelRates[l.id] ?? ''}
                          onChange={(e) => setLevelRates((r) => ({ ...r, [l.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                          placeholder={fromPct !== undefined ? `${fromPct} (${l.percent_off}% off)` : `${draft.rate} (base)`}
                        />
                      </label>
                    );
                  })}
                </div>
                <span className={controls.hint}>Leave blank to use the level&apos;s % off the default rate.</span>
              </fieldset>
            )}

            <CustomFieldInputs scope="item" idPrefix="catalog" value={draft.custom_fields} onChange={(custom_fields) => setDraft({ ...draft, custom_fields })} />
          </form>
        )}
      </Modal>

      <Modal
        open={revise}
        onClose={() => setRevise(false)}
        size="sm"
        title="Revise default rates"
        subtitle={selected.size > 0 ? `${selected.size} selected item${selected.size === 1 ? '' : 's'}` : `All ${items.length} items`}
        footer={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => setRevise(false)}>
              Cancel
            </button>
            <button type="button" className={controls.btnPrimary} onClick={applyRevision}>
              Apply {percent >= 0 ? '+' : ''}
              {percent}%
            </button>
          </>
        }
      >
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>Change by (%)</span>
            <input
              className={cn(controls.input, controls.inputNumeric)}
              type="number"
              step="0.5"
              value={percent}
              onChange={(e) => setPercent(Number(e.target.value))}
            />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Round to</span>
            <select className={controls.select} value={roundMode} onChange={(e) => setRoundMode(e.target.value as RoundTo)}>
              {(Object.keys(ROUND_LABELS) as RoundTo[]).map((k) => (
                <option key={k} value={k}>
                  {ROUND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className={controls.hint}>
          Use a negative number to lower rates. Free items (rate 0) stay free. Existing invoices are never changed.
        </p>
      </Modal>

      {labels && (
        <Suspense fallback={null}>
          <LabelSheetModal open={labels} onClose={() => setLabels(false)} onChanged={reload} preselected={selected} />
        </Suspense>
      )}

      <ConfirmDialog
        open={!!removing}
        destructive
        title="Remove this item?"
        message={`“${removing?.name ?? ''}” will be removed from your catalogue. Invoices that already use it are not affected.`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (removing) removeCatalogItem(removing.id);
          setSelected((s) => {
            const next = new Set(s);
            if (removing) next.delete(removing.id);
            return next;
          });
          notify('Item removed');
          reload();
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}
