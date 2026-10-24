import { useMemo, useState } from 'react';
import { ClipboardList, FilePlus2, Pencil, Printer, ReceiptText, RotateCcw, Trash2, XCircle } from 'lucide-react';
import type { PurchaseOrder, PurchaseRecord, Vendor } from '../../types/purchases';
import {
  PO_STATES,
  billSeedFromPo,
  poFulfilment,
  poHtml,
  poTone,
  poTotals,
  purchaseOrdersDb,
  validatePo,
  type BillSeed,
  type PoState,
} from '../../lib/purchase-orders';
import { blankPurchaseLine } from '../../lib/purchases';
import { localDb } from '../../lib/localDb';
import { INDIAN_STATES, resolveStateCode } from '../../lib/india-states';
import { downloadText } from '../../lib/download';
import { addDaysInput, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { EmptyState } from '../ui/EmptyState';
import { StatusBadge } from '../ui/StatusBadge';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { VendorPicker } from './VendorPicker';
import { LineItemsEditor } from './LineItemsEditor';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './purchases.module.css';
import tabStyles from './VendorsTab.module.css';

export interface PurchaseOrdersTabProps {
  orders: PurchaseOrder[];
  vendors: Vendor[];
  purchases: PurchaseRecord[];
  businessState: string;
  /** "Convert to bill": open the bill form pre-filled with the pending quantities. */
  onConvert: (seed: BillSeed) => void;
  onVendorCreated: () => void;
  onChanged: (message?: string, tone?: 'error') => void;
}

/** Open a printable PO in its own window (script-free HTML); a blocked pop-up saves it as a file. */
function printPo(po: PurchaseOrder, vendors: Vendor[]) {
  const p = localDb.settings.activeProfile();
  const v = vendors.find((x) => x.id === po.vendor_id);
  const html = poHtml(
    po,
    { name: p?.companyName || 'Buyer', gstin: p?.companyGstin, address: p?.companyAddress, phone: p?.companyPhone, email: p?.companyEmail },
    v ? { address: v.address, phone: v.phone, email: v.email } : undefined,
  );
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  } else {
    downloadText(`${po.po_number.replace(/\//g, '-')}.html`, html, 'text/html');
  }
}

