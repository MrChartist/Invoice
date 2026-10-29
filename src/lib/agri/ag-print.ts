/**
 * AG-A5 small papers (script-free HTML print pages, the `abstractHtml` pattern; also CSV where a register): the farmer
 * purchase voucher (weighment, quality-cut table, charges, declaration), the farmer payment slip (A6 / 80 mm) and the
 * farmer cards sheet (8 per A4; the QR is rendered by the screen and passed in). Each prints from the stored row only —
 * never recomputed. "Working paper — verify" only where a tax or statutory figure is stated.
 */
import type { AgQualityReading, FarmerCycle, FarmerCycleLine } from '../../types/agri-r12';
import type { PurchaseRecord } from '../../types/purchases';
import { weightText } from '../trade/tr-weight';
import { PRINT_FONT, PRINT_FONT_FACE } from '../print-fonts';

export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const rs = (n: unknown) => `₹${(Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const CSS = `body{font:13px ${PRINT_FONT};margin:16px;color:#111}h1{font-size:16px;margin:0 0 4px}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}.r{text-align:right}.note{font-size:12px;color:#555}`;
const page = (title: string, body: string, extra = '') => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${PRINT_FONT_FACE}${CSS}${extra}</style></head><body>${body}</body></html>`;
const table = (head: readonly string[], rows: readonly (readonly unknown[])[]) =>
  `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

/** Quality-cut rows (also on the voucher's statement page). */
export const qualityRows = (q: readonly AgQualityReading[]): string[][] =>
  q.map((r) => [r.label ?? r.key, `${r.reading}%`, `${r.norm}%`, `${r.cut_pct}%`, r.cut_kg ? `${r.cut_kg} kg` : r.cut_rs ? rs(r.cut_rs) : '—', r.reject ? 'Above reject line' : '']);

/** The farmer purchase voucher (FPV) as a print page. */
export function voucherHtml(bill: PurchaseRecord, business: { name: string; address?: string; gstin?: string }, farmer?: { code?: string; village?: string }): string {
  const v = bill.ag?.voucher;
  const goods = bill.lines.filter((l) => !l.charge_head_id && Number(l.rate) > 0);
  const body = [
    `<h1>${esc(business.name)} — Farmer purchase voucher</h1>`,
    `<p>${esc(business.address ?? '')}${business.gstin ? ` · GSTIN ${esc(business.gstin)}` : ''}</p>`,
    `<p><b>${esc(bill.bill_number)}</b> · ${esc(bill.date)} · Farmer: <b>${esc(bill.vendor_name)}</b>${farmer?.code ? ` (${esc(farmer.code)})` : ''}${farmer?.village ? `, ${esc(farmer.village)}` : ''}${v?.vehicle ? ` · Vehicle ${esc(v.vehicle)}` : ''}</p>`,
    table(['Produce', 'Weighment', 'Accepted', 'Rate', 'Amount'], goods.map((l) => [l.name, weightText(l.wt) || '—', `${l.quantity} ${l.unit ?? ''}`, rs(l.rate), rs(Number(l.quantity) * Number(l.rate))])),
    v?.quality.length ? `<h1>Quality cuts</h1>${table(['Parameter', 'Reading', 'Norm', 'Cut', 'Cut amount', ''], qualityRows(v.quality))}<p>Weight cut ${esc(v.cut_kg)} kg · accepted ${esc(v.accepted_kg)} kg</p>` : '',
    v?.charges?.length ? table(['Charge', 'Paid by', 'Amount'], v.charges.map((c) => [c.name, c.by === 'us' ? 'Us (memo)' : 'Recovered from the farmer', rs(c.amount)])) : '',
    `<p><b>Total payable ${rs(bill.total)}</b></p>`,
    v?.declaration ? `<p>${esc(v.declaration)}</p>` : '',
    '<p class="note">Farmer\'s signature / thumb impression: ____________ · Working paper — verify with your CA.</p>',
  ];
  return page(bill.bill_number, body.join(''));
}

/** A farmer's payment slip of a cycle (shift-wise table when the line carries it — AG-B). */
export function slipHtml(c: FarmerCycle, l: FarmerCycleLine, business: string, code?: string, narrow = false): string {
  const ded = l.deductions.map((d) => [d.kind, d.note ?? '', rs(d.amount)]);
  const body = [
    `<h1>${esc(business)} — Payment slip</h1>`,
    `<p>${esc(c.number)} · ${esc(c.period_from)} to ${esc(c.period_to)}<br>${esc(l.name ?? '')}${code ? ` (${esc(code)})` : ''}</p>`,
    l.shifts?.length ? table(['Date', 'Shift', 'Qty', 'Fat', 'SNF', 'Amount'], l.shifts.map((s) => [s.date, s.shift, s.qty, s.fat ?? '', s.snf ?? '', rs(s.amount)])) : '',
    table(['', '', ''], [['Quantity', '', `${l.qty} ${l.unit}`], ['Amount', '', rs(l.amount)], ...(l.bonus ? [['Bonus', '', rs(l.bonus)]] : []), ...(l.carried ? [['Carried from last cycle', '', rs(l.carried)]] : []), ...ded.map((d) => [`Less: ${d[0]}`, d[1], d[2]])]),
    `<p><b>Net ${rs(l.net)}</b>${l.carry_out ? ` · carried to next cycle ${rs(l.carry_out)}` : ''} · ${l.mode === 'bank' ? 'Bank transfer' : 'Cash'}</p>`,
  ];
  return page(`${c.number} ${l.name ?? ''}`, body.join(''), narrow ? '@page{size:80mm auto;margin:3mm}body{margin:0;font-size:12px}' : '@page{size:A6;margin:6mm}');
}

/** The cards sheet: `cardsHtml` is the rendered cards (with their QR SVGs), 8 per A4. */
export const cardsPage = (cardsHtml: string): string =>
  page('Farmer cards', cardsHtml, '@page{size:A4;margin:8mm}.cards{display:grid;grid-template-columns:1fr 1fr;gap:6mm}.card{border:1px solid #333;border-radius:4px;padding:4mm;height:62mm;display:flex;gap:4mm;align-items:center;break-inside:avoid}.card svg{width:28mm;height:28mm}');
