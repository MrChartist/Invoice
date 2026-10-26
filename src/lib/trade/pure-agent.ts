/**
 * QA8 T9: a pure-agent ("outside", Rule 33 CGST Rules) bill-charge line (TR-B2) is a reimbursement recovered at actual,
 * not a supply: GSTR-1 Table 8 / HSN, GSTR-3B 3.1(c), e-Invoice ItemList and e-Way itemList leave it out (it stays in
 * the document total — e-Invoice `OthChrg`, e-Way `otherValue`). Data only, no imports: GST readers stay small.
 * Working paper — verify with your CA.
 */
export const PURE_AGENT_CHARGE = 'Recovered at actual as a pure agent (Rule 33) — outside the taxable value. Verify with your CA.';

/** A charge line of an `outside` head (stamped with the Rule 33 note by `chargeLine`). */
export const isPureAgentLine = (l: { charge_head_id?: string; description?: string } | null | undefined): boolean =>
  !!l?.charge_head_id && l.description === PURE_AGENT_CHARGE;
