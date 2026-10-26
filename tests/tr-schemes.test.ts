/** TR-A2: scheme scope v2 (group / brand / party), free slabs, scheme claims to the principal and their settlement. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientKA, clientMH, installSettings, SELLER } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable } from '../src/lib/storage.ts';
import { vendorsDb } from '../src/lib/vendors.ts';
import { schemesDb, syncSchemeLines, type Scheme } from '../src/lib/pricing.ts';
import { applyScopedSchemes, lineForScheme, partyInScope, schemeFree, type ScopeCtx } from '../src/lib/trade/tr-schemes.ts';
import { claimedKeys, deleteClaim, loadClaims, markClaim, saveClaim, schemeClaimRows, settleClaim, unsettleClaim } from '../src/lib/trade/tr-claims.ts';
import { loadVouchers } from '../src/lib/ledger/vouchers.ts';
import { purchaseReturnsDb } from '../src/lib/purchase-returns.ts';
import { applyTotals } from '../src/lib/demo-data.ts';
import type { InvoiceItem, InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings({ industry_packs: ['distributor'], business_type: 'wholesale' } as never);
});

let n = 0;
const line = (name: string, quantity: number, rate = 100, over: Partial<InvoiceItem> = {}): InvoiceItem => ({ id: `l${++n}`, name, type: 'Goods', hsn: '3401', unit: 'CASE', quantity, rate, tax_rate: 18, discount_percent: 0, amount: quantity * rate, ...over });
const ctx = (over: Partial<ScopeCtx> = {}): ScopeCtx => ({
  clientId: 'c1',
  parents: new Map([['soap', 'fmcg'], ['fmcg', undefined]]),
  item: (name) => ({ 'dettol soap': { ids: ['s1'], group_id: 'soap', category: 'Dettol' }, 'dettol liquid': { ids: ['s2'], group_id: 'liquid', category: 'Dettol' }, 'lifebuoy soap': { ids: ['s3'], group_id: 'soap', category: 'Lifebuoy' } } as Record<string, { ids: string[]; group_id: string; category: string }>)[name.toLowerCase()],
  ...over,
});
const sync = (items: InvoiceItem[], schemes: Scheme[], c = ctx()) => syncSchemeLines(items, schemes, '2026-10-10', () => `f${++n}`, [], (after, before) => applyScopedSchemes(after, before, schemes, '2026-10-10', c, () => `f${++n}`, []));

test('group scope counts paid quantity across SKUs (sub-groups too); the cheapest qualifying item is given free', () => {
  const s: Scheme = { id: 'g', item_id: '', item_name: '', buy_qty: 10, free_qty: 1, scope: { group_ids: ['fmcg'] } };
  const out = sync([line('Dettol soap', 6, 120), line('Lifebuoy soap', 5, 90), line('Dettol liquid', 20)], [s]);
  const free = out.filter((l) => l.free_of);
  assert.equal(free.length, 1);
  assert.deepEqual([free[0].name, free[0].quantity, free[0].rate, free[0].scheme_id], ['Lifebuoy soap', 1, 0, 'g']);
  assert.equal(out.indexOf(free[0]), 1, 'under the first qualifying line');
  // Stable: a second pass changes nothing and keeps the free line id.
  assert.equal(sync(out, [s]), out);
});

test('brand scope; party scope excludes other parties; slabs pick the best reached; legacy scheme unchanged', () => {
  const brand: Scheme = { id: 'b', item_id: '', item_name: '', buy_qty: 0, free_qty: 0, scope: { brand: 'dettol', client_ids: ['c1'] }, free_slabs: [{ min_qty: 10, free_qty: 1 }, { min_qty: 25, free_qty: 3 }] };
  assert.equal(schemeFree(brand, 24), 1);
  assert.equal(schemeFree(brand, 30), 3);
  const items = [line('Dettol soap', 12), line('Dettol liquid', 14), line('Lifebuoy soap', 50)];
  assert.equal(sync(items, [brand]).find((l) => l.free_of)?.quantity, 3, '26 Dettol cases → slab 25 → 3 free');
  assert.equal(partyInScope(brand, { clientId: 'c2' }), false);
  assert.equal(sync(items, [brand], ctx({ clientId: 'c2' })).some((l) => l.free_of), false, 'another party gets nothing');
  const legacy: Scheme = { id: 'x', item_id: 'i9', item_name: 'Lifebuoy soap', buy_qty: 12, free_qty: 1 };
  const out = syncSchemeLines([line('Lifebuoy soap', 25)], [legacy], '2026-10-10', () => 'f');
  assert.deepEqual(out.filter((l) => l.free_of).map((l) => l.quantity), [2], 'single-item behaviour as before');
  assert.equal(lineForScheme(legacy, { name: 'lifebuoy soap' }, ctx()), true);
});

const sale = (id: string, date: string, items: InvoiceItem[], client = clientMH) =>
  localDb.invoices.save(applyTotals({
    id, invoice_number: '', doc_type: 'TAX_INVOICE', issue_date: date, due_date: date, status: 'Sent', currency: 'INR', template_id: 't', client: { ...client }, sender: SELLER, items,
    gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 18, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0,
  } as unknown as InvoiceRecord));

test('scheme claim values per basis; financial settlement posts the journal; GST settlement records a supplier credit note', () => {
  const p = vendorsDb.save({ name: 'Reckitt (principal)', gstin: '' });
  localDb.clients.upsert({ ...clientMH });
  localDb.clients.upsert({ ...clientKA });
  const atCost: Scheme = { id: 's1', item_id: '', item_name: 'Dettol soap', buy_qty: 10, free_qty: 1, principal_vendor_id: p.id, claim_basis: 'free_goods_at_cost' };
  const fixed: Scheme = { id: 's2', item_id: '', item_name: 'Dettol liquid', buy_qty: 10, free_qty: 2, principal_vendor_id: p.id, claim_basis: 'fixed_per_unit', claim_rate: 40 };
  const disc: Scheme = { id: 's3', item_id: '', item_name: 'Lifebuoy soap', buy_qty: 100, free_qty: 1, principal_vendor_id: p.id, claim_basis: 'discount_given' };
  const atRate: Scheme = { id: 's4', item_id: '', item_name: 'Harpic', buy_qty: 5, free_qty: 1, principal_vendor_id: p.id, claim_basis: 'free_goods_at_rate' };
  const a = line('Dettol soap', 20, 120);
  const b = line('Dettol liquid', 10, 200);
  const c = line('Harpic', 5, 150);
  sale('i1', '2026-10-05', [a, line('Dettol soap', 2, 0, { free_of: a.id, scheme_id: 's1' }), b, line('Dettol liquid', 2, 0, { free_of: b.id, scheme_id: 's2' })]);
  sale('i2', '2026-10-06', [line('Lifebuoy soap', 10, 50, { discount_percent: 10 }), c, line('Harpic', 1, 0, { free_of: c.id, scheme_id: 's4' })], clientKA);
  sale('i3', '2026-09-01', [a, line('Dettol soap', 2, 0, { free_of: a.id, scheme_id: 's1' })]);
  const opts = { cost: (name: string) => (name === 'Dettol soap' ? 95 : 0), inScheme: (s: Scheme, l: InvoiceItem) => lineForScheme(s, l, ctx()) };
  const rows = schemeClaimRows(getTable<InvoiceRecord>('invoices'), [atCost, fixed, disc, atRate], p.id, '2026-10-01', '2026-10-31', opts);
  assert.deepEqual(rows.map((r) => [r.item, r.free_qty, r.qty, r.value]), [['Dettol soap', 2, 0, 190], ['Dettol liquid', 2, 0, 80], ['Lifebuoy soap', 0, 10, 50], ['Harpic', 1, 0, 150]]);
  const claim = saveClaim({ date: '2026-11-01', kind: 'scheme', principal_id: p.id, principal_name: p.name, from: '2026-10-01', to: '2026-10-31', rows });
  assert.match(claim.number, /^TCL\/FY26-27\/0*1$/);
  assert.equal(claim.amount, 470);
  // Claimed lines are not claimed again.
  assert.equal(schemeClaimRows(getTable<InvoiceRecord>('invoices'), [atCost, fixed, disc, atRate], p.id, '2026-10-01', '2026-10-31', { ...opts, claimed: claimedKeys(loadClaims()) }).length, 0);
  markClaim(claim.id, 'sent');
  const settled = settleClaim(claim.id, { mode: 'financial', note_no: 'RB/CN/88', date: '2026-11-20', amount: 450 });
  assert.equal(settled.status, 'short');
  const v = loadVouchers().find((x) => x.id === settled.settlement?.voucher_id)!;
  assert.equal(v.type, 'JOURNAL');
  assert.deepEqual(v.lines.map((l) => [l.dr, l.cr]), [[45000, 0], [0, 45000]]);
  assert.equal(v.lines[0].account_id, 'creditors');
  // Undo, then settle with GST: a supplier credit note (ITC reversal), no journal.
  unsettleClaim(claim.id);
  assert.equal(loadVouchers().length, 0);
  const g = settleClaim(claim.id, { mode: 'gst', note_no: 'RB/CN/89', date: '2026-11-21', amount: 472, gst_rate: 18 });
  assert.equal(g.status, 'settled');
  const cn = purchaseReturnsDb.all().find((r) => r.id === g.settlement?.return_id)!;
  assert.deepEqual([cn.kind, cn.supplier_note_number, cn.taxable, cn.total], ['SUPPLIER_CN', 'RB/CN/89', 400, 472]);
});

test('a deleted claim number stays reserved; settled claims cannot be deleted', () => {
  const p = vendorsDb.save({ name: 'Principal' });
  const row = { invoice_number: 'X', date: '2026-10-01', party: 'A', item: 'I', qty: 0, free_qty: 1, value: 10 };
  const c1 = saveClaim({ date: '2026-10-10', kind: 'scheme', principal_id: p.id, principal_name: p.name, from: '2026-10-01', to: '2026-10-10', rows: [row] });
  deleteClaim(c1.id);
  const c2 = saveClaim({ date: '2026-10-10', kind: 'scheme', principal_id: p.id, principal_name: p.name, from: '2026-10-01', to: '2026-10-10', rows: [row] });
  assert.notEqual(c2.number, c1.number);
  assert.ok(getTable<{ table?: string }>('recycle_bin').length >= 1, 'the deleted claim went to the recycle bin');
  settleClaim(c2.id, { mode: 'financial', note_no: 'N', date: '2026-10-20', amount: 10 });
  assert.throws(() => deleteClaim(c2.id), /settled/);
  assert.throws(() => saveClaim({ date: '2026-10-10', kind: 'scheme', principal_id: p.id, principal_name: p.name, from: '2026-10-01', to: '2026-10-10', rows: [] }), /Nothing to claim/);
});

test('the scheme form keeps scope v2 and the claim terms on save', () => {
  const s = schemesDb.save({ id: '', item_id: '', item_name: '', buy_qty: 0, free_qty: 0, scope: { group_ids: ['g1'] }, free_slabs: [{ min_qty: 10, free_qty: 1 }], principal_vendor_id: 'v1', claim_basis: 'fixed_per_unit', claim_rate: 5 });
  assert.deepEqual([s.scope, s.free_slabs, s.principal_vendor_id, s.claim_basis, s.claim_rate], [{ group_ids: ['g1'] }, [{ min_qty: 10, free_qty: 1 }], 'v1', 'fixed_per_unit', 5]);
  assert.throws(() => schemesDb.save({ id: '', item_id: '', item_name: '', buy_qty: 1, free_qty: 1 }), /Pick the item/);
});
