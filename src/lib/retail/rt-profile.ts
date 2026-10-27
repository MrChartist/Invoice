/**
 * RT-A1 retail profile: the shop picked under "Kirana / retail shop" (setup wizard, Settings → Features). The settings
 * patch (business type `kirana`, modules, explicit packs, `retail_kind`) comes from `shop-presets.ts`
 * `applyRetailKind`; this module writes the profile's switches — `retail_settings` (MRP guard, deliveries, short
 * book, free quantity, cash / PAN guard) and, for a medical store, the 7U pharma switches — and never turns a switch
 * the user set OFF (a profile only adds). Changing the profile deletes nothing; packs turned off only hide tabs.
 * Existing kirana companies (no `retail_kind`) are untouched until they pick (checklist step "Pick your shop").
 */
import { RETAIL_PROFILES, type RetailKindId } from '../shop-presets';
import { readPharmaSettings } from '../pharma-gate';
import { savePharmaSettings } from '../pharma';
import { readRetailSettings, saveRetailSettings } from './rt-settings';
import type { GuardMode, RetailSettings } from '../../types/retail-r9';

const RANK: Record<GuardMode, number> = { off: 0, warn: 1, block: 2 };
const stricter = (a: GuardMode | undefined, b: GuardMode | undefined): GuardMode | undefined => {
  if (!a) return b;
  if (!b) return a;
  return RANK[b] > RANK[a] ? b : a;
};

/** The retail settings after applying `kind`'s switches to `current` (pure; switches are only ever turned on). */
export function retailSwitchesFor(kind: RetailKindId, current: RetailSettings = {}): RetailSettings {
  const p = RETAIL_PROFILES[kind].retail;
  const next: RetailSettings = { ...current };
  const mrp = stricter(current.mrp_guard, p.mrp_guard === 'off' ? undefined : p.mrp_guard);
  if (mrp) next.mrp_guard = mrp;
  if (p.delivery) next.delivery = { enabled: true };
  if (p.short_book) next.short_book = { enabled: true };
  if (p.free_qty) next.free_qty = true;
  const cash = stricter(current.cash_guard, p.cash_guard);
  if (cash) next.cash_guard = cash;
  if (p.require_pan) next.require_pan = true;
  return next;
}

/** Owner only: write the profile's switches (retail settings; pharma for a medical store). */
export function applyRetailSwitches(kind: RetailKindId): RetailSettings {
  const saved = saveRetailSettings(retailSwitchesFor(kind, readRetailSettings()));
  if (RETAIL_PROFILES[kind].pharma) {
    const ph = readPharmaSettings();
    // RT-B1 (§8 #8): a medical store blocks H1 / X sales without patient + prescriber (the owner may turn it to warn).
    if (!ph.enabled || !ph.block_expired || !ph.block_above_mrp || !ph.require_rx) savePharmaSettings({ ...ph, enabled: true, block_expired: true, block_above_mrp: true, require_rx: true });
  }
  return saved;
}
