/**
 * R6-A2 screen-help registry: route + `tab` (+ `view`) → topic id, and which lazy topics file holds it.
 *
 * Topic ids are `<route>[:<tab>[:<view>]]` where `<route>` is the first path segment (`dashboard` for `/`):
 * `/gst-reports?tab=cdnur` → `gst-reports:cdnur`. Lookups fall back from the most specific id to the route's own
 * topic. The topics live in six per-area data files, each a lazy chunk loaded when Help (or the palette's
 * "Help topics" group) opens. Only this route map ships with the Help dialog.
 *
 * Coverage rule (tests/help-registry.test.ts): every route in App.tsx, every GST tab, every PACK_TABS row and the
 * tab ids of the main pages have a topic. A new tab needs a help topic.
 */
import { PACK_TABS } from '../industry-packs';
import type { HelpTopic } from './types';

export type HelpArea = 'sales' | 'purchase' | 'books' | 'statutory' | 'packs' | 'settings';

const ROUTE_AREA: Readonly<Record<string, HelpArea>> = {
  dashboard: 'sales', invoice: 'sales', clients: 'sales', receivables: 'sales', recurring: 'sales', time: 'sales',
  pos: 'sales', tables: 'sales', transactions: 'sales', 'order-pad': 'sales', 'pos-display': 'sales', 'share-target': 'sales', design: 'sales',
  expenses: 'purchase', inventory: 'purchase', manufacturing: 'purchase', distribution: 'purchase',
  books: 'books', gateway: 'books', 'tally-keys': 'books', reconcile: 'books', cheques: 'books', loans: 'books', reports: 'books', exports: 'books',
  'gst-reports': 'statutory', tds: 'statutory', payroll: 'statutory', practice: 'statutory',
  settings: 'settings',
};

/** `/gst-reports`, `?tab=cdnur` → `gst-reports:cdnur`; `/invoice/<id>` → `invoice`; `/` → `dashboard`. */
export function topicKey(pathname: string, search = ''): string {
  const seg = (pathname || '/').split(/[?#]/)[0].split('/')[1] || 'dashboard';
  const q = new URLSearchParams(search);
  const tab = q.get('tab');
  const view = tab ? q.get('view') : null;
  return [seg, tab, view].filter(Boolean).join(':');
}

/** Topic id of an in-app href (`/receivables?tab=marketplace&view=tcs`). */
export const keyOfHref = (href: string): string => {
  const i = href.indexOf('?');
  return topicKey(i < 0 ? href : href.slice(0, i), i < 0 ? '' : href.slice(i));
};

/** The in-app href of a topic id. */
export function hrefOfKey(id: string): string {
  const [seg, tab, view] = id.split(':');
  const path = seg === 'dashboard' ? '/' : `/${seg}`;
  if (!tab) return path;
  return `${path}?tab=${tab}${view ? `&view=${view}` : ''}`;
}

const PACK_KEYS: ReadonlySet<string> = new Set(PACK_TABS.map((p) => keyOfHref(p.path)));

export function areaOf(id: string): HelpArea {
  if (PACK_KEYS.has(id)) return 'packs';
  return ROUTE_AREA[id.split(':')[0]] ?? 'sales';
}

/** Candidate ids, most specific first (`a:b:c`, `a:b`, `a`). */
export function candidates(pathname: string, search = ''): string[] {
  const parts = topicKey(pathname, search).split(':');
  return parts.map((_, i) => parts.slice(0, parts.length - i).join(':'));
}

const LOADERS: Record<HelpArea, () => Promise<{ TOPICS: readonly HelpTopic[] }>> = {
  sales: () => import('./topics-sales'),
  purchase: () => import('./topics-purchase'),
  books: () => import('./topics-books'),
  statutory: () => import('./topics-statutory'),
  packs: () => import('./topics-packs'),
  settings: () => import('./topics-settings'),
};

export const HELP_AREAS: readonly HelpArea[] = ['sales', 'purchase', 'books', 'statutory', 'packs', 'settings'];

const cache = new Map<HelpArea, Promise<Map<string, HelpTopic>>>();

export function loadArea(area: HelpArea): Promise<Map<string, HelpTopic>> {
  let p = cache.get(area);
  if (!p) {
    p = LOADERS[area]().then((m) => new Map(m.TOPICS.map((x) => [x.id, x])));
    p.catch(() => cache.delete(area));
    cache.set(area, p);
  }
  return p;
}

/** The topic for a topic id, falling back to its parents (`gst-reports:x` → `gst-reports`). */
export async function topicById(id: string): Promise<HelpTopic | null> {
  const parts = id.split(':');
  for (let i = parts.length; i > 0; i--) {
    const key = parts.slice(0, i).join(':');
    const hit = (await loadArea(areaOf(key))).get(key);
    if (hit) return hit;
  }
  return null;
}

/** The topic of a screen (route + tab + view), or null. */
export function helpFor(pathname: string, search = ''): Promise<HelpTopic | null> {
  return topicById(topicKey(pathname, search));
}

/** Every topic with its href (Help search; R6-B's palette "Help topics" group). */
export async function helpIndex(): Promise<(HelpTopic & { href: string })[]> {
  const maps = await Promise.all(HELP_AREAS.map(loadArea));
  return maps.flatMap((m) => [...m.values()].map((x) => ({ ...x, href: hrefOfKey(x.id) })));
}
