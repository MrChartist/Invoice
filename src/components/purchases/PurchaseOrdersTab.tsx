import { Suspense, lazy, useMemo, useState } from 'react';
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

// R14 (PS-B5): a media buy turns the PO into a release order (`media` pack) — one lazy row.
const MediaRows = lazy(() => import('../prof/MediaRows'));
import { Link } from 'react-router-dom';
import { getTable } from '../../lib/storage';
import { s2T } from '../../i18n/areas/sales-r2';
import { INDIAN_STATES, resolveStateCode } from '../../lib/india-states';
import { downloadText } from '../../lib/download';
import { addDaysInput, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { EmptyState } from '../ui/EmptyState';
import { StatusBadge } from '../ui/StatusBadge';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { VendorPicker } from './VendorPicker';
import { LineItemsEditor } from './LineItemsEditor';
import { SizeGridSlot } from './SizeGridSlot';
import { useT } from '../../i18n';
import { purT, poStateLabel } from '../../i18n/areas/purchases';
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
  const buyer = { name: p?.companyName || 'Buyer', gstin: p?.companyGstin, address: p?.companyAddress, phone: p?.companyPhone, email: p?.companyEmail };
  const vend = v ? { address: v.address, phone: v.phone, email: v.email } : undefined;
  const w = window.open('', '_blank');
  // R14 PS-B5: a PO carrying a media buy prints as a release order (one lazy part).
  const media = (po as { ps?: { media?: { client_id?: string } } }).ps?.media;
  if (media) {
    void import('../../lib/prof/ps-ro').then((m) => show(w, po, m.roHtml(po, buyer, vend, localDb.clients.getById(media.client_id ?? '')?.name ?? '')));
    return;
  }
  show(w, po, poHtml(po, buyer, vend));
}

