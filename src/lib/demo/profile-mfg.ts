/**
 * R13 sample rows of the manufacturing profile (Demo company only, R6-B4). Dispatched by the Demo company's packs (the
 * manufacturing kind writes them); one block per package (§6 of docs/prd/round-13.md). Pure.
 */
import type { DemoExtras } from '../demo-data';
import type { Drawing, JobCard, MfOrderOp, PrintEstimate, Routing, WorkCentre } from '../../types/mfg-r13';
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
  // MF-B (engineering): the bracket's drawing at rev C (rev B superseded) with three characteristics; (printing): an
  // estimate of a 4-colour carton. Runs are not sampled (a run always comes with its stock journal).
  if (packs.includes('fabrication')) {
    const drawing: Drawing & { demo: true } = {
      id: 'demo-dwg-1145', demo: true, number: '1145-B', title: 'MS bracket (demo)', item_id: 'demo-item-bracket', material_grade: 'IS 2062 E250',
      revisions: [{ rev: 'B', date: shiftDay(today, -60), status: 'superseded' }, { rev: 'C', date: shiftDay(today, -10), note: 'Slot moved 5 mm', status: 'current' }],
      characteristics: [
        { id: 'demo-ch-1', name: 'Length', nominal: 120, tol_minus: 0.2, tol_plus: 0.2, unit: 'mm', critical: true },
        { id: 'demo-ch-2', name: 'Hole Ø', nominal: 10.5, tol_minus: 0, tol_plus: 0.1, unit: 'mm', critical: true },
        { id: 'demo-ch-3', name: 'Bend angle', nominal: 90, tol_minus: 0.5, tol_plus: 0.5, unit: '°' },
      ],
    };
    tables.drawings = [drawing];
  }
  if (packs.includes('press')) {
    const est: PrintEstimate & { demo: true } = {
      id: 'demo-pes-1', demo: true, number: `PES/${getIndianFY(today).label}/9001`, date: shiftDay(today, -2), job: '4-colour carton + varnish (demo)', size: { w: 350, h: 230 }, breaks: [5000, 10000],
      colours_front: 4, colours_back: 0, varnish_plate: true, sheet: { w: 762, h: 508 }, margins: { gripper: 10, bleed: 3, edge: 5 }, gsm: 300, paper_rate: 80, plate_rate: 350, running_waste_pct: 2,
      finishing: [{ name: 'Die-cutting', basis: 'sheet', rate: 0.5 }, { name: 'Pasting', basis: 'piece', rate: 0.2 }], margin_pct: 15, status: 'draft',
    };
    tables.print_estimates = [est];
  }
  return { tables };
}
