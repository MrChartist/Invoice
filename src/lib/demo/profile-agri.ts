/**
 * R12 sample rows of the agri profile (Demo company only, R6-B4). Dispatched by the Demo company's packs (the agri kind
 * writes them); one block per package (§6 of docs/prd/round-12.md). Pure.
 */
import type { DemoExtras } from '../demo-data';
import type { FarmBatch } from '../../types/agri-r12';
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
  // AG-D (cold / inputs / fpo): lots, rent plan, gate pass, loan; licences, subsidised sale; members with shares.
  return { tables };
}
