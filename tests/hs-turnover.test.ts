/**
 * R18-B3: FY turnover (exempt bills and non-member income in, pure-agent dues out, credit notes reduce, drafts /
 * cancelled out), thresholds by State, units above the limit, the Circular 109 Q2 position, and the inward-RCM hint.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fyTurnover, position, rcmHint, regThreshold, unitsAbove } from '../src/lib/society/hs-turnover.ts';
import { recoveryValue } from '../src/lib/trade/pure-agent.ts';
import { ruleAt } from '../src/lib/tax-rules.ts';
import { SECURITY_RCM_RULES } from '../src/lib/manpower-rules.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

const PA = 'Recovered at actual as a pure agent (Rule 33): outside the taxable value. Verify with your CA.';
const doc = (o: Partial<InvoiceRecord>): InvoiceRecord => ({ id: String(Math.random()), status: 'Sent', issue_date: '2026-10-01', items: [], ...o }) as InvoiceRecord;
const BOS = doc({ doc_type: 'BILL_OF_SUPPLY', taxable_value: 6710, items: [{ id: 'a', name: 'svc', quantity: 1, rate: 5510, amount: 5510 }, { id: 'b', name: 'ptx', quantity: 1, rate: 1200, amount: 1200, charge_head_id: 'rule33', description: PA }] as never, hs: { unit: { id: 'u1', code: 'A-101', members: [] }, period: '2026-10', test: { counted: 5510, limit: 7500, months: 1 } } });
const TAX = doc({ doc_type: 'TAX_INVOICE', taxable_value: 12010, items: [{ id: 'a', name: 'svc', quantity: 1, rate: 9010, amount: 9010, tax_rate: 18 }, { id: 'b', name: 'ptx', quantity: 1, rate: 3000, amount: 3000, charge_head_id: 'rule33', description: PA }] as never, hs: { unit: { id: 'u3', code: 'A-901', members: [] }, period: '2026-10', test: { counted: 9010, limit: 7500, months: 1 } } });

test('FY turnover: exempt and taxable without the pure-agent dues; credit notes reduce; drafts, cancelled and other dates out', () => {
  const all = [BOS, TAX, doc({ doc_type: 'TAX_INVOICE', taxable_value: 20000 }), doc({ doc_type: 'CREDIT_NOTE', taxable_value: 1000 }), doc({ doc_type: 'TAX_INVOICE', taxable_value: 5, status: 'Draft' }), doc({ doc_type: 'TAX_INVOICE', taxable_value: 7, status: 'Cancelled' }), doc({ doc_type: 'TAX_INVOICE', taxable_value: 9, issue_date: '2026-03-31' })];
  assert.deepEqual(fyTurnover(all, '2026-04-01', '2026-10-31', recoveryValue), { exempt: 5510, taxable: 9010 + 20000 - 1000, total: 33520 });
  assert.equal(regThreshold('27', '2026-10-01'), 2000000);
  assert.equal(regThreshold('14', '2026-10-01'), 1000000, 'Manipur: special-category row (unverified)');
  assert.deepEqual(unitsAbove([BOS, TAX, { ...TAX, status: 'Cancelled' }], '2026-10'), ['A-901']);
  assert.deepEqual(position(1900000, 2000000, 1), { big: false, above: true, hint: false });
  assert.deepEqual(position(2000000, 2000000, 1), { big: true, above: true, hint: true });
  assert.equal(position(2500000, 2000000, 0).hint, false);
});

test('inward RCM hint: security services (99852x) from a non-company to a registered society, not yet reverse charge', () => {
  const rule = ruleAt(SECURITY_RCM_RULES, '2026-10-01');
  const bill = { lines: [{ hsn: '998525' }] };
  assert.equal(rcmHint(bill, { gstin: '27AAPFU0939F1ZV' }, true, rule), true, 'a firm (PAN 4th letter F)');
  assert.equal(rcmHint(bill, { gstin: '27AABCU9603R1ZV' }, true, rule), false, 'a company is a body corporate');
  assert.equal(rcmHint(bill, { gstin: '27AAPFU0939F1ZV' }, false, rule), false, 'an unregistered society');
  assert.equal(rcmHint({ ...bill, reverse_charge: true }, { gstin: '27AAPFU0939F1ZV' }, true, rule), false);
  assert.equal(rcmHint({ lines: [{ hsn: '998533' }] }, undefined, true, rule), false, 'housekeeping is not entry 14');
  assert.equal(rcmHint(bill, undefined, true, ruleAt(SECURITY_RCM_RULES, '2018-12-31')), false, 'before 1 Jan 2019');
});
