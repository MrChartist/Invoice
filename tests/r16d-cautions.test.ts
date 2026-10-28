/**
 * R16-D3: cautions that were never shown — the realty no-ITC caution on a builder's bill not charged to a project
 * (override audited, PF18), the works-contract class-rate notice in the GST guards (CN1), and the R15-B ITC-reason
 * refusal through the travel strings (Hindi).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setTable } from '../src/lib/storage.ts';
import { audit } from '../src/lib/audit.ts';
import { billWarnings, saveBillGuarded } from '../src/lib/bill-guard.ts';
import { cnExceptions } from '../src/lib/construction/cn-guard.ts';
import { tvT } from '../src/i18n/areas/travel-r15b.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const builder = () => {
  const s = localDb.settings.get();
  localDb.settings.save({ ...s, industry_packs: ['realty', 'works'] } as never);
};
const bill = (over: Record<string, unknown> = {}) =>
  ({ kind: 'PURCHASE', vendor_name: 'Steel Co', bill_number: 'S/1', date: '2026-07-10', lines: [{ id: 'l', name: 'TMT', quantity: 1, rate: 100000, tax_rate: 18 }], taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, total: 118000, itc_eligible: true, amount_paid: 0, ...over }) as never;
const realty = (w: string[]) => w.some((m) => m.includes('PF18') || m.includes('CN34'));

test('D3: a builder\'s bill claiming ITC without a project gets the caution; untagged and no realty pack → none', () => {
  assert.ok(!realty(billWarnings(bill(), [])), 'no realty pack, no caution');
  builder();
  assert.ok(billWarnings(bill(), []).some((m) => m.includes('PF18')), 'company caution with its CA id');
  assert.ok(!realty(billWarnings(bill({ itc_eligible: false }), [])), 'ITC unticked');
  setTable('realty_projects', [{ id: 'p1', name: 'Old Tower', cost_centre_id: 'cc1', gst_scheme: 'old_option' }]);
  assert.ok(!realty(billWarnings(bill(), [])), 'a project on the old 8% / 12% option may take ITC');
  setTable('realty_projects', [{ id: 'p1', name: 'Green Heights', cost_centre_id: 'cc1', gst_scheme: 'n03_2019' }]);
  assert.ok(billWarnings(bill({ cost_centre_id: 'cc1' }), []).some((m) => m.includes('Green Heights') && m.includes('CN34')));
});

test('D3: saving past the caution is an override, audited with the note as the reason', () => {
  builder();
  const first = saveBillGuarded(bill({ notes: 'Capital goods for the let-out mall' }));
  assert.equal(first.kind, 'warn');
  const saved = saveBillGuarded(bill({ notes: 'Capital goods for the let-out mall' }), { confirmed: true });
  assert.equal(saved.kind, 'saved');
  audit.flush?.();
  const row = audit.rows().find((r) => r.action === 'override' && r.entity_id === (saved as { bill: { id: string } }).bill.id);
  assert.ok(row && /PF18/.test(row.summary ?? '') && /let-out mall/.test(row.summary ?? ''));
});

test('D3: GST guard — a works-contract line whose rate differs from its class (CN1)', () => {
  const inv = {
    id: 'i', issue_date: '2026-06-30', items: [{ id: 'a', name: 'Civil works', tax_rate: 12 }, { id: 'b', name: 'Steel supply', tax_rate: 18 }, { id: 'c', name: 'Catalogue', tax_rate: 5, cn_class: 'wc_general' }],
    boq_terms: { cn: { lines: { a: { cls: 'wc_general' }, b: { cls: 'supply_goods' } } } },
  } as never;
  assert.deepEqual(cnExceptions(inv).map((e) => [e.code, e.vars.name, e.vars.want]), [['CN_CLASS_RATE', 'Civil works', 18], ['CN_CLASS_RATE', 'Catalogue', 18]]);
  const guards = readFileSync('src/lib/gst-guards.ts', 'utf8');
  assert.match(guards, /import\('\.\/construction\/cn-guard'\)/, 'loaded lazily by the GST guards');
  assert.match(readFileSync('src/components/gst-reports/Gst8dPanel.tsx', 'utf8'), /CN_CLASS_RATE: 'exCnClass'/);
  const area = readFileSync('src/i18n/areas/gst-guards.ts', 'utf8');
  assert.equal(area.match(/exCnClass:/g)?.length, 2, 'English and Hindi');
});

test('D3: the R15-B ITC-reason refusal goes through the travel strings (Hindi), no English literal in the bill form', () => {
  assert.match(tvT('needReason'), /TV8/);
  assert.match(readFileSync('src/i18n/areas/travel-r15b.ts', 'utf8'), /needReason: '5 % यात्रा/);
  assert.doesNotMatch(readFileSync('src/components/purchases/BillModal.tsx', 'utf8'), /needs a reason/);
});
