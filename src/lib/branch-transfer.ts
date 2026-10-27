/**
 * Inter-branch stock transfer between distinct GSTINs (WP-9, P1-19).
 *
 * Two registrations of one business are "distinct persons" (Sec 25(4) CGST Act) and goods moved
 * between them are a supply even without consideration (Schedule I para 2). A stock transfer whose
 * source and destination godowns belong to branches with DIFFERENT GSTINs therefore needs a tax
 * invoice from the sending branch and a matching purchase bill (ITC) at the receiving branch.
 *
 *  - `branchOfGodown` — the branch whose `godown_id` is the godown or one of its parents.
 *  - `transferTaxPair` — the two branches when a tax invoice is needed, else null.
 *  - `buildTransferPair` (pure) — the TAX_INVOICE (sender = sending branch's registration, client =
 *    receiving branch, place of supply = receiving state) and the PURCHASE bill. Both carry
 *    `branch_transfer_id`, so the ledger posts them to "Branch transfer (outward / inward)" instead
 *    of Sales / Purchases: on consolidation the pair nets to nil, only the GST stays.
 *  - Lines keep their HSN but carry the transfer number in the name, so the stock engine (which
 *    matches lines by item id or name + HSN) does not move the goods a second time: the transfer
 *    voucher already moved the quantity.
 *  - `raiseTransferPair` — saves both or neither (period lock, roles and numbering apply); refuses a second pair
 *    (a live invoice or bill) and a clerk's invoice that approvals would hold as a draft.
 *
 * The value is the user's (Rule 28: open market value, or the value declared on the invoice when the
 * recipient branch can take full credit). Working papers — verify with your CA.
 */
import type { Client, InvoiceItem, InvoiceRecord, SenderProfile } from '../types/invoice';
import type { PurchaseLine, PurchaseRecord } from '../types/purchases';
import type { Godown, StockTransfer } from '../types/stock';
import { localDb, type AppSettings } from './localDb';
import { stockDb, type StockItem } from './inventory';
import { purchasesDb } from './purchases';
import { godownsDb, transferPairOf } from './godowns';
import { withTablesRollback } from './table-txn';
import { generateId } from './storage';
import { loadBranches, type Branch } from './branch';
import { calcInputFromRecord, calculateInvoice, num, round2 } from './invoice-calc';
import { makeDraft } from '../store/invoice-defaults';

export const BRANCH_TRANSFER_CATEGORY = 'Branch transfer';
export const BRANCH_TRANSFER_CA_NOTE = 'Supply between distinct persons (Sec 25(4), Schedule I para 2 CGST Act). Value per Rule 28 — verify with your CA.';

const gstinOf = (b: Branch | undefined) => (b?.gstin ?? '').trim().toUpperCase();

/** The branch that owns a godown (directly, or through a parent godown). */
export function branchOfGodown(godownId: string, branches: readonly Branch[], godowns: readonly Godown[]): Branch | undefined {
  const seen = new Set<string>();
  let id: string | undefined = godownId;
  while (id && !seen.has(id)) {
    seen.add(id);
    const hit = branches.find((b) => b.godown_id === id);
    if (hit) return hit;
    id = godowns.find((g) => g.id === id)?.parent_id;
  }
  return undefined;
}

/** Sending / receiving branches when the transfer crosses two different GSTINs, else null. */
export function transferTaxPair(t: Pick<StockTransfer, 'from_godown' | 'to_godown'>, branches: readonly Branch[], godowns: readonly Godown[]): { from: Branch; to: Branch } | null {
  const from = branchOfGodown(t.from_godown, branches, godowns);
  const to = branchOfGodown(t.to_godown, branches, godowns);
  if (!from || !to || from.id === to.id) return null;
  const a = gstinOf(from);
  const b = gstinOf(to);
  return a && b && a !== b ? { from, to } : null;
}

/**
 * QA14 Q1: a transfer line's quantity in the item's base unit. A line typed in an alternate unit (10 BOX of 12) is billed
 * as 120 NOS at the per-base-unit rate the dialog suggests (average cost), never 10 × the per-piece cost.
 */
