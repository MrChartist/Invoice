/**
 * R20-D: navigation keys — pure data and helpers (tested in tests/keys-nav.test.ts).
 *
 * - The Company (Alt+K), Data (Alt+Y) and Import (Alt+O) sheets: every row is an existing route or action, with a
 *   letter (as on the Gateway) and, where one exists, the registry row whose key it shows.
 * - Go To (Alt+G): the Gateway's leaf entries (`flattenMenu`) become palette rows with Tally names and the R20-D
 *   synonyms (`GOTO_SYNONYMS` in search.ts; built by `nav-goto.ts`).
 * - The setup-wizard answer "Have you used Tally?" sets the Tally keys switch.
 * The sheets themselves are `components/keys/MenuSheets.tsx`.
 */
import { can as canDo, type AccessAction } from '../access';
import type { StaticEntry } from '../search';
import { setKeysLayout, setKeysMode } from './stub';
import type { KeysKey } from '../../i18n/areas/keys-r20a';
import type { NavKey } from '../../i18n/areas/keys-r20d';

export type MenuId = 'company' | 'data' | 'import';
export type MenuAct = 'switch' | 'lock' | 'backup';
export interface MenuItem {
  letter: string;
  /** Label: a row label (keys-r20a) or a sheet string (keys-r20d). */
  k?: KeysKey;
  n?: NavKey;
  to?: string;
  act?: MenuAct;
  /** Registry row whose key is shown beside the item. */
  row?: string;
  need?: AccessAction;
}

export const MENUS: Readonly<Record<MenuId, readonly MenuItem[]>> = {
  company: [
    { letter: 'S', k: 'company', act: 'switch', row: 'company' },
    { letter: 'C', k: 'companies', to: '/settings?tab=data', row: 'companies', need: 'settings.manage' },
    { letter: 'F', k: 'features', to: '/settings?tab=defaults', row: 'features', need: 'settings.manage' },
    { letter: 'G', k: 'configure', to: '/settings', row: 'configure' },
    { letter: 'U', n: 'users', to: '/settings?tab=security' },
    { letter: 'L', k: 'lock', act: 'lock', row: 'lock' },
  ],
  data: [
    { letter: 'B', n: 'backup', act: 'backup', need: 'data.backup' },
    { letter: 'R', n: 'restore', to: '/settings?tab=data', need: 'data.restore' },
    { letter: 'C', k: 'repair', to: '/settings?tab=activity', row: 'repair' },
    { letter: 'N', n: 'newYear', to: '/books?open=yearend', need: 'books.edit' },
    { letter: 'E', n: 'bin', to: '/settings?tab=activity&bin=1' },
    { letter: 'S', n: 'sync', to: '/settings?tab=data', need: 'data.restore' },
  ],
  import: [
    { letter: 'T', n: 'tallyXml', to: '/books?open=tally', need: 'data.restore' },
    { letter: 'X', n: 'excel', to: '/settings?tab=data', need: 'data.restore' },
    { letter: 'B', n: 'bank', to: '/reconcile?tab=import', need: 'books.edit' },
  ],
};

/** The rows of a sheet this role may use. */
export const menuItems = (id: MenuId, may: (a: AccessAction) => boolean = canDo): MenuItem[] => MENUS[id].filter((m) => !m.need || may(m.need));

/** The item a letter picks (no modifier), or undefined. */
export const itemForLetter = (items: readonly MenuItem[], key: string): MenuItem | undefined =>
  key.length === 1 ? items.find((m) => m.letter === key.toUpperCase()) : undefined;

/** The setup wizard's "Have you used Tally?": yes → Tally keys on (TallyPrime keys), no → off, unanswered → unchanged. */
export function applyTallyAnswer(yes: boolean | null): void {
  if (yes === null) return;
  if (yes) setKeysLayout('prime');
  setKeysMode(yes ? 'on' : 'off');
}

/** One Gateway leaf as Go To needs it (from `flattenMenu` + `entryRoute`). */
export interface GotoLike { id: string; label: string; path: readonly string[]; href: string; haystack: string }

/** Go To rows: one per destination (the Gateway's `&from=` dropped for the de-duplication), Tally names searchable. */
export function gotoEntries(items: readonly GotoLike[], words: Readonly<Record<string, readonly string[]>> = {}): StaticEntry[] {
  const seen = new Set<string>();
  const out: StaticEntry[] = [];
  for (const it of items) {
    const key = `${it.href.replace(/&from=[^&]*/, '')}#${it.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `goto:${key}`, title: it.label, subtitle: it.path.join(' › ') || 'Gateway', icon: 'page', href: it.href, keywords: [it.haystack, ...(words[it.id] ?? [])] });
  }
  return out;
}

/** The "Back to …" name of a screen: its page heading, else the document title. */
export const screenName = (doc: Pick<Document, 'querySelector' | 'title'> = document): string =>
  (doc.querySelector('main h1')?.textContent ?? '').trim() || doc.title.split(/\s[·|–-]\s/)[0].trim();
