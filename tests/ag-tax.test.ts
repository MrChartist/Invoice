/** AG-A3 agri classes by date, typed rate wins, declarations by line mix, RCM line only for notified goods. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { agClassAt } from '../src/lib/agri-rules.ts';
import { classRateNotice, voucherDeclaration } from '../src/lib/agri/ag-tax.ts';
import { agriDeclaration } from '../src/components/templates/paper-helpers.ts';

test('class → rate before / after 22 Sep 2025; packed cereals 5% from 18 Jul 2022', () => {
  assert.equal(agClassAt('ghee_butter', '2025-09-21')!.rate, 12);
  assert.equal(agClassAt('ghee_butter', '2025-09-22')!.rate, 5);
  assert.equal(agClassAt('milk_uht', '2025-09-22')!.rate, 0);
  assert.equal(agClassAt('tractor', '2025-01-01')!.rate, 12);
  assert.equal(agClassAt('cereal_packed_25', '2022-07-17')!.rate, 0);
  assert.equal(agClassAt('cereal_packed_25', '2022-07-18')!.rate, 5);
  assert.equal(agClassAt('milk_fresh', '2026-10-01')!.hsn, '0401');
});

test('a typed rate wins: only a soft notice citing the CA item', () => {
  assert.equal(classRateNotice({ name: 'Ghee', tax_rate: 5, ag_class: 'ghee_butter' }, '2026-01-01'), '');
  assert.match(classRateNotice({ name: 'Ghee', tax_rate: 12, ag_class: 'ghee_butter' }, '2026-01-01'), /differs from the class.*AG4/);
  assert.equal(classRateNotice({ name: 'X', tax_rate: 18 }), '');
});

test('declarations: agriculturist line, RCM line for notified goods only, loose produce on a bill of supply', () => {
  const farmer = { principal_kind: 'agriculturist' };
  assert.match(voucherDeclaration(farmer, [{ hsn: '100610', name: 'Paddy' }], '2026-10-01'), /^Purchased from an agriculturist/);
  assert.match(voucherDeclaration(farmer, [{ hsn: '5201', name: 'Raw cotton' }], '2026-10-01'), /reverse charge/);
  assert.equal(voucherDeclaration({ gstin: '27AAAAA0000A1Z5', principal_kind: 'registered' }, [{ hsn: '100610' }], '2026-10-01'), '');
  assert.equal(agriDeclaration({ doc_type: 'BILL_OF_SUPPLY', items: [{ ag_class: 'cereal_loose' }] } as never), 'Agricultural produce: not pre-packaged and labelled.');
  assert.equal(agriDeclaration({ doc_type: 'INVOICE', items: [{ ag_class: 'cereal_loose' }] } as never), '');
  assert.match(agriDeclaration({ doc_type: 'BILL_OF_SUPPLY', items: [], ag: { kind: 'rent', rent: { exempt: true } } } as never), /storage of agricultural produce/);
  assert.equal(agriDeclaration({ doc_type: 'INVOICE', items: [] } as never), '');
});