export const transferBaseQty = (l: StockTransfer['lines'][number]): number => Math.round(num(l.qty) * (num(l.unit_factor) > 0 ? num(l.unit_factor) : 1) * 1000) / 1000;

/** The live tax invoice already raised for a transfer, if any. */
export function transferInvoiceOf(transferId: string, invoices: readonly Pick<InvoiceRecord, 'id' | 'branch_transfer_id' | 'status' | 'invoice_number'>[]) {
  return invoices.find((i) => i.branch_transfer_id === transferId && i.status !== 'Cancelled');
}

export interface TransferPairInput {
  transfer: StockTransfer;
  from: Branch;
  to: Branch;
  items: readonly StockItem[];
  /** Rupees per unit (taxable value) by transfer line id. */
  rates: Readonly<Record<string, number>>;
  settings: AppSettings;
  /** Business profile of the sending branch (its own, else the active one). */
  profile: SenderProfile | null;
  invoiceId: string;
  invoiceNumber: string;
  billId: string;
  newId: () => string;
}

/** Pure: the tax invoice and the purchase bill for a transfer (totals filled in, nothing saved). */
export function buildTransferPair(x: TransferPairInput): { invoice: InvoiceRecord; bill: Omit<PurchaseRecord, 'id'> & { id: string } } {
  const t = x.transfer;
  const fromState = x.from.state_code || gstinOf(x.from).slice(0, 2);
  const toState = x.to.state_code || gstinOf(x.to).slice(0, 2);
  const byId = new Map(x.items.map((i) => [i.id, i]));
  const base = x.profile ?? null;
  const sender: SenderProfile | null = base ? { ...base, companyGstin: gstinOf(x.from), stateCode: fromState, ...(x.from.address ? { companyAddress: x.from.address } : {}) } : null;
  const company = base?.companyName?.trim() || x.from.name;
  const client: Client = {
    name: `${company} — ${x.to.name}`,
    company,
    email: '',
    address: x.to.address ?? '',
    city: '',
    zip: '',
    gstin: gstinOf(x.to),
    state_code: toState,
  };
  const draft = makeDraft({ settings: x.settings, sender, docType: 'TAX_INVOICE' });
  const label = (name: string) => `${name} (branch transfer ${t.transfer_number})`;
  const items: InvoiceItem[] = t.lines
    .filter((l) => num(l.qty) > 0)
    .map((l) => {
      const it = byId.get(l.item_id);
      const rate = round2(Math.max(0, num(x.rates[l.id])));
      return {
        id: x.newId(),
        name: label(it?.name ?? 'Item'),
        type: 'goods',
        ...(it?.hsn ? { hsn: it.hsn } : {}),
        unit: it?.unit || 'NOS',
        quantity: transferBaseQty(l),
        rate,
        tax_rate: num(it?.tax_rate ?? x.settings.defaultTaxRate),
        amount: round2(transferBaseQty(l) * rate),
      };
    });
  const note = `Stock transfer ${t.transfer_number} from ${x.from.name} (${gstinOf(x.from)}) to ${x.to.name} (${gstinOf(x.to)}). ${BRANCH_TRANSFER_CA_NOTE}`;
  const rec: InvoiceRecord = {
    ...draft,
    id: x.invoiceId,
    invoice_number: x.invoiceNumber,
    issue_date: t.date,
    due_date: t.date,
    status: 'Sent',
    currency: 'INR',
    client,
    items,
    gst_mode: fromState && toState && fromState !== toState ? 'IGST' : 'CGST_SGST',
    place_of_supply: toState,
    supply_type: 'B2B',
    notes: note,
    po_number: t.transfer_number,
    branch_id: x.from.id,
    branch_transfer_id: t.id,
  };
  const c = calculateInvoice(calcInputFromRecord(rec));
  const invoice: InvoiceRecord = {
    ...rec,
    subtotal: c.subtotal,
    discount_amount: c.discount_amount,
    taxable_value: c.taxable_value,
    cgst_amount: c.cgst_amount,
    sgst_amount: c.sgst_amount,
    igst_amount: c.igst_amount,
    tax_amount: c.tax_amount,
    round_off: c.round_off,
    total: c.total,
    balance_due: c.balance_due,
    cess_amount: c.cess_amount,
    tcs_amount: 0,
    tds_amount: 0,
  };
  const lines: PurchaseLine[] = items.map((i) => ({ id: x.newId(), name: i.name, ...(i.hsn ? { hsn: i.hsn } : {}), unit: i.unit, quantity: i.quantity, rate: i.rate, tax_rate: num(i.tax_rate) }));
  const bill = {
    id: x.billId,
    kind: 'PURCHASE' as const,
    vendor_name: `${company} — ${x.from.name}`,
    vendor_gstin: gstinOf(x.from),
    bill_number: x.invoiceNumber,
    date: t.date,
    due_date: t.date,
    place_of_supply: toState,
    category: BRANCH_TRANSFER_CATEGORY,
    lines,
    taxable: invoice.taxable_value,
    cgst: invoice.cgst_amount,
    sgst: invoice.sgst_amount,
    igst: invoice.igst_amount,
    itc_eligible: true,
    total: invoice.total,
    amount_paid: 0,
    notes: note,
    branch_id: x.to.id,
    branch_transfer_id: t.id,
  };
  return { invoice, bill };
}

