/**
 * R19-D2 courier manifests (pure; family `f-logistics`). One `lg_manifests` row per account customer × month holds its
 * dockets (never one row per docket). A docket's charge: chargeable = the greater of the actual and the volumetric
 * weight (÷ 5000, a setting, LG33) up to the next 0.5 kg; the zone card's first 500 g + each further 500 g, the card's
 * minimum, its RTO % on a returned docket, then the fuel surcharge %. The monthly run bills every manifest of the period
 * that no live bill names (`lg.manifest_id`, derived — never stored): one tax invoice per customer, SAC 996812 at the
 * courier rate, POS by Sec 12(8) (a registered customer's State); international dockets go on their own document with
 * POS 96 (12(8) proviso, LG18). One line per docket ("Courier charges", the docket in the description — the catalogue
 * learns one item). COD remittance was cut (PRD §3 cut 2). Working papers — verify with your CA (LG18, LG20, LG33).
 */
import { round2 } from '../invoice-calc';
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { LgDocket, LgManifest, LgZone, LogisticsSettings } from '../../types/logistics-r19';
import { lgRateFor, sacFor } from './lg-heads';
import { chargeableWeight } from './lg-weight';
import { liveBills, lgDoc, partyPos, periodOf, svcLine, type DocCtx } from './lg-doc';

/** Most dockets read from one file (the network's monthly CSV). */
export const MAX_DOCKETS = 5000;
/** Declared value above which the e-Way hint shows (Rule 138(1) proviso, LG20). */
export const EWAY_VALUE = 50000;

type Charge = Pick<LgDocket, 'kg' | 'dims' | 'zone' | 'fsc_pct' | 'status'>;
/** Chargeable kg and the charge of a docket on the zone card; null when the zone has no card. */
export function docketCharge(d: Charge, zones: readonly LgZone[], s: Pick<LogisticsSettings, 'volumetric'> = {}): { chargeable_kg: number; charge: number } | null {
  const chargeable_kg = chargeableWeight({ gross_kg: d.kg, dims: d.dims, mode: 'courier', settings: s }).value;
  const z = zones.find((x) => x.zone.trim().toLowerCase() === d.zone.trim().toLowerCase());
  if (!z) return null;
  let c = Math.max(z.first_500g + (Math.max(1, Math.ceil(chargeable_kg * 2 - 1e-9)) - 1) * z.addl_500g, z.min ?? 0);
  if (d.status === 'rto') c += (c * (z.rto_pct ?? 0)) / 100;
  return { chargeable_kg, charge: round2(c * (1 + (d.fsc_pct ?? 0) / 100)) };
}

/** The docket file's columns (a header row, any order; `docket`, `date` and `zone` required). */
export const DOCKET_COLS = ['docket', 'date', 'zone', 'kg', 'l', 'w', 'h', 'pcs', 'service', 'pin', 'value', 'status', 'intl', 'fsc', 'charge'] as const;
const n = (v: string) => { const x = Number(v.replace(/,/g, '')); return x > 0 ? x : undefined; };
const day = (v: string) => { const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v); const d = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : v; return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : ''; };

/**
 * Dockets from a parsed CSV (first row = the header). A `charge` column wins over the zone card (a zone without a card
 * then needs one). `errors`: `cols`, `many`, or the rows to fix (1 = the header); `hints`: dockets above ₹50,000.
 */
export function docketsFromRows(rows: readonly string[][], s: LogisticsSettings): { dockets: LgDocket[]; errors: string[]; hints: string[] } {
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const dockets: LgDocket[] = [], errors: string[] = [], hints: string[] = [], seen = new Set<string>();
  const body = rows.slice(1).filter((r) => r.some((c) => c.trim()));
  if (!['docket', 'date', 'zone'].every((k) => head.includes(k))) return { dockets, errors: ['cols'], hints };
  if (body.length > MAX_DOCKETS) return { dockets, errors: ['many'], hints };
  body.forEach((r, i) => {
    const g = (k: (typeof DOCKET_COLS)[number]) => (r[head.indexOf(k)] ?? '').trim();
    const no = g('docket').toUpperCase(), date = day(g('date')), zone = g('zone'), st = g('status').toLowerCase(), sv = g('service').toLowerCase();
    if (!no || !date || !zone || seen.has(no)) return void errors.push(String(i + 2));
    seen.add(no);
    const d: LgDocket = {
      no, date, zone, pcs: n(g('pcs')) ?? 1, kg: n(g('kg')) ?? 0, chargeable_kg: 0, charge: 0, service: sv === 'express' || sv === 'cargo' ? sv : 'standard',
      ...(n(g('l')) && n(g('w')) && n(g('h')) ? { dims: [{ l: n(g('l'))!, w: n(g('w'))!, h: n(g('h'))!, n: n(g('pcs')) ?? 1 }] } : {}),
      ...(g('pin') ? { dest_pin: g('pin') } : {}), ...(n(g('value')) ? { value: n(g('value')) } : {}), ...(n(g('fsc')) ? { fsc_pct: n(g('fsc')) } : {}),
      ...(st === 'delivered' || st === 'rto' ? { status: st } : {}), ...(/^(y|yes|1|true)$/i.test(g('intl')) ? { intl: true } : {}),
    };
    const c = docketCharge(d, s.zones ?? [], s), typed = n(g('charge'));
    if (!c && !typed) return void errors.push(`${i + 2}: ${zone}`);
    d.chargeable_kg = c?.chargeable_kg ?? chargeableWeight({ gross_kg: d.kg, dims: d.dims, mode: 'courier', settings: s }).value;
    d.charge = round2(typed ?? c!.charge);
    if ((d.value ?? 0) > EWAY_VALUE) hints.push(no);
    dockets.push(d);
  });
  return { dockets, errors, hints };
}

