/**
 * R16-D4 statutory watch: GST Council recommendations that are NOT yet notified. Notes only — never rule rows, and
 * no reader ever applies a pending row (`tests/pending-changes.test.ts`: no rule file imports this module). Every date
 * here is a recommendation (`verified: false` in spirit): it changes at notification.
 *
 * When a notification is issued, the developer appends a dated row to the owning rule file (`mfg-rules.ts`
 * `inputServices`, `gst-penalties.ts`, `trading-rules.ts` …) with its number and sets `notified: 'N xx/2026-CT'` here;
 * the note then disappears. Summaries are strings of `pending-r16d.ts` keyed by row id (Hindi in the Hindi pack).
 * Lazy: screens load it through `components/ui/PendingNote.tsx`. Working paper — verify with your CA.
 */
import { pendT } from '../i18n/areas/pending-r16d';

export type PendingArea = 'refund' | 'rule89' | 'latefee' | 'gstr3b' | 'export' | 'rcm_goods' | 'rcm_self' | 'society' | 'logistics';

export interface PendingChange {
  id: Exclude<Parameters<typeof pendT>[0], 'lead' | 'head'>;
  area: PendingArea;
  recommended_on: string;
  /** Proposed start (as recommended); absent = no date given. */
  proposed_from?: string;
  source: string;
  ca: string;
  /** `false` until notified; then the notification number (the note is no longer shown). */
  notified: false | string;
}

const ON = '2026-10-08';
const PIB = 'PIB 8 Oct 2026';

export const PENDING_CHANGES: readonly PendingChange[] = [
  { id: 'pf1_services', area: 'refund', recommended_on: ON, proposed_from: '2026-11-01', source: `${PIB} ¶8.2`, ca: 'PF1', notified: false },
  { id: 'pf1_capital', area: 'refund', recommended_on: ON, proposed_from: '2027-04-01', source: `${PIB} ¶8.3`, ca: 'PF1', notified: false },
  { id: 'pf2_rule89', area: 'rule89', recommended_on: ON, source: `${PIB} ¶6.2`, ca: 'PF2', notified: false },
  { id: 'pf3_latefee', area: 'latefee', recommended_on: ON, source: `${PIB} ¶15`, ca: 'PF3', notified: false },
  { id: 'pf4_3b', area: 'gstr3b', recommended_on: ON, proposed_from: '2027-04-01', source: `${PIB} ¶5.1–5.2`, ca: 'PF4', notified: false },
  { id: 'pf5_export', area: 'export', recommended_on: ON, source: `${PIB} ¶10`, ca: 'PF5', notified: false },
  { id: 'pf7_rcm', area: 'rcm_goods', recommended_on: ON, source: `${PIB} C1 ¶5`, ca: 'PF7', notified: false },
  { id: 'pf8_einv', area: 'rcm_self', recommended_on: ON, source: `${PIB} ¶18`, ca: 'PF8', notified: false },
  // R18-B (HS2): not a Council recommendation — a High Court order under appeal (year only: the order's date was not read).
  { id: 'hs2_valuation', area: 'society', recommended_on: '2021', source: 'Madras HC, TVH Lumbini Square / Greenwood Owners Assn. (single judge); W.A. 2318 / 2321 of 2021 (S)', ca: 'HS2', notified: false },
  // R19-B (LG19): delivery services through e-commerce operators (courier and postal excluded).
  { id: 'lg19_delivery', area: 'logistics', recommended_on: ON, source: `${PIB} (S taxscan, maritimegateway)`, ca: 'LG19', notified: false },
];

/** `YYYY-MM-DD` + `n` months (local day arithmetic; the day clamps to the month's end). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  const last = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Un-notified rows of `area` whose proposed start is absent or within 6 months after `day`. */
export const pendingFor = (area: PendingArea, day: string, rows: readonly PendingChange[] = PENDING_CHANGES): PendingChange[] =>
  rows.filter((r) => r.area === area && r.notified === false && (!r.proposed_from || r.proposed_from <= addMonths(day, 6)));

/** Every row still pending (Help → What's new). */
export const pendingAll = (): PendingChange[] => PENDING_CHANGES.filter((r) => r.notified === false);

/** A row's summary in the current language, with its CA id: "<summary> (PF1)". */
export const pendingLine = (r: PendingChange): string => `${pendT(r.id)} (${r.ca})`;
/** "Recommended by the GST Council on 8 Oct 2026, not yet notified — verify with your CA:" / the What's new heading. */
export const pendingLead = (): string => pendT('lead');
export const pendingHead = (): string => pendT('head');
