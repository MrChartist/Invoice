/** R3-A: command palette destinations for the restaurant screens (searched only, like the Tally rows). */
import { can } from '../../lib/access';
import type { StaticEntry } from '../../lib/search';
import { defineArea } from '../../i18n/area';

const cT = defineArea(
  {
    tables: 'Tables & running orders (restaurant)',
    takeaway: 'Takeaway / delivery / aggregator orders',
    group: 'Tables',
  } as const,
  {
    tables: 'टेबल और चालू ऑर्डर (रेस्टोरेंट)',
    takeaway: 'टेकअवे / डिलीवरी / एग्रीगेटर ऑर्डर',
    group: 'टेबल',
  },
);

export function r3aDestinations(): StaticEntry[] {
  if (!can('doc.create')) return [];
  const rows: { key: 'tables' | 'takeaway'; keywords: string[] }[] = [
    { key: 'tables', keywords: ['restaurant', 'table', 'kot', 'kitchen', 'dine in', 'cafe', 'dhaba', 'split bill', 'covers', 'captain', 'kot register', 'modifier', '86'] },
    { key: 'takeaway', keywords: ['takeaway', 'parcel', 'delivery', 'swiggy', 'zomato', 'aggregator', 'token'] },
  ];
  return rows.map((r) => ({ id: `r3a:${r.key}`, title: cT(r.key), subtitle: cT('group'), icon: 'page', href: '/tables', keywords: r.keywords }));
}
