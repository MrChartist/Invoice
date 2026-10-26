/**
 * R8-C (TR-C3) trading sample rows, built per trading pack of the Demo company (never a real company):
 *  - agency (commission agent): a consignment godown, one arrival of a farmer's wheat, two agency sales from the lot,
 *    a draft bikri patti for them and two indents (one placed, one dispatched);
 *  - distributor / commodity: their rows (party rates, a group scheme, crates; weight lines, charge heads, a broker)
 *    belong to TR-A / TR-B and are appended here by those packages.
 * Demo series (`DEMOARR`, `DEMOAG`, `DEMOPAT`, `DEMOIND`) so no real series number is reserved. Pure.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { Godown } from '../../types/stock';
import type { Arrival, Indent, PackagingMove, PackagingType, PartyRate, SalePatti } from '../../types/trade-r8';
import type { Scheme } from '../pricing';
import { applyTotals, type Demo, type DemoExtras } from '../demo-data';
import { deriveGstMode } from '../invoice-calc';
import { shiftDay } from '../dates';
import { buildInvoiceNumber, getIndianFY } from '../invoice-number';
import { agencySales } from '../trade/tr-arrivals';
import { buildPatti } from '../trade/tr-patti';
import type { ProfileContext } from './profiles';

const fyOf = (d: string) => getIndianFY(d).label;

function agencyExtras({ today, base }: ProfileContext): DemoExtras {
  const godown: Demo<Godown> = { id: 'demo-godown-agency', demo: true, name: 'Agency (principals’ goods) — demo', kind: 'consignment' };
  const principal = base.vendors[0];
  const day = shiftDay(today, -6);
  const arrival: Demo<Arrival> = {
    id: 'demo-arrival-1',
    demo: true,
    number: buildInvoiceNumber('DEMOARR', fyOf(day), 1),
    date: day,
    principal_id: principal.id,
    principal_name: principal.name,
    principal_kind: 'agriculturist',
    lot_no: 'L-101',
    item_name: 'Wheat (sample lot)',
    hsn: '1001',
    unit: 'QTL',
    packages: 80,
    package_kind: 'BAG',
    gross_weight: 4048,
    qty: 40,
    godown_id: godown.id,
    produce: 'agricultural',
    status: 'open',
    created_at: `${day}T09:00:00.000Z`,
  };
  const sale = (n: number, qty: number, rate: number): Demo<InvoiceRecord> => {
    const d = shiftDay(day, n + 1);
    const client = base.clients[n % base.clients.length];
    const pos = client.gstin?.slice(0, 2) || base.profile.stateCode || '27';
    return applyTotals({
      ...base.invoices[0],
      id: `demo-agency-${n + 1}`,
      demo: true,
      doc_type: 'INVOICE',
      invoice_number: buildInvoiceNumber('DEMOAG', fyOf(d), n + 1),
      issue_date: d,
      due_date: shiftDay(d, 7),
      status: 'Sent',
      client: { ...client },
      items: [{ id: `demo-agency-${n + 1}-l1`, name: arrival.item_name, description: `Lot ${arrival.lot_no} of ${principal.name} (sold as agent)`, type: 'Goods', hsn: '1001', unit: 'QTL', quantity: qty, rate, tax_rate: 0, discount_percent: 0, amount: qty * rate, arrival_id: arrival.id, godown_id: godown.id }],
      place_of_supply: pos,
      gst_mode: deriveGstMode({ senderStateCode: base.profile.stateCode, placeOfSupply: pos, senderHasGstin: true, taxEnabled: true }),
      discount_rate: 0,
      po_number: undefined,
      amount_paid: 0,
      agency: true,
      notes: 'Sale on behalf of the principal (kachi aadat) — sample.',
      created_at: `${d}T11:00:00.000Z`,
    } as Demo<InvoiceRecord>);
  };
  const sales = [sale(0, 15, 2450), sale(1, 10, 2475)];
  const pattiDay = shiftDay(day, 3);
  const built = buildPatti(
    { date: pattiDay, principalId: principal.id, arrivalIds: [arrival.id], deductions: [{ label: 'Aadat', basis: 'percent', rate: 2.5, aadat: true }, { label: 'Hamali', basis: 'per_package', rate: 4 }] },
    { arrivals: [arrival], sales: agencySales(sales), existing: [] },
  );
  const patti: Demo<SalePatti> = { ...built, id: 'demo-patti-1', demo: true, number: buildInvoiceNumber('DEMOPAT', fyOf(pattiDay), 1), status: 'draft', created_at: `${pattiDay}T17:00:00.000Z` };
  const mill = base.clients[base.clients.length - 1];
  const indent = (n: number, dispatched: boolean): Demo<Indent> => {
    const d = shiftDay(today, -10 + n * 4);
    return {
      id: `demo-indent-${n + 1}`,
      demo: true,
      number: buildInvoiceNumber('DEMOIND', fyOf(d), n + 1),
      date: d,
      buyer_name: n ? 'Sample Garments (demo)' : 'Sample Traders (demo)',
      principal_id: mill.id!,
      principal_name: mill.name,
      item: n ? 'Cotton yarn 40s' : 'Grey fabric',
      qty: n ? 500 : 1200,
      unit: n ? 'KGS' : 'MTR',
      rate: n ? 310 : 85,
      commission_basis: 'percent',
      commission_rate: 1,
      status: dispatched ? 'dispatched' : 'placed',
      ...(dispatched ? { dispatched_on: shiftDay(d, 2), principal_invoice_no: 'MILL/2041' } : {}),
      created_at: `${d}T10:00:00.000Z`,
    };
  };
  return { invoices: sales, tables: { godowns: [godown], arrivals: [arrival], sale_pattis: [patti], indents: [indent(0, false), indent(1, true)] } };
}

/** R8-A: a party special rate (18 + 4 %), a brand scheme paid by a principal, crates with one customer. */
function distributorExtras({ today, base }: ProfileContext): DemoExtras {
  const item = base.items[0];
  const client = base.clients[0];
  const principal = base.vendors[0];
  const from = shiftDay(today, -30);
  const rate: Demo<PartyRate> = { id: 'demo-party-rate-1', demo: true, side: 'sale', party_id: client.id!, party_name: client.name, item_id: item.id, item_name: item.name, disc_chain: [18, 4], valid_from: from };
  const scheme: Demo<Scheme> = { id: 'demo-scheme-brand', demo: true, item_id: '', item_name: '', buy_qty: 10, free_qty: 1, scope: { brand: item.name.split(/\s+/)[0] }, valid_from: from, principal_vendor_id: principal.id, claim_basis: 'free_goods_at_cost' };
  const crate: Demo<PackagingType> = { id: 'demo-crate', demo: true, name: 'Crate (demo)', unit: 'NOS', deposit: 50, charge_rate: 150, hsn: '3923', tax_rate: 18, returnable: true };
  const move = (n: number, out: number, back: number, days: number): Demo<PackagingMove> => ({ id: `demo-crate-move-${n}`, demo: true, date: shiftDay(today, -days), party_kind: 'client', party_id: client.id, party_name: client.name, type_id: crate.id, out, in: back, created_at: `${shiftDay(today, -days)}T10:00:00.000Z` });
  return { tables: { party_rates: [rate], schemes: [scheme], packaging_types: [crate], packaging_moves: [move(1, 40, 0, 75), move(2, 0, 35, 70), move(3, 20, 0, 5)] } };
}

export function tradingExtras(ctx: ProfileContext): DemoExtras {
  // R8-C: the agency rows; R8-A: the distributor rows; TR-B (commodity) appends theirs below.
  const a = ctx.packs.includes('agency') ? agencyExtras(ctx) : {};
  const d = ctx.packs.includes('distributor') ? distributorExtras(ctx) : {};
  return a.tables && d.tables ? { ...a, tables: { ...a.tables, ...d.tables } } : a.tables ? a : d;
}
