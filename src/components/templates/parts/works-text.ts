import { cnT, type CnKey } from '../../../i18n/areas/construction-r11a';

/** "{x}" placeholders filled from `vars`. */
export const fill = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/** English paper text (the paper's language is fixed, not the screen's). */
export const pe = (k: CnKey, vars?: Record<string, string | number>): string => fill(cnT.en[k], vars);

/** Hindi paper text (bilingual paper). */
export const ph = (k: CnKey, vars?: Record<string, string | number>): string => fill(cnT.hi[k], vars);
