/**
 * PENDING #16 (MF-C3-4): the Job Work In charges invoice suggests the job-charges class from `TEXTILE_CLASS_RULES` by the
 * HSN chapter of the principal's goods; the rate follows the dated row; the modal offers the class and a typed rate wins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chargesClassRate, jobChargesClass, orderChargesClass } from '../src/lib/mfg/mf-jw-class.ts';
import type { PrincipalMovement } from '../src/types/job-work.ts';

test('class by HSN chapter: textile ch 50-63, print ch 48 / 49, else other', () => {
  assert.equal(jobChargesClass(['5208', '9988']), 'jw_textile');
  assert.equal(jobChargesClass(['6109']), 'jw_textile');
  assert.equal(jobChargesClass(['4901']), 'jw_print_ch48_49');
  assert.equal(jobChargesClass(['4819', '5407']), 'jw_textile', 'textile wins over print');
  assert.equal(jobChargesClass(['7308', undefined, '']), 'jw_other');
  assert.equal(jobChargesClass([]), 'jw_other');
});

test('the order class reads receipts of that order only; rates follow the dated rows', () => {
  const mv = (order_id: string, kind: 'receipt' | 'return', hsn: string): PrincipalMovement =>
    ({ id: order_id + kind + hsn, number: 'JWP/1', date: '2026-01-01', order_id, kind, party_name: 'P', lines: [{ id: 'l', name: 'x', qty: 1, hsn }] });
  const rows = [mv('o1', 'receipt', '5208'), mv('o2', 'receipt', '7308'), mv('o2', 'return', '5208')];
  assert.equal(orderChargesClass(rows, 'o1'), 'jw_textile');
  assert.equal(orderChargesClass(rows, 'o2'), 'jw_other');
  assert.deepEqual(chargesClassRate('jw_textile', '2026-01-01'), { rate: 5, ca: 'MF2' });
  assert.equal(chargesClassRate('jw_other', '2026-01-01').rate, 18);
  assert.deepEqual([chargesClassRate('jw_print_ch48_49', '2025-09-21').rate, chargesClassRate('jw_print_ch48_49', '2025-09-22').rate], [12, 5]);
});

test('the charges modal pre-picks the suggested class instead of a fixed 18%', () => {
  const src = readFileSync(new URL('../src/components/job-work/PrincipalPanel.tsx', import.meta.url), 'utf8');
  assert.match(src, /orderChargesClass\(data\.principal, order\.id\)/);
  assert.ok(!src.includes("useState('18')"), 'no fixed 18% default');
});