/** Manifest ids a live bill names. */
export const billedManifests = (invoices: readonly InvoiceRecord[]): Set<string> => new Set(liveBills(invoices).map((i) => i.lg?.manifest_id ?? '').filter(Boolean));

/**
 * Put dockets into the customer's manifests by month (new rows get `newId()`). `dup`: numbers already on a manifest of
 * the company; `billed`: months already billed — the caller refuses the whole file on either.
 */
export function mergeDockets(all: readonly LgManifest[], clientId: string, dockets: readonly LgDocket[], billed: ReadonlySet<string>, newId: () => string, monthEndOf: (p: string) => string, now: string): { rows: LgManifest[]; dup: string[]; billed: string[] } {
  const used = new Set(all.flatMap((m) => m.dockets.map((d) => d.no)));
  const rows = all.slice(), shut = new Set<string>();
  for (const d of dockets) {
    const period = periodOf(d.date);
    let k = rows.findIndex((m) => m.client_id === clientId && m.period === period);
    if (k < 0) k = rows.push({ id: newId(), client_id: clientId, period, date: monthEndOf(period), dockets: [], updated_at: now }) - 1;
    if (billed.has(rows[k].id)) shut.add(period);
    rows[k] = { ...rows[k], dockets: [...rows[k].dockets, d], updated_at: now };
  }
  return { rows, dup: dockets.filter((d) => used.has(d.no)).map((d) => d.no), billed: [...shut] };
}

export const manifestTotals = (m: { dockets: readonly LgDocket[] }): { count: number; kg: number; charge: number } =>
  ({ count: m.dockets.length, kg: round2(m.dockets.reduce((s, d) => s + d.chargeable_kg, 0)), charge: round2(m.dockets.reduce((s, d) => s + d.charge, 0)) });

export interface CourierGroup { m: LgManifest; client: Client; intl: boolean; dockets: LgDocket[] }
/** The documents of a period's run: per unbilled manifest one domestic group and, when it has any, one international. */
export function planCourierRun(period: string, manifests: readonly LgManifest[], invoices: readonly InvoiceRecord[], clients: readonly Client[]): CourierGroup[] {
  const billed = billedManifests(invoices);
  return manifests.filter((x) => x.period === period && !billed.has(x.id)).flatMap((m) => {
    const client = clients.find((c) => c.id === m.client_id);
    return client ? [false, true].map((intl) => ({ m, client, intl, dockets: m.dockets.filter((d) => !!d.intl === intl) })).filter((g) => g.dockets.length) : [];
  });
}

/** One run document: a line per docket; `lg = { manifest_id, period, count, kg, pos_reason }`. */
export function courierBill(g: CourierGroup, ctx: DocCtx): InvoiceRecord {
  const rate = lgRateFor('courier', ctx.date)?.rate ?? 18, sac = sacFor('courier', ctx.date), t = manifestTotals(g);
  const items = g.dockets.map((d) => svcLine('Courier charges', [d.no, d.date.split('-').reverse().join('/'), d.zone, `${d.chargeable_kg} kg`, d.service !== 'standard' && d.service, d.status === 'rto' && 'RTO', d.dest_pin].filter(Boolean).join(' · '), d.charge, sac, rate));
  return lgDoc(ctx, g.client, items, g.intl ? '96' : partyPos(g.client, ctx.home), {
    notes: `Courier charges for ${g.m.period}: ${t.count} docket(s), ${t.kg} kg chargeable.`,
    // QA22 W2: an international docket of a customer in India is export freight (POS 96, IGST) — the GST readers report it
    // as a domestic supply (B2B / B2C with POS 96, LG15), never as an export in Table 6A.
    lg: { manifest_id: g.m.id, period: g.m.period, count: t.count, kg: t.kg, ...(g.intl && !['96', '97', '99'].includes(String(g.client.state_code ?? '')) ? { regime: 'export_freight' } : {}), pos_reason: g.intl ? 'Place of supply: outside India (96), Sec 12(8) proviso IGST Act.' : 'Place of supply: Sec 12(8) IGST Act.' },
  });
}

/** The annexure (CSV rows) of a manifest's dockets. */
export const docketRows = (m: Pick<LgManifest, 'dockets'>): (string | number)[][] => [
  ['Docket', 'Date', 'Zone', 'PIN', 'Pcs', 'Actual kg', 'Chargeable kg', 'Service', 'Status', 'FSC %', 'Charge'],
  ...m.dockets.map((d) => [d.no, d.date, d.zone, d.dest_pin ?? '', d.pcs, d.kg, d.chargeable_kg, d.service, d.status ?? '', d.fsc_pct ?? '', d.charge]),
];
