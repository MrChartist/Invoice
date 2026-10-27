/**
 * AG-A4 Rule 6DD(e) cash check (pure, no imports — the existing cash guards call it with one guarded line). Cash paid to
 * the cultivator, grower or producer of agricultural produce, dairy or poultry products, fish, horticulture or
 * apiculture products is outside Sec 40A(3) (Rule 6DD(e)). Read narrowly (Mad HC 2025): only a vendor marked
 * `principal_kind: 'agriculturist'` (a farmer) or a pooled farmer cycle counts — a company, trader or processor keeps the
 * warning. The 2025-Act equivalent is not confirmed (`agri-rules.ts` `RULE_6DDE_RULES`). Verify with your CA (AG14).
 */

/** The payee is a cultivator / producer (a farmer vendor, or a pooled farmer cycle). */
export const isCultivatorPayee = (p: { principal_kind?: string; ag?: { code?: string } | { cycle_id?: string } } | null | undefined): boolean =>
  !!p && (p.principal_kind === 'agriculturist' || !!(p.ag as { cycle_id?: string } | undefined)?.cycle_id);

export const RULE_6DDE_NOTE = 'Cash to a cultivator / producer — Rule 6DD(e); keep the farmer\'s acknowledgement (verify with your CA, AG14).';

/**
 * The note for a cash payment of `paidToday` (to one person, that day) above `limit`: the Rule 6DD(e) note for a
 * cultivator, else the Sec 40A(3) warning `warn` the caller already built. '' at or under the limit.
 */
export function cashPayeeNote(payee: Parameters<typeof isCultivatorPayee>[0], paidToday: number, limit: number, warn: string): string {
  if (!(Number(paidToday) > limit)) return '';
  return isCultivatorPayee(payee) ? RULE_6DDE_NOTE : warn;
}
