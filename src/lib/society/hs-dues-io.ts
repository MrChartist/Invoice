/**
 * R18-C bridge (outside `f-society`): the Dues view's reads and writes through the shared paths — interest by
 * `computeInterest` (R5 interest engine), a unit's receipt through `savePartyReceipt` (the khata receipt: one row per
 * bill, the rest on account; all or nothing) pre-split interest first, an interest waiver as a financial credit note
 * (`createFinancialNote`, FCN, audited; reason + general-body resolution in its note), the dues certificate and the
 * transfer of membership through `saveUnit` (units + member links in one rollback), the society reminder wording into
 * the R2-A5 schedule, and print windows (`escHtml`). Working papers — verify with your CA.
 */
import './hs-registry';
import { getTable } from '../storage';
import { localDb } from '../localDb';
import { round2 } from '../invoice-calc';
import { withTablesRollback } from '../table-txn';
import { computeInterest } from '../interest';
import { savePartyReceipt } from '../bill-allocation';
import { createFinancialNote } from '../settlement';
import { loadReminderSchedule, saveReminderSchedule } from '../reminder-settings';
import { buildReminder } from '../reminders';
import { whatsappLink } from '../share';
import { escHtml } from '../html-esc';
import { printHtmlDocument } from '../voucher-print';
import { formatCurrency } from '../utils';
import { hscT } from '../../i18n/areas/society-r18c';
import type { Client, Payment } from '../../types/invoice';
import type { SocietyUnit } from '../../types/society-r18';
import { allocate, duesIndex, duesRow, unitDues, type DuesIndex, type DuesRow, type InterestFn } from './hs-dues';
import { nextCertificate, transferError, transferUnit, type TransferInput } from './hs-transfer';
import { SOCIETY_TEMPLATES } from './hs-reminders';
import { loadUnits, saveUnit } from './hs-units-save';
import { societySettings } from './hs-issue-io';

const fn = computeInterest as InterestFn;
const index = (): DuesIndex => duesIndex(localDb.invoices.getAll(), getTable<Payment>('transactions'), getTable('doc_links'));
const unitOf = (id: string) => { const u = loadUnits().find((x) => x.id === id); if (!u) throw new Error(hscT('noUnit')); return u; };

export interface DuesLine extends DuesRow { unit: SocietyUnit; member?: Client; promise?: string }

/** Every unit's dues on `asOf` with its member and the last promise to pay (R2-A4 collection notes). */
export function loadDues(asOf: string): DuesLine[] {
  const ix = index(), s = societySettings(), byId = new Map(localDb.clients.getAll().map((c) => [c.id, c]));
  const notes = getTable<{ party_key: string; date: string; promise?: { amount: number; date: string } }>('collection_notes').filter((n) => n.promise).sort((a, b) => a.date.localeCompare(b.date));
  return loadUnits().filter((u) => u.status === 'active').map((unit) => {
    const p = notes.filter((n) => n.party_key === unit.owner_id).at(-1)?.promise;
    return { ...duesRow(unit.id, asOf, ix, s, fn, unit.owner_id), unit, member: byId.get(unit.owner_id ?? ''), ...(p ? { promise: `${formatCurrency(p.amount)} · ${p.date}` } : {}) };
  });
}

/** The suggested split of a receipt (interest first unless the society chose oldest first, HS37). */
export function receiptSplit(unitId: string, amount: number, date: string) {
  const d = unitDues(unitId, date, index(), societySettings(), fn, unitOf(unitId).owner_id);
  return allocate(amount, d.bills, societySettings().allocation).map((a) => ({ ...a, ref: d.bills.find((b) => b.bill.id === a.bill_id)?.bill.invoice_number ?? '' }));
}

/** Save a unit's receipt (`payment.record`) with the (possibly edited) split; the rest stays on account. */
export function recordUnitReceipt(unitId: string, amount: number, date: string, method: string, split: readonly { bill_id: string; ref?: string; amount: number }[]) {
  const u = unitOf(unitId), c = localDb.clients.getAll().find((x) => x.id === u.owner_id);
  if (!c) throw new Error(hscT('noMember'));
  return savePartyReceipt({ client: { id: c.id, name: c.name }, amount, method, date, note: `${u.code} maintenance`, allocations: split.map((a) => ({ bill_id: a.bill_id, ref: a.ref ?? '', amount: a.amount })) });
}

