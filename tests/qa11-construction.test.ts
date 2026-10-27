/**
 * QA round 11 (construction, CN-A … CN-D) regressions — docs/prd/qa-round-11.md, findings C1 … C12. Each test names
 * its finding; every one failed on `claude/elegant-cannon-cwapiv` at f5645b2 (CN-A … CN-D merged).
 */
import './helpers/shim.ts';
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { thawDate } from './helpers/shim.ts';
import { siteWorld, SUB } from './helpers/site-ops.ts';
import { DEPT, setupWorks } from './helpers/transport-works.ts';
import { BUYER, book, realtyWorld } from './helpers/realty.ts';
import { gstin } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { loadAdvances, refundAdvance } from '../src/lib/advances.ts';
import { advanceBalance } from '../src/lib/advance-tax.ts';
import { deleteVoucher, loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { loadLedger } from '../src/lib/ledger/index.ts';
import { A } from '../src/lib/ledger/accounts.ts';
import { billWarnings } from '../src/lib/bill-guard.ts';
import { saveRaBill, gstTdsProvisoApplies } from '../src/lib/works/measurements.ts';
import { saveContract } from '../src/lib/construction/cn-contracts.ts';
import { billPv, savePv } from '../src/lib/construction/cn-escalation.ts';
import { recordSecured, deleteSecured } from '../src/lib/construction/cn-secured.ts';
import { fromBoq, saveWorkOrder } from '../src/lib/construction/cn-subcon.ts';
import { cancelSubBill, loadSubBills, saveSubBill } from '../src/lib/construction/cn-subcon-bill.ts';
import { loadMuster, markDay, saveLabour, settleWeek, undoSettlement } from '../src/lib/construction/cn-muster.ts';
import { saveHired, saveLog } from '../src/lib/construction/cn-plant.ts';
import { bookHireIn } from '../src/lib/construction/cn-plant-hire.ts';
import { gatherSitePnl, sitePnl } from '../src/lib/construction/cn-site-pnl.ts';
import { recordReceipt } from '../src/lib/construction/cn-bookings.ts';
import { cancelBooking } from '../src/lib/construction/cn-cancellations.ts';
import { saveConstructionSettings } from '../src/lib/construction/cn-settings.ts';
import { certifyStage } from '../src/lib/construction/cn-plans.ts';
import { delayInterest, raiseDemands } from '../src/lib/construction/cn-demands.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

afterEach(() => thawDate());
const P = { start: '2026-04-01', end: '2027-03-31' };
const bin = () => getTable<{ id: string; table: string; row_id: string }>('recycle_bin');
const balance = (account: string, party?: string) => loadLedger().vouchers.flatMap((v) => v.lines).filter((l) => l.account === account && (!party || l.party === party)).reduce((s, l) => s + l.dr - l.cr, 0);

test('C1: node_modules is ignored as a file too (a committed symlink broke every checkout)', () => {
  const lines = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(lines.includes('node_modules'), '"node_modules/" only matches a directory, not the symlink that was committed');
  assert.ok(!existsSync(new URL('../src/components/construction/R11Stub.tsx', import.meta.url)), 'C12: the unused builder stub is gone');
});

test('C2: forfeiture out of an open booking advance closes it (no phantom debtor, no second refund)', () => {
  const w = realtyWorld('2026-10-27');
  saveConstructionSettings({ realty: { forfeit_pct: 2 } });
  const b = book(w);
  recordReceipt(b.id, { date: '2026-05-02', amount: 750000, method: 'Bank transfer', bankAccountId: 'rera' });
  const c = cancelBooking(b.id, '2026-10-27', 'Buyer request').cancellation!;
  assert.deepEqual([c.forfeiture, c.refund], [150000, 600000]);
  const adv = loadAdvances()[0];
  const bal = advanceBalance(adv, getTable('transactions'), localDb.invoices.getAll());
  assert.deepEqual([bal.refunded, bal.forfeited, bal.open], [600000, 150000, 0], 'the kept part closes the advance');
  assert.throws(() => refundAdvance(adv.id, { amount: 1000, date: '2026-10-28', method: 'Cash' }), /./, 'nothing is left to refund');
  const j = loadVouchers().find((v) => v.id === c.journal_id)!;
  assert.equal(j.variant, undefined, 'posted: the advance register closed at once');
  assert.equal(adv.forfeits?.[0].journal_id, j.id);
  // Books: the buyer's advance and Debtors both at zero; the GST paid on the kept part leaves "GST paid on advances".
  assert.equal(balance(A.custAdvances, BUYER.name), 0);
  assert.equal(balance(A.debtors, BUYER.name), 0);
  assert.equal(balance(A.gstOnAdvances), 0);
  assert.throws(() => deleteVoucher(j.id), /closed the buyer's advance/);
});

test('C2: a forfeiture wholly out of the demands\' credit stays a draft journal on Debtors (unchanged)', () => {
  const w = realtyWorld('2026-10-27');
  saveConstructionSettings({ realty: { forfeit_pct: 2 } });
  const b = book(w);
  recordReceipt(b.id, { date: '2026-05-02', amount: 1500000, method: 'Bank transfer' });
  raiseDemands(certifyStage({ project_id: w.project.id, tower_id: w.tower.id, stage_id: w.plan.stages[2].id, stage_label: 'Plinth', certified_on: '2026-06-01', by: 'A' }).id, '2026-06-01');
  const c = cancelBooking(b.id, '2026-10-27', 'Buyer request').cancellation!;
  const j = loadVouchers().find((v) => v.id === c.journal_id)!;
  assert.equal(j.variant, 'OPTIONAL');
  assert.deepEqual(j.lines.map((l) => l.account_id).slice(0, 1), [A.debtors]);
  assert.equal(advanceBalance(loadAdvances()[0], getTable('transactions'), localDb.invoices.getAll()).forfeited, undefined);
});

test('C3: site P&L counts what the client recovers on our RA bills as our cost', () => {
  const w = siteWorld();
  saveContract({ boq_id: w.boq.id, client_id: DEPT.id, client_name: DEPT.name, name_of_work: 'Road', contract_value: 1150000, stipulated_completion: '2026-06-15', water_pct: 1, power_pct: 1 });
  saveRaBill(w.boq.id, { date: '2026-06-30', lines: [{ line_id: 'l2', cumulative_qty: 100 }], recoveries: [{ kind: 'material_recovery', qty: 20, rate: 450 }, { kind: 'hire_charges', amount: 4000 }, { kind: 'ld', amount: 3000 }, { kind: 'withheld', amount: 5000, reason: 'Drain' }] });
  const p = sitePnl(gatherSitePnl(localDb.invoices.getById(w.boq.id)!, P));
  assert.equal(p.revenue.taxable, 450000);
  assert.deepEqual([p.costs.material, p.costs.plant, p.costs.other], [9000, 4000, 9000 + 3000], 'material issued; plant hire; water & power + LD (withheld is held, not a cost)');
  assert.equal(p.margin, 450000 - 25000);
});

test('C7: a draft RA bill is measured, not billed (site P&L WIP)', () => {
  const w = siteWorld();
  saveRaBill(w.boq.id, { date: '2026-06-30', draft: true, lines: [{ line_id: 'l2', cumulative_qty: 100 }] });
  const p = sitePnl(gatherSitePnl(localDb.invoices.getById(w.boq.id)!, P));
  assert.deepEqual([p.revenue.taxable, p.wip.unbilled], [0, 450000]);
});

test('C8: a price-variation bill carries the contract\'s BOQ, so the site P&L sees it', () => {
  const w = siteWorld();
  const c = saveContract({ boq_id: w.boq.id, client_id: DEPT.id, client_name: DEPT.name, name_of_work: 'Road', contract_value: 1150000, escalation: { clause: '10CC', components: [{ key: 'cement', label: 'Cement', share_pct: 100, base_index: 100 }] } as never });
  saveRaBill(w.boq.id, { date: '2026-06-30', lines: [{ line_id: 'l2', cumulative_qty: 100 }] });
  const pv = savePv({ contract: c, date: '2026-07-05', period_from: '2026-06-01', period_to: '2026-06-30', indices: [{ key: 'cement', current_index: 110 }] });
  const { doc } = billPv(pv.id, '2026-07-05');
  assert.equal(doc.boq_id, w.boq.id);
  assert.equal(doc.ra_no, undefined, 'never an RA bill');
  assert.equal(sitePnl(gatherSitePnl(localDb.invoices.getById(w.boq.id)!, P)).revenue.taxable, 450000 + doc.taxable_value);
});

test('C4 / C5: construction journals and a measured sub-contractor bill go only from their own screens', () => {
  const w = siteWorld();
  const wo = saveWorkOrder({ date: '2026-06-01', vendor_id: SUB.id, vendor_name: SUB.name, boq_id: w.boq.id, site_id: w.site.id, cost_centre_id: w.cc.id, lines: fromBoq(w.boq, ['l2'], 90), deductions: [{ kind: 'retention', rate: 5 }] });
  const { bill, measurement } = saveSubBill(wo.id, { date: '2026-06-30', qty: [{ line_id: wo.lines[0].id, cumulative: 50 }] });
  assert.throws(() => deleteVoucher(bill.cn_sub!.jv_id!), /cancel the sub-contractor bill/);
  assert.throws(() => purchasesDb.remove(bill.id), /made from a measurement/);
  cancelSubBill(measurement.id); // its own path still removes both
  assert.equal(purchasesDb.get(bill.id), undefined);
  assert.equal(loadVouchers().length, 0);
  assert.equal(loadSubBills()[0].status, 'cancelled');

  const a = saveLabour({ name: 'Ramu', trade: 'Mason', daily_rate: 800, ot_rate: 0, site_id: w.site.id });
  markDay(w.site.id, '2026-07-06', [{ labour_id: a.id, present: 1 }]);
  const s = settleWeek(w.site, '2026-07-06', '2026-07-12', { date: '2026-07-12', method: 'Cash' });
  assert.throws(() => deleteVoucher(s.voucher.id), /undo the settlement/);
  undoSettlement(s.number);
  assert.equal(loadMuster()[0].mus_no, undefined);
  assert.ok(!loadVouchers().some((v) => v.id === s.voucher.id));

  const c = saveContract({ boq_id: w.boq.id, client_id: DEPT.id, client_name: DEPT.name, name_of_work: 'Road', contract_value: 1150000 });
  const sa = recordSecured({ contract_id: c.id, party: DEPT.name, date: '2026-07-01', materials: [{ description: 'Steel', qty: 10, rate: 60000 }] });
  assert.throws(() => deleteVoucher(sa.voucher_id!), /delete the secured advance/);
  deleteSecured(sa.id, localDb.invoices.getAll());
  assert.ok(!loadVouchers().some((v) => v.id === sa.voucher_id));
});

test('C6: GST TDS u/s 51 — not deducted when our State and the site are one State and the client is registered in another', () => {
  assert.equal(gstTdsProvisoApplies('27', '27', gstin('29AAAGK0100A1Z')), true);
  assert.equal(gstTdsProvisoApplies('27', '27', gstin('27AAAGP0100A1Z')), false);
  assert.equal(gstTdsProvisoApplies('27', '29', gstin('29AAAGK0100A1Z')), false, 'IGST to a recipient registered at the site: deducted');
  assert.equal(gstTdsProvisoApplies('27', '27', undefined), false);
  const boq = setupWorks();
  const ka = { ...boq.client, gstin: gstin('29AAAGK0100A1Z'), state_code: '29' };
  localDb.clients.upsert({ ...DEPT, ...ka });
  localDb.invoices.save({ ...boq, client: ka, place_of_supply: '27', boq_terms: { deductions: [{ kind: 'gst_tds' }, { kind: 'retention', rate: 5 }], site: { address: 'Pune', state_code: '27' } } } as InvoiceRecord);
  const inv = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] }).invoice;
  assert.equal(inv.place_of_supply, '27');
  assert.deepEqual(inv.ra_deductions?.map((d) => d.kind), ['retention'], 'no GST TDS under the proviso');
});

