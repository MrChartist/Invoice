/** AG-B shared helpers of the Dairy desk views (run-with-toast, pickers' data, farmer lookup). Lazy: desk chunks only. */
import { useState } from 'react';
import type { Vendor } from '../../types/purchases';
import { bT } from '../../i18n/areas/agri-r12b';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { readAgriSettings } from '../../lib/agri/ag-settings';
import controls from '../../styles/controls.module.css';

export type Done = (msg: string, error?: boolean) => void;
export const sm = `${controls.btnOutline} ${controls.btnSm}`;
export const wrap = { flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' } as const;

/** Run a write and report it; bumps `tick` so views re-read their rows. */
export function useRun(onDone: Done) {
  const [tick, setTick] = useState(0);
  const run = (fn: () => string | void) => {
    try {
      const m = fn();
      if (m) onDone(m);
      setTick((t) => t + 1);
    } catch (e) {
      onDone((e as Error).message, true);
    }
  };
  return [tick, run] as const;
}

export const milkOpts = () => (['cow', 'buffalo', 'mixed'] as const).map((k) => [k, bT(`milk.${k}`)] as const);
/** Milk centres (Farm settings); with none set up, one built-in "Main centre" (id `main`, the Main godown). */
export const milkCentres = () => {
  const l = (readAgriSettings().centres ?? []).filter((c) => c.kind === 'milk');
  return l.length ? l : [{ id: 'main', name: bT('mainCentre') }];
};
export const farmers = (): Vendor[] => getTable<Vendor>('vendors').filter((v) => v.ag?.code);
export const clientOpts = () => localDb.clients.getAll().filter((c) => c.id).map((c) => [c.id!, c.company || c.name] as const);

/** Find a farmer by code ("F-0042" or just "42"), phone or the start of the name. */
export function findFarmer(all: readonly Vendor[], q: string): Vendor | undefined {
  const t = q.trim().toLowerCase();
  if (!t) return undefined;
  const n = /^\d+$/.test(t) ? Number(t) : NaN;
  return all.find((v) => v.ag!.code.toLowerCase() === t) ?? all.find((v) => Number.isFinite(n) && Number(v.ag!.code.replace(/\D/g, '')) === n)
    ?? all.find((v) => v.phone === q.trim()) ?? all.find((v) => v.name.toLowerCase().startsWith(t));
}
