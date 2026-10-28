/** Round 2 (R2-A): command palette destinations for the collections screens (searched only, like the Tally rows). */
import { can } from '../../lib/access';
import type { StaticEntry } from '../../lib/search';
import { defineArea } from '../../i18n/area';

const pT = defineArea(
  {
    followups: 'Collections follow-ups (promises to pay)',
    writeoffs: 'Write-off register (bad debts)',
    terms: 'Payment terms master',
    schedule: 'Reminder schedule and templates',
    group: 'Collections',
    netting: 'Netting — set off a customer who is also a supplier',
  } as const,
  {
    followups: 'वसूली फ़ॉलो-अप (भुगतान वादे)',
    writeoffs: 'बट्टे खाते का रजिस्टर (डूबत ऋण)',
    terms: 'भुगतान शर्तें मास्टर',
    schedule: 'रिमाइंडर अनुसूची और टेम्पलेट',
    group: 'वसूली',
    netting: 'आपसी समायोजन (नेटिंग) — ग्राहक जो आपूर्तिकर्ता भी है',
  },
);

export function collectionsDestinations(): StaticEntry[] {
  const rows: { key: 'followups' | 'writeoffs' | 'terms' | 'schedule' | 'netting'; href: string; keywords: string[]; settings?: boolean; books?: boolean }[] = [
    { key: 'followups', href: '/receivables?tab=followups', keywords: ['follow up', 'promise', 'promise to pay', 'collections', 'call', 'next action'] },
    { key: 'writeoffs', href: '/receivables?tab=collections', keywords: ['write off', 'bad debt', 'recovery', 'written off'] },
    // R15-A3: party netting (opens the dialog on Receivables)
    { key: 'netting', href: '/receivables?tab=aging&netting=1', keywords: ['netting', 'set off', 'set-off', 'contra', 'customer and supplier', 'nett off'], books: true },
    { key: 'terms', href: '/settings?tab=defaults', keywords: ['payment terms', 'net 30', 'eom', 'instalments', 'early payment discount'], settings: true },
    { key: 'schedule', href: '/settings?tab=defaults', keywords: ['reminder schedule', 'reminder template', 'dunning', 'follow-up levels'], settings: true },
  ];
  return rows
    .filter((r) => (!r.settings || can('settings.manage')) && (!r.books || can('books.edit')))
    .map((r) => ({ id: `r2a:${r.key}`, title: pT(r.key), subtitle: pT('group'), icon: 'page', href: r.href, keywords: r.keywords }));
}
