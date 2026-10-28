/** 8F: command palette destinations for the distribution screens (searched only, like the Tally rows). */
import { can } from '../../lib/access';
import type { StaticEntry } from '../../lib/search';
import { defineArea } from '../../i18n/area';

const pT = defineArea(
  { dist: 'Distribution (beats, salesmen, van, credit control)', pad: 'Order pad (salesman mode)', expiry: 'Breakage / expiry (pharma)', group: 'Distribution' } as const,
  { dist: 'वितरण (बीट, सेल्समैन, वैन, क्रेडिट नियंत्रण)', pad: 'ऑर्डर पैड (सेल्समैन मोड)', expiry: 'टूट-फूट / एक्सपायरी (फ़ार्मा)', group: 'वितरण' },
);

export function distDestinations(): StaticEntry[] {
  const rows: { key: 'dist' | 'pad' | 'expiry'; href: string; keywords: string[]; create?: boolean }[] = [
    { key: 'dist', href: '/distribution', keywords: ['beat', 'route', 'area', 'salesman', 'van', 'credit limit', 'distribution'] },
    { key: 'pad', href: '/order-pad', keywords: ['order', 'salesman', 'order booking', 'pad'], create: true },
    { key: 'expiry', href: '/inventory?tab=expiry', keywords: ['expiry', 'breakage', 'pharma', 'claim', 'debit note'] },
  ];
  return rows.filter((r) => !r.create || can('doc.create')).map((r) => ({ id: `dist:${r.href}`, title: pT(r.key), subtitle: pT('group'), icon: 'page', href: r.href, keywords: r.keywords }));
}
