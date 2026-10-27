/**
 * QA round 13 (agriculture vertical, Round 12 AG-A / AG-B / AG-C): one regression per finding G1…Gn
 * (docs/prd/qa-round-13.md).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { getTable } from '../src/lib/storage.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import type { Payment } from '../src/types/invoice.ts';
import type { PurchaseRecord, Vendor } from '../src/types/purchases.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { saveFarmer } from '../src/lib/agri/ag-farmers.ts';
import { closeCycle, loadCycles, payCycle, reopenCycle, saveCycleDraft } from '../src/lib/agri/ag-cycle-post.ts';
import { saveChart } from '../src/lib/agri/ag-rate-chart.ts';
import { addEntry, closeShift, loadShifts, reopenShift } from '../src/lib/agri/ag-shifts.ts';
import { closeMilkCycle, makeMilkCycle } from '../src/lib/agri/ag-milk-cycle.ts';
import { cowMatrix } from './helpers/ag-dairy.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const bin = () => getTable<{ id: string; table: string; row_id: string }>('recycle_bin');
const cyclePurchases = (id: string) => getTable<PurchaseRecord>('purchases').filter((p) => p.ag?.cycle_id === id);

/* ── G1: a cycle with a carried / over-deducted farmer can be paid, and the pooled bill ends settled ── */

test('G1: deductions above one farmer\'s milk money: pay works, the bill is settled; next cycle\'s carry settles too', () => {
  const ram = saveFarmer({ name: 'Ram', ag: { code: 'F-0001' } });
  const sita = saveFarmer({ name: 'Sita', ag: { code: 'F-0002' } });
  const d1 = saveCycleDraft({ period_from: '2026-10-01', period_to: '2026-10-10', source: 'produce', lines: [
    { farmer_id: ram.id, name: 'Ram', qty: 20, unit: 'KG', amount: 1000, deductions: [{ kind: 'advance', amount: 1500 }], net: 0, mode: 'cash' },
    { farmer_id: sita.id, name: 'Sita', qty: 20, unit: 'KG', amount: 1000, deductions: [], net: 0, mode: 'cash' },
  ] });
  closeCycle(d1.id);
  payCycle(d1.id, '2026-10-12');
  const b1 = purchasesDb.get(cyclePurchases(d1.id)[0].id)!;
  assert.equal(b1.amount_paid, b1.total, 'cycle 1 bill settled (deductions + carry + cash)');
  const d2 = saveCycleDraft({ period_from: '2026-10-11', period_to: '2026-10-20', source: 'produce', lines: [
    { farmer_id: ram.id, name: 'Ram', qty: 20, unit: 'KG', amount: 1000, carried: -500, deductions: [], net: 0, mode: 'cash' },
  ] });
  closeCycle(d2.id);
  payCycle(d2.id, '2026-10-22');
  const b2 = purchasesDb.get(cyclePurchases(d2.id)[0].id)!;
  assert.equal(b2.amount_paid, b2.total, 'cycle 2 bill settled: the carried-in recovery is not left as a payable');
});
