/**
 * CN-B5: final bill and contract closure. The checklist — final RA bill made, completion date, DLP over, retention and
 * security deposit released, guarantees released, PV final statement, no-claim certificate, material reconciliation —
 * is derived from the data where it can be (bills, receipts, deposits, guarantees) and ticked by hand otherwise. Any
 * item can be waived with a reason (kept on the contract, audited with it). The contract moves to `closed` only when
 * every item is done or waived. Working paper — verify with your CA.
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { BankGuarantee, CnClosure, CnClosureKey, WorksContract } from '../../types/construction-r11';
import type { SecurityDeposit } from '../../types/institutions-r5';
import { num } from '../invoice-calc';
import { raDueSplit } from '../works/ra-due';
import { contractBills, contractById, plusMonths, saveContract } from './cn-contracts';
import { isLiveBg } from './cn-guarantees';
import type { AttachmentRef } from '../../types/attachments';

export const CLOSURE_KEYS: readonly CnClosureKey[] = ['final_bill', 'completion', 'dlp', 'retention', 'sd', 'bgs', 'pv_final', 'no_claim', 'reco'];
/** Items only a person can tick (the rest follow from the data). */
export const HAND_TICKS: readonly CnClosureKey[] = ['pv_final', 'reco'];

export interface ClosureItem {
  key: CnClosureKey;
  state: 'done' | 'open' | 'waived';
  /** Due day where one applies (DLP end). */
  due?: string;
}

export interface ClosureData {
  invoices: readonly InvoiceRecord[];
  payments: readonly Payment[];
  guarantees: readonly BankGuarantee[];
  deposits: readonly SecurityDeposit[];
  today: string;
}

/** Pure: the closure checklist of a contract. */
export function closureChecklist(c: WorksContract, d: ClosureData): ClosureItem[] {
  const bills = contractBills(c, d.invoices);
  const held = (kind: string) => bills.some((b) => {
    const mine = d.payments.filter((p) => p.invoice_id === b.id);
    const out = num(b.ra_net_payable ?? b.total) + (b.ra_deductions ?? []).filter((x) => x.kind !== 'it_tds').reduce((s, x) => s + x.amount, 0) - mine.reduce((s, p) => s + num(p.amount), 0);
    return raDueSplit(b, mine, out).held.some((h) => h.kind === kind);
  });
  const dlpEnd = c.completed_on && num(c.dlp_months) > 0 ? plusMonths(c.completed_on, num(c.dlp_months)) : c.completed_on;
  const done: Record<CnClosureKey, boolean> = {
    final_bill: bills.some((b) => b.ra_final),
    completion: !!c.completed_on,
    dlp: !!dlpEnd && dlpEnd <= d.today,
    retention: bills.length > 0 && !held('retention'),
    sd: !held('security_deposit') && !d.deposits.some((x) => x.contract_id === c.id && x.status === 'open'),
    bgs: !d.guarantees.some((b) => b.contract_id === c.id && isLiveBg(b)),
    pv_final: !c.escalation || !!c.closure?.ticks?.pv_final,
    no_claim: !!c.closure?.no_claim_ref?.trim(),
    reco: !!c.closure?.ticks?.reco,
  };
  return CLOSURE_KEYS.map((key) => ({ key, state: done[key] ? 'done' : c.closure?.waived?.[key] ? 'waived' : 'open', ...(key === 'dlp' && dlpEnd ? { due: dlpEnd } : {}) }));
}

/** Update the closure record (ticks, waivers with reason, no-claim certificate). */
export function setClosure(id: string, patch: Partial<CnClosure>): WorksContract {
  const c = contractById(id);
  if (!c) throw new Error('Contract not found.');
  for (const [k, why] of Object.entries(patch.waived ?? {})) if (why !== undefined && !String(why).trim()) throw new Error(`Give a reason to waive "${k}".`);
  return saveContract({ ...c, closure: { ...c.closure, ...patch, ticks: { ...c.closure?.ticks, ...patch.ticks }, waived: { ...c.closure?.waived, ...patch.waived } } });
}

/**
 * PENDING 14: the closure documents attached to the contract (`works_contracts` is in `ATTACHMENT_OWNER_TABLES`, so the
 * files stay referenced; the attachments panel releases files dropped from the list).
 */
export function setClosureFiles(id: string, refs: readonly AttachmentRef[]): WorksContract {
  const c = contractById(id);
  if (!c) throw new Error('Contract not found.');
  return saveContract({ ...c, attachments: [...refs] });
}

/** Close the contract once every checklist item is done or waived. */
export function closeContract(id: string, d: ClosureData): WorksContract {
  const c = contractById(id);
  if (!c) throw new Error('Contract not found.');
  const open = closureChecklist(c, d).filter((x) => x.state === 'open');
  if (open.length) throw new Error(`Still open: ${open.map((x) => x.key).join(', ')}.`);
  return saveContract({ ...c, status: 'closed', closure: { ...c.closure, closed_on: d.today } });
}
