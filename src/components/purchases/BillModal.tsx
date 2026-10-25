import { useMemo, useState } from 'react';
import type { ImportType, ItcReversalReason, PurchaseRecord, Vendor } from '../../types/purchases';
import { ITC_REVERSAL_REASONS, PURCHASE_CATEGORIES } from '../../types/purchases';
import { INDIAN_STATES, resolveStateCode } from '../../lib/india-states';
import { blankPurchaseLine, computePurchaseTotals, purchasesDb } from '../../lib/purchases';
import { supplierPayableOf } from '../../lib/purchase-normalize';
import type { BillSeed } from '../../lib/purchase-orders';
import { addDaysInput, formatCurrency, todayInput } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { localDb } from '../../lib/localDb';
import { BillableFields } from './BillableFields';
import { CostCentreSelect } from '../cost-centres/CostCentreSelect';
import { useCostCentres } from '../cost-centres/useCostCentres';
import { billablePatch, type BillableValue } from '../../lib/purchases';
import { VendorPicker } from './VendorPicker';
import { LineItemsEditor } from './LineItemsEditor';
import { AttachmentsPanel } from '../attachments/AttachmentsPanel';
import type { AttachmentRef } from '../../types/attachments';
import type { BillStockContext } from './BillLineTracking';
import { buildItemIndex, loadSettings, stockDb } from '../../lib/inventory';
import { billTrackingIssues, liveTrackingInputs } from '../../lib/stock-tracking';
import { godownsDb } from '../../lib/godowns';
import { MAIN_GODOWN_ID } from '../../types/stock';
import { TdsBillPanel } from './TdsBillPanel';
import { priorCreditsFor, resolveBillTds, type BillTdsInput } from '../../lib/tds-payables';
import controls from '../../styles/controls.module.css';
import styles from './purchases.module.css';

export interface BillModalProps {
  open: boolean;
  onClose: () => void;
  /** Existing bill to edit; omit to create. */
  purchase?: PurchaseRecord | null;
  vendors: Vendor[];
  onVendorCreated: (vendor: Vendor) => void;
  /** State code of the business, drives CGST+SGST vs IGST. */
  businessState: string;
  onSaved: (message: string) => void;
  /** New bill only: fields pre-filled from a purchase order ("Convert to bill", pending quantities). */
  seed?: BillSeed | null;
}

/** Supplier bill with line items, GST split by place of supply, and ITC flag. */
export function BillModal({ open, onClose, purchase, seed, ...rest }: BillModalProps) {
  // Re-mount the form per bill so state initialises from props without effects.
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={purchase ? 'Edit purchase bill' : 'Add purchase bill'}
      subtitle={seed && !purchase ? 'Pre-filled with what is still to be received on the purchase order — adjust to match the supplier bill.' : 'Record a supplier bill. GST is split automatically by place of supply.'}
    >
      <BillForm key={purchase?.id ?? (seed ? `po-${seed.po_id}` : 'new')} purchase={purchase ?? undefined} seed={purchase ? undefined : seed ?? undefined} onClose={onClose} {...rest} />
    </Modal>
  );
}

type FormProps = Omit<BillModalProps, 'open' | 'purchase' | 'seed'> & { purchase?: PurchaseRecord; seed?: BillSeed };

