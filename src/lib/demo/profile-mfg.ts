/**
 * R13 sample rows of the manufacturing profile (Demo company only, R6-B4). Dispatched by the Demo company's packs (the
 * manufacturing kind writes them); one block per package (§6 of docs/prd/round-13.md). Pure.
 */
import type { DemoExtras } from '../demo-data';
import type { JobCard, MfOrderOp, Routing, WorkCentre } from '../../types/mfg-r13';
import type { ProductionOrder } from '../../types/production-r4';
import { shiftDay } from '../dates';
import { getIndianFY } from '../invoice-number';
import type { ProfileContext } from './profiles';

export function mfgExtras(ctx: ProfileContext): DemoExtras {
  const { today, packs } = ctx;
  const tables: NonNullable<DemoExtras['tables']> = {};
  // MF-A (shop floor): 4 work centres, a bracket routing, a released order with two job cards (scrap kg on the laser).
  if (packs.includes('shopfloor')) {
    const fy = getIndianFY(today).label;
    const shift = [{ name: 'Shift 1', hours: 8 }, { name: 'Shift 2', hours: 8 }];
    const days = [1, 2, 3, 4, 5, 6];
    const c = (id: string, name: string, hourly: number, extra: Partial<WorkCentre> = {}): WorkCentre & { demo: true } => ({ id, demo: true, name, kind: 'machine', hourly_rate: hourly, shifts: shift, days, efficiency_pct: 100, capacity_units: 1, active: true, ...extra });
    const centres = [c('demo-wc-laser', 'Laser 1 (demo)', 1800), c('demo-wc-brake', 'Press brake (demo)', 900), c('demo-wc-weld', 'MIG welding (demo)', 150, { kind: 'manual', labour_rate: 450, power_rate: 120, shifts: [shift[0]] }), c('demo-wc-coat', 'Powder coating (demo)', 600, { kind: 'line', shifts: [shift[0]] })];
    tables.work_centres = centres;
    tables.stock_items = [
      { id: 'demo-item-bracket', demo: true, name: 'MS bracket (demo)', unit: 'NOS', hsn: '7326', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, sale_rate: 85, tax_rate: 18 } as never,
      { id: 'demo-item-turnings', demo: true, name: 'MS off-cuts (demo)', unit: 'KG', hsn: '7204', track_stock: true, opening_qty: 0, opening_rate: 0, reorder_level: 0, sale_rate: 28, tax_rate: 18 } as never,
    ];
    const ops: MfOrderOp[] = [
      { id: 'demo-op-10', seq: 10, name: 'Laser cut', work_centre_id: 'demo-wc-laser', setup_min: 15, run_min_per_unit: 3, planned_hours: 10.25, rate: 1800 },
      { id: 'demo-op-20', seq: 20, name: 'Bend', work_centre_id: 'demo-wc-brake', setup_min: 15, run_min_per_unit: 1.8, planned_hours: 6.25, rate: 900 },
      { id: 'demo-op-30', seq: 30, name: 'Weld', work_centre_id: 'demo-wc-weld', setup_min: 15, run_min_per_unit: 4.8, planned_hours: 16.25, rate: 720 },
      { id: 'demo-op-40', seq: 40, name: 'Powder coat', work_centre_id: 'demo-wc-coat', setup_min: 15, run_min_per_unit: 120, batch_size: 50, planned_hours: 8.25, rate: 600 },
    ];
    const routing: Routing & { demo: true } = { id: 'demo-routing-bracket', demo: true, item_id: 'demo-item-bracket', name: 'Standard (demo)', is_default: true, ops: ops.map(({ planned_hours: _h, rate: _r, ...op }) => op) };
    tables.routings = [routing];
    const date = shiftDay(today, -3);
    const order: ProductionOrder & { demo: true } = { id: 'demo-wo-1', demo: true, number: `WO/${fy}/9001`, date, item_id: 'demo-item-bracket', planned_qty: 200, due_date: shiftDay(today, 10), wip_godown_id: '', status: 'released', materials: [], log: [], mf: { ops } };
    tables.production_orders = [order];
    const card = (id: string, op: MfOrderOp, n: number, good: number, hours: number, scrap?: number): JobCard & { demo: true } => ({
      id, demo: true, number: `JCD/${fy}/${String(9000 + n).padStart(4, '0')}`, date, order_id: order.id, op_id: op.id, work_centre_id: op.work_centre_id, planned: { qty: 200, hours: op.planned_hours },
      entries: [{ id: `${id}-e1`, date, start: '09:00', end: '16:40', hours, good, rejected: 2, rework: 0, reason: 'Burr', ...(scrap ? { scrap_kg: scrap, scrap_item_id: 'demo-item-turnings' } : {}) }], status: 'running',
    });
    tables.job_cards = [card('demo-jc-1', ops[0], 1, 150, 7.67, 3.4), card('demo-jc-2', ops[1], 2, 118, 4)];
  }
  return { tables };
}
