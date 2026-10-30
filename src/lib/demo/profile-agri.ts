/**
 * R12 sample rows of the agri profile (Demo company only, R6-B4). Dispatched by the Demo company's packs (the agri kind
 * writes them); one block per package (§6 of docs/prd/round-12.md). Pure.
 */
import type { DemoExtras } from '../demo-data';
import type { AgClass, FarmBatch, MilkCard, MilkDispatch, MilkEntry, MilkRateChart, MilkShift } from '../../types/agri-r12';
import type { Vendor } from '../../types/purchases';
import type { ColdLot, ColdRentPlan } from '../../types/agri-r12d';
import { shiftDay } from '../dates';
import { getIndianFY } from '../invoice-number';
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
  // AG-C (mill): a paddy intake slip with moisture, the rice starter BOM and one milling batch (outturn 68% vs 67%),
  // a CMR agreement with one paddy lot (JWP receipt) and one delivery (CMR/FY…, JWP return of the paddy milled).
  if (packs.includes('mill')) {
    const add = (k: keyof typeof tables, rows: readonly object[]) => { tables[k] = rows as never; };
    const fy = (d: string) => getIndianFY(d).label; // QA13 G16: each number in its own date's FY (the first week of April)
    const [d1, d2, d3] = [shiftDay(today, -6), shiftDay(today, -5), shiftDay(today, -2)];
    const item = (id: string, name: string, ag_class: AgClass, opening = 0) => ({ id, demo: true as const, name, unit: 'QTL', track_stock: true, opening_qty: opening, opening_rate: opening ? 2300 : 0, reorder_level: 0, ag_class, created_at: `${d1}T09:00:00.000Z` });
    add('stock_items', [...(tables.stock_items ?? []), item('demo-paddy', 'Paddy (demo)', 'paddy', 500), item('demo-rice', 'Rice (demo)', 'cereal_loose'), item('demo-broken', 'Broken rice (demo)', 'broken_rice'), item('demo-bran', 'Rice bran (demo)', 'rice_bran_feed'), item('demo-husk', 'Rice husk (demo)', 'rice_husk')]);
    const outputs = [
      { id: 'o1', item_id: 'demo-broken', qty: 4, kind: 'co_product' as const, cost_pct: 5 },
      { id: 'o2', item_id: 'demo-bran', qty: 7, kind: 'by_product' as const, rate: 1500 },
      { id: 'o3', item_id: 'demo-husk', qty: 22, kind: 'by_product' as const, rate: 400 },
    ];
    add('boms', [{ id: 'demo-bom-rice', demo: true, item_id: 'demo-rice', name: 'Rice mill starter (practice: adjust)', batch_qty: 64, is_default: true, components: [{ id: 'c1', item_id: 'demo-paddy', qty: 100 }], outputs }]);
    add('production_orders', [{ id: 'demo-wo-1', demo: true, number: `WO/FY${fy(d2)}/0001`, date: d2, item_id: 'demo-rice', bom_id: 'demo-bom-rice', planned_qty: 64, wip_godown_id: '', status: 'completed', log: [], ag: { mill: { standard_outturn_pct: 67, std_source: 'own', input_moisture: 14, output_moisture: 13 } } }]);
    add('manufacturing_vouchers', [{ id: 'demo-mfg-1', demo: true, number: `MFG/FY${fy(d2)}/0001`, date: d2, item_id: 'demo-rice', bom_id: 'demo-bom-rice', qty: 64, production_order_id: 'demo-wo-1', components: [{ id: 'c1', item_id: 'demo-paddy', qty: 100 }], outputs, costs: [] }]);
    add('weighbridge_slips', [{ id: 'demo-wbs-1', demo: true, number: `WBS/FY${fy(d1)}/0001`, date: d1, vehicle: 'PB10AB1234', party_kind: 'farmer', party_name: 'Gurdev Singh (demo)', commodity: 'Paddy', gross_kg: 8640, gross_at: `${d1}T09:10`, tare_kg: 6000, tare_at: `${d1}T13:30`, net_kg: 2640, bags: 52, readings: { moisture: 19.2, foreign: 1 }, use: 'purchase', status: 'done' }]);
    const paddy = 'Paddy: CMR Kharif (demo)';
    add('job_work_principal', [
      { id: 'demo-jwp-1', demo: true, number: `JWP/FY${fy(d1)}/0001`, date: d1, kind: 'receipt', party_name: 'State Civil Supplies (demo)', lines: [{ id: 'l1', name: paddy, qty: 50, unit: 'QTL' }], narration: 'Custom milling: paddy received' },
      { id: 'demo-jwp-2', demo: true, number: `JWP/FY${fy(d3)}/0002`, date: d3, kind: 'return', party_name: 'State Civil Supplies (demo)', challan_no: `CMR/FY${fy(d3)}/0001`, lines: [{ id: 'l1', name: paddy, qty: 14.925, unit: 'QTL', processed: true }], narration: 'Custom-milled rice 10 qtl delivered (lot L-1) = paddy 14.925 qtl at 67%' },
    ]);
    add('cmr_agreements', [{
      id: 'demo-cmr-1', demo: true, agency_id: '', agency_name: 'State Civil Supplies (demo)', season: 'Kharif (demo)', kind: 'raw', outturn_pct: 67, milling_rate: 40, status: 'open',
      paddy_lots: [{ id: 'lot1', jwp_id: 'demo-jwp-1', date: d1, qty: 50 }],
      deliveries: [{ id: 'del1', number: `CMR/FY${fy(d3)}/0001`, date: d3, qty: 10, lot_no: 'L-1', ack_no: 'ACK-101', jwp_id: 'demo-jwp-2' }],
    }]);
  }
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
