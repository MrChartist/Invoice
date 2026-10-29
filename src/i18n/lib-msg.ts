/**
 * PENDING 51: on-screen text for messages composed in `src/lib/*`. Libraries stay English and free of React / i18n
 * (their text is also what tests, CSVs and the audit log see); a lazy screen passes what it shows through
 *
 *   libMsg(text)   → Hindi when Hindi is on and the text matches a template of `hi-lib.ts`, else the text as is
 *   errText(err)   → the same for a caught error; access-denied and period-lock errors are rebuilt from their fields
 *
 * The templates and their Hindi live in `hi-lib.ts`, which is part of the Hindi pack: English devices get the text
 * unchanged and download nothing. Other interface languages show the library's English. Never import this module from
 * a first-paint module.
 */
import { getLanguage, interpolate, registerHindi, type MessageVars } from './index';
import { roleLabel } from './labels';
import { deniedMessage, isAccessDeniedError } from '../lib/access';
import { isPeriodLockedError, lockMessage, prettyDay } from '../lib/period-lock';

interface Template {
  hi: string;
  re: RegExp;
  names: string[];
}

interface Table {
  exact: Map<string, string>;
  patterns: Template[];
  built: Readonly<Record<string, string>>;
}

let table: Table | undefined;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Index [English template, Hindi] pairs: placeholder-free ones by text, the rest as anchored patterns. */
export function buildTable(pairs: readonly (readonly [string, string])[], built: Readonly<Record<string, string>> = {}): Table {
  const exact = new Map<string, string>();
  const patterns: Template[] = [];
  for (const [en, hi] of pairs) {
    const parts = en.split(/\{(\w+)\}/);
    if (parts.length === 1) {
      exact.set(en, hi);
      continue;
    }
    const names: string[] = [];
    const source = parts.map((p, i) => (i % 2 ? (names.push(p), '([\\s\\S]+?)') : escape(p))).join('');
    patterns.push({ hi, re: new RegExp(`^${source}$`), names });
  }
  return { exact, patterns, built };
}

/** Loads the Hindi table (the language switch awaits it; exported for tests). */
export const loadLibHindi = (): Promise<void> => import('./hi-lib').then((m) => { table = buildTable(m.HI_LIB, m.HI_LIB_BUILT); });
registerHindi(loadLibHindi);

/** The Hindi of a library message, or undefined (Hindi table not loaded, or no template matches). */
function toHindi(text: string): string | undefined {
  if (!table) return undefined;
  const hit = table.exact.get(text);
  if (hit) return hit;
  for (const p of table.patterns) {
    const m = p.re.exec(text);
    if (!m) continue;
    const vars: MessageVars = {};
    p.names.forEach((n, i) => { vars[n] = m[i + 1]; });
    return interpolate(p.hi, vars);
  }
  return undefined;
}

/** A message from `src/lib` in the interface language (unknown text is returned unchanged). */
export function libMsg(text: string): string {
  if (!text || getLanguage() !== 'hi') return text;
  return toHindi(text) ?? text;
}

/** A caught error as on-screen text in the interface language. */
export function errText(err: unknown): string {
  const message = typeof (err as { message?: unknown } | null)?.message === 'string' ? (err as { message: string }).message : String(err ?? '');
  if (getLanguage() !== 'hi' || !table) return message;
  const b = table.built;
  if (isAccessDeniedError(err)) {
    const what = b[`dn.${err.action}`];
    if (what && b.denied && message === deniedMessage(err.action, err.role)) return interpolate(b.denied, { role: roleLabel(err.role), what });
  }
  if (isPeriodLockedError(err) && message === lockMessage(err.lockUntil, err.action, err.docDate, err.docNumber)) {
    const until = prettyDay(err.lockUntil);
    if (err.action === 'settings') return interpolate(b.lockSettings ?? message, { until });
    const verb = b[`lv.${err.action}`];
    if (verb && b.lockDoc) {
      const what = err.docNumber ? interpolate(b.lockWhatNo, { number: err.docNumber, date: prettyDay(err.docDate) }) : interpolate(b.lockWhat, { date: prettyDay(err.docDate) });
      return interpolate(b.lockDoc, { until, what, verb });
    }
  }
  return libMsg(message);
}
