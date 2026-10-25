/**
 * Interface language (5.4): a tiny, dependency-free i18n layer.
 *
 *  - `t(key, vars?)` looks a key up in the active catalogue, falls back to English, and fills
 *    `{name}` placeholders. Keys are typed from the English catalogue (`en.ts`).
 *  - English ships in the main bundle; every other catalogue is a lazy chunk loaded by
 *    `setLanguage()` (or `initI18n()` at boot), so English users pay nothing for Hindi.
 *  - The choice is per device (`LANG_KEY`, a device-local key that never travels in a backup)
 *    and is readable before unlock, so the PIN and vault screens are translated too.
 *  - `useT()` re-renders a component when the language changes.
 *
 * Numbers and amounts stay in Latin digits with Indian grouping (formatCurrency is en-IN) in
 * every language: invoices are read next to bank statements and GST portals that use them.
 */
import { createElement, Fragment, useSyncExternalStore, type ReactNode } from 'react';
import { LANG_KEY } from '../lib/storage';
import { en, type MessageKey, type Messages } from './en';

export type { MessageKey, Messages };
export type Lang = 'en' | 'hi' | 'mr' | 'gu' | 'ta' | 'bn' | 'te' | 'kn';
export type MessageVars = Record<string, string | number>;

/** Interface languages (native names only: the picker is labelled "Language / भाषा"). */
export const LANGUAGES: readonly { code: Lang; native: string }[] = [
  { code: 'en', native: 'English' },
  { code: 'hi', native: 'हिन्दी' },
  { code: 'mr', native: 'मराठी' },
  { code: 'gu', native: 'ગુજરાતી' },
  { code: 'ta', native: 'தமிழ்' },
  { code: 'bn', native: 'বাংলা' },
  { code: 'te', native: 'తెలుగు' },
  { code: 'kn', native: 'ಕನ್ನಡ' },
]

/**
 * A lazily loaded language (8H): keyed strings plus a phrase glossary (English text → translation)
 * that per-area catalogues (`defineArea`) consult, so a language can cover any screen's strings
 * without editing that screen's area file. Anything missing falls back to English.
 */
export interface Catalogue {
  messages: Partial<Messages>;
  phrases?: Readonly<Record<string, string>>;
}

/**
 * Lazy catalogue loaders. Hindi is its own chunk; the other regional catalogues share ONE small chunk
 * (`regional.ts`) so the first-paint bundle carries a single loader for all of them (8H).
 */
const load = (code: Exclude<Lang, 'en'>): Promise<Catalogue> =>
  code === 'hi' ? import('./hi').then((m) => ({ messages: m.hi })) : import('./regional').then((m) => m.REGIONAL[code]);

let lang: Lang = 'en';
/** English: the shell catalogue now, page catalogues (en-pages.ts) as their chunks load. */
const english: Partial<Messages> = { ...en };
const loaded: Partial<Record<Lang, Partial<Messages>>> = {};
const glossary: Partial<Record<Lang, Readonly<Record<string, string>>>> = {};
const listeners = new Set<() => void>();

export function isLang(value: unknown): value is Lang {
  return LANGUAGES.some((l) => l.code === value);
}

/** The active language's translation of an English phrase, if its glossary has one. */
export function phrase(text: string): string | undefined {
  return lang === 'en' ? undefined : glossary[lang]?.[text];
}

/** Fill `{name}` placeholders; an unknown placeholder is left as written. */
export function interpolate(message: string, vars?: MessageVars): string {
  if (!vars) return message;
  return message.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Translate `key` into the active language (English when the key is missing there). */
export function t(key: MessageKey, vars?: MessageVars): string {
  const active = lang === 'en' ? undefined : loaded[lang]?.[key];
  const base = english[key];
  return interpolate(active || (base && phrase(base)) || base || key, vars);
}

/** Called by a page catalogue (en-pages.ts) when its chunk loads. */
export function registerEnglish(messages: Partial<Messages>): void {
  Object.assign(english, messages);
}

/**
 * Like `t`, but placeholders may be React nodes (a <strong>, a countdown…), so each language
 * keeps its own word order: `tNodes('login.typePhrase', { phrase: <b>ERASE</b> })`.
 */
export function tNodes(key: MessageKey, vars: Record<string, ReactNode>): ReactNode {
  const parts = t(key).split(/(\{\w+\})/);
  const nodes = parts.map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in vars ? vars[m[1]] : part;
  });
  return createElement(Fragment, null, ...nodes);
}