test('C9: bills charged to a 1% / 5% project take no ITC; the bill form cautions', () => {
  const w = siteWorld();
  setTable('realty_projects', [{ id: 'p1', name: 'Green Heights', cost_centre_id: w.cc.id, gst_scheme: 'n03_2019', towers: [] }]);
  const wo = saveWorkOrder({ date: '2026-06-01', vendor_id: SUB.id, vendor_name: SUB.name, boq_id: w.boq.id, site_id: w.site.id, cost_centre_id: w.cc.id, lines: fromBoq(w.boq, ['l2'], 90), deductions: [] });
  const { bill } = saveSubBill(wo.id, { date: '2026-06-30', qty: [{ line_id: wo.lines[0].id, cumulative: 10 }] });
  assert.equal(bill.itc_eligible, false, 'GSTR-3B: no ITC for the builder');
  const hired = saveHired({ vendor_id: 'v-hire', vendor_name: 'Crane Hire Co', description: 'Crane', rate: 20000, basis: 'day', with_operator: true, from: '2026-07-01' });
  saveLog({ date: '2026-07-01', equipment_ref: `hire:${hired.id}`, site_id: w.site.id, hours_worked: 8, idle_hours: 0, breakdown_hours: 0, fuel_litres: 0 });
  assert.equal(bookHireIn(hired.id, '2026-07', 'CR/1').itc_eligible, false);
  const settings = localDb.settings.get();
  localDb.settings.save({ ...settings, industry_packs: [...(settings.industry_packs ?? []), 'realty'] } as never);
  const input = { kind: 'PURCHASE', vendor_name: 'Steel Co', bill_number: 'S/1', date: '2026-07-10', lines: [], taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, total: 118000, itc_eligible: true, amount_paid: 0, cost_centre_id: w.cc.id } as never;
  assert.ok(billWarnings(input, []).some((m) => m.includes('Green Heights')));
  assert.ok(!billWarnings({ ...(input as object), itc_eligible: false } as never, []).some((m) => m.includes('Green Heights')));
});