/** Default rate per transfer line: average cost, else the opening rate, else the sale rate. */
export function defaultTransferRates(t: StockTransfer, items: readonly StockItem[], avgCost: ReadonlyMap<string, number>): Record<string, number> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: Record<string, number> = {};
  for (const l of t.lines) {
    const it = byId.get(l.item_id);
    out[l.id] = round2(num(avgCost.get(l.item_id)) || num(it?.opening_rate) || num(it?.sale_rate));
  }
  return out;
}

export class BranchTransferError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BranchTransferError';
  }
}

/**
 * Save the invoice / bill pair for a transfer (storage-backed). Throws when the godowns are not two
 * branches with different GSTINs, when a pair was already raised, or when a save is refused
 * (period lock, role).
 */
export function raiseTransferPair(t: StockTransfer, rates: Readonly<Record<string, number>>): { invoice: InvoiceRecord; bill: PurchaseRecord } {
  const pair = transferTaxPair(t, loadBranches(), godownsDb.list());
  if (!pair) throw new BranchTransferError('Both godowns must belong to branches with different GSTINs.');
  // Review M2: a live bill counts too (an invoice is ignored once cancelled, its bill is not).
  const already = transferPairOf(t.id);
  if (already?.invoice) throw new BranchTransferError(`Tax invoice ${already.invoice} was already raised for this transfer.`);
  if (already?.bill) throw new BranchTransferError(`Purchase bill ${already.bill} was already raised for this transfer. Delete it before raising the pair again.`);
  const settings = localDb.settings.get();
  const profile = (pair.from.profile_id && settings.profiles.find((p) => p.id === pair.from.profile_id)) || localDb.settings.activeProfile();
  const built = buildTransferPair({
    transfer: t,
    ...pair,
    items: stockDb.items(),
    rates,
    settings,
    profile,
    invoiceId: generateId(),
    invoiceNumber: localDb.invoices.nextNumber(t.date, 'TAX_INVOICE', profile?.invoicePrefix || undefined),
    billId: generateId(),
    newId: generateId,
  });
  if (!(built.invoice.total > 0)) throw new BranchTransferError('Enter a value for the goods transferred.');
  // Review M2: both or neither. A clerk's invoice held for approval (kept as a Draft) is not a supply
  // document yet, so the pair is refused and the owner raises it.
  return withTablesRollback(['invoices', 'purchases'], () => {
    const invoice = localDb.invoices.save(built.invoice);
    if (invoice.status === 'Draft' || invoice.approval?.state === 'pending') {
      throw new BranchTransferError('Approvals are on, so this tax invoice would wait as a draft for approval. Ask the owner to raise the branch-transfer invoice and bill.');
    }
    const bill = purchasesDb.save({ ...built.bill, bill_number: invoice.invoice_number });
    return { invoice, bill };
  });
}
