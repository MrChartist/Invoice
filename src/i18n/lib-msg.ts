/**
 * PENDING 51: on-screen text for messages composed in `src/lib/*`. Libraries stay English and free of React / i18n
 * (their text is also what tests, CSVs and the audit log see); a lazy screen passes what it shows through
 *
 *   libMsg(text)   → the text in the interface language when it matches a template of `areas/libmsg.ts`, else as is
 *   errText(err)   → the same for a caught error; access-denied and period-lock errors are rebuilt from their fields
 *
 * English devices get the text unchanged (no lookup). Never import this from a first-paint module: the templates
 * would grow first paint (the Hindi itself is a lazy `lang-hi-libmsg` pack either way).
 */
import { getLanguage, type MessageVars } from './index';
import { roleLabel } from './labels';
import { libT, type LibKey } from './areas/libmsg';
import { deniedMessage, isAccessDeniedError } from '../lib/access';
import { isPeriodLockedError, lockMessage, prettyDay } from '../lib/period-lock';

/** Keys built from an error's fields, never matched as text. */
const BUILT = /^(denied|dn\.|lock|lv\.)/;

interface Template {
  key: LibKey;
  re: RegExp;
  names: string[];
}

let exact: Map<string, LibKey> | undefined;
let patterns: Template[] | undefined;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function build(): void {
  exact = new Map();
  patterns = [];
  for (const [key, text] of Object.entries(libT.en) as [LibKey, string][]) {
    if (BUILT.test(key)) continue;
    const names: string[] = [];
    const parts = text.split(/\{(\w+)\}/);
    if (parts.length === 1) {
      exact.set(text, key);
      continue;
    }
    const source = parts.map((p, i) => (i % 2 ? (names.push(p), '([\\s\\S]+?)') : escape(p))).join('');
    patterns.push({ key, re: new RegExp(`^${source}$`), names });
  }
}

/** The English text's template key and the values it was filled with, or null. Exported for tests. */
export function matchLibMsg(text: string): { key: LibKey; vars: MessageVars } | null {
  if (!exact || !patterns) build();
  const hit = exact!.get(text);
  if (hit) return { key: hit, vars: {} };
  for (const p of patterns!) {
    const m = p.re.exec(text);
    if (!m) continue;
    const vars: MessageVars = {};
    p.names.forEach((n, i) => { vars[n] = m[i + 1]; });
    return { key: p.key, vars };
  }
  return null;
}

/** A message from `src/lib` in the interface language (unknown text is returned unchanged). */
export function libMsg(text: string): string {
  if (!text || getLanguage() === 'en') return text;
  const m = matchLibMsg(text);
  return m ? libT(m.key, m.vars) : text;
}

const hasKey = (key: string): key is LibKey => Object.hasOwn(libT.en, key);

/** A caught error as on-screen text in the interface language. */
export function errText(err: unknown): string {
  const message = typeof (err as { message?: unknown } | null)?.message === 'string' ? (err as { message: string }).message : String(err ?? '');
  if (getLanguage() === 'en') return message;
  // Rebuilt sentences need the whole sentence in the language: Hindi only (other languages match as text below).
  if (getLanguage() !== 'hi') return libMsg(message);
  if (isAccessDeniedError(err)) {
    const what = `dn.${err.action}`;
    if (hasKey(what) && message === deniedMessage(err.action, err.role)) return libT('denied', { role: roleLabel(err.role), what: libT(what) });
  }
  if (isPeriodLockedError(err) && message === lockMessage(err.lockUntil, err.action, err.docDate, err.docNumber)) {
    const until = prettyDay(err.lockUntil);
    if (err.action === 'settings') return libT('lockSettings', { until });
    const what = err.docNumber ? libT('lockWhatNo', { number: err.docNumber, date: prettyDay(err.docDate) }) : libT('lockWhat', { date: prettyDay(err.docDate) });
    return libT('lockDoc', { until, what, verb: libT(`lv.${err.action}` as LibKey) });
  }
  return libMsg(message);
}
