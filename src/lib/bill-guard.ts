/**
 * The bill / expense forms' save path (8.42 + 8.44): duplicate warnings, the approval hold and
 * clean-up of the draft a bill was posted from. One call replaces `purchasesDb.save` in the forms.
 *
 *  1. Unless `confirmed`, soft warnings stop the save: duplicate supplier bill number in the FY,
 *     possible duplicate (same supplier + amount within ±3 days), total differing from the captured
 *     e-invoice value, e-invoice made out to a GSTIN that is not ours. The form shows them and saves
 *     on a second press (override).
 *  2. A clerk's bill above the approval threshold is held in `purchase_drafts` (out of the books).
 *  3. Otherwise `purchasesDb.save` (period lock, roles) and, when the bill was a draft, the draft is
 *     deleted and its inbox row marked done.
 */

import type { PurchaseRecord } from '../types/purchases';
import { can } from './access';
import { findBillDuplicates } from './bill-duplicates';
import { draftsDb, PURCHASE_DRAFTS_TABLE, type DraftMeta, type PurchaseDraft } from './purchase-drafts';
import { PURCHASES_TABLE, purchasesDb } from './purchases';
import { DOC_INBOX_TABLE } from './doc-inbox';
import { withTablesRollback } from './table-txn';
import { billApprovalRequired, readPurchaseApprovalPolicy } from './purchase-approval-gate';
import { settleInboxFor, submitBillForApproval } from './purchase-approvals';
import { formatCurrency, formatDate } from './utils';
import { capT } from '../i18n/areas/capture';
import { defineArea } from '../i18n/area';
import { isPackOn } from './industry-packs';
import { getIndianFY } from './invoice-number';
import { SINGLETON_KEYS, getJson, peekTable } from './storage';

// R5-B2: informational ITC caution for a GTA that opted for 5% forward charge without ITC this FY (transport pack only).
const gtaT = defineArea(
  {
    warnGta: 'GTA option FY {fy}: 5% without ITC — check the ITC on this bill (verify with your CA).',
    warnRealty: 'Project {name} pays GST at 1% / 5% without ITC — this bill claims ITC (verify with your CA).',
  } as const,
  {
    warnGta: 'GTA विकल्प वित्त वर्ष {fy}: 5% बिना ITC — इस बिल का ITC जाँचें (CA से पुष्टि करें)।',
    warnRealty: 'प्रोजेक्ट {name} पर GST 1% / 5% बिना ITC है — यह बिल ITC ले रहा है (CA से पुष्टि करें)।',
  },
);

/** QA11 C9: a bill charged to a builder's project on the 1% / 5% scheme (N 03/2019, no ITC) that claims ITC. */
function realtyItcCaution(input: BillInput): string {
  if (!input.itc_eligible || !input.cost_centre_id || !(num(input.cgst) + num(input.sgst) + num(input.igst) > 0)) return '';
  if (!isPackOn(getJson(SINGLETON_KEYS.settings, null), 'realty')) return '';
  const p = peekTable<{ name?: string; cost_centre_id?: string; gst_scheme?: string }>('realty_projects').find((x) => x?.cost_centre_id === input.cost_centre_id && x.gst_scheme !== 'old_option');
  return p ? gtaT('warnRealty', { name: p.name ?? '' }) : '';
}

function gtaItcCaution(input: BillInput): string {
  if (!input.itc_eligible || !(num(input.cgst) + num(input.sgst) + num(input.igst) > 0)) return '';
  if (!isPackOn(getJson(SINGLETON_KEYS.settings, null), 'transport')) return '';
  const fy = getIndianFY(input.date).label;
  return peekTable<{ fy?: string; option?: string }>('gta_options').some((o) => o?.fy === fy && o.option === 'fcm_5') ? gtaT('warnGta', { fy }) : '';
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// R10 (SV-A4): the 5%-without-ITC caution of a service company — one lazy check registered by `services/sv-hooks.ts`.
let svBillCaution: ((bill: BillInput) => string) | null = null;
export const setSvBillCaution = (fn: (bill: BillInput) => string): void => { svBillCaution = fn; };
// R10 (SV-A4): a service company (profile or pack) loads the service hooks once — no shared chunk, nothing for others.
const svOn = ((s) => !!s?.service_kind || (Array.isArray(s?.industry_packs) && s.industry_packs.some((p) => p === 'clinic' || p === 'salon' || p === 'fitness' || p === 'workshop')))(getJson<{ service_kind?: unknown; industry_packs?: unknown } | null>(SINGLETON_KEYS.settings, null));
if (svOn) void import('./services/sv-hooks').then((m) => { svBillCaution ??= m.billCaution; }, () => undefined);

export type GuardedSave =
  | { kind: 'warn'; message: string }
  | { kind: 'held'; draft: PurchaseDraft }
  | { kind: 'saved'; bill: PurchaseRecord };

type BillInput = Omit<PurchaseRecord, 'id'> & { id?: string };

/** Soft warnings for a bill about to be saved (empty = none). */
export function billWarnings(input: BillInput, purchases: readonly PurchaseRecord[], draft?: DraftMeta): string[] {
  const out: string[] = [];
  const dup = findBillDuplicates(input, purchases);
  const ref = (p: PurchaseRecord) => `${p.bill_number || '—'} · ${formatDate(p.date)} · ${formatCurrency(p.total)}`;
  if (dup.exact.length) out.push(capT('warnDup', { list: dup.exact.slice(0, 3).map(ref).join('; ') }));
  if (dup.near.length) out.push(capT('warnNear', { list: dup.near.slice(0, 3).map(ref).join('; ') }));
  if (draft?.expected_total && Math.abs(draft.expected_total - (Number(input.total) || 0)) > 1) {
    out.push(capT('warnTotal', { qr: formatCurrency(draft.expected_total), total: formatCurrency(Number(input.total) || 0) }));
  }
  if (draft?.foreign_buyer) out.push(capT('warnBuyer', { gstin: draft.foreign_buyer }));
  const gta = gtaItcCaution(input); // R5-B2
  if (gta) out.push(gta);
  const realty = realtyItcCaution(input); // QA11 C9
  if (realty) out.push(realty);
  const sv = svBillCaution?.(input); // R10 (SV-A4)
  if (sv) out.push(sv);
  return out;
}

export function saveBillGuarded(input: BillInput, opts: { confirmed?: boolean; payNow?: DraftMeta['pay_now'] } = {}): GuardedSave {
  const draft = input.id ? draftsDb.get(input.id) : undefined;
  const stored = input.id ? purchasesDb.get(input.id) : undefined;
  if (!opts.confirmed) {
    const warnings = billWarnings(input, purchasesDb.all(), draft?.draft);
    if (warnings.length) return { kind: 'warn', message: `${warnings.join(' ')} ${capT('saveAgain')}` };
  }
  if (billApprovalRequired(input, stored, readPurchaseApprovalPolicy(), can('doc.approve'))) {
    return { kind: 'held', draft: submitBillForApproval(input, { payNow: opts.payNow }) };
  }
  if (!draft) return { kind: 'saved', bill: purchasesDb.save(input) };
  const bill = withTablesRollback([PURCHASES_TABLE, PURCHASE_DRAFTS_TABLE, DOC_INBOX_TABLE], () => {
    const saved = purchasesDb.save(input);
    draftsDb.remove(draft.id, { keepFiles: true });
    settleInboxFor(draft.id, saved.id);
    return saved;
  });
  return { kind: 'saved', bill };
}
