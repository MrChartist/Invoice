/** R5-B6: site godowns, consumption, theoretical vs actual, site cost per cost centre, alternate units. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setupWorks } from './helpers/transport-works.ts';
import { blankStockItem, computeStockDetailed, stockDb } from '../src/lib/inventory.ts';
import { liveTrackingInputs } from '../src/lib/stock-tracking.ts';
import { godownsDb, nonSaleableGodowns, transfersDb } from '../src/lib/godowns.ts';
import { getTable } from '../src/lib/storage.ts';
import { saveCostCentre } from '../src/lib/cost-centres.ts';
import { addSite, bookConsumption, loadCoefficients, saveCoefficients, siteCostByCentre, siteGodowns, siteStatement } from '../src/lib/works/sites.ts';
import { loadMeasurements, saveRaBill } from '../src/lib/works/measurements.ts';
import { saveBoqTerms } from '../src/lib/works/boq.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { StockJournal } from '../src/types/manufacturing.ts';
import type { StockTransfer } from '../src/types/stock.ts';

let boq: InvoiceRecord;
beforeEach(() => { boq = setupWorks(); });

test('site godown: kind site, non-saleable, linked to the BOQ and its project; transfer in, consumption out, closing; theoretical × measured', () => {
  const project = saveCostCentre({ name: 'PWD Road Pkg 3', kind: 'project', active: true });
  saveBoqTerms(boq.id, { cost_centre_id: project.id });
  const cement = blankStockItem({ name: 'Cement', unit: 'BAG', opening_qty: 1000, opening_rate: 400 });
  stockDb.saveItem(cement);
  const site = addSite(boq.id, 'Ch. 12 site', project.id);
  assert.equal(site.kind, 'site');
  assert.equal(site.boq_id, boq.id);
  assert.ok(nonSaleableGodowns(godownsDb.list()).has(site.id));
  assert.deepEqual(siteGodowns(godownsDb.stored(), boq.id).map((g) => g.id), [site.id]);
  // 10 "TRUCK" of 20 bags each (alternate unit) + 50 bags.
  transfersDb.save({ date: '2026-06-02', from_godown: 'main', to_godown: site.id, lines: [{ id: 't1', item_id: cement.id, qty: 10, unit: 'TRUCK', unit_factor: 20 }] });
  transfersDb.save({ date: '2026-06-05', from_godown: 'main', to_godown: site.id, lines: [{ id: 't2', item_id: cement.id, qty: 50 }] });
  const j = bookConsumption(site, { date: '2026-06-25', lines: [{ item_id: cement.id, qty: 180 }] }, stockDb.items());
  assert.equal(j.cost_centre_id, project.id);
  assert.equal(j.consume[0].godown_id, site.id);
  assert.equal(j.number, 'SJ/FY26-27/0001');
  saveCoefficients(boq.id, [{ line_id: 'l2', item_id: cement.id, qty_per_unit: 1.5 }, { line_id: 'l1', item_id: '', qty_per_unit: 2 }]);
  assert.equal(loadCoefficients(boq.id).length, 1, 'rows without an item are dropped');
  saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l2', cumulative_qty: 100 }] });
  const [row] = siteStatement({
    site: godownsDb.stored().find((g) => g.id === site.id)!, period: { start: '2026-06-01', end: '2026-06-30' },
    transfers: getTable<StockTransfer>('stock_transfers'), journals: getTable<StockJournal>('stock_journals'), measurements: loadMeasurements(boq.id), coefficients: loadCoefficients(boq.id),
  });
  assert.deepEqual([row.issued, row.consumed, row.theoretical, row.variancePct, row.closing], [250, 180, 150, 20, 70]);
  // Site cost: consumed stock value (weighted average ₹400) on the project cost centre.
  const cost = siteCostByCentre(getTable<StockJournal>('stock_journals'), computeStockDetailed(liveTrackingInputs()), { start: '2026-06-01', end: '2026-06-30' });
  assert.equal(cost.get(project.id), 72000);
  assert.equal(siteCostByCentre(getTable<StockJournal>('stock_journals'), computeStockDetailed(liveTrackingInputs()), { start: '2026-07-01', end: '2026-07-31' }).size, 0);
});

test('booking consumption needs a site godown', () => {
  const g = godownsDb.save({ name: 'Store 2' });
  assert.throws(() => bookConsumption(g, { date: '2026-06-25', lines: [] }, []), /site godown/);
});
