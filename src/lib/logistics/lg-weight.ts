/**
 * R19-A2 chargeable weight (pure; family `f-logistics`). Air: the greater of the gross and the volumetric weight
 * (Σ l·w·h·n cm³ ÷ 6000); courier ÷ 5000; sea LCL "W/M": the greater of the CBM and gross ÷ 1000 (revenue tons). Air /
 * courier round up to 0.5 kg, W/M to 0.01. The divisors are commercial conventions held in the settings (LG33), never
 * rule rows.
 */
import type { LgDims, LgMode, LogisticsSettings } from '../../types/logistics-r19';

export const VOLUMETRIC_DEFAULT = { air: 6000, courier: 5000, sea_kg_per_cbm: 1000 } as const;

/** Total volume in cm³ of the dimension lines (bad lines count 0). */
export const volumeCm3 = (dims: readonly LgDims[] = []): number => dims.reduce((s, d) => s + (d.l > 0 && d.w > 0 && d.h > 0 && d.n > 0 ? d.l * d.w * d.h * d.n : 0), 0);

const up = (v: number, step: number) => Math.ceil(Math.round(v / step * 1e6) / 1e6) * step;

/**
 * The chargeable weight of a shipment: kg for air / courier (`basis` "volumetric" when that wins), revenue tons (W/M) for
 * sea LCL, else the gross. `cbm` is the volume in m³ (from the dimensions, else the typed CBM).
 */
export function chargeableWeight(i: { gross_kg?: number; dims?: readonly LgDims[]; cbm?: number; mode: LgMode; settings?: Pick<LogisticsSettings, 'volumetric'> }): { value: number; unit: 'kg' | 'W/M'; basis: 'gross' | 'volumetric'; cbm: number } {
  const v = { ...VOLUMETRIC_DEFAULT, ...i.settings?.volumetric };
  const gross = Math.max(0, i.gross_kg ?? 0);
  const cm3 = volumeCm3(i.dims);
  const cbm = cm3 ? cm3 / 1e6 : Math.max(0, i.cbm ?? 0);
  if (i.mode === 'sea_lcl') {
    const wt = gross / v.sea_kg_per_cbm;
    return { value: up(Math.max(cbm, wt), 0.01), unit: 'W/M', basis: cbm >= wt ? 'volumetric' : 'gross', cbm };
  }
  const div = i.mode === 'air' ? v.air : i.mode === 'courier' ? v.courier : 0;
  const vol = div ? cbm * 1e6 / div : 0;
  return { value: div ? up(Math.max(gross, vol), 0.5) : gross, unit: 'kg', basis: vol > gross ? 'volumetric' : 'gross', cbm };
}
