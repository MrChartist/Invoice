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
import { getLanguage, interpolate, phrase, type MessageVars } from './index';

export type AreaTranslator<K extends string> = ((key: K, vars?: MessageVars) => string) & {
  readonly en: Readonly<Record<K, string>>;
  readonly hi: Readonly<Record<K, string>>;
};

export function defineArea<const E extends Record<string, string>>(en: E, hi: { readonly [K in keyof E]: string }): AreaTranslator<Extract<keyof E, string>> {
  const fn = (key: Extract<keyof E, string>, vars?: MessageVars): string => {
    // Hindi from the area file; other languages (8H) from their phrase glossary; English otherwise.
    const text = (getLanguage() === 'hi' ? hi[key] : undefined) || (en[key] && phrase(en[key])) || en[key] || key;
    return interpolate(text, vars);
  };
  return Object.assign(fn, { en, hi }) as AreaTranslator<Extract<keyof E, string>>;
}
