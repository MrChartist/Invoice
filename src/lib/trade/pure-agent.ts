/**
 * QA8 T9: a pure-agent ("outside", Rule 33 CGST Rules) bill-charge line (TR-B2) is a reimbursement recovered at actual,
 * not a supply: GSTR-1 Table 8 / HSN, GSTR-3B 3.1(c), e-Invoice ItemList and e-Way itemList leave it out (it stays in
 * the document total — e-Invoice `OthChrg`, e-Way `otherValue`). Data only, no imports: GST readers stay small.
 * Working paper — verify with your CA.
 */
export const PURE_AGENT_CHARGE = 'Recovered at actual as a pure agent (Rule 33): outside the taxable value. Verify with your CA.';

/** A charge line of an `outside` head (stamped with the Rule 33 note by `chargeLine`). */
export const isPureAgentLine = (l: { charge_head_id?: string; description?: string } | null | undefined): boolean =>
  !!l?.charge_head_id && l.description === PURE_AGENT_CHARGE;

type DocLine = { charge_head_id?: string; description?: string; tax_rate?: number; quantity?: number; rate?: number; discount_percent?: number };
/** A recovery at actual: the pure-agent key, or a 0 % line whose text says "pure agent" (timesheet lines before PS-B1). */
export const isRecovery = (l: DocLine | null | undefined): boolean =>
  isPureAgentLine(l) || (!!l && !l.charge_head_id && !(Number(l.tax_rate) > 0) && /pure agent/i.test(l.description ?? ''));

/**
 * QA17 R3: the taxable value of a document's pure-agent recoveries — the invoice-calc order (gross − line % − its share
 * of the invoice discount; a 0 % line's taxable is that net, tax-inclusive or not). Turnover, the 194J fee base and
 * the services refund leave it out, as GSTR-1 does. Rupees, 2 dp.
 */
export function recoveryValue(d: { items?: readonly DocLine[]; discount_type?: string; discount_rate?: number }): number {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const net = (d.items ?? []).map((l) => { const g = r2((Number(l.quantity) || 0) * (Number(l.rate) || 0)); return { l, n: r2(g - r2((g * Math.min(Math.max(Number(l.discount_percent) || 0, 0), 100)) / 100)) }; });
  const agent = net.filter((x) => isRecovery(x.l)).reduce((s, x) => s + x.n, 0);
  if (!agent) return 0;
  const base = net.reduce((s, x) => s + x.n, 0);
  const rate = Number(d.discount_rate) || 0;
  const disc = base > 0 ? Math.min(Math.max(d.discount_type === 'AMOUNT' ? rate : (base * Math.min(Math.max(rate, 0), 100)) / 100, 0), base) : 0;
  return r2(agent - (base > 0 ? (disc * agent) / base : 0));
}
