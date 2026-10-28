/**
 * CN-A1: the company object `mrchartist_inv_construction_settings` (RA bill paper style, M-book column, government
 * sign-off boxes, certificate, deviation limit, Works views). Owner only (`settings.manage`), audited on save, synced
 * as a singleton, backed up. Absent = today's behaviour, so existing contractor companies see no change.
 */
import { DB_PREFIX, getJson, setJson } from '../storage';
import { requireAccess } from '../access';
import { audit } from '../audit';
import type { ConstructionSettings, CnWorksView, RaPaperStyle } from '../../types/construction-r11';
import { CN_OBJECTS } from './cn-registry';

export const CONSTRUCTION_SETTINGS_KEY = `${DB_PREFIX}${CN_OBJECTS.constructionSettings}`;

export const CN_WORKS_VIEWS: readonly CnWorksView[] = ['contracts', 'advances', 'escalation', 'guarantees', 'subcon', 'labour', 'plant', 'reco', 'pnl'];
const PAPERS: readonly RaPaperStyle[] = ['standard', 'pwd', 'summary'];

/** Pure: clean a stored object (unknown keys and values dropped). */
export function cleanConstructionSettings(raw: unknown): ConstructionSettings {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const out: ConstructionSettings = {};
  if (PAPERS.includes(r.ra_paper as RaPaperStyle)) out.ra_paper = r.ra_paper as RaPaperStyle;
  for (const k of ['mb_column', 'government', 'certificate', 'signoff_boxes', 'split_caution', 'photo_pages', 'manpower_preset'] as const) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  if (typeof r.certificate_text === 'string' && r.certificate_text.trim()) out.certificate_text = r.certificate_text.trim().slice(0, 600);
  const dev = Number(r.deviation_pct);
  if (Number.isFinite(dev) && dev >= 0 && dev <= 100) out.deviation_pct = dev;
  if (r.views && typeof r.views === 'object') {
    const v: Partial<Record<CnWorksView, boolean>> = {};
    for (const k of CN_WORKS_VIEWS) if ((r.views as Record<string, unknown>)[k] === true) v[k] = true;
    if (Object.keys(v).length) out.views = v;
  }
  // CN-C: builder settings (numbers ≥ 0, terms text).
  if (r.realty && typeof r.realty === 'object') {
    const x = r.realty as Record<string, unknown>;
    const re = Object.fromEntries(Object.entries(x).filter(([k, v]) => (k === 'terms' ? typeof v === 'string' && v.trim() : ['interest_rate', 'forfeit_pct', 'forfeit_amount'].includes(k) && Number(v) >= 0)));
    if (Object.keys(re).length) out.realty = re;
  }
  // CN-D2: labour-contractor hold % (0–100).
  const wh = Number(r.labour_withhold_pct);
  if (r.labour_withhold_pct !== undefined && Number.isFinite(wh) && wh >= 0 && wh <= 100) out.labour_withhold_pct = wh;
  if (typeof r.updated_at === 'string') out.updated_at = r.updated_at;
  return out;
}

export function readConstructionSettings(): ConstructionSettings {
  try {
    return cleanConstructionSettings(getJson<unknown>(CONSTRUCTION_SETTINGS_KEY, null));
  } catch {
    return {};
  }
}

const describe = (s: ConstructionSettings): string =>
  [`paper ${s.ra_paper ?? 'standard'}`, s.mb_column && 'M-book column', s.government && 'government', s.signoff_boxes && 'sign-off boxes', s.certificate === false && 'no certificate', s.deviation_pct !== undefined && `deviation ${s.deviation_pct}%`, s.views && `views ${Object.keys(s.views).join('/')}`].filter(Boolean).join(', ');

/** Owner only: merge `patch` into the construction settings (audited). Returns the saved settings. */
export function saveConstructionSettings(patch: Partial<ConstructionSettings>): ConstructionSettings {
  requireAccess('settings.manage');
  const before = readConstructionSettings();
  const next = cleanConstructionSettings({ ...before, ...patch, updated_at: new Date().toISOString() });
  setJson(CONSTRUCTION_SETTINGS_KEY, next);
  try {
    audit.record({ entity: 'settings', entity_id: CN_OBJECTS.constructionSettings, action: 'update', summary: `Construction profile: ${describe(before)} → ${describe(next)}` });
  } catch {
    /* logging never blocks */
  }
  return readConstructionSettings();
}

/** The settings form (PENDING #22): switches as typed (numbers as text). */
export interface ConstructionForm {
  ra_paper: RaPaperStyle;
  mb_column: boolean;
  government: boolean;
  certificate: boolean;
  certificate_text: string;
  signoff_boxes: boolean;
  deviation_pct: string;
  split_caution: boolean;
  photo_pages: boolean;
  manpower_preset: boolean;
  labour_withhold_pct: string;
}

/**
 * Pure: the patch the form saves. A blank number or text clears the key (the default applies); a bad number throws.
 * `views` and `realty` are not touched.
 */
export function constructionFormPatch(f: ConstructionForm): Partial<ConstructionSettings> {
  const pct = (v: string, what: string): number | undefined => {
    if (!v.trim()) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`${what} must be between 0 and 100.`);
    return n;
  };
  return {
    ra_paper: f.ra_paper, mb_column: f.mb_column, government: f.government, certificate: f.certificate,
    certificate_text: f.certificate_text.trim() || undefined, signoff_boxes: f.signoff_boxes,
    deviation_pct: pct(f.deviation_pct, 'The deviation limit'), split_caution: f.split_caution, photo_pages: f.photo_pages,
    manpower_preset: f.manpower_preset, labour_withhold_pct: pct(f.labour_withhold_pct, 'The labour hold'),
  };
}

/** Is a Works view listed? (a view whose switch is off is hidden, its URL still opens it). */
export const worksViewOn = (s: ConstructionSettings, v: CnWorksView): boolean => s.views?.[v] === true;
