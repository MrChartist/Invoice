/**
 * Per-area catalogues (5.4, round 2): a screen group keeps its English and Hindi strings together
 * in `src/i18n/areas/<area>.ts`, created with `defineArea(en, hi)`. The area file is imported only
 * by that area's (lazy) components, so it never touches first paint, and areas can be translated
 * independently without editing the shared catalogues.
 *
 *   export const gstT = defineArea({ title: 'GST returns', due: 'Due {date}' } as const,
 *                                  { title: 'GST रिटर्न', due: '{date} तक' });
 *   const { lang } = useT();            // re-render on language change
 *   gstT('due', { date })               // → active language, English fallback
 *
 * `hi` must have every key (typecheck) and the same placeholders (tests/i18n-areas.test.ts).
 * Marathi, Gujarati, Tamil… (8H) translate area strings through their phrase glossary
 * (`src/i18n/<lang>.ts`, keyed by the English text); an untranslated string shows English.
 */
import { getLanguage, interpolate, phrase, registerHindi, type MessageVars } from './index';

export type AreaTranslator<K extends string> = ((key: K, vars?: MessageVars) => string) & {
  readonly en: Readonly<Record<K, string>>;
  /** The Hindi table once loaded (R16-A1: a build chunk), else English — never undefined. */
  readonly hi: Readonly<Record<K, string>>;
};

type HiTable = Readonly<Record<string, string>>;

/**
 * R16-A1: the build (scripts/vite-hi-split.mjs) replaces `hi` with `() => import('virtual:hi/…')`, a loader of a
 * `lang-hi-<family>` chunk. The source always passes the object, so the typecheck still forces every key. With a
 * loader the translator shows English until the Hindi arrives; `setLanguage('hi')` awaits every loader registered so
 * far, and an area evaluated later while Hindi is on loads at once and re-renders `useT()` callers on arrival.
 */
export function defineArea<const E extends Record<string, string>>(en: E, hi: { readonly [K in keyof E]: string }): AreaTranslator<Extract<keyof E, string>> {
  const lazy = typeof (hi as unknown) === 'function' ? (hi as unknown as () => Promise<{ default: HiTable }>) : null;
  let table: HiTable | undefined = lazy ? undefined : hi;
  if (lazy) {
    let pending: Promise<void> | undefined;
    registerHindi(() => (pending ??= lazy().then(
      (m) => { table = m.default; },
      (e) => { pending = undefined; throw e; },
    )));
  }
  const fn = (key: Extract<keyof E, string>, vars?: MessageVars): string => {
    // Hindi from the area file; other languages (8H) from their phrase glossary; English otherwise.
    const text = (getLanguage() === 'hi' ? table?.[key] : undefined) || (en[key] && phrase(en[key])) || en[key] || key;
    return interpolate(text, vars);
  };
  return Object.defineProperties(fn, {
    en: { value: en, enumerable: true },
    hi: { get: () => table ?? en, enumerable: true },
  }) as unknown as AreaTranslator<Extract<keyof E, string>>;
}
