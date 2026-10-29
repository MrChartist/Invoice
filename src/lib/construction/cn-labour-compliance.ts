/**
 * CN-D2 labour contractors. Compliance pack per vendor and month (table `labour_compliance`, `doc.create`): headcount,
 * wages, PF (TRRN, amount, challan file), ESI (challan, amount, file), wage register file, licence; status pending /
 * proved / waived. Files go through the attachments store. Until the month is proved, that vendor's bills of that
 * month carry a **hold** proposal = the higher of `construction_settings.labour_withhold_pct` (default 10%,
 * `LABOUR_WITHHOLD_DEFAULTS`) of the bill and the PF + ESI amount (CN15) — a warning and an amount, never a block.
 * Manpower supply bill (we are the labour contractor): SAC 998519 at the class rate, lines "Wages", "Statutory
 * contributions (PF / ESI)" and "Service charge" — one supply at one rate, not pure agent (CN15). Verify with your CA.
 */
import './cn-registry';
import type { LabourCompliance } from '../../types/construction-r11';
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { balanceOf } from '../purchases';
import { LABOUR_WITHHOLD_DEFAULTS, WORKS_CLASS_RULES } from '../construction-rules';
import { readConstructionSettings } from './cn-settings';
import { SD, drop, put, rowsOf } from './cn-subcon';
import { draftInvoice } from './cn-plant-hire';
import { PRINT_FONT, PRINT_FONT_FACE } from '../print-fonts';

export const loadCompliance = () => rowsOf<LabourCompliance>(SD.compliance);
const MONTH = /^\d{4}-\d{2}$/;

export type ComplianceInput = Omit<LabourCompliance, 'id' | 'status'> & { status?: LabourCompliance['status'] };

/** Save the pack of a vendor and month (one row each; an edit replaces it). `proved` needs the PF and ESI challans. */
export function saveCompliance(i: ComplianceInput): LabourCompliance {
  requireAccess('doc.create');
  if (!i.vendor_id || !MONTH.test(i.month)) throw new Error('Choose the labour contractor and the month.');
  const status = i.status ?? 'pending';
  if (status === 'proved' && (!i.pf.trrn?.trim() || !i.esi.challan?.trim())) throw new Error('Enter the PF TRRN and the ESI challan before marking the month proved.');
  const prev = loadCompliance().find((r) => r.vendor_id === i.vendor_id && r.month === i.month);
  return put(SD.compliance, { ...prev, ...i, id: prev?.id ?? generateId(), headcount: Math.max(Math.round(num(i.headcount)), 0), wages: round2(num(i.wages)), status });
}
export function deleteCompliance(id: string): void {
  requireAccess('doc.create');
  drop(SD.compliance, id);
}

/** Hold % on the date (settings, else the default rule). */
export const holdPct = (date: string) => readConstructionSettings().labour_withhold_pct ?? ruleAt(LABOUR_WITHHOLD_DEFAULTS, date).pct;

/** Pure: the hold proposed on a labour contractor's bill (0 once the bill's month is proved / waived). */
export function withholdFor(bill: Pick<PurchaseRecord, 'vendor_id' | 'date' | 'total'>, rows: readonly LabourCompliance[], pct: number): { hold: number; status: LabourCompliance['status'] | 'missing' } {
  const r = rows.find((x) => x.vendor_id === bill.vendor_id && x.month === bill.date.slice(0, 7));
  if (r && r.status !== 'pending') return { hold: 0, status: r.status };
  const statutory = num(r?.pf.amount) + num(r?.esi.amount);
  return { hold: round2(Math.max((num(bill.total) * pct) / 100, statutory)), status: r ? 'pending' : 'missing' };
}

/** Bills of labour contractors (vendors with a pack, or category "Labour contract") with balance, hold and pay-now. */
export function labourBills(purchases: readonly PurchaseRecord[], rows: readonly LabourCompliance[] = loadCompliance()) {
  const vendors = new Set(rows.map((r) => r.vendor_id));
  return purchases.filter((p) => !p.cn_sub && ((p.vendor_id && vendors.has(p.vendor_id)) || /labour contract/i.test(p.category))).map((p) => {
    const w = withholdFor(p, rows, holdPct(p.date));
    const balance = balanceOf(p);
    return { bill: p, balance, ...w, payNow: round2(Math.max(balance - w.hold, 0)) };
  });
}

/** Pure: the three manpower-supply lines (SAC 998519, one rate on the whole value). */
export function manpowerItems(wages: number, statutory: number, service: number, date: string) {
  const rate = ruleAt(WORKS_CLASS_RULES, date).manpower?.rate ?? 18;
  const l = (name: string, v: number) => ({ name, hsn: '998519', unit: 'NOS', quantity: 1, rate: round2(num(v)), tax_rate: rate });
  return [l('Wages', wages), l('Statutory contributions (PF / ESI)', statutory), l('Service charge', service)].filter((x) => x.rate > 0);
}

/** Manpower supply bill as a DRAFT tax invoice (annexure: the month's compliance pack, printed separately). */
export function manpowerBill(clientId: string, wages: number, statutory: number, service: number, date: string): InvoiceRecord {
  const items = manpowerItems(wages, statutory, service, date);
  if (!items.length) throw new Error('Enter the wages and charges.');
  return draftInvoice(clientId, items, 'Manpower supply service (SAC 998519): wages and statutory contributions are part of the value of one supply, not pure agent. Verify with your CA (CN15).', date);
}

/** Printable compliance annexure of a month. */
export function complianceHtml(rows: readonly LabourCompliance[], month: string, company: string): string {
  const e = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const body = rows.filter((r) => r.month === month).map((r) => `<tr><td>${e(r.vendor_name)}</td><td>${r.headcount}</td><td>${r.wages.toFixed(2)}</td><td>${e(r.pf.trrn)} ${num(r.pf.amount).toFixed(2)}</td><td>${e(r.esi.challan)} ${num(r.esi.amount).toFixed(2)}</td><td>${e(r.licence?.no)} ${e(r.licence?.valid_till)}</td><td>${e(r.status)}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Labour compliance ${e(month)}</title><style>${PRINT_FONT_FACE}body{font:12px ${PRINT_FONT};margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;text-align:left}</style>
<h2>Labour compliance: ${e(month)}</h2><p>${e(company)}</p><table><tr><th>Contractor</th><th>Headcount</th><th>Wages</th><th>PF (TRRN, ₹)</th><th>ESI (challan, ₹)</th><th>Licence</th><th>Status</th></tr>${body}</table>
<p><small>Working paper: verify with your CA / labour-law adviser (CN15).</small></p>`;
}
