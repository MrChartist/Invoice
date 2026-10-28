/**
 * R19-A4 job paper (pure; family `f-logistics`): the reference rows (job, shipment, route, house / master bill, vessel
 * or flight, shipping bill / bill of entry, packages, weights, CBM) and the place-of-supply reason B writes
 * (`lg.pos_reason`) — from the document's `lg` snapshot only, so an issued document never changes. The containers
 * table was cut at the R19-A cap (PRD §3 cut 1). C (disbursement schedule) and D (manifest / storage summaries) add
 * `parts/logistics/*.tsx` arms.
 */
import type { LgSnapshot } from '../../types/logistics-r19';

const MODE: Record<string, string> = { sea_fcl: 'Sea FCL', sea_lcl: 'Sea LCL', air: 'Air', road: 'Road', rail: 'Rail', multimodal: 'Multimodal', courier: 'Courier' };
const DIR: Record<string, string> = { export: 'Export', import: 'Import', domestic: 'Domestic', cross_trade: 'Cross-trade' };
const dmy = (d?: string) => (d ? d.split('-').reverse().join('/') : '');
const pair = (a?: string, b?: string) => [a, b].filter(Boolean).join(' / ');
const kg = (v?: number) => (v ? `${v.toLocaleString('en-IN')} kg` : '');

export function logisticsPaper(lg: LgSnapshot): { rows: [string, string][]; reason: string } {
  const r = lg.refs ?? {};
  const w = lg.weights ?? {};
  const p = lg.ports;
  const rows: [string, string][] = [
    ['Job', lg.job_no ?? ''],
    ['Shipment', pair(DIR[lg.dir ?? ''], MODE[lg.mode ?? ''])],
    ['Route', p ? `${p.origin} → ${p.destination}${p.dest_country ? ` (${p.dest_country})` : ''}` : ''],
    [r.hawb || r.mawb ? 'HAWB / MAWB' : 'HBL / MBL', r.hawb || r.mawb ? pair(r.hawb, r.mawb) : pair(r.hbl, r.mbl)],
    [r.flight ? 'Flight' : 'Vessel / voyage', r.flight ?? pair(r.vessel, r.voyage)],
    ['Shipping bill', r.sb_no ? `${r.sb_no}${r.sb_date ? ` dt ${dmy(r.sb_date)}` : ''}` : ''],
    ['Bill of entry', r.boe_no ? `${r.boe_no}${r.boe_date ? ` dt ${dmy(r.boe_date)}` : ''}` : ''],
    ['Packages', w.pkgs ? String(w.pkgs) : ''],
    ['Gross / chargeable', pair(kg(w.gross_kg), kg(w.chargeable_kg))],
    ['CBM', w.cbm ? String(w.cbm) : ''],
  ];
  return { rows: rows.filter(([, v]) => v), reason: lg.pos_reason ?? '' };
}
