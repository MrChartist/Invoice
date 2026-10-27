/**
 * R5-B4: the BOQ is a sales order (or quotation) — its lines carry the BOQ item number (`boq_ref`), unit, BOQ quantity
 * and rate; the work order number / date sit in the existing reference fields. BOQ terms (deduction set, DLP,
 * mobilisation advance, project cost centre, cess mode) are one additive field `boq_terms` on the sales order.
 * A BOQ can be imported from CSV / XLSX (item no., description, unit, qty, rate, HSN / SAC) into a new sales order.
 */
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { BoqTerms, DeductionRule } from '../../types/transport-works-r5';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, num, round2 } from '../invoice-calc';
import { billableLines } from '../progress-billing';
import { scoreHeader } from '../import-mapping';
import { parseNumber } from '../importers';
import { makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { generateId } from '../storage';
import { localDb } from '../localDb';
import { ruleAt } from '../tax-rules';
import { WORKS_CONTRACT_RATE_RULES } from '../transport-works-rules';

export const DEDUCTION_KINDS = ['retention', 'advance_recovery', 'it_tds', 'gst_tds', 'labour_cess', 'security_deposit', 'ld', 'other', 'water_power'] as const; // R11 (CN-B4): water & electricity %

type BoqDoc = Pick<InvoiceRecord, 'id' | 'doc_type' | 'status'>;
export const isBoqDoc = (d: BoqDoc): boolean => (d.doc_type === 'SALES_ORDER' || d.doc_type === 'QUOTATION') && d.status !== 'Cancelled';

/** Sales orders / quotations that can serve as a BOQ (newest first). */
export function listBoqs(invoices: readonly InvoiceRecord[]): InvoiceRecord[] {
  return invoices.filter(isBoqDoc).sort((a, b) => (b.issue_date ?? '').localeCompare(a.issue_date ?? ''));
}

export const boqLines = (boq: Pick<InvoiceRecord, 'items'>): InvoiceItem[] => billableLines(boq);

/** Contract value (taxable, before GST) of the BOQ. */
export function contractValue(boq: InvoiceRecord): number {
  return calculateInvoice(calcInputFromRecord({ ...boq, items: boqLines(boq) }, { amount_paid: 0 })).taxable_value;
}

/** Cleaned deduction rules (unknown kinds and empty rows dropped). */
export function cleanRules(rules: readonly Partial<DeductionRule>[] | undefined): DeductionRule[] {
  const out: DeductionRule[] = [];
  for (const r of rules ?? []) {
    if (!r?.kind || !(DEDUCTION_KINDS as readonly string[]).includes(r.kind)) continue;
    const rate = num(r.rate);
    const amount = num(r.amount);
    if (!(rate > 0) && !(amount > 0) && r.kind !== 'gst_tds' && r.kind !== 'labour_cess' && r.kind !== 'it_tds') continue;
    out.push({
      kind: r.kind,
      ...(rate > 0 ? { rate: round2(rate) } : {}),
      ...(amount > 0 ? { amount: round2(amount) } : {}),
      ...(r.basis === 'gross' ? { basis: 'gross' as const } : {}),
      ...(num(r.cap_pct) > 0 ? { cap_pct: round2(num(r.cap_pct)) } : {}),
      ...(num(r.start_after_pct) > 0 ? { start_after_pct: round2(num(r.start_after_pct)) } : {}),
      ...(r.section ? { section: r.section } : {}),
      ...(r.label?.trim() ? { label: r.label.trim().slice(0, 60) } : {}),
    });
  }
  return out;
}

/** Save the BOQ terms on the sales order (period lock and roles through `localDb.invoices.save`). */
export function saveBoqTerms(boqId: string, terms: BoqTerms): InvoiceRecord {
  const fresh = localDb.invoices.getById(boqId);
  if (!fresh) throw new Error('BOQ not found.');
  const clean: BoqTerms = {
    ...terms,
    deductions: cleanRules(terms.deductions),
    ...(num(terms.dlp_months) > 0 ? { dlp_months: Math.round(num(terms.dlp_months)) } : { dlp_months: undefined }),
  };
  for (const k of Object.keys(clean) as (keyof BoqTerms)[]) if (clean[k] === undefined || clean[k] === '') delete clean[k];
  return localDb.invoices.save({ ...fresh, boq_terms: clean });
}

/* ── BOQ import ───────────────────────────────────────────────── */

export const BOQ_FIELDS: Readonly<Record<'ref' | 'description' | 'unit' | 'qty' | 'rate' | 'hsn', string[]>> = {
  ref: ['item no', 'item number', 'sl no', 's no', 'boq ref', 'boq item', 'code'],
  description: ['description', 'item', 'particulars', 'description of work', 'work'],
  unit: ['unit', 'uom'],
  qty: ['qty', 'quantity', 'boq qty'],
  rate: ['rate', 'unit rate', 'rate per unit'],
  hsn: ['hsn', 'sac', 'hsn sac', 'hsn/sac'],
};

export type BoqColumns = Partial<Record<keyof typeof BOQ_FIELDS, number>>;

/** Best header for each field (a header is used once). */
export function mapBoqColumns(headers: readonly string[]): BoqColumns {
  const out: BoqColumns = {};
  const used = new Set<number>();
  for (const f of Object.keys(BOQ_FIELDS) as (keyof typeof BOQ_FIELDS)[]) {
    let best = -1;
    let score = 0;
    headers.forEach((h, i) => {
      if (used.has(i)) return;
      const s = scoreHeader(h, BOQ_FIELDS[f]);
      if (s > score) {
        score = s;
        best = i;
      }
    });
    if (best >= 0) {
      out[f] = best;
      used.add(best);
    }
  }
  return out;
}

export interface BoqImportRow {
  boq_ref: string;
  name: string;
  unit: string;
  quantity: number;
  rate: number;
  hsn: string;
}

/** Rows → BOQ lines (rows without a description or quantity are skipped and listed by line number). */
export function planBoqImport(table: { headers: string[]; rows: string[][] }, cols: BoqColumns = mapBoqColumns(table.headers)): { lines: BoqImportRow[]; skipped: number[] } {
  const cell = (r: string[], f: keyof BoqColumns) => (cols[f] === undefined ? '' : String(r[cols[f]!] ?? '').trim());
  const lines: BoqImportRow[] = [];
  const skipped: number[] = [];
  table.rows.forEach((r, i) => {
    const name = cell(r, 'description');
    const quantity = parseNumber(cell(r, 'qty')).value ?? 0;
    if (!name || !(quantity > 0)) {
      skipped.push(i + 2);
      return;
    }
    lines.push({ boq_ref: cell(r, 'ref'), name: name.slice(0, 200), unit: cell(r, 'unit').toUpperCase().slice(0, 12), quantity, rate: round2(parseNumber(cell(r, 'rate')).value ?? 0), hsn: cell(r, 'hsn').replace(/\s+/g, '') });
  });
  return { lines, skipped };
}

/** Save an imported BOQ as an issued sales order for the client. */
export function createBoqFromImport(lines: readonly BoqImportRow[], opts: { client: Client; date: string; workOrder?: string; government?: boolean; taxRate?: number }): InvoiceRecord {
  if (!lines.length) throw new Error('No BOQ lines to import.');
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile();
  const rate = opts.taxRate ?? ruleAt(WORKS_CONTRACT_RATE_RULES, opts.date)[opts.government ? 'government' : 'general'];
  const draft = makeDraft({ settings, sender, docType: 'SALES_ORDER', templateId: localDb.template.get() });
  const pos = opts.client.state_code || opts.client.gstin?.slice(0, 2) || senderStateCode(sender);
  const items: InvoiceItem[] = lines.map((l) => ({
    id: generateId(), name: l.name, description: '', type: 'Service', hsn: l.hsn || '995411', unit: l.unit, quantity: l.quantity, rate: l.rate, tax_rate: rate, discount_percent: 0, amount: round2(l.quantity * l.rate),
    ...(l.boq_ref ? { boq_ref: l.boq_ref } : {}),
  }));
  const rec: InvoiceRecord = {
    ...draft, issue_date: opts.date, status: 'Sent', client: { ...opts.client }, items, place_of_supply: pos,
    gst_mode: deriveGstMode({ senderStateCode: senderStateCode(sender), placeOfSupply: pos, senderHasGstin: !!sender?.companyGstin?.trim(), taxEnabled: true }),
    ...(opts.workOrder?.trim() ? { po_number: opts.workOrder.trim() } : {}),
    boq_terms: { ...(opts.workOrder?.trim() ? { work_order: opts.workOrder.trim() } : {}) },
  };
  const t = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return localDb.invoices.save({ ...rec, subtotal: t.subtotal, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: t.balance_due, discount_amount: t.discount_amount });
}
