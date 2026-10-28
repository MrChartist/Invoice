/** RT-C3 alteration slips: ALT numbering (a deleted number stays used), status flow, the charge line, tailor bill, pack gate. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { DB_PREFIX, getTable, setReadTrace } from '../src/lib/storage.ts';
import '../src/lib/trust/recycle-bin.ts';
import { addAlteration, billedJobs, canMove, chargeLine, deleteAlteration, dueJobs, loadAlterations, makeTailorBill, moveAlteration, nextStatus, readyLink, tailorJobs } from '../src/lib/retail/rt-alterations.ts';
import { syncBands } from '../src/lib/retail/rt-bands.ts';
import { draftsDb } from '../src/lib/purchase-drafts.ts';
import { calculateInvoice, calcInputFromRecord } from '../src/lib/invoice-calc.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});
const DAY = '2026-07-20';
const slip = (over = {}) => addAlteration({ date: DAY, customer: 'Ravi', phone: '98000 00001', garment: 'Trousers', notes: 'Shorten 2 cm', due: '2026-07-23', tailor_id: 'v-imran', tailor_name: 'Imran', tailor_rate: 50, ...over });
const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('ALT/FY numbering; a deleted number is never reused; the slip goes to the recycle bin', () => {
  const a = slip();
  const b = slip({ charge: 300, garment: 'Blazer' });
  assert.deepEqual([a.number, b.number], ['ALT/FY26-27/0001', 'ALT/FY26-27/0002']);
  assert.equal(slip({ date: '2027-04-02', due: '2027-04-05' }).number, 'ALT/FY27-28/0001');
  deleteAlteration(b.id);
  assert.equal(loadAlterations().length, 2);
  assert.ok(getTable<{ table?: string }>('recycle_bin').length >= 1, 'deleted slip in the recycle bin');
  assert.equal(slip().number, 'ALT/FY26-27/0003', '0002 stays used');
  assert.throws(() => slip({ customer: ' ' }), /customer/);
  assert.throws(() => slip({ due: '2026-07-19' }), /due day is before/);
});

test('status flow: received → with tailor → ready → delivered, or cancelled', () => {
  assert.deepEqual([nextStatus('received'), nextStatus('with_tailor'), nextStatus('ready'), nextStatus('delivered'), nextStatus('cancelled')], ['with_tailor', 'ready', 'delivered', undefined, undefined]);
  assert.ok(canMove('ready', 'cancelled') && !canMove('delivered', 'cancelled') && !canMove('received', 'ready'));
  const a = slip();
  assert.throws(() => moveAlteration(a.id, 'ready', DAY), /cannot move/);
  moveAlteration(a.id, 'with_tailor', DAY);
  assert.equal(dueJobs(loadAlterations(), '2026-07-23').length, 1, 'due on the day, not ready yet');
  const r = moveAlteration(a.id, 'ready', '2026-07-22');
  assert.equal(r.ready_on, '2026-07-22');
  assert.equal(dueJobs(loadAlterations(), '2026-07-23').length, 0);
  assert.equal(readyLink(r, 'Ready'), 'https://wa.me/919800000001?text=Ready');
  assert.equal(moveAlteration(a.id, 'delivered', '2026-07-23').delivered_on, '2026-07-23');
  assert.throws(() => moveAlteration(a.id, 'cancelled', DAY), /cannot move/);
});

test('a charged alteration is a service line at the rule\'s SAC and rate; a free one adds nothing', () => {
  const free = slip();
  assert.equal(chargeLine(free, DAY, 'x'), null);
  const paid = slip({ charge: 300, garment: 'Blazer' });
  const l = chargeLine(paid, DAY, 'c1')!;
  assert.deepEqual([l.type, l.hsn, l.tax_rate, l.rate, l.quantity, l.description], ['Service', '998821', 5, 300, 1, paid.number]);
  const bill = { id: 'i1', doc_type: 'INVOICE', status: 'Sent', issue_date: DAY, gst_mode: 'CGST_SGST', items: [l] } as unknown as InvoiceRecord;
  assert.equal(calculateInvoice(calcInputFromRecord(bill)).total, 315);
  assert.deepEqual([...billedJobs(loadAlterations(), [bill])], [paid.id]);
  assert.deepEqual([...billedJobs(loadAlterations(), [{ ...bill, status: 'Cancelled' }])], []);
  // The service line is not a band line: syncBands leaves it alone.
  assert.equal(syncBands(bill), bill.items);
});

test('tailor bill: delivered, unbilled jobs of the period at the tailor\'s rates, as a purchase draft without GST', async () => {
  const a = slip();
  const b = slip({ garment: 'Kurta', tailor_rate: 80 });
  const c = slip({ garment: 'Saree fall', tailor_id: 'v-other', tailor_name: 'Other' });
  const late = slip({ garment: 'Late' });
  for (const j of [a, b, c, late]) {
    moveAlteration(j.id, 'with_tailor', DAY);
    moveAlteration(j.id, 'ready', DAY);
  }
  moveAlteration(a.id, 'delivered', '2026-07-21');
  moveAlteration(b.id, 'delivered', '2026-07-24');
  moveAlteration(c.id, 'delivered', '2026-07-24');
  moveAlteration(late.id, 'delivered', '2026-08-02');
  assert.deepEqual(tailorJobs(loadAlterations(), 'v-imran', '2026-07-20', '2026-07-31').map((j) => j.id), [a.id, b.id]);
  const r = await makeTailorBill({ id: 'v-imran', name: 'Imran' }, '2026-07-20', '2026-07-31');
  assert.deepEqual([r.n, r.total], [2, 130]);
  const d = draftsDb.get(r.id)!;
  assert.deepEqual([d.kind, d.category, d.cgst + d.sgst + d.igst, d.itc_eligible, d.lines.length, d.vendor_id], ['EXPENSE', 'Tailoring charges', 0, false, 2, 'v-imran']);
  assert.ok(loadAlterations().filter((j) => j.tailor_bill_id === r.id).length === 2);
  await assert.rejects(makeTailorBill({ id: 'v-imran', name: 'Imran' }, '2026-07-20', '2026-07-31'), /No delivered/);
  assert.throws(() => deleteAlteration(a.id), /tailor has been billed/);
});

test('pack-off gate: band and exception code read no alteration slips; the POS mounts the apparel row only with the pack', () => {
  slip();
  const seen = new Set<string>();
  const prev = setReadTrace(seen);
  try {
    syncBands({ doc_type: 'INVOICE', issue_date: DAY, items: [{ id: 'l', name: 'Soap', quantity: 1, rate: 50, tax_rate: 18, amount: 50 }] } as never);
  } finally {
    setReadTrace(prev);
  }
  assert.ok(!seen.has(DB_PREFIX + 'alteration_jobs') && !seen.has('alteration_jobs'));
  assert.match(src('pages/Pos.tsx'), /isPackOn\(settings, 'apparel'\) && <Suspense fallback=\{null\}><PosApparel /);
  // PENDING #23: the bill, PO and GRN editors share one slot; the apparel gate sits in it.
  assert.match(src('components/purchases/BillModal.tsx'), /<SizeGridSlot lines=\{lines\}/);
  assert.match(src('components/purchases/SizeGridSlot.tsx'), /includes\('apparel'\)\) return null;\s+return <Suspense fallback=\{null\}><BillGrid /);
  assert.match(src('components/creator/ItemsTable.tsx'), /\(apparelOn \|\| items\.some\(\(i\) => i\.band_rate\)\) && <Suspense/);
  assert.match(src('lib/retail/rt-alterations.ts'), /^import '\.\/rt-registry';/m);
});