/** True when `key` is a catalogue key (for labels that may also be free text, e.g. statuses). */
export function hasMessage(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(english, key);
}

/** Translate `prefix + value` when such a key exists, else return `value` unchanged. */
export function tMaybe(prefix: string, value: string): string {
  const key = prefix + value;
  return hasMessage(key) ? t(key) : value;
}

export function getLanguage(): Lang {
  return lang;
}

/** Locale for dates written in words (weekday / month names). Digits stay Latin. */
export function dateLocale(l: Lang = lang): string {
  return l === 'en' ? 'en-IN' : `${l}-IN-u-nu-latn`;
}

/** The language saved on this device ('en' when unset, unreadable or unknown). */
export function readStoredLanguage(): Lang {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(LANG_KEY);
    return isLang(v) ? v : 'en';
  } catch {
    return 'en';
  }
}

function applyDocumentLang(): void {
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

function emit(): void {
  for (const fn of listeners) fn();
}

async function ensureCatalogue(next: Lang): Promise<void> {
  if (next === 'en' || loaded[next]) return;
  const c = await load(next);
  glossary[next] = c.phrases ?? {};
  loaded[next] = c.messages;
}

/**
 * Switch the interface language. Loads the catalogue first (so nothing flashes half-translated),
 * then saves the choice on this device unless `persist` is false.
 */
export async function setLanguage(next: Lang, { persist = true }: { persist?: boolean } = {}): Promise<void> {
  await ensureCatalogue(next);
  if (persist) {
    try {
      localStorage.setItem(LANG_KEY, next);
    } catch {
      /* non-fatal: the choice just will not survive a reload */
    }
  }
  if (next === lang) return applyDocumentLang();
  lang = next;
  applyDocumentLang();
  emit();
}

let crossTab = false;

/**
 * Boot: apply the saved language before the first render (main.tsx awaits this alongside
 * storage init). A catalogue that fails to load leaves the app in English.
 */
export async function initI18n(): Promise<void> {
  if (!crossTab && typeof window !== 'undefined') {
    crossTab = true;
    // Another tab switched language: follow it.
    window.addEventListener('storage', (e) => {
      if (e.key === LANG_KEY) void setLanguage(isLang(e.newValue) ? e.newValue : 'en', { persist: false }).catch(() => undefined);
    });
  }
  try {
    await setLanguage(readStoredLanguage(), { persist: false });
  } catch {
    lang = 'en';
    applyDocumentLang();
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** `const { t, lang } = useT();` — re-renders the caller when the language changes. */
export function useT(): { t: typeof t; lang: Lang } {
  const current = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return { t, lang: current };
}

/** Test hook: forget loaded catalogues and return to English without touching storage. */
export function resetI18nForTests(): void {
  lang = 'en';
  for (const k of Object.keys(loaded) as Lang[]) delete loaded[k];
  for (const k of Object.keys(glossary) as Lang[]) delete glossary[k];
}

/** Test hook: make `catalogue` the active one (e.g. a partial catalogue to prove the fallback). */
export function setCatalogueForTests(code: Exclude<Lang, 'en'>, catalogue: Partial<Messages>, phrases: Record<string, string> = {}): void {
  loaded[code] = catalogue;
  glossary[code] = phrases;
  lang = code;
}

/** Test hook: load a language's real catalogue (as `setLanguage` would) without touching storage. */
export async function loadLanguageForTests(code: Lang): Promise<void> {
  await setLanguage(code, { persist: false });
}
