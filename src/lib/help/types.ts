/**
 * R6-A2: screen-help topic shape. Topics are data (per-area files, each its own lazy chunk), keyed by
 * `<route>[:<tab>[:<view>]]` (see `registry.ts`). Text is English; every topic carries its Hindi title, shown when
 * the interface is in Hindi (statutory wording that is not certain stays English — `docs/features/i18n.md`).
 * No topic promises a statutory value: values are phrased "as the app applies it" and point to CA_REVIEW ids.
 */

export interface HelpStatutory {
  forms?: string;
  /** Text, never computed. */
  due?: string;
  /** Prints the "Verify with your CA" box. */
  ca: true;
  /** `docs/CA_REVIEW.md` ids, e.g. `['G1', 'G16']`. */
  caItems?: readonly string[];
}

export interface HelpLink {
  label: string;
  href: string;
}

export interface HelpTopic {
  id: string;
  title: string;
  hiTitle: string;
  what: string;
  when: string;
  /** ≤ 5 lines. */
  steps?: readonly string[];
  statutory?: HelpStatutory;
  related?: readonly HelpLink[];
}

type Extra = Pick<HelpTopic, 'steps' | 'statutory' | 'related'>;

/** Compact row builder: `t(id, title, hiTitle, what, when, extra?)`. */
export const t = (id: string, title: string, hiTitle: string, what: string, when: string, extra?: Extra): HelpTopic => ({ id, title, hiTitle, what, when, ...extra });

/** Statutory block shorthand. */
export const ca = (caItems?: readonly string[], forms?: string, due?: string): HelpStatutory => ({ ca: true, ...(caItems ? { caItems } : {}), ...(forms ? { forms } : {}), ...(due ? { due } : {}) });

/** Related-link shorthand: `rel(['Label', '/href'], …)`. */
export const rel = (...pairs: [string, string][]): HelpLink[] => pairs.map(([label, href]) => ({ label, href }));
