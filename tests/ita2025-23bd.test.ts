/**
 * PENDING 45 (ROADMAP 23b / 23d): Finance Act 2026 TCS presets (LRS education / medical 2 %, overseas tour package
 * 2 %) from 1 Apr 2026, and the 2025-Act section / collection codes of the Protean file formats v1.2 (Forms 140 /
 * 143 / 144, Annexure 2) on the quarterly working papers from Q1 FY 2026-27. Older periods keep the 1961 codes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { TCS_PRESET_RULES, tcsPresets } from '../src/lib/tax-rules.ts';
import { RPU_2025_CODE_RULES, rpuCode2025, tcsCode2025 } from '../src/lib/tds-rules.ts';
import { form26Q, form27EQ, tcsCollections } from '../src/lib/tds-returns.ts';
import { form27Q } from '../src/lib/tds-27q.ts';
import { actKey } from '../src/lib/ita2025.ts';
import type { TdsDeductionRow } from '../src/lib/tds-payables.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

test('23d: tour package and LRS education presets from 1 Apr 2026 only; LRS 20 % kept; row not verified', () => {
  const before = tcsPresets('2026-03-31');
  assert.ok(!before.some((p) => /tour|educat/i.test(p.label)));
  const after = tcsPresets('2026-04-01');
  assert.equal(after.find((p) => /overseas tour/.test(p.label))?.rate, 2);
  assert.equal(after.find((p) => /education/.test(p.label))?.rate, 2);
  assert.equal(after.find((p) => /overseas remittance/.test(p.label))?.rate, 20);
  assert.equal(TCS_PRESET_RULES[TCS_PRESET_RULES.length - 1].verified, false);
  // 2025-Act labels: the tour preset maps to Sl. No. 8, education to the LRS row (Sl. No. 7).
  assert.equal(actKey(after.find((p) => /overseas tour/.test(p.label))!.label), '206C1G-tour');
  assert.equal(actKey(after.find((p) => /education/.test(p.label))!.label), '206C1G');
});

test('23b: 2025-Act codes by date (Protean file format v1.2), none before 1 Apr 2026', () => {
  assert.equal(rpuCode2025('194J', '2026-03-31'), undefined);
  assert.equal(rpuCode2025('194J', '2026-04-01'), '1027');
  assert.equal(rpuCode2025('194C-1', '2026-04-01'), '1023');
  assert.equal(rpuCode2025('194Q', '2026-04-01'), '1031');
  assert.equal(rpuCode2025('195-R', '2026-04-01'), '1057');
  assert.equal(tcsCode2025('206C(1G) overseas remittance 20%', '2026-04-01'), '1087');
  assert.equal(tcsCode2025('206C(1G) LRS education / medical 2%', '2026-04-01'), '1086');
  assert.equal(tcsCode2025('Sec 394(1) Sl. 8 — overseas tour package 2 %', '2026-04-01'), '', 'tour: 1088 / 1089, pick in the RPU');
  assert.equal(tcsCode2025('206C(1) scrap 1%', '2026-04-01'), '1073');
  assert.equal(tcsCode2025('206C(1G) overseas remittance 20%', '2026-03-31'), undefined);
  assert.equal(RPU_2025_CODE_RULES[RPU_2025_CODE_RULES.length - 1].verified, true, 'read in the Protean file formats');
});

function row(over: Partial<TdsDeductionRow>): TdsDeductionRow {
  return {
    key: 'bill:1', source: 'bill', payee: 'Rao', payeeKey: 'pan:ABCPK1234F', pan: 'ABCPK1234F', deducteeType: 'INDIVIDUAL',
    code: '194J', section: '194J', rpu: '4JB', billNumber: 'B1', base: 100000, rate: 10, amount: 10000,
    creditedOn: '2026-05-10', deductedOn: '2026-05-10', reason: '', certNo: '', nonResident: false, fy: 2026, quarter: 1, ...over,
  } as TdsDeductionRow;
}

test('23b: Form 140 / 144 / 143 papers carry the 2025-Act codes; Q4 FY 2025-26 keeps the 1961 codes', () => {
  const p = form26Q([row({})], [], 2026, 1);
  assert.equal(p.deducteeRows[1][2], '1027');
  assert.ok(p.warnings.some((w) => /file format v1\.2/.test(w)));
  assert.ok(!p.warnings.some((w) => /1961-Act RPU codes/.test(w)));
  const old = form26Q([row({ creditedOn: '2026-03-10', deductedOn: '2026-03-10', fy: 2025, quarter: 4 })], [], 2025, 4);
  assert.equal(old.deducteeRows[1][2], '4JB');

  const q = form27Q([row({ code: '195-F', section: '195', rpu: '195', nonResident: true })], [], [], 2026, 1);
  assert.equal(q.deducteeRows[1][2], '1057');

  const inv = (id: string, label: string, rate: number) => ({
    id, doc_type: 'INVOICE', status: 'Sent', invoice_number: `INV/${id}`, issue_date: '2026-05-05',
    client: { name: 'Asha', pan: 'ABCPA1234K' }, total: 102000, tcs_amount: 2000, tcs_rate: rate, tcs_label: label,
  }) as unknown as InvoiceRecord;
  const rows = tcsCollections([inv('a', '206C(1G) LRS education / medical 2%', 2), inv('b', '206C(1G) overseas remittance 20%', 20)]);
  const e = form27EQ(rows, [], 2026, 1);
  assert.deepEqual(e.deducteeRows.slice(1).map((r) => r[2]), ['1086', '1087']);
});
