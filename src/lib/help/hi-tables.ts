/**
 * PERF-6: the Hindi of the help topics and the glossary lives in the `lang-hi-help` pack in a build
 * (scripts/vite-hi-split.mjs `splitHelp`): the build blanks each Hindi argument and the data module exports
 * `loadHi`, a loader of its `{ key: hindi }` table. In dev and tests the Hindi stays inline and `loadHi` is absent.
 *
 * `withHindi` returns a loader that fetches the table once and hands it to `apply`. It is registered with the language
 * switch (Hindi on → loaded at once; `setLanguage('hi')` awaits it) and awaited here when Hindi is on now, so a
 * topic or term reaches the screen with its Hindi. A failed load (offline English install) leaves the English.
 */
import { getLanguage, registerHindi } from '../../i18n/index';

export type HiTableLoader<T> = () => Promise<{ default: Readonly<Record<string, T>> }>;

export async function withHindi<T>(load: HiTableLoader<T> | undefined, apply: (table: Readonly<Record<string, T>>) => void): Promise<() => Promise<void>> {
  if (!load) return () => Promise.resolve();
  let pending: Promise<void> | undefined;
  const fill = () => (pending ??= load().then(
    (m) => apply(m.default),
    (e) => {
      pending = undefined;
      throw e;
    },
  ));
  registerHindi(fill);
  if (getLanguage() === 'hi') await fill().catch(() => undefined);
  return () => fill().catch(() => undefined);
}