/** Waive open interest of the unit's bills (oldest first) by financial credit notes with the reason and the GB resolution. */
export function waiveInterest(unitId: string, amount: number, reason: string, resolution: string, date: string): number {
  if (!reason.trim() || !resolution.trim()) throw new Error(hscT('needWhy'));
  const open = unitDues(unitId, date, index(), societySettings(), fn, unitOf(unitId).owner_id).bills.filter((b) => b.interest > 0);
  let left = round2(amount);
  if (left > round2(open.reduce((t, b) => t + b.interest, 0)) + 0.004) throw new Error(hscT('tooMuch'));
  // QA21 W6: one note per bill, all or nothing (a refusal on the second bill no longer leaves the first note issued).
  return withTablesRollback(['invoices', 'doc_links', 'series_counters', 'items_catalog'], () => {
    let n = 0;
    for (const b of open) {
      const a = round2(Math.min(left, b.interest));
      if (!(a > 0)) break;
      createFinancialNote(b.bill.id, { amount: a, reason: 'settlement_discount', date, note: `Interest on arrears waived: ${reason.trim()} (GB resolution ${resolution.trim()})` });
      left = round2(left - a);
      n++;
    }
    return n;
  });
}

/** Issue and log a dues certificate (`master.edit`); the text states only the books' figures (HS33). */
export function issueCertificate(unitId: string, asOf: string): string {
  const u = unitOf(unitId), ix = index(), s = societySettings();
  const d = unitDues(unitId, asOf, ix, s, fn);
  const later = (ix.bills.get(unitId) ?? []).filter((b) => b.issue_date > asOf).reduce((t, b) => t + Math.max(0, b.total - (ix.events.get(b.id) ?? []).reduce((x, e) => x + e.amount, 0)), 0);
  const billedInt = d.bills.reduce((t, b) => t + b.interest, 0), p = round2(d.arrears - billedInt), i = round2(billedInt + d.interest), total = round2(p + i + later);
  const cert = nextCertificate(u, asOf, total, s.certificate_validity_days);
  saveUnit({ ...u, certificates: [...(u.certificates ?? []), cert] });
  const m = localDb.clients.getAll().find((c) => c.id === u.owner_id)?.name ?? '';
  return hscT('certLine', { u: u.code, m, d: asOf, p: formatCurrency(p), i: formatCurrency(i), a: formatCurrency(round2(later)), t: formatCurrency(total), no: cert.no, v: cert.valid_till });
}

/** Record a transfer of membership; later bills go to the new member. */
export function transferMembership(unitId: string, t: TransferInput): SocietyUnit {
  const u = unitOf(unitId);
  const e = transferError(u, t, unitDues(unitId, t.date, index(), societySettings(), fn).arrears);
  if (e) throw new Error(hscT(`e_${e}`));
  return saveUnit(transferUnit(u, t));
}

/** The society template set into the company's reminder schedule (R2-A5). */
export const applySocietyWording = () => saveReminderSchedule({ ...loadReminderSchedule(), templates: SOCIETY_TEMPLATES });

/** A WhatsApp reminder for the unit's oldest open bill, in the society wording. */
export function reminderLink(l: DuesLine): string {
  return l.first ? whatsappLink(l.member?.phone, buildReminder(l.first, 'overdue_polite', 'en', new Date(), { template: SOCIETY_TEMPLATES.en!.overdue_polite as { subject: string; body: string } }).body) : '';
}

/** Print: a certificate text, or the notice-board list (unit and amount only — no phone numbers). */
export function printText(title: string, lines: readonly string[]): void {
  printHtmlDocument(`<!doctype html><meta charset="utf-8"><title>${escHtml(title)}</title><body style="font:14px/1.6 sans-serif;margin:24px"><h2>${escHtml(title)}</h2>${lines.map((l) => `<p>${escHtml(l)}</p>`).join('')}<p style="color:#666">${escHtml('Working paper — verify with your CA.')}</p></body>`, () => undefined);
}
