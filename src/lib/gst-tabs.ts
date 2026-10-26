/**
 * GST page tabs (8I, 8.162): the ~29 sections grouped into GSTR-1 / GSTR-3B / Reconcile / Tools. Every tab id that
 * ever worked as `/gst-reports?tab=<id>` must keep resolving (`tests/gst-filing.test.ts` pins the list).
 */
import type { gstT } from '../i18n/areas/gst';
import type { PackId } from './industry-packs';

export type GstTabId =
  | 'overview' | 'compliance' | 'b2b' | 'b2cl' | 'b2cs' | 'cdnr' | 'cdnur' | 'exp' | 'nil' | 'at' | 'txpd' | 'hsn' | 'docs'
  | 'amend' | 'eco' | 'gstr3b' | 'gstr2b' | 'composition' | 'setoff' | 'purhsn' | 'recon' | 'hsnmaster' | 'gstr9c'
  | 'rcmdocs' | 'cashref' | 'isd' | 'ewbcons' | 'bygstin' | 'guards'
  // R3-C4 / C5
  | 'portal-files' | 'eway-desk'
  // R4-C2: export desk (realisation, IRM / e-BRC, incentives, imports by BOE)
  | 'export-desk'
  // R5-C2: Rule 42 / 43 common-credit working
  | 'common-credit'
  // R7-C1: hotel GST desk (bands, specified premises, declarations)
  | 'hotel-gst';

export type GstTabGroupId = 'gstr1' | 'gstr3b' | 'recon' | 'tools';

export interface GstTab {
  id: GstTabId;
  /** English (Excel sheet names); `key` is the on-screen name when it is not a portal term. */
  label: string;
  key?: Parameters<typeof gstT>[0];
  /** R3-C: on-screen name from the desks area (`desks-r3.ts`) instead of the GST area. */
  desk?: 'tab.portal' | 'tab.eway';
}

/** `label` stays English (Excel sheet names); `key` is the on-screen name when it is not a portal term. */
export const GST_TABS: readonly GstTab[] = [
  { id: 'overview', label: 'Overview', key: 'tabOverview' },
  { id: 'b2b', label: 'B2B' },
  { id: 'b2cl', label: 'B2CL' },
  { id: 'b2cs', label: 'B2CS' },
  { id: 'cdnr', label: 'CDNR' },
  { id: 'cdnur', label: 'CDNUR' },
  { id: 'exp', label: 'Exports', key: 'tabExp' },
  { id: 'nil', label: 'Nil / Exempt', key: 'tabNil' },
  { id: 'at', label: 'Advances 11A', key: 'tabAt' },
  { id: 'txpd', label: 'Adjusted 11B', key: 'tabTxpd' },
  { id: 'hsn', label: 'HSN' },
  { id: 'docs', label: 'Documents', key: 'tabDocs' },
  { id: 'amend', label: 'Amendments', key: 'tabAmend' },
  { id: 'eco', label: 'E-commerce 14', key: 'tabEco' },
  { id: 'gstr3b', label: 'GSTR-3B' },
  { id: 'setoff', label: 'Set-off & payment', key: 'tabSetoff' },
  { id: 'gstr2b', label: '2B match', key: 'tab2b' },
  { id: 'purhsn', label: 'Purchase HSN', key: 'tabPurHsn' },
  { id: 'recon', label: '1 vs 3B vs Books', key: 'tabRecon' },
  { id: 'compliance', label: 'Compliance', key: 'tabCompliance' },
  { id: 'composition', label: 'Composition (CMP-08 / GSTR-4)', key: 'tabComposition' },
  { id: 'hsnmaster', label: 'HSN master', key: 'tabHsnMaster' },
  { id: 'gstr9c', label: 'GSTR-9C', key: 'tab9c' },
  { id: 'rcmdocs', label: 'RCM self-invoice', key: 'tabRcm' },
  { id: 'cashref', label: 'Cash ledger & refunds', key: 'tabCashRef' },
  { id: 'isd', label: 'ISD / GSTR-6', key: 'tabIsd' },
  { id: 'ewbcons', label: 'Consolidated e-Way', key: 'tabEwbCons' },
  { id: 'bygstin', label: 'By GSTIN', key: 'tabByGstin' },
  { id: 'guards', label: 'GST guards', key: 'tabGuards' },
  // R3-C4 / C5: GSTR-1 portal files, e-Way desk
  { id: 'portal-files', label: 'Portal files', desk: 'tab.portal' },
  { id: 'eway-desk', label: 'e-Way desk', desk: 'tab.eway' },
  // R4-C2
  { id: 'export-desk', label: 'Export desk', key: 'tabExportDesk' },
  // R5-C2 (on-screen name from the institutions area)
  { id: 'common-credit', label: 'Common credit (Rule 42 / 43)' },
  // R7-C1 (on-screen name from the hotel compliance area)
  { id: 'hotel-gst', label: 'Hotel GST' },
];

/** R5-C: tabs listed only while one of these packs is on (their URL always opens them). */
export const PACK_GST_TABS: Readonly<Partial<Record<GstTabId, readonly PackId[]>>> = { 'common-credit': ['fees', 'nonprofit', 'leases', 'hotel'], 'hotel-gst': ['hotel'] };

/** Display order: GSTR-1 sections, GSTR-3B and payment, reconciliation, then the other tools. */
export const GST_TAB_GROUPS: readonly { id: GstTabGroupId; tabs: readonly GstTabId[] }[] = [
  { id: 'gstr1', tabs: ['overview', 'b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp', 'nil', 'at', 'txpd', 'hsn', 'docs', 'amend', 'eco'] },
  { id: 'gstr3b', tabs: ['gstr3b', 'setoff', 'cashref', 'rcmdocs'] },
  { id: 'recon', tabs: ['gstr2b', 'purhsn', 'recon', 'guards', 'bygstin'] },
  { id: 'tools', tabs: ['compliance', 'composition', 'hsnmaster', 'gstr9c', 'isd', 'ewbcons', 'portal-files', 'eway-desk', 'export-desk', 'common-credit', 'hotel-gst'] },
];

/** Tab ids in on-screen order (arrow-key navigation walks this list). */
export const GST_TAB_ORDER: readonly GstTabId[] = GST_TAB_GROUPS.flatMap((g) => g.tabs);

export const isGstTab = (t: unknown): t is GstTabId => typeof t === 'string' && GST_TABS.some((x) => x.id === t);

/** `?tab=` → tab id, or null for a missing / unknown value. */
export const resolveGstTab = (t: string | null | undefined): GstTabId | null => (isGstTab(t) ? t : null);

export const groupOfTab = (t: GstTabId): GstTabGroupId => GST_TAB_GROUPS.find((g) => g.tabs.includes(t))?.id ?? 'tools';

/** Next tab for an arrow / Home / End key, or null for any other key. */
export function tabForKey(current: GstTabId, key: string): GstTabId | null {
  const i = GST_TAB_ORDER.indexOf(current);
  const n = GST_TAB_ORDER.length;
  if (key === 'ArrowRight') return GST_TAB_ORDER[(i + 1) % n];
  if (key === 'ArrowLeft') return GST_TAB_ORDER[(i - 1 + n) % n];
  if (key === 'Home') return GST_TAB_ORDER[0];
  if (key === 'End') return GST_TAB_ORDER[n - 1];
  return null;
}
