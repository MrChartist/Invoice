/**
 * R12 sample rows of the agri profile (Demo company only, R6-B4). Dispatched by the Demo company's packs (the agri kind
 * writes them); one block per package (§6 of docs/prd/round-12.md). Pure.
 */
import type { DemoExtras } from '../demo-data';
import type { FarmBatch } from '../../types/agri-r12';
import type { ColdLot, ColdRentPlan } from '../../types/agri-r12d';
import { shiftDay } from '../dates';
import type { ProfileContext } from './profiles';

export function agriExtras(ctx: ProfileContext): DemoExtras {
  const { today, packs } = ctx;
  const tables: NonNullable<DemoExtras['tables']> = {};
  // AG-A (farm base): a broiler flock with feed, mortality and weight events (FCR on the Batches view).
  if (packs.includes('agri')) {
    const start = shiftDay(today, -35);
    const batch: FarmBatch & { demo: true } = {
      id: 'demo-batch-1', demo: true, kind: 'flock', name: 'Broiler flock 12 (demo)', start, placed: 5000, unit: 'birds', start_weight_kg: 200, status: 'active',
      events: [
        { date: shiftDay(today, -28), kind: 'feed', qty: 2500, unit: 'KG' }, { date: shiftDay(today, -20), kind: 'mortality', qty: 60, unit: 'NOS' },
        { date: shiftDay(today, -14), kind: 'feed', qty: 4200, unit: 'KG' }, { date: shiftDay(today, -2), kind: 'weight', qty: 9600, unit: 'KG' },
      ],
      created_at: `${start}T09:00:00.000Z`,
    };
    tables.farm_batches = [batch];
  }
  // AG-B (dairy): 12 farmers, a rate chart, 20 days of shifts, one cycle bill, one dispatch.
  // AG-C (mill): a paddy intake with moisture cut, a milling batch, a CMR agreement with one delivery.
  // AG-D (cold): a season rent plan and three lots of the demo clients, one partly released (custody only; loans,
  // shares and licences post vouchers or live in settings, so the user makes them on the desks).
  if (packs.includes('coldstore')) {
    const plan: ColdRentPlan & { demo: true } = { id: 'demo-rent-1', demo: true, name: 'Potato season (demo)', basis: 'bag_season', rate: 180, season: { from: '03-01', to: '11-30' }, part_month: 'full', charges: [{ name: 'Loading', basis: 'bag', rate: 5, when: 'out' }], class: 'storage_agri', bill_at: 'out' };
    const lot = (i: number, bags: number, out: number): ColdLot & { demo: true } => {
      const c = ctx.base.clients[i % Math.max(ctx.base.clients.length, 1)];
      const date_in = shiftDay(today, -60 + i * 5);
      return {
        id: `demo-lot-${i}`, demo: true, number: `CSR/DEMO/${i}`, date_in, depositor_id: c?.id ?? '', depositor_name: c?.name ?? 'Depositor', commodity: 'Potato', variety: 'Kufri Jyoti', bags, bag_kg: 50,
        chamber_id: 'demo-ch-1', season: today.slice(0, 4), rent_plan_id: plan.id, status: out ? 'part_out' : 'stored',
        outs: out ? [{ id: `demo-gpo-${i}`, number: `GPO/DEMO/${i}`, date: shiftDay(today, -3), bags: out, loan_check: 'clear' }] : [],
      };
    };
    tables.cold_rent_plans = [plan];
    tables.cold_lots = [lot(1, 240, 60), lot(2, 120, 0), lot(3, 400, 0)];
  }
  return { tables };
}
