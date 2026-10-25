/** R2-B: command palette destinations for the round-2 sales screens (searched only, like the Tally rows). */
import { can } from '../../lib/access';
import type { StaticEntry } from '../../lib/search';
import { s2T } from '../../i18n/areas/sales-r2';

export function salesR2Destinations(): StaticEntry[] {
  const rows: { key: 'cmd.batch' | 'cmd.backorders'; href: string; keywords: string[]; create?: boolean }[] = [
    { key: 'cmd.batch', href: '/recurring?tab=batch', keywords: ['batch', 'bulk invoice', 'society', 'members', 'many parties', 'mass billing'], create: true },
    { key: 'cmd.backorders', href: '/inventory?tab=orders&view=backorders', keywords: ['backorder', 'back order', 'back-to-back', 'purchase order', 'drop ship', 'sales order'] },
  ];
  return rows.filter((r) => !r.create || can('doc.create')).map((r) => ({ id: `r2b:${r.href}`, title: s2T(r.key), subtitle: s2T('cmd.group'), icon: 'page', href: r.href, keywords: r.keywords }));
}