test('C10: the recycle bin never brings back a demand / RA bill / PV bill next to the one made again', async () => {
  const { restoreEntry } = await import('../src/lib/trust/recycle-bin.ts');
  const w = realtyWorld('2026-10-27');
  book(w);
  const cert = certifyStage({ project_id: w.project.id, tower_id: w.tower.id, stage_id: w.plan.stages[2].id, stage_label: 'Plinth', certified_on: '2026-06-01', by: 'A' });
  const [d] = raiseDemands(cert.id, '2026-06-01');
  localDb.invoices.remove(d.id);
  raiseDemands(cert.id, '2026-06-02');
  assert.throws(() => restoreEntry(bin().find((x) => x.table === 'invoices' && x.row_id === d.id)!.id), /demanded again/);

  const boq = setupWorks();
  const { invoice } = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] });
  localDb.invoices.remove(invoice.id);
  const entry = bin().find((x) => x.table === 'invoices' && x.row_id === invoice.id)!;
  saveRaBill(boq.id, { date: '2026-07-01', lines: [{ line_id: 'l1', cumulative_qty: 400 }] });
  assert.throws(() => restoreEntry(entry.id), /measured again/);
});

test('C10: an RA bill deleted by mistake still comes back while nothing was measured since', async () => {
  const { restoreEntry } = await import('../src/lib/trust/recycle-bin.ts');
  const boq = setupWorks();
  const { invoice } = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 400 }] });
  localDb.invoices.remove(invoice.id);
  restoreEntry(bin().find((x) => x.table === 'invoices' && x.row_id === invoice.id)!.id);
  assert.ok(localDb.invoices.getById(invoice.id));
});

test('C11: delay interest is simple — never on interest billed by an earlier demand', () => {
  const d1 = { total: 1181250, due_date: '2026-06-16', boq_terms: { cn: { demand: { land: { value: 0, land: 0, taxable: 0, notif: 7.5, effective: 5 } } } } } as unknown as InvoiceRecord;
  const d2 = { total: 1191614, due_date: '2026-09-16', boq_terms: { cn: { demand: { interest: { days: 77, rate: 10.85, amount: 9870.9 }, land: { value: 0, land: 0, taxable: 0, notif: 7.5, effective: 5 } } } } } as unknown as InvoiceRecord;
  // Paid 750000 + the second instalment in full (1181250 of principal): only the first instalment's 431250 is owed.
  const r = delayInterest([d1, d2], 750000 + 1181250, '2026-10-16', 10.85)!;
  assert.equal(r.days, 30);
  assert.ok(Math.abs(r.amount - (431250 * 10.85 * 30) / 36500) < 0.05, `interest on the 4,31,250 instalment owed only (${r.amount})`);
  assert.equal(delayInterest([d1, d2], 1181250 * 2, '2026-10-16', 10.85), undefined, 'unpaid interest alone earns none');
});
