/** AG-C fixtures: a rice mill with the starter BOM, paddy in stock, and milling batches run through production orders. */
import { freezeDate, resetStorage } from './shim.ts';
import { installSettings } from './world.ts';
import { clearOverrides } from '../../src/lib/period-lock.ts';
import { stockDb } from '../../src/lib/inventory.ts';
import { computeTracking, liveTrackingInputs } from '../../src/lib/stock-tracking.ts';
import { bomsDb } from '../../src/lib/manufacturing.ts';
import { buildIssueLines, buildOutputVoucher, loadOrderDocs, materialRows, orderProgress, productionOrdersDb } from '../../src/lib/production/orders.ts';
import { installMillStarter } from '../../src/lib/agri/ag-mill-bom.ts';
import { setMillMeta } from '../../src/lib/agri/ag-yield.ts';

export function millWorld(today = '2026-10-27') {
  resetStorage();
  clearOverrides();
  installSettings({ mill_kind: 'rice' } as never);
  freezeDate(`${today}T10:00:00`);
  const { bom, itemIds } = installMillStarter('rice', { rates: { bran: 1500, husk: 400 } });
  stockDb.addMove({ id: 'paddy-in', item_id: itemIds.paddy, date: '2026-04-02', qty: 1000, rate: 2300, kind: 'purchase' });
  return { bom, ids: itemIds };
}

/** One batch: `paddy` qtl issued, output of `rice` qtl with the BOM's by-products scaled; moisture meta optional. */
export function runBatch(date: string, paddy: number, rice: number, meta?: { input_moisture?: number; output_moisture?: number; standard_outturn_pct?: number }) {
  const bom = bomsDb.all()[0];
  let o = productionOrdersDb.save({ date, item_id: bom.item_id, planned_qty: rice }, stockDb.items(), bomsDb.all());
  o = productionOrdersDb.release(o.id, bomsDb.all());
  const rows = materialRows(o, orderProgress(o, loadOrderDocs()));
  const tracking = computeTracking({ ...liveTrackingInputs(), asOf: date });
  const lines = buildIssueLines(rows, stockDb.items(), tracking, date, 'main', new Map([[rows[0].item_id, paddy]]));
  productionOrdersDb.issue(o.id, { date, from: 'main', lines }, stockDb.items(), liveTrackingInputs());
  const p = orderProgress(o, loadOrderDocs());
  const draft = buildOutputVoucher(o, p, bom, { qty: rice, date });
  draft.components = draft.components.map((c) => ({ ...c, qty: paddy }));
  const v = productionOrdersDb.reportOutput(o.id, draft, stockDb.items(), liveTrackingInputs());
  if (meta) setMillMeta(o.id, { standard_outturn_pct: 67, std_source: 'own', ...meta });
  return { order: productionOrdersDb.get(o.id)!, voucher: v };
}
