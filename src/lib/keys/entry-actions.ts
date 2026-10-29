/**
 * R20-B: voucher and document entry — the actions behind Alt+D / Alt+X / Alt+2 (C's report rows and D's list rows call
 * them too) and the small pure helpers of the entry keys. Every change goes through the data layer: a delete through
 * `localDb.invoices.remove` / `deleteVoucher` / `purchasesDb.remove` (each copies the row to the recycle bin), its Undo
 * through the bin's own `restoreEntries` (rights, period lock and module checks run again), a cancel through
 * `cancelDocument` and its Undo through `reinstateDocument`. Never `writeRaw`. Notes: docs/features/tally-keys.md.
 */
import type { BinEntry } from '../../types/trade-r4';
import { requireAccess } from '../access';
import { peekTable } from '../storage';
import { isIssued, localDb } from '../localDb';
import { isTypingTarget } from '../../hooks/useHotkeys';
import { comboFor, comboOf, rowById, type KeyRow } from './registry';
import { rowLive, type KeyHandler } from './engine';
import { keysLayout, type KeyLike } from './stub';

/** What an entry action works on: a sales document, a Gateway / Books voucher or a supplier bill. */
export type EntryKind = 'invoice' | 'voucher' | 'purchase';
const TABLE: Record<EntryKind, string> = { invoice: 'invoices', voucher: 'vouchers', purchase: 'purchases' };

/**
 * The row among `ids` this key presses here, for a screen that reads its own keys (the Gateway voucher, a form in a
 * dialog, where the engine stays out). Same rules as the engine (built, mode, rights, layout, field scopes), except that
 * in a text field an F-key or a modified key fires too (Tally forms are all fields) — never Ctrl+Alt (AltGr).
 * `anyField`: every key fires in a field (the Gateway voucher, where every place is a field).
 */
export function rowFor(e: KeyLike, ids: readonly string[], anyField = false): KeyRow | undefined {
  const combo = comboOf(e);
  const el = (e.target ?? null) as Element | null;
  const typing = isTypingTarget(el) && (combo.startsWith('mod+alt+') || !(anyField || /^(f\d+|mod\+|alt\+)/.test(combo)));
  for (const id of ids) {
    const r = rowById(id);
    if (!r || comboFor(r, keysLayout()) !== combo || !rowLive(r, combo)) continue;
    const field = r.scope.startsWith('field:');
    if (field ? !el?.closest?.(`[data-key-field="${r.scope.slice(6)}"]`) : typing && !r.inField) continue;
    return r;
  }
  return undefined;
}

/** onKeyDown for a form inside a dialog: runs the matching handler (false passes); a nested dialog keeps its keys. */
export const entryKeyDown = (map: Record<string, KeyHandler | false | undefined>) =>
  (e: { nativeEvent: KeyboardEvent; target: EventTarget; currentTarget: Element; preventDefault(): void; stopPropagation(): void }) => {
    if ((e.target as Element).closest?.('[role="dialog"]') !== e.currentTarget.closest('[role="dialog"]')) return;
    const r = rowFor(e.nativeEvent, Object.keys(map).filter((k) => map[k]));
    if (r && (map[r.id] as KeyHandler)(e.nativeEvent, r) !== false) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

/** Newest non-empty text among rows `pick` keeps (by day, then stored order), leaving out `except` (Ctrl+R / Alt+R). */
export function lastText<T extends { id?: string }>(rows: readonly T[], pick: (r: T) => boolean, text: (r: T) => string | undefined, day: (r: T) => string, except?: string): string {
  let best: [string, string] | null = null;
  for (const r of rows) {
    const t = (text(r) ?? '').trim();
    if (t && (!except || r.id !== except) && pick(r) && (!best || day(r) >= best[0])) best = [day(r), t];
  }
  return best?.[1] ?? '';
}

/** Ctrl+D: the lines without `id` (one blank kept by the caller) and the Undo that puts it back where it was. */
export function withoutLine<T extends { id: string }>(lines: readonly T[], id: string): { lines: T[]; undo: (now: readonly T[]) => T[] } | null {
  const i = lines.findIndex((l) => l.id === id);
  if (i < 0) return null;
  const line = lines[i];
  return { lines: lines.filter((l) => l.id !== id), undo: (now) => (now.some((l) => l.id === id) ? [...now] : [...now.slice(0, i), line, ...now.slice(i)]) };
}

/** Alt+D: delete through the data layer (to the recycle bin). Throws the data layer's refusal. */
export async function deleteEntry(kind: EntryKind, id: string): Promise<void> {
  if (kind === 'invoice') {
    const d = localDb.invoices.getById(id);
    if (d) requireAccess(isIssued(d) ? 'doc.deleteIssued' : 'doc.deleteDraft');
    localDb.invoices.remove(id);
    return;
  }
  requireAccess('books.edit');
  if (kind === 'voucher') (await import('../ledger/vouchers')).deleteVoucher(id);
  else (await import('../purchases')).purchasesDb.remove(id);
}

/** Undo of a delete: the newest recycle-bin entry of the row, restored through the bin's own path. */
export async function undoDelete(kind: EntryKind, id: string): Promise<void> {
  const { BIN_TABLE, restoreEntries } = await import('../trust/recycle-bin');
  const e = [...peekTable<BinEntry>(BIN_TABLE)].reverse().find((x) => x.table === TABLE[kind] && x.row_id === id);
  if (!e) throw new Error('That entry is no longer in the recycle bin.');
  restoreEntries([e.id], { withChildren: true });
}

/** Alt+X: cancel a sales document with a reason (payments acknowledged by the confirm that asked). */
export async function cancelEntry(id: string, reason: string, acknowledgePayments = false): Promise<void> {
  const d = localDb.invoices.getById(id);
  if (!d) return;
  requireAccess('doc.edit');
  (await import('../documents')).cancelDocument(d, reason, { acknowledgePayments });
}

/** Undo of a cancel: the status it had, through the reinstate checks. */
export async function undoCancel(id: string): Promise<void> {
  const d = localDb.invoices.getById(id);
  if (d) (await import('../documents')).reinstateDocument(d);
}

/** Alt+2: where the copy opens — an unsaved copy in its editor; it takes a new number on save, Undo just leaves it. */
export function duplicateRoute(kind: Exclude<EntryKind, 'purchase'>, id: string, voucherType = 'journal'): string {
  return kind === 'invoice' ? `/invoice/${encodeURIComponent(id)}?dup=1` : `/gateway/voucher/${voucherType.toLowerCase()}?dup=${encodeURIComponent(id)}`;
}

/** Ctrl+A in a form: submit it the way its Save button does. */
export const acceptForm: KeyHandler = (e) => void (e.target as Element | null)?.closest?.('form')?.requestSubmit();
/** F2 in a form: its first date field. */
export const focusFormDate: KeyHandler = (e) => void (e.target as Element | null)?.closest?.('form')?.querySelector<HTMLElement>('input[type="date"]')?.focus();
