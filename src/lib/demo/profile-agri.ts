/**
 * R12 sample rows of the agri profile (Demo company only, R6-B4). Dispatched by the Demo company's packs (the agri kind
 * writes them); one block per package (§6 of docs/prd/round-12.md). Pure.
 */
import type { DemoExtras } from '../demo-data';
import type { FarmBatch, MilkCard, MilkDispatch, MilkEntry, MilkRateChart, MilkShift } from '../../types/agri-r12';
import type { Vendor } from '../../types/purchases';
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
  // AG-B (dairy): 12 farmers, a cow rate chart, 20 days of closed shifts at the Main centre, one dispatch, a milk card.
  // Demo shifts carry no stock journal (sample rows only); bills are made from the desk (Milk bills → Make bills).
  if (packs.includes('dairy')) {
    const names = ['Ramesh', 'Suresh', 'Mahesh', 'Ganesh', 'Dinesh', 'Rakesh', 'Mukesh', 'Naresh', 'Kamla', 'Sita', 'Gita', 'Lakshmi'];
    const farmers: Vendor[] = names.map((n, i) => ({ id: `demo-farmer-${i + 1}`, name: `${n} (demo)`, principal_kind: 'agriculturist', ag: { code: `F-${String(i + 1).padStart(4, '0')}`, centre_id: 'main', village: i % 2 ? 'Rampur' : 'Sitapur', status: 'active' }, ...(i % 3 ? { bank_account_no: `5010012345${String(i).padStart(4, '0')}` } : {}) }));
    tables.vendors = farmers;
    const from = shiftDay(today, -20);
    const chart: MilkRateChart = { id: 'demo-chart-cow', name: 'Cow (demo)', milk: 'cow', basis: 'matrix', unit: 'L', effective_from: shiftDay(today, -60), below_min: 'reject', matrix: { fat_steps: [3, 3.5, 4, 4.5], snf_steps: [8, 8.5, 9], rates: [[30, 31, 32], [33, 34, 35], [36, 37, 38], [39, 40, 41]] } };
    tables.milk_rate_charts = [chart];
    const shifts: MilkShift[] = [];
    for (let d = 0; d < 20; d++) {
      const date = shiftDay(from, d);
      for (const shift of ['M', 'E'] as const) {
        const entries = names.map((_, i): MilkEntry => {
          const qty = 4 + ((i * 3 + d) % 7);
          const fat = 3.5 + (i % 3) * 0.5;
          const rate = [34, 37, 40][i % 3];
          return { id: `demo-e-${date}-${shift}-${i}`, farmer_id: `demo-farmer-${i + 1}`, code: `F-${String(i + 1).padStart(4, '0')}`, name: names[i], milk: 'cow', qty, unit: 'L', fat, snf: 8.6, chart_id: 'demo-chart-cow', rate, amount: qty * rate, at: `${date}T0${shift === 'M' ? 6 : 7}:00:00.000Z` };
        });
        shifts.push({ id: `demo-shift-${date}-${shift}`, centre_id: 'main', date, shift, entries, closed_at: `${date}T09:00:00.000Z` });
      }
    }
    tables.milk_shifts = shifts;
    const dispatch: MilkDispatch = { id: 'demo-mds-1', number: 'MDS/DEMO/0001', date: shiftDay(today, -1), shift: 'M', centre_id: 'main', buyer_id: '', buyer_name: 'District Milk Union (demo)', milk: 'cow', tanker: 'MH12 AB 1234', sent: { qty: 400, unit: 'L', fat: 4, snf: 8.6 }, received: { qty: 398, fat: 3.95, snf: 8.6, ack_no: 'ACK-101', date: today } };
    tables.milk_dispatches = [dispatch];
    const card: MilkCard = { id: 'demo-card-1', client_id: 'demo-client-1', client_name: 'Sample household (demo)', month: today.slice(0, 7), milk: 'buffalo', rate: 64, default_qty: 1, days: { 3: 0 } };
    tables.milk_cards = [card];
  }
  // AG-C (mill): a paddy intake with moisture cut, a milling batch, a CMR agreement with one delivery.
  // AG-D (cold / inputs / fpo): lots, rent plan, gate pass, loan; licences, subsidised sale; members with shares.
  return { tables };
}