function BillForm({ purchase, seed, vendors, onVendorCreated, businessState, onSaved, onClose }: FormProps) {
  const init = purchase ?? seed;
  const [vendorId, setVendorId] = useState(init?.vendor_id ?? '');
  const [billNumber, setBillNumber] = useState(purchase?.bill_number ?? '');
  const [date, setDate] = useState(purchase?.date ?? todayInput());
  const [dueDate, setDueDate] = useState(purchase?.due_date ?? addDaysInput(30));
  const [pos, setPos] = useState(init?.place_of_supply ?? businessState);
  const [category, setCategory] = useState(purchase?.category ?? 'Purchases');
  const [lines, setLines] = useState(init?.lines?.length ? init.lines : [blankPurchaseLine()]);
  const [itc, setItc] = useState(purchase?.itc_eligible ?? (seed ? !!seed.vendor_gstin : true));
  const [notes, setNotes] = useState(init?.notes ?? '');
  const compositionProfile = useMemo(() => localDb.settings.activeProfile()?.gst_scheme === 'composition', []);
  const poId = purchase?.po_id ?? seed?.po_id;
  const [costCentre, setCostCentre] = useState<string | undefined>(purchase?.cost_centre_id);
  const centres = useCostCentres();
  // Advanced GST: reverse charge, imports, ITC reversal, Sec 17(5) blocked credit.
  const [rcm, setRcm] = useState(purchase?.reverse_charge ?? false);
  const [importType, setImportType] = useState<ImportType | ''>(purchase?.import_type ?? '');
  const [boeNumber, setBoeNumber] = useState(purchase?.boe_number ?? '');
  const [boeDate, setBoeDate] = useState(purchase?.boe_date ?? '');
  const [portCode, setPortCode] = useState(purchase?.port_code ?? '');
  const wasBlocked = purchase?.itc_eligible === false && purchase.itc_reversal_reason === 'SEC_17_5';
  const [blocked, setBlocked] = useState(wasBlocked);
  const [reversed, setReversed] = useState(wasBlocked ? 0 : purchase?.itc_reversed ?? 0);
  const [reason, setReason] = useState<ItcReversalReason>(wasBlocked ? 'RULE_42' : purchase?.itc_reversal_reason ?? 'RULE_42');
  const [billable, setBillable] = useState<BillableValue>({
    billable_to_client_id: purchase?.billable_to_client_id,
    markup_percent: purchase?.markup_percent,
    pure_agent: purchase?.pure_agent,
  });
  const [attachments, setAttachments] = useState<AttachmentRef[]>(purchase?.attachments ?? []);
  const [error, setError] = useState('');
  // TDS deducted by us (Tally parity). Undefined rate / base / amount follow the suggestion.
  const [tds, setTds] = useState<BillTdsInput>(() => {
    const v = vendors.find((x) => x.id === init?.vendor_id);
    return {
      section: purchase?.tds_section ?? '',
      on: purchase?.tds_on ?? 'BILL',
      pan: purchase?.tds_pan ?? v?.pan ?? '',
      lowerCert: purchase?.tds_cert_no ?? v?.tds_lower_cert,
      lowerRate: v?.tds_lower_rate,
      nonFiler: v?.tds_non_filer,
      ...(purchase?.tds_section ? { rate: purchase.tds_rate, base: purchase.tds_base, amount: purchase.tds_amount } : {}),
    };
  });
  // Batch / serial / godown fields appear only for items that opted in, or once a second godown exists.
  const [stock] = useState<BillStockContext | undefined>(() => {
    try {
      const items = stockDb.items().filter((i) => i.track_stock);
      const godowns = godownsDb.list();
      if (godowns.length < 2 && !items.some((i) => i.track_batches || i.track_serials)) return undefined;
      const index = buildItemIndex(items);
      const settings = loadSettings();
      const def = godowns.some((g) => g.id === settings.defaultGodown) ? (settings.defaultGodown as string) : MAIN_GODOWN_ID;
      return { find: (name, hsn) => index.find(name, hsn), godowns, defaultGodown: def };
    } catch {
      return undefined;
    }
  });

  const vendor = vendors.find((v) => v.id === vendorId);
  // Imports always carry IGST (customs IGST for goods, reverse-charge IGST for services); '96' = other country.
  const taxPos = importType ? '96' : pos;
  const totals = useMemo(
    () => computePurchaseTotals(lines, { placeOfSupply: taxPos, businessState }),
    [lines, taxPos, businessState],
  );
  const interState = !!importType || (!!pos && !!businessState && pos !== businessState);
  const advancedSet = rcm || !!importType || blocked || reversed > 0;

  // Reverse charge / imports: the GST is paid by us to the government, so the supplier is owed only the taxable value.
  const selfTax = rcm || !!importType;
  const tdsResolved = useMemo(
    () => resolveBillTds(tds, { date, taxable: totals.taxable, prior: priorCreditsFor(purchasesDb.all(), { id: vendor?.id, name: vendor?.name ?? init?.vendor_name, pan: tds.pan }), excludeId: purchase?.id }),
    [tds, date, totals.taxable, vendor?.id, vendor?.name, init?.vendor_name, purchase?.id],
  );
  const tdsOnBill = tdsResolved.fields.tds_on === 'BILL' ? tdsResolved.fields.tds_amount ?? 0 : 0;
  const supplierPayable = supplierPayableOf({ reverseCharge: rcm && !importType, importType: importType || '', tax: totals.tax, taxable: totals.taxable, total: totals.total, tdsOnBill });

  const submit = () => {
    if (!vendor && !init?.vendor_name) return setError('Choose or create a vendor.');
    if (!billNumber.trim()) return setError("Enter the supplier's bill number.");
    if (!date) return setError('Choose the bill date.');
    if (dueDate && dueDate < date) return setError('Due date cannot be before the bill date.');
    const real = lines.filter((l) => l.name.trim() || l.rate > 0);
    if (real.length === 0 || real.some((l) => !l.name.trim())) return setError('Every line needs an item name.');
    if (totals.total <= 0) return setError('The bill total must be greater than zero.');
    if (importType === 'GOODS' && !boeNumber.trim()) return setError('Enter the Bill of Entry number for an import of goods.');
    if (portCode.trim() && !/^[A-Z0-9]{6}$/i.test(portCode.trim())) return setError('Port code is 6 letters / digits, e.g. INNSA1.');
    if (reversed < 0 || reversed > totals.tax + 0.004) return setError('ITC reversed cannot exceed the GST on the bill.');
    if (purchase && supplierPayable < purchase.amount_paid) {
      return setError(`The amount payable to the supplier cannot drop below the ${formatCurrency(purchase.amount_paid)} already paid.`);
    }
    let saveLines = real;
    if (stock) {
      const live = liveTrackingInputs();
      const issues = billTrackingIssues(real, { ...live, purchases: (live.purchases ?? []).filter((p) => p.id !== purchase?.id) });
      if (issues.length) return setError(issues[0]);
      // Tracked lines left on the godown picker's default are stored with it.
      if (stock.godowns.length > 1) {
        saveLines = real.map((l) => (!l.godown_id && stock.find(l.name, l.hsn) ? { ...l, godown_id: stock.defaultGodown } : l));
      }
    }
    try {
      purchasesDb.save({
        ...purchase,
        kind: 'PURCHASE',
        vendor_id: vendor?.id ?? init?.vendor_id,
        vendor_name: vendor?.name ?? init?.vendor_name ?? '',
        vendor_gstin: vendor?.gstin ?? init?.vendor_gstin,
        po_id: poId,
        bill_number: billNumber.trim(),
        date,
        due_date: dueDate || undefined,
        place_of_supply: pos || undefined,
        category,
        lines: saveLines,
        taxable: totals.taxable,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        itc_eligible: itc && !blocked && totals.tax > 0,
        reverse_charge: rcm && !importType ? true : undefined,
        import_type: importType || undefined,
        boe_number: importType === 'GOODS' ? boeNumber.trim() || undefined : undefined,
        boe_date: importType === 'GOODS' ? boeDate || undefined : undefined,
        port_code: importType === 'GOODS' ? portCode.trim().toUpperCase() || undefined : undefined,
        itc_reversed: !blocked && itc && reversed > 0 ? reversed : undefined,
        itc_reversal_reason: blocked && totals.tax > 0 ? 'SEC_17_5' : !blocked && itc && reversed > 0 ? reason : undefined,
        total: totals.total,
        amount_paid: purchase?.amount_paid ?? 0,
        notes: notes.trim() || undefined,
        ...billablePatch(billable),
        cost_centre_id: costCentre,
        attachments: attachments.length ? attachments : undefined,
        ...tdsResolved.fields,
      });
      onSaved(purchase ? 'Bill updated' : `Bill ${billNumber.trim()} saved`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <VendorPicker
        id="bill-vendor"
        vendors={vendors}
        value={vendorId}
        onCreated={onVendorCreated}
        onSelect={(v) => {
          setVendorId(v?.id ?? '');
          // Vendor's state drives IGST vs CGST+SGST; older vendors may only carry a GSTIN.
          const vendorState = v ? resolveStateCode({ code: v.state_code, gstin: v.gstin }) : '';
          if (vendorState) setPos(vendorState);
          if (v) setItc(!!v.gstin);
          if (v) setTds((t) => ({ ...t, pan: t.pan || v.pan || '', section: t.section || v.tds_section || '', nonFiler: v.tds_non_filer, lowerCert: v.tds_lower_cert, lowerRate: v.tds_lower_rate }));
        }}
      />

      <div className={controls.row3}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="bill-no">Bill number</label>
          <input id="bill-no" className={controls.input} value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="bill-date">Bill date</label>
          <input id="bill-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="bill-due">Due date</label>
          <input id="bill-due" type="date" className={controls.input} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
      </div>

      <div className={controls.row}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="bill-pos">Place of supply</label>
          <select id="bill-pos" className={controls.select} value={pos} onChange={(e) => setPos(e.target.value)}>
            <option value="">Not specified</option>
            {INDIAN_STATES.map((s) => (
              <option key={s.code} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
          <span className={controls.hint}>
            {interState ? 'Inter-state: IGST applies.' : 'Intra-state: CGST + SGST apply.'}
            {!businessState && ' Set your GSTIN in Settings to detect this accurately.'}
          </span>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="bill-cat">Category</label>
          <select id="bill-cat" className={controls.select} value={category} onChange={(e) => setCategory(e.target.value)}>
            {PURCHASE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>
      <CostCentreSelect id="bill-cost-centre" label="Cost centre / project" centres={centres} value={costCentre} onChange={setCostCentre} />

      <h3 className={styles.sectionTitle}>Line items</h3>
      <LineItemsEditor lines={lines} onChange={setLines} stock={stock} />

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
        <div className={styles.totalGrand}><span>Bill total</span><span>{formatCurrency(totals.total)}</span></div>
        {selfTax && totals.tax > 0 && (
          <div className={styles.totalRow}>
            <span>Payable to the supplier (the GST is paid by you {importType === 'GOODS' ? 'at customs' : 'under reverse charge'})</span>
            <span>{formatCurrency(supplierPayable)}</span>
          </div>
        )}
      </div>

      <label className={controls.check}>
        <input type="checkbox" checked={itc} onChange={(e) => setItc(e.target.checked)} />
        Claim input tax credit on this bill
      </label>
      {compositionProfile && (
        <p className={controls.hint} style={{ margin: 0 }}>
          The active profile is under the composition scheme: input tax credit is not available (Sec 10(4)). The flag is kept for your records only;
          composition returns never claim it. Reverse-charge bills are still taxed in CMP-08.
        </p>
      )}
      <details className={styles.advanced} open={advancedSet}>
        <summary>Advanced GST: reverse charge, import, ITC reversal</summary>
        <div className={styles.advancedBody}>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="bill-import">Import</label>
              <select id="bill-import" className={controls.select} value={importType} onChange={(e) => {
                  const t = e.target.value as ImportType | '';
                  setImportType(t);
                  // Foreign suppliers have no GSTIN, which unticks ITC on vendor pick; imports carry ITC.
                  if (t) setItc(true);
                }}>
                <option value="">Domestic purchase</option>
                <option value="GOODS">Import of goods (Bill of Entry)</option>
                <option value="SERVICES">Import of services (reverse charge)</option>
              </select>
            </div>
            <label className={controls.check}>
              <input type="checkbox" checked={rcm || importType === 'SERVICES'} disabled={!!importType} onChange={(e) => setRcm(e.target.checked)} />
              Reverse charge: GST payable by us
            </label>
          </div>
          {importType === 'GOODS' && (
            <div className={controls.row3}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="bill-boe">Bill of Entry no.</label>
                <input id="bill-boe" className={controls.input} value={boeNumber} onChange={(e) => setBoeNumber(e.target.value)} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="bill-boe-date">BoE date</label>
                <input id="bill-boe-date" type="date" className={controls.input} value={boeDate} onChange={(e) => setBoeDate(e.target.value)} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="bill-port">Port code</label>
                <input id="bill-port" className={controls.input} placeholder="INNSA1" maxLength={6} value={portCode} onChange={(e) => setPortCode(e.target.value)} />
              </div>
            </div>
          )}
          <label className={controls.check}>
            <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} />
            Blocked credit under Sec 17(5) (no ITC; shown in 3B 4A and reversed in 4B(1))
          </label>
          {!blocked && itc && (
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="bill-rev">ITC reversed (₹)</label>
                <input id="bill-rev" type="number" min={0} step="0.01" className={controls.input} value={reversed || ''} onChange={(e) => setReversed(Math.max(Number(e.target.value) || 0, 0))} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="bill-rev-reason">Reason</label>
                <select id="bill-rev-reason" className={controls.select} value={reason} onChange={(e) => setReason(e.target.value as ItcReversalReason)}>
                  {ITC_REVERSAL_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <p className={styles.note}>
            Feeds GSTR-3B: reverse charge in 3.1(d) and 4A(3), imports in 4A(1) / 4A(2), reversals in 4B. Working papers — verify with your CA.
          </p>
        </div>
      </details>

      <TdsBillPanel value={tds} onChange={setTds} suggestion={tdsResolved.suggestion} payableNet={supplierPayable} nonResident={vendor?.non_resident} />

      {itc && !rcm && !importType && totals.tax > 0 && vendor && !vendor.gstin && (
        <p className={styles.note}>This vendor has no GSTIN — ITC generally cannot be claimed on unregistered purchases.</p>
      )}

      <div className={controls.field}>
        <label className={controls.label} htmlFor="bill-notes">Notes</label>
        <textarea id="bill-notes" className={controls.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <BillableFields idPrefix="bill" value={billable} onChange={setBillable} rebilledIn={purchase?.rebilled_in} />

      <AttachmentsPanel value={attachments} onChange={setAttachments} label="Receipts & attachments" />

      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.inlineActions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
        <button type="submit" className={controls.btnPrimary}>{purchase ? 'Save changes' : 'Save bill'}</button>
      </div>
    </form>
  );
}
