import { useMemo, useState } from 'react';
import { Package, Pencil, Percent, Plus, Search, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
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
import { cn, formatCurrency } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './CatalogPanel.module.css';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

const BLANK: CatalogDraft = { name: '', type: 'Service', hsn: '', unit: 'NOS', rate: 0, tax_rate: 18 };

const toDraft = (i: InvoiceItem): CatalogDraft => ({
  id: i.id,
  name: i.name ?? '',
  type: i.type || 'Service',
  hsn: i.hsn ?? '',
  unit: i.unit || 'NOS',
  rate: i.rate ?? 0,
  tax_rate: typeof i.tax_rate === 'number' ? i.tax_rate : 18,
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => listCatalog(), [version]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? items.filter((i) => i.name?.toLowerCase().includes(q) || i.hsn?.toLowerCase().includes(q)) : items;
    return [...list].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [items, query]);

  const reload = () => setVersion((v) => v + 1);
  const allShownSelected = filtered.length > 0 && filtered.every((i) => selected.has(i.id));

  const save = () => {
    if (!draft) return;
    const result = saveCatalogItem(draft);
    if (!result.ok) return setError(result.error);
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
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setRevise(true)} disabled={items.length === 0}>
            <Percent size={14} /> Revise rates
          </button>
          <button
            type="button"
            className={cn(controls.btnPrimary, controls.btnSm)}
            onClick={() => {
              setDraft({ ...BLANK });
              setError(null);
            }}
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
                      <div className={styles.sub}>{i.type || 'Service'}</div>
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
                          onClick={() => {
                            setDraft(toDraft(i));
                            setError(null);
                          }}
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
