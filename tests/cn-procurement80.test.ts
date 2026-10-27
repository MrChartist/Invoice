/** CN-C5 80% registered-procurement test: registered vs unregistered inputs of the project's cost centre, exclusions
 * (diesel / electricity / TDR), cement from unregistered at its own rate (28% → 18% from 22 Sep 2025), RCM 18% on the
 * rest of the shortfall, and the "Book RCM liability" journal draft. */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { thawDate } from './helpers/shim.ts';
import { realtyWorld } from './helpers/realty.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { bookRcmDraft, procurement80 } from '../src/lib/construction/cn-procurement80.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

afterEach(() => thawDate());

const bill = (id: string, cc: string | undefined, gstin: string | undefined, date: string, lines: [string, string, number][]): PurchaseRecord => ({
  id, kind: 'PURCHASE', vendor_name: id, vendor_gstin: gstin, bill_number: id, date, place_of_supply: '27', category: 'Purchases', cost_centre_id: cc,
  lines: lines.map(([name, hsn, value], i) => ({ id: `${id}-${i}`, name, hsn, unit: 'NOS', quantity: 1, rate: value, tax_rate: 18 })),
  taxable: lines.reduce((s, l) => s + l[2], 0), cgst: 0, sgst: 0, igst: 0, itc_eligible: false, total: lines.reduce((s, l) => s + l[2], 0), amount_paid: 0,
});
const REG = '27AAPFU0939F1ZV';

test('80% test: exclusions, cement RCM at its rate, 18% on the rest of the shortfall', () => {
  const cc = 'cc-p';
  const p = [
    bill('steel', cc, REG, '2026-05-10', [['TMT steel', '7214', 600000]]),
    bill('sand', cc, undefined, '2026-06-10', [['River sand', '2505', 250000]]),
    bill('cement', cc, undefined, '2026-07-10', [['OPC cement', '2523', 100000]]),
    bill('diesel', cc, undefined, '2026-07-11', [['High speed diesel', '2710', 90000]]),
    bill('tdr', cc, undefined, '2026-07-12', [['TDR purchase', '', 500000]]),
    bill('other', 'cc-x', undefined, '2026-07-12', [['Bricks', '6901', 70000]]),
    bill('lastfy', cc, undefined, '2026-03-31', [['Bricks', '6901', 70000]]),
    { ...bill('void', cc, undefined, '2026-07-12', [['Bricks', '6901', 70000]]), status: 'void' } as never,
  ];
  const t = procurement80({ cost_centre_id: cc }, 2026, p);
  assert.deepEqual([t.fy, t.total, t.registered, t.unregistered, t.excluded, t.cementUnreg], ['2026-27', 950000, 600000, 350000, 590000, 100000]);
  assert.equal(t.pct, 63.16);
  assert.equal(t.required, 760000);
  assert.equal(t.shortfall, 160000);
  assert.equal(t.cementRcm, 18000, 'cement at 18% (after 22 Sep 2025)');
  assert.equal(t.rcm18Base, 60000);
  assert.equal(t.rcm, 28800);
  const old = procurement80({ cost_centre_id: cc }, 2024, [bill('c24', cc, undefined, '2024-08-01', [['OPC cement', '2523', 100000]])]);
  assert.equal(old.cementRcm, 28000, 'cement at 28% before 22 Sep 2025');
  const ok = procurement80({ cost_centre_id: cc }, 2026, [bill('s', cc, REG, '2026-05-10', [['Steel', '7214', 800000]]), bill('u', cc, undefined, '2026-05-10', [['Sand', '2505', 200000]])]);
  assert.deepEqual([ok.pct, ok.shortfall, ok.rcm], [80, 0, 0], 'exactly 80% registered: no RCM');
});

test('the RCM journal is a draft (optional voucher) to RCM payable, charged to the project', () => {
  realtyWorld();
  const t = procurement80({ cost_centre_id: 'cc-p' }, 2026, [bill('u', 'cc-p', undefined, '2026-05-10', [['Sand', '2505', 100000]])]);
  const v = bookRcmDraft({ name: 'Green Heights', cost_centre_id: 'cc-p' }, t, '2027-03-31');
  assert.equal(v.variant, 'OPTIONAL');
  assert.equal(v.lines[0].dr, 1440000, '80% of ₹1 lakh at 18% = ₹14,400');
  assert.equal(v.lines[1].account_id, 'rcm_payable');
  assert.equal(v.lines[0].cost_centre_id, 'cc-p');
  assert.equal(loadVouchers().length, 1);
  assert.throws(() => bookRcmDraft({ name: 'x' }, { ...t, rcm: 0 }, '2027-03-31'), /No RCM/);
});
