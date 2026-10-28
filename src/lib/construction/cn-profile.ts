/**
 * CN-A1 construction profile: the kind picked under "Contractor" (setup wizard, Settings → Features). The settings
 * patch (business type `contractor`, modules, explicit packs, `construction_kind`) comes from `shop-presets.ts`
 * `applyConstructionKind`; this module writes the profile's switches into `construction_settings` (RA paper style,
 * M-book column, government sign-off boxes, Works views …) and never turns a switch the user set OFF back on for a
 * different reason — a profile only adds views. Changing the profile deletes nothing; switches off only hide views.
 * Existing contractor companies (no `construction_kind`) are untouched until they pick (checklist step).
 */
import type { ConstructionSettings, CnWorksView } from '../../types/construction-r11';
import type { ConstructionKindId } from '../shop-presets';
import { readConstructionSettings, saveConstructionSettings } from './cn-settings';

export interface ConstructionSwitches {
  ra_paper: ConstructionSettings['ra_paper'];
  views: readonly CnWorksView[];
  mb_column?: boolean;
  split_caution?: boolean;
  photo_pages?: boolean;
  manpower_preset?: boolean;
}

/** The switches each kind turns on (PRD CN-A1 table). `government` adds the government switches. */
export const CONSTRUCTION_SWITCHES: Readonly<Record<ConstructionKindId, ConstructionSwitches>> = {
  civil: { ra_paper: 'standard', views: ['contracts', 'advances', 'escalation', 'guarantees', 'subcon', 'plant', 'labour', 'reco'], mb_column: true },
  subcontractor: { ra_paper: 'standard', views: ['labour'] },
  builder: { ra_paper: 'standard', views: ['subcon', 'labour', 'reco', 'pnl'] },
  interiors: { ra_paper: 'standard', views: [], split_caution: true, photo_pages: true },
  mep: { ra_paper: 'standard', views: ['contracts', 'subcon', 'guarantees'], split_caution: true },
  labour: { ra_paper: 'standard', views: ['labour'], manpower_preset: true },
  other: { ra_paper: undefined, views: [] },
};

/** The construction settings after applying `kind`'s switches to `current` (pure; views are only ever added). */
export function constructionSwitchesFor(kind: ConstructionKindId, opts: { government?: boolean } = {}, current: ConstructionSettings = {}): ConstructionSettings {
  const p = CONSTRUCTION_SWITCHES[kind];
  const next: ConstructionSettings = { ...current };
  // §8 Q8: `pwd` (cumulative item table) is the default for civil + government; `standard` for every other kind.
  const paper = kind === 'civil' && opts.government ? 'pwd' : p.ra_paper;
  if (paper && !current.ra_paper) next.ra_paper = paper;
  else if (paper === 'pwd') next.ra_paper = 'pwd';
  if (p.views.length) next.views = { ...current.views, ...Object.fromEntries(p.views.map((v) => [v, true])) };
  for (const k of ['mb_column', 'split_caution', 'photo_pages', 'manpower_preset'] as const) if (p[k]) next[k] = true;
  if (opts.government && kind !== 'other') {
    next.government = true;
    next.signoff_boxes = true;
    next.mb_column = true;
  }
  return next;
}

/** Owner only: write the profile's switches (audited). */
export function applyConstructionSwitches(kind: ConstructionKindId, opts: { government?: boolean } = {}): ConstructionSettings {
  return saveConstructionSettings(constructionSwitchesFor(kind, opts, readConstructionSettings()));
}
