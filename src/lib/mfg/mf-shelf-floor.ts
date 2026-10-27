/**
 * MF-D2 FEFO with a floor — the only part of `mf-shelf.ts` the invoice editor loads (one guarded line in
 * `LineTracking.tsx`): a client's minimum remaining shelf life at dispatch and the batches that meet it. Pure, tiny.
 */
/** Whole days from `a` to `b` (local `YYYY-MM-DD`; same maths as `msme.ts`, kept here so the editor filter stays tiny). */
export const daysBetween = (a: string, b: string): number => {
  const t = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
};

/** A client's minimum remaining shelf life at dispatch (either or both). */
export interface ShelfFloor {
  pct?: number;
  days?: number;
}

/** The floor on a client record (`Client.mf.min_shelf_pct` / `min_shelf_days`), or undefined when none is set. */
export function floorOf(client: unknown): ShelfFloor | undefined {
  const mf = (client as { mf?: { min_shelf_pct?: unknown; min_shelf_days?: unknown } } | null | undefined)?.mf;
  const pct = Number(mf?.min_shelf_pct);
  const days = Number(mf?.min_shelf_days);
  const out: ShelfFloor = {};
  if (pct > 0 && pct <= 100) out.pct = pct;
  if (days > 0) out.days = Math.round(days);
  return out.pct || out.days ? out : undefined;
}

/** Remaining life on `day`: % of the total life (null without a MFG / packed date) and days (null without an expiry). */
export function remainingLife(b: { mfg?: string; expiry?: string }, day: string): { pct: number | null; days: number | null } {
  if (!b.expiry) return { pct: null, days: null };
  const days = daysBetween(day, b.expiry);
  if (!b.mfg) return { pct: null, days };
  const total = daysBetween(b.mfg, b.expiry);
  const pct = total > 0 ? Math.max(Math.min(Math.round((days / total) * 1000) / 10, 100), 0) : days >= 0 ? 100 : 0;
  return { pct: days < 0 ? 0 : pct, days };
}

/**
 * The batch meets the floor on `day`. A batch without an expiry always does (nothing to run out); a % floor on a batch
 * without a MFG date cannot be checked, so it does not qualify (the user picks it by hand).
 */
export function meetsFloor(b: { mfg?: string; expiry?: string }, day: string, floor: ShelfFloor | undefined): boolean {
  if (!floor || !b.expiry) return true;
  const r = remainingLife(b, day);
  if (floor.days && (r.days ?? 0) < floor.days) return false;
  if (floor.pct && (r.pct === null || r.pct < floor.pct)) return false;
  return true;
}

/** Batches (FEFO order kept) that meet the floor, the units they hold, and the shortfall text when `want` is not met. */
export function floorBatches<T extends { batch: string; mfg?: string; expiry?: string; qty: number; expired?: boolean }>(
  options: readonly T[], day: string, floor: ShelfFloor | undefined, want = 0,
): { ok: T[]; qualifying: number; message: string } {
  const ok = options.filter((o) => !o.expired && meetsFloor(o, day, floor));
  const qualifying = Math.round(ok.reduce((s, o) => s + o.qty, 0) * 1000) / 1000;
  return { ok, qualifying, message: floor && qualifying < want ? shortfallText(floor, qualifying) : '' };
}

/** "no batch with ≥ 70% life — 12 units qualify". */
export function shortfallText(floor: ShelfFloor, qualifying: number): string {
  const need = [floor.pct ? `${floor.pct}% life` : '', floor.days ? `${floor.days} days` : ''].filter(Boolean).join(' and ');
  return `no batch with ≥ ${need} — ${qualifying} units qualify`;
}

