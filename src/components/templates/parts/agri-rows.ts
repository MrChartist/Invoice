/** R12 (AG-A5) the rows of the agri box per kind, from the `ag` snapshot only (pure; tested in `tests/ag-print.test.ts`). */
import type { AgSnapshot } from '../../../types/agri-r12';

type Row = [label: string, value: unknown];
const n = (v: unknown, unit = '') => (v === undefined || v === null || v === '' ? undefined : `${v}${unit}`);

export function agriRows(ag: AgSnapshot): { title: string; rows: Row[] }[] {
  const out: { title: string; rows: Row[] }[] = [];
  const r = ag.rent;
  if (r) out.push({ title: 'Storage particulars', rows: [['Lot no.', r.lot_no], ['Receipt no.', r.receipt_no], ['Depositor', r.depositor], ['Commodity', r.commodity], ['Variety', r.variety], ['Bags in', r.bags_in], ['Bags out', r.bags_out], ['Balance bags', r.bags_balance], ['Chamber', r.chamber], ['Date in', r.date_in], ['Season', r.season], ['Rate basis', r.rate_basis]] });
  const i = ag.inputs;
  if (i) out.push({ title: 'Dealer particulars', rows: [...(i.licences ?? []).map((l): Row => [`${l.kind} licence`, l.no]), ['Principal certificate', i.principal_ref], ['PoS transaction no.', i.pos_txn], ['Farmer ID (last 4)', i.farmer_id_last4], ['Bags under subsidy', i.subsidy_bags]] });
  const m = ag.milk;
  if (m) out.push({ title: 'Milk particulars', rows: [['Tanker', m.tanker], ['Shift', m.shift], ['Kg fat', m.kg_fat], ['Kg SNF', m.kg_snf], ['Rate chart', m.chart]] });
  const c = ag.cmr;
  if (c) out.push({ title: 'Custom milling', rows: [['Agency', c.agency], ['Season', c.season], ['Lot / ACK no.', c.lot_ack], ['Paddy (qtl)', c.paddy_qtl], ['Outturn', n(c.outturn_pct, '%')], ['Rice due (qtl)', c.rice_due_qtl], ['Rice delivered (qtl)', c.rice_delivered_qtl]] });
  if (ag.header && Object.keys(ag.header).length) out.push({ title: 'Particulars', rows: Object.entries(ag.header) });
  return out.map((b) => ({ ...b, rows: b.rows.filter(([, v]) => v !== undefined && v !== null && v !== '') })).filter((b) => b.rows.length);
}