/** Purchase orders: raise, print, receive against bills (pending quantities), close. */
export function PurchaseOrdersTab({ orders, vendors, purchases, businessState, onConvert, onVendorCreated, onChanged }: PurchaseOrdersTabProps) {
  const [stateFilter, setStateFilter] = useState<PoState | ''>('');
  const [editing, setEditing] = useState<PurchaseOrder | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PurchaseOrder | null>(null);

  const rows = useMemo(
    () =>
      orders
        .map((po) => ({ po, f: poFulfilment(po, purchases) }))
        .filter((r) => !stateFilter || r.f.state === stateFilter)
        .sort((a, b) => b.po.date.localeCompare(a.po.date) || b.po.po_number.localeCompare(a.po.po_number)),
    [orders, purchases, stateFilter],
  );

  const convert = (po: PurchaseOrder) => {
    try {
      onConvert(billSeedFromPo(po, purchases));
    } catch (err) {
      onChanged((err as Error).message, 'error');
    }
  };
  const setClosed = (po: PurchaseOrder, closed: boolean) => {
    purchaseOrdersDb.setClosed(po.id, closed ? todayInput() : undefined);
    onChanged(closed ? `${po.po_number} closed` : `${po.po_number} reopened`);
  };
  const remove = (po: PurchaseOrder) => {
    try {
      purchaseOrdersDb.remove(po.id, purchases);
      onChanged(`${po.po_number} deleted`);
    } catch (err) {
      onChanged((err as Error).message, 'error');
    }
  };

  return (
    <section className={surface.card}>
      <div className={styles.poBar}>
        <select className={controls.select} value={stateFilter} onChange={(e) => setStateFilter(e.target.value as PoState | '')} aria-label="Filter purchase orders by status">
          <option value="">All purchase orders</option>
          {PO_STATES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button type="button" className={controls.btnPrimary} onClick={() => setEditing('new')}>
          <FilePlus2 size={16} /> New purchase order
        </button>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No purchase orders yet"
          text="Raise a PO to a supplier, print it, then convert it to a bill as goods arrive — part deliveries are tracked line by line."
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No matches" text="No purchase order has this status." />
      ) : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>PO</th>
                <th>Vendor</th>
                <th>Date</th>
                <th>Status</th>
                <th className={surface.numeric}>Received</th>
                <th className={surface.numeric}>Total</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ po, f }) => {
                const ordered = f.lines.reduce((s, l) => s + l.ordered, 0);
                const received = f.lines.reduce((s, l) => s + Math.min(l.received, l.ordered), 0);
                const open = f.state === 'Open' || f.state === 'Partly received';
                return (
                  <tr key={po.id}>
                    <td>
                      <div className={tabStyles.name}>{po.po_number}</div>
                      {f.bills.length > 0 && <div className={tabStyles.sub}>{f.bills.length} bill{f.bills.length === 1 ? '' : 's'}: {f.bills.map((b) => b.bill_number).join(', ')}</div>}
                    </td>
                    <td>{po.vendor_name || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {formatDate(po.date)}
                      {po.expected_date && <div className={tabStyles.sub}>Expected {formatDate(po.expected_date)}</div>}
                    </td>
                    <td><StatusBadge status={f.state} tone={poTone(f.state)} /></td>
                    <td className={surface.numeric}>{ordered > 0 ? `${Math.round((received / ordered) * 100)}%` : '—'}</td>
                    <td className={surface.numeric}>{formatCurrency(po.total)}</td>
                    <td>
                      <div className={surface.rowActions}>
                        {open && (
                          <button type="button" className={controls.btnIcon} title="Convert to bill (pending quantities)" aria-label={`Convert ${po.po_number} to bill`} onClick={() => convert(po)}>
                            <ReceiptText size={16} />
                          </button>
                        )}
                        <button type="button" className={controls.btnIcon} title="Print / save" aria-label={`Print ${po.po_number}`} onClick={() => printPo(po, vendors)}>
                          <Printer size={16} />
                        </button>
                        <button type="button" className={controls.btnIcon} title="Edit" aria-label={`Edit ${po.po_number}`} onClick={() => setEditing(po)}>
                          <Pencil size={16} />
                        </button>
                        {open && (
                          <button type="button" className={controls.btnIcon} title="Close order (stop expecting the rest)" aria-label={`Close ${po.po_number}`} onClick={() => setClosed(po, true)}>
                            <XCircle size={16} />
                          </button>
                        )}
                        {f.state === 'Closed' && (
                          <button type="button" className={controls.btnIcon} title="Reopen" aria-label={`Reopen ${po.po_number}`} onClick={() => setClosed(po, false)}>
                            <RotateCcw size={16} />
                          </button>
                        )}
                        <button type="button" className={controls.btnDanger} title="Delete" aria-label={`Delete ${po.po_number}`} onClick={() => setDeleting(po)}>
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.poNote}>
        A purchase order is not a tax document: GST, ITC, books and stock move only when the supplier&apos;s bill is recorded.
      </p>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        size="xl"
        title={editing && editing !== 'new' ? `Edit ${editing.po_number}` : 'New purchase order'}
        subtitle="Order goods or services from a supplier. Received quantities come from the bills you convert it to."
      >
        {editing !== null && (
          <PoForm
            key={editing === 'new' ? 'new' : editing.id}
            po={editing === 'new' ? undefined : editing}
            vendors={vendors}
            businessState={businessState}
            onVendorCreated={onVendorCreated}
            onClose={() => setEditing(null)}
            onSaved={(message) => {
              setEditing(null);
              onChanged(message);
            }}
          />
        )}
      </Modal>
      <ConfirmDialog
        open={!!deleting}
        destructive
        title="Delete this purchase order?"
        message={`${deleting?.po_number ?? ''} (${deleting?.vendor_name ?? ''}) will be removed from this device. Orders with bills recorded against them can only be closed.`}
        confirmLabel="Delete"
        onConfirm={() => deleting && remove(deleting)}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

function PoForm({
  po,
  vendors,
  businessState,
  onVendorCreated,
  onClose,
  onSaved,
}: {
  po?: PurchaseOrder;
  vendors: Vendor[];
  businessState: string;
  onVendorCreated: () => void;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [vendorId, setVendorId] = useState(po?.vendor_id ?? '');
  const [date, setDate] = useState(po?.date ?? todayInput());
  const [expected, setExpected] = useState(po?.expected_date ?? addDaysInput(7));
  const [pos, setPos] = useState(po?.place_of_supply ?? businessState);
  const [lines, setLines] = useState(po?.lines?.length ? po.lines : [blankPurchaseLine()]);
  const [notes, setNotes] = useState(po?.notes ?? '');
  const [error, setError] = useState('');
  const vendor = vendors.find((v) => v.id === vendorId);
  const totals = useMemo(() => poTotals(lines, pos, businessState), [lines, pos, businessState]);

  const submit = () => {
    const draft = {
      vendor_name: vendor?.name ?? po?.vendor_name ?? '',
      date,
      expected_date: expected || undefined,
      lines,
    };
    const problem = validatePo(draft);
    if (problem) return setError(problem);
    try {
      const saved = purchaseOrdersDb.save({
        ...po,
        ...draft,
        vendor_id: vendor?.id ?? po?.vendor_id,
        vendor_gstin: vendor?.gstin ?? po?.vendor_gstin,
        place_of_supply: pos || undefined,
        // Drop the empty trailing row; strip any stock link a bill line type might carry.
        lines: lines.filter((l) => l.name.trim() || l.rate > 0).map(({ id, name, hsn, unit, quantity, rate, tax_rate }) => ({ id, name, hsn, unit, quantity, rate, tax_rate })),
        taxable: totals.taxable,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        total: totals.total,
        notes: notes.trim() || undefined,
      });
      onSaved(po ? `${saved.po_number} updated` : `Purchase order ${saved.po_number} saved`);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const interState = !!pos && !!businessState && pos !== businessState;
  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <VendorPicker
        id="po-vendor"
        vendors={vendors}
        value={vendorId}
        onCreated={onVendorCreated}
        onSelect={(v) => {
          setVendorId(v?.id ?? '');
          const st = v ? resolveStateCode({ code: v.state_code, gstin: v.gstin }) : '';
          if (st) setPos(st);
        }}
      />
      <div className={controls.row3}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="po-date">Order date</label>
          <input id="po-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          {!po && <span className={controls.hint}>Number: {purchaseOrdersDb.nextNumber(date)}</span>}
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="po-expected">Expected by</label>
          <input id="po-expected" type="date" className={controls.input} value={expected} onChange={(e) => setExpected(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="po-pos">Place of supply</label>
          <select id="po-pos" className={controls.select} value={pos} onChange={(e) => setPos(e.target.value)}>
            <option value="">Not specified</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
        </div>
      </div>

      <h3 className={styles.sectionTitle}>Line items</h3>
      <LineItemsEditor lines={lines} onChange={setLines} />

      <div className={styles.totals} aria-live="polite">
        <div className={styles.totalRow}><span>Taxable value</span><span>{formatCurrency(totals.taxable)}</span></div>
        {interState ? (
          <div className={styles.totalRow}><span>IGST</span><span>{formatCurrency(totals.igst)}</span></div>
        ) : (
          <>
            <div className={styles.totalRow}><span>CGST</span><span>{formatCurrency(totals.cgst)}</span></div>
            <div className={styles.totalRow}><span>SGST</span><span>{formatCurrency(totals.sgst)}</span></div>
          </>
        )}
        <div className={styles.totalGrand}><span>Order total</span><span>{formatCurrency(totals.total)}</span></div>
      </div>

      <div className={controls.field}>
        <label className={controls.label} htmlFor="po-notes">Notes / terms for the supplier</label>
        <textarea id="po-notes" className={controls.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.inlineActions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
        <button type="submit" className={controls.btnPrimary}>{po ? 'Save changes' : 'Save purchase order'}</button>
      </div>
    </form>
  );
}
