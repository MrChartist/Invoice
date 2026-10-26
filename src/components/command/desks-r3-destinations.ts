/** R3-C: command palette destinations for the compliance desks (searched only, like the Tally rows). */
import { can } from '../../lib/access';
import type { StaticEntry } from '../../lib/search';
import { dkT } from '../../i18n/areas/desks-r3';

export function desksR3Destinations(): StaticEntry[] {
  const rows: { key: 'cmd.portal' | 'cmd.eway' | 'cmd.practice'; href: string; keywords: string[]; owner?: boolean }[] = [
    { key: 'cmd.portal', href: '/gst-reports?tab=portal-files', keywords: ['portal', 'error report', 'processed with error', 'gstr-1 download', 'gstr1 json', 'corrected json', 'offline tool'] },
    { key: 'cmd.eway', href: '/gst-reports?tab=eway-desk', keywords: ['e-way', 'eway', 'ewb', 'validity', 'expiry', 'vehicle', 'part b', 'transporter', 'extend'] },
    { key: 'cmd.practice', href: '/practice', keywords: ['practice', 'all companies', 'clients', 'dsc', 'digital signature', 'checklist', 'ca desk'], owner: true },
  ];
  return rows.filter((r) => !r.owner || can('settings.manage')).map((r) => ({ id: `r3c:${r.href}`, title: dkT(r.key), subtitle: dkT('cmd.group'), icon: 'page', href: r.href, keywords: r.keywords }));
}
