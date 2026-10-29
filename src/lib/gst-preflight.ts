/**
 * 8I (8.161): validate before a GSTR-1 / GSTR-3B / IFF JSON download — the Refrens "Validate report" and Tally
 * "resolve exceptions, then export" step. Pure: groups the GST exceptions (`gst-guards.ts`), the report's own
 * error / warning issues (`gst-reports.ts`) and the Rule 46 series gaps (`invoice-number.ts`) into a short list the
 * preflight dialog shows. An empty list means the download goes straight through.
 *
 * Working papers only: a clean preflight is not a portal validation — verify with your CA.
 */

import type { GstException, GstExceptionCode } from './gst-guards';
import type { ReconIssue } from './gst-reports';
import type { SeriesGap } from './invoice-number';
import type { LutIssue } from './trade/lut-register';

export type PreflightForm = 'GSTR1' | 'GSTR3B' | 'IFF' | 'CMP08';

/** R6-C4: HSN-summary findings — IFF has no HSN table, so its preflight skips them. */
export const HSN_CODES: ReadonlySet<string> = new Set(['B2B_NO_HSN', 'HSN_MISSING', 'HSN_DIGITS']);
/** R6-C4: the checks CMP-08 runs (a composition dealer's quarterly statement): composition documents and series. */
export const COMPOSITION_CODES: ReadonlySet<string> = new Set(['COMPOSITION_DOCS', 'BOS_TAXED_LINES', 'DRAFTS', 'SERIES_GAP', 'SERIES_CANCELLED', 'CANCELLED']);

export interface PreflightItem {
  key: string;
  /** Document number, series or short text. */
  label: string;
  /** Full message for this row (issues), when it adds anything. */
  detail?: string;
  /** In-app route that fixes it (`/invoice/:id`, `/clients`, `/gst-reports?tab=docs` …). */
  link?: string;
}

export interface PreflightGroup {
  /** `ex:<code>`, `issue:<code>` or `gaps`. */
  id: string;
  source: 'exception' | 'issue' | 'gap';
  code: GstExceptionCode | string;
  severity: 'error' | 'warning';
  /** Documents (or series) in the group. */
  count: number;
  /** Message values: `n` (documents), `lines` (B2B_NO_HSN), `missing` (gaps), `message` (issues). */
  vars: Record<string, string | number>;
  items: PreflightItem[];
}

export interface PreflightInput {
  exceptions: readonly GstException[];
  issues: readonly ReconIssue[];
  gaps: readonly SeriesGap[];
  /** R4-C1: LUT findings (`lutIssues` in trade/lut-register.ts) — LUT_MISSING (error), LUT_OUTSIDE_FY (warning). */
  lut?: readonly LutIssue[];
}

const docLink = (id: string) => `/invoice/${encodeURIComponent(id)}`;

/** Issue message without the leading "<document number>: " that `gst-reports.ts` adds. */
export function issueText(i: Pick<ReconIssue, 'message' | 'invoiceNumber' | 'invoiceId'>): string {
  const label = i.invoiceNumber || i.invoiceId;
  return label && i.message.startsWith(`${label}: `) ? i.message.slice(label.length + 2) : i.message;
}

/** Group everything worth a second look before the JSON leaves the app. Errors first, then by size. */
export function buildPreflight({ exceptions, issues, gaps, lut = [] }: PreflightInput, form?: PreflightForm): PreflightGroup[] {
  const all = buildAllGroups({ exceptions, issues, gaps, lut });
  // R6-C4: per-form preflight. IFF skips the HSN checks; CMP-08 runs only the composition checks.
  if (form === 'IFF') return all.filter((g) => !HSN_CODES.has(String(g.code)));
  if (form === 'CMP08') return all.filter((g) => COMPOSITION_CODES.has(String(g.code)));
  return all;
}

