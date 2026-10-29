/**
 * Tally-style global keys (Phase 7) — since R20-A a view over the key registry (`src/lib/keys/registry.ts`), no
 * longer part of the app shell: the shell keeps only the claim stub (`keys/stub.ts`) and the lazy engine runs the
 * rows. `resolveTallyKey` keeps Phase 7's rules for a layout (default `erp9`, the mapping before Round 20):
 *  - never fires while typing in an input / textarea / select / contenteditable — not even the Ctrl/Alt combos;
 *  - never fires on /pos (POS owns F2–F10) or while a modal dialog is open;
 *  - entries the signed-in role cannot use are skipped;
 *  - Ctrl+/ is the cheat sheet (`help`, handled by the shell's useHotkeys).
 * Tested in tests/gateway.test.ts and tests/wiring.test.ts.
 */
import type { AccessAction } from './access';
import { KEY_ROWS, comboFor, comboOf, isBuilt, type KeyRow } from './keys/registry';
import type { KeysLayout } from './keys/stub';

export type TallyKeyId =
  | 'date' | 'period' | 'contra' | 'payment' | 'receipt' | 'journal' | 'sales' | 'purchase' | 'creditNote' | 'debitNote'
  | 'salesOrder' | 'purchaseOrder' | 'deliveryNote' | 'receiptNote' | 'stockJournal' | 'physicalStock' | 'payroll' | 'rejOut'
  | 'vouchers' | 'features' | 'configure' | 'goto' | 'switch' | 'help.ctx' | 'help';

export interface TallyKey {
  id: TallyKeyId;
  combo: string;
  /** Route to open; null = handled by the shell (help, vouchers sheet). */
  to: string | null;
  /** Router state for the Gateway (opens the date / period dialog or focuses Go To). */
  state?: { tally: 'date' | 'period' | 'goto' };
  need?: AccessAction;
}

const toKey = (r: KeyRow, layout: KeysLayout): TallyKey => ({
  id: r.id as TallyKeyId,
  combo: comboFor(r, layout),
  to: r.go ? '/gateway' : r.route ?? null,
  ...(r.go ? { state: { tally: r.go } } : {}),
  ...(r.need ? { need: r.need } : {}),
});

/** The global Tally keys of a layout (built rows only), plus Ctrl+/ for the cheat sheet. */
export function tallyKeys(layout: KeysLayout = 'erp9'): TallyKey[] {
  return [
    ...KEY_ROWS.filter((r) => r.scope === 'global' && r.mode === 'tally' && isBuilt(r) && comboFor(r, layout)).map((r) => toKey(r, layout)),
    { id: 'help', combo: 'mod+/', to: null },
  ];
}
export const TALLY_KEYS: readonly TallyKey[] = tallyKeys('erp9');

export type KeyLike = Parameters<typeof comboOf>[0];

export interface TallyKeyContext {
  pathname: string;
  typing: boolean;
  modalOpen?: boolean;
  can?: (action: AccessAction) => boolean;
  layout?: KeysLayout;
}

export const isPosPath = (pathname: string) => pathname === '/pos' || pathname.startsWith('/pos/');

/** The Tally key an event stands for in this context, or null. `help` is returned for Ctrl+/. */
export function resolveTallyKey(e: KeyLike, ctx: TallyKeyContext): TallyKey | null {
  if (ctx.typing || ctx.modalOpen || isPosPath(ctx.pathname)) return null;
  const combo = comboOf(e);
  const hit = tallyKeys(ctx.layout).find((k) => k.combo === combo);
  if (!hit) return null;
  if (hit.need && ctx.can && !ctx.can(hit.need)) return null;
  // On the purchase side the Debit Note key is Tally's purchase-return Debit Note (WP-3), not the sales debit note.
  const row = KEY_ROWS.find((r) => r.id === hit.id);
  if (row?.on && ctx.pathname.startsWith(row.on.path)) {
    return row.on.need && ctx.can && !ctx.can(row.on.need) ? null : { ...hit, to: row.on.route, need: row.on.need };
  }
  return hit;
}
