/** R19-A4 job paper: rows from the snapshot only (air vs sea refs, SB / BOE, weights), the POS reason; old invoices print unchanged (containers line cut, PRD §3 cut 1). */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logisticsPaper } from '../src/lib/logistics/lg-print.ts';
import { trackingText } from '../src/components/templates/paper-helpers.ts';
import type { LgSnapshot } from '../src/types/logistics-r19.ts';

const air: LgSnapshot = { job_id: 'j1', job_no: 'JOB/FY26-27/0001', mode: 'air', dir: 'export', refs: { hawb: 'SBL-0001', mawb: '176-12345675', flight: 'SQ 423', sb_no: '1234567', sb_date: '2026-11-04' }, ports: { origin: 'BOM', destination: 'SIN', dest_country: 'SG' }, weights: { pkgs: 5, gross_kg: 480, chargeable_kg: 500 }, pos_reason: 'Place of supply outside India — Sec 12(8) proviso; IGST (Circular 184/16/2022-GST)' };

test('rows and the reason come from the snapshot only', () => {
  const p = logisticsPaper(air);
  assert.deepEqual(p.rows, [['Job', 'JOB/FY26-27/0001'], ['Shipment', 'Export / Air'], ['Route', 'BOM → SIN (SG)'], ['HAWB / MAWB', 'SBL-0001 / 176-12345675'], ['Flight', 'SQ 423'], ['Shipping bill', '1234567 dt 04/11/2026'], ['Packages', '5'], ['Gross / chargeable', '480 kg / 500 kg']]);
  assert.equal(p.reason, air.pos_reason);
  const sea = logisticsPaper({ job_no: 'JOB/FY26-27/0002', mode: 'sea_fcl', dir: 'import', refs: { hbl: 'H1', mbl: 'M1', vessel: 'MSC Anna', voyage: '612W', boe_no: '7654321', boe_date: '2026-11-10' }, containers: Array.from({ length: 10 }, (_, i) => ({ no: `CSQU305438${i}`, size: '40HC' as const })) });
  assert.deepEqual(sea.rows.slice(1, 5), [['Shipment', 'Import / Sea FCL'], ['HBL / MBL', 'H1 / M1'], ['Vessel / voyage', 'MSC Anna / 612W'], ['Bill of entry', '7654321 dt 10/11/2026']]);
  assert.ok(!sea.rows.some(([k]) => k === 'Containers'), 'cut 1: no containers line');
});

test('old invoices print exactly as before; an empty snapshot prints no block', () => {
  assert.deepEqual(logisticsPaper({}), { rows: [], reason: '' });
  assert.equal(trackingText({ id: 'l1', batch_no: 'B1' } as never), 'Batch B1');
  assert.equal(trackingText({ id: 'l1', charge_head_id: 'rule33' } as never), '', 'a pure-agent line of a non-job document is unchanged');
});

test('R19-B4: the exchange rate of a foreign-currency charge prints with Rule 34(2) (LG13)', () => {
  const p = logisticsPaper({ ...air, fx: { currency: 'USD', rate: 84, source: 'RBI' } });
  assert.deepEqual(p.rows.at(-1), ['Exchange rate', '₹84.00 / USD (Rule 34(2) CGST Rules — as per accounting standards)']);
  assert.ok(!logisticsPaper(air).rows.some(([k]) => k === 'Exchange rate'));
});
