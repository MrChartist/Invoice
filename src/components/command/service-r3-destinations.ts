/** R3-B: command palette destinations for service billing (searched only, like the Tally rows). */
import { can } from '../../lib/access';
import type { StaticEntry } from '../../lib/search';
import { defineArea } from '../../i18n/area';

// A tiny own catalogue so the palette chunk does not load the whole service-r3 area.
const t = defineArea(
  { group: 'Service billing', projects: 'Projects board', retainers: 'Retainers', workTypes: 'Work types & rate cards', quiet: 'Customers gone quiet' } as const,
  { group: 'सेवा बिलिंग', projects: 'प्रोजेक्ट बोर्ड', retainers: 'रिटेनर', workTypes: 'काम के प्रकार और रेट कार्ड', quiet: 'जो ग्राहक चुप हो गए' },
);

export function serviceR3Destinations(): StaticEntry[] {
  const rows: { key: 'projects' | 'retainers' | 'workTypes' | 'quiet'; href: string; keywords: string[] }[] = [
    { key: 'projects', href: '/time?tab=projects', keywords: ['project', 'kanban', 'board', 'tasks', 'hours budget', 'estimate', 'burn'] },
    { key: 'retainers', href: '/time?tab=retainers', keywords: ['retainer', 'prepaid hours', 'block of hours', 'rollover', 'overage', 'drawdown'] },
    { key: 'workTypes', href: '/time?tab=settings', keywords: ['rate card', 'work type', 'hourly rate', 'billing rate', 'sac'] },
    { key: 'quiet', href: '/clients?quiet=1', keywords: ['inactive customers', 'gone quiet', 'lost customers', 'reorder', 're-order', 'nudge', 'win back'] },
  ];
  return rows
    .filter(() => can('view'))
    .map((r) => ({ id: `r3b:${r.href}`, title: t(r.key), subtitle: t('group'), icon: 'page', href: r.href, keywords: r.keywords }));
}