function buildAllGroups({ exceptions, issues, gaps, lut = [] }: PreflightInput): PreflightGroup[] {
  const groups = new Map<string, PreflightGroup>();
  const group = (id: string, init: Omit<PreflightGroup, 'id' | 'count' | 'items'>) => {
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { id, count: 0, items: [], ...init }));
    return g;
  };

  // GST exceptions: one group per code. Missing HSN also counts the lines.
  const hsnDocs = new Set<string>();
  for (const e of exceptions) {
    const g = group(`ex:${e.code}`, { source: 'exception', code: e.code, severity: e.severity, vars: { n: 0 } });
    if (e.severity === 'error') g.severity = 'error';
    g.count++;
    g.vars.n = g.count;
    if (e.code === 'B2B_NO_HSN') {
      hsnDocs.add(e.invoiceId);
      g.vars.lines = Number(g.vars.lines ?? 0) + (Number(e.vars.n) || 0);
    }
    g.items.push({ key: `${e.code}:${e.invoiceId}`, label: e.number, link: docLink(e.invoiceId) });
  }

  // Report issues (errors / warnings only; `info` is context, not a problem). HSN_MISSING on a document already
  // listed by the exceptions is the same finding — shown once.
  for (const i of issues) {
    if (i.severity !== 'error' && i.severity !== 'warning') continue;
    if (i.code === 'HSN_MISSING' && i.invoiceId && hsnDocs.has(i.invoiceId)) continue;
    const g = group(`issue:${i.code}`, { source: 'issue', code: i.code, severity: i.severity, vars: { n: 0, message: issueText(i) } });
    if (i.severity === 'error') g.severity = 'error';
    g.count++;
    g.vars.n = g.count;
    g.items.push({ key: i.id, label: i.invoiceNumber || (i.invoiceId ? '-' : issueText(i)), detail: issueText(i), link: i.link ?? (i.invoiceId ? docLink(i.invoiceId) : undefined) });
  }

  // R4-C1: zero-rated exports without a live LUT (Rule 96A) — verify with your CA.
  for (const l of lut) {
    const message = l.code === 'LUT_MISSING'
      ? 'Zero-rated export without an LUT (Rule 96A): verify with your CA'
      : `LUT of ${l.lutFy} on a document of ${l.fy}: verify with your CA`;
    const g = group(`issue:${l.code}`, { source: 'issue', code: l.code, severity: l.code === 'LUT_MISSING' ? 'error' : 'warning', vars: { n: 0, message } });
    g.count++;
    g.vars.n = g.count;
    g.items.push({ key: `${l.code}:${l.invoiceId}`, label: l.number || '-', detail: message, link: docLink(l.invoiceId) });
  }

  // Rule 46: gaps in a series are reported as cancelled in Table 13 — worth explaining before filing.
  const withGaps = gaps.filter((g) => g && g.missingCount > 0);
  if (withGaps.length) {
    const missing = withGaps.reduce((s, g) => s + g.missingCount, 0);
    groups.set('gaps', {
      id: 'gaps',
      source: 'gap',
      code: 'SERIES_GAP',
      severity: 'warning',
      count: withGaps.length,
      vars: { n: withGaps.length, missing },
      items: withGaps.map((g) => ({
        key: `${g.prefix}|${g.fy}`,
        label: `${g.prefix}/FY${g.fy}`,
        detail: `${g.missingNumbers.slice(0, 6).join(', ')}${g.missingCount > 6 ? ' …' : ''}`,
        link: '/gst-reports?tab=docs',
      })),
    });
  }

  const rank = (g: PreflightGroup) => (g.severity === 'error' ? 0 : 1);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b) || b.count - a.count || a.id.localeCompare(b.id));
}

/** Number shown on the JSON buttons ("GSTR-1 JSON · 3 ⚠"): one per document / series in every group. */
export const preflightCount = (groups: readonly PreflightGroup[]) => groups.reduce((s, g) => s + g.count, 0);

/** True when the download should stop at the preflight dialog first. */
export const needsPreflight = (groups: readonly PreflightGroup[]) => groups.length > 0;