function show(w: Window | null, po: PurchaseOrder, html: string) {
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
  useT(); // re-render on a language switch (5.4)
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

  // R2-B5: back-to-back POs name the sales order they were raised for.
  const soNumbers = useMemo(() => {
    if (!orders.some((o) => o.so_id)) return new Map<string, string>();
    return new Map(getTable<{ id: string; invoice_number: string }>('invoices').map((i) => [i.id, i.invoice_number]));
  }, [orders]);

  const convert = (po: PurchaseOrder) => {
    try {
      onConvert(billSeedFromPo(po, purchases));
    } catch (err) {
      onChanged((err as Error).message, 'error');
    }
  };
  const setClosed = (po: PurchaseOrder, closed: boolean) => {
    purchaseOrdersDb.setClosed(po.id, closed ? todayInput() : undefined);
    onChanged(closed ? purT('poClosed', { number: po.po_number }) : purT('poReopened', { number: po.po_number }));
  };
  const remove = (po: PurchaseOrder) => {
    try {
      purchaseOrdersDb.remove(po.id, purchases);
      onChanged(purT('deleted', { name: po.po_number }));
    } catch (err) {
      onChanged((err as Error).message, 'error');
    }
  };

  return (
    <section className={surface.card}>
      <div className={styles.poBar}>
        <select className={controls.select} value={stateFilter} onChange={(e) => setStateFilter(e.target.value as PoState | '')} aria-label={purT('poFilter')}>
          <option value="">{purT('poAll')}</option>
          {PO_STATES.map((s) => (
            <option key={s} value={s}>{poStateLabel(s)}</option>
          ))}
        </select>
        <button type="button" className={controls.btnPrimary} onClick={() => setEditing('new')}>
          <FilePlus2 size={16} /> {purT('poNew')}
        </button>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title={purT('poEmpty')}
          text={purT('poEmptyText')}
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title={purT('noMatches')} text={purT('poNoStatus')} />
      ) : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>{purT('thPo')}</th>
                <th>{purT('thVendor')}</th>
                <th>{purT('thDate')}</th>
                <th>{purT('thStatus')}</th>
                <th className={surface.numeric}>{purT('thReceived')}</th>
                <th className={surface.numeric}>{purT('thTotal')}</th>
                <th aria-label={purT('thActions')} />
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
                      {po.so_id && (
                        <div className={tabStyles.sub} data-po-so>
                          <Link to={`/invoice/${po.so_id}`}>{s2T('po.soRef', { number: soNumbers.get(po.so_id) ?? '—' })}</Link>
                          {po.drop_ship ? ` · ${s2T('po.dropShipTag')}` : ''}
                        </div>
                      )}
                      {f.bills.length > 0 && <div className={tabStyles.sub}>{purT(f.bills.length === 1 ? 'poBillsOne' : 'poBillsMany', { n: f.bills.length, list: f.bills.map((b) => b.bill_number).join(', ') })}</div>}
                    </td>
                    <td>{po.vendor_name || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {formatDate(po.date)}
                      {po.expected_date && <div className={tabStyles.sub}>{purT('expected', { date: formatDate(po.expected_date) })}</div>}
                    </td>
                    <td><StatusBadge status={poStateLabel(f.state)} tone={poTone(f.state)} /></td>
                    <td className={surface.numeric}>{ordered > 0 ? `${Math.round((received / ordered) * 100)}%` : '—'}</td>
                    <td className={surface.numeric}>{formatCurrency(po.total)}</td>
                    <td>
                      <div className={surface.rowActions}>
                        {open && (
                          <button type="button" className={controls.btnIcon} title={purT('poConvert')} aria-label={purT('poConvertNamed', { number: po.po_number })} onClick={() => convert(po)}>
                            <ReceiptText size={16} />
                          </button>
                        )}
                        <button type="button" className={controls.btnIcon} title={purT('poPrint')} aria-label={purT('poPrintNamed', { number: po.po_number })} onClick={() => printPo(po, vendors)}>
                          <Printer size={16} />
                        </button>
                        <button type="button" className={controls.btnIcon} title={purT('edit')} aria-label={purT('editNamed', { name: po.po_number })} onClick={() => setEditing(po)}>
                          <Pencil size={16} />
                        </button>
                        {open && (
                          <button type="button" className={controls.btnIcon} title={purT('poCloseOrder')} aria-label={purT('poCloseNamed', { number: po.po_number })} onClick={() => setClosed(po, true)}>
                            <XCircle size={16} />
                          </button>
                        )}
                        {f.state === 'Closed' && (
                          <button type="button" className={controls.btnIcon} title={purT('poReopen')} aria-label={purT('poReopenNamed', { number: po.po_number })} onClick={() => setClosed(po, false)}>
                            <RotateCcw size={16} />
                          </button>
                        )}
                        <button type="button" className={controls.btnDanger} title={purT('delete')} aria-label={purT('deleteNamed', { name: po.po_number })} onClick={() => setDeleting(po)}>
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
        {purT('poNotTax')}
      </p>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        size="xl"
        title={editing && editing !== 'new' ? purT('poEditTitle', { number: editing.po_number }) : purT('poNew')}
        subtitle={purT('poSub')}
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
        title={purT('poDeleteTitle')}
        message={purT('poDeleteMessage', { number: deleting?.po_number ?? '', vendor: deleting?.vendor_name ?? '' })}
        confirmLabel={purT('delete')}
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
  const [psB, setPsB] = useState(() => (po as { ps?: Record<string, unknown> } | undefined)?.ps); // R14 (PS-B5)
  const [mediaOn] = useState(() => ((s: { industry_packs?: unknown }) => Array.isArray(s.industry_packs) && s.industry_packs.includes('media'))(localDb.settings.get() as never));
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
        lines: lines.filter((l) => l.name.trim() || l.rate > 0).map(({ id, name, hsn, unit, quantity, rate, tax_rate, item_id, unit_factor }) => ({ id, name, hsn, unit, quantity, rate, tax_rate, ...(item_id ? { item_id } : {}), ...(unit_factor ? { unit_factor } : {}) })),
        taxable: totals.taxable,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        total: totals.total,
        notes: notes.trim() || undefined,
        ...(psB !== (po as { ps?: unknown } | undefined)?.ps ? { ps: psB } : {}), // R14 (PS-B5)
      });
      onSaved(po ? purT('updated', { name: saved.po_number }) : purT('poSaved', { number: saved.po_number }));
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
          <label className={controls.label} htmlFor="po-date">{purT('orderDate')}</label>
          <input id="po-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          {!po && <span className={controls.hint}>{purT('poNumber', { number: purchaseOrdersDb.nextNumber(date) })}</span>}
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="po-expected">{purT('expectedBy')}</label>
          <input id="po-expected" type="date" className={controls.input} value={expected} onChange={(e) => setExpected(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="po-pos">{purT('placeOfSupply')}</label>
          <select id="po-pos" className={controls.select} value={pos} onChange={(e) => setPos(e.target.value)}>
            <option value="">{purT('notSpecified')}</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
        </div>
      </div>

      <h3 className={styles.sectionTitle}>{purT('lineItems')}</h3>
      <LineItemsEditor lines={lines} onChange={setLines} />
      <SizeGridSlot lines={lines} onChange={setLines} date={date} />

      <div className={styles.totals} aria-live="polite">
        <div className={styles.totalRow}><span>{purT('taxable')}</span><span>{formatCurrency(totals.taxable)}</span></div>
        {interState ? (
          <div className={styles.totalRow}><span>IGST</span><span>{formatCurrency(totals.igst)}</span></div>
        ) : (
          <>
            <div className={styles.totalRow}><span>CGST</span><span>{formatCurrency(totals.cgst)}</span></div>
            <div className={styles.totalRow}><span>SGST</span><span>{formatCurrency(totals.sgst)}</span></div>
          </>
        )}
        <div className={styles.totalGrand}><span>{purT('orderTotal')}</span><span>{formatCurrency(totals.total)}</span></div>
      </div>

      <div className={controls.field}>
        <label className={controls.label} htmlFor="po-notes">{purT('poNotes')}</label>
        <textarea id="po-notes" className={controls.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {(mediaOn || !!psB?.media) && <Suspense fallback={null}><MediaRows ps={psB} onChange={setPsB} /></Suspense>}

      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.inlineActions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{purT('cancel')}</button>
        <button type="submit" className={controls.btnPrimary}>{po ? purT('saveChanges') : purT('poSave')}</button>
      </div>
    </form>
  );
}
