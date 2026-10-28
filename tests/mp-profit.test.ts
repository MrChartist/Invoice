/**
 * R17-C2 site P&L: billed (single-site and grouped bills, debit notes in, credit notes out, other months and cancelled
 * left out), wages / relievers / employer PF / ESI from the run shares, site-tagged bills, margin %; volume (one month
 * of 60 sites reads only that month).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { info, line } from './helpers/mp-world.ts';
import { billedFor, siteProfit } from '../src/lib/manpower/mp-profit.ts';
import { siteBills } from '../src/lib/manpower/mp-sites-io.ts';
import { setTable } from '../src/lib/storage.ts';
import type { Site } from '../src/lib/manpower/mp-sites.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { SiteMuster } from '../src/types/manpower-r17.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

const s1: Site = { id: 's1', name: 'Sunrise', client_id: 'c', mp: info() };
const s2: Site = { id: 's2', name: 'Park', client_id: 'c', mp: info({ code: 'S-002' }) };
const inv = (o: Partial<InvoiceRecord>): InvoiceRecord => ({ id: 'i', doc_type: 'INVOICE', status: 'Draft', taxable_value: 0, ...o }) as InvoiceRecord;

test('billed: single-site, grouped by post rows, debit notes in, credit notes out; cancelled / other months out', () => {
  const docs = [
    inv({ taxable_value: 128600, mp: { month: '2026-10', site: { id: 's1', code: 'S-001', name: 'Sunrise' } } }),
    inv({ taxable_value: 9000, mp: { month: '2026-10', posts: [{ post: 'G', sac: '998525', heads: 1, rate: 1, amount: 5000, site: 'S-001' }, { post: 'G', sac: '998525', heads: 1, rate: 1, amount: 4000, site: 'S-002' }] } }),
    inv({ doc_type: 'DEBIT_NOTE', taxable_value: 3978, mp: { month: '2026-10', site: { id: 's1', code: 'S-001', name: 'Sunrise' } } }),
    inv({ doc_type: 'CREDIT_NOTE', taxable_value: 1000, mp: { month: '2026-10', site: { id: 's1', code: 'S-001', name: 'Sunrise' } } }),
    inv({ status: 'Cancelled', taxable_value: 7, mp: { month: '2026-10', site: { id: 's1', code: 'S-001', name: 'Sunrise' } } }),
    inv({ taxable_value: 99, mp: { month: '2026-09', site: { id: 's1', code: 'S-001', name: 'Sunrise' } } }),
  ];
  assert.deepEqual([billedFor(docs[1], s1), billedFor(docs[1], s2), billedFor(docs[3], s1), billedFor(docs[4], s1)], [5000, 4000, -1000, 0]);
  const m: SiteMuster = { id: 'm', site_id: 's1', month: '2026-10', date: '', status: 'locked', updated_at: '', rows: [{ employee_id: 'x', post_id: 'g', duties: 31 }, { employee_id: 'r', post_id: 'g', duties: 3, relief: true }] };
  const rows = siteProfit({ month: '2026-10', sites: [s1, s2], invoices: docs, musters: [m], lines: [line('x', 24800), line('r', 2400)], bills: [{ site_id: 's1', cost: 6000 }, { site_id: 's2', cost: 100 }] });
  const r = rows[0];
  assert.deepEqual([r.billed, r.wages, r.relief, r.statutory, r.bills], [136578, 24800, 2400, 3900, 6000]);
  assert.equal(r.margin, 136578 - 24800 - 2400 - 3900 - 6000);
  assert.equal(r.pct, Math.round((r.margin / 136578) * 10000) / 100);
  assert.deepEqual([rows[1].billed, rows[1].wages, rows[1].margin], [4000, 0, 3900]);
  assert.equal(siteProfit({ month: '2026-10', sites: [s2], invoices: [], musters: [], lines: null, bills: [] })[0].pct, null);
});

test('site bills through readPurchase: month only, cost = taxable (+ tax without ITC), void out', () => {
  const b = (id: string, date: string, o = {}) => ({ id, kind: 'PURCHASE', vendor_name: 'Uniforms Co', bill_number: id, date, taxable: 6000, cgst: 540, sgst: 540, igst: 0, total: 7080, itc_eligible: true, amount_paid: 0, lines: [], mp: { site_id: 's1' }, ...o });
  setTable('purchases', [b('a', '2026-10-05'), b('b', '2026-10-20', { itc_eligible: false }), b('c', '2026-11-01'), b('d', '2026-10-06', { status: 'void' }), { ...b('e', '2026-10-07'), mp: undefined }]);
  assert.deepEqual(siteBills('2026-10'), [{ site_id: 's1', cost: 6000 }, { site_id: 's1', cost: 7080 }]);
});

test('volume: 60 sites × 12 months — a month reads only its own musters', () => {
  const sites = Array.from({ length: 60 }, (_, i): Site => ({ id: `s${i}`, name: `S${i}`, mp: info({ code: `S-${i}` }) }));
  const musters: SiteMuster[] = [];
  for (let mo = 1; mo <= 12; mo++) for (const s of sites) musters.push({ id: `${s.id}-${mo}`, site_id: s.id, month: `2026-${String(mo).padStart(2, '0')}`, date: '', status: 'locked', updated_at: '', rows: Array.from({ length: 10 }, (_, k) => ({ employee_id: `${s.id}e${k}`, post_id: 'g', duties: 30 })) });
  const lines = sites.flatMap((s) => Array.from({ length: 10 }, (_, k) => line(`${s.id}e${k}`, 3000)));
  const t0 = Date.now();
  const rows = siteProfit({ month: '2026-10', sites, invoices: [], musters: musters.filter((m) => m.month === '2026-10'), lines, bills: [] });
  assert.equal(rows.length, 60);
  assert.ok(rows.every((r) => r.wages === 30000), 'each site: its ten people for the month');
  assert.ok(Date.now() - t0 < 3000);
});
