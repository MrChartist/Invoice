/** R2-C: command palette destinations (searched only, like the Tally rows). */
import { can } from '../../lib/access';
import type { StaticEntry } from '../../lib/search';
import { defineArea } from '../../i18n/area';

const cT = defineArea(
  {
    annual: 'Annual accounts pack & notes to accounts',
    defer: 'Deferred revenue / prepaid expenses',
    ims: 'IMS ITC reduction & working file (GSTR-2B)',
    labels: 'Invoice labels & logo accent (Design Studio)',
    display: 'Display & accessibility (text size, contrast)',
    pkgTypes: 'Package types (packing lists)',
    group: 'Books & output',
  } as const,
  {
    annual: 'वार्षिक लेखा पैक और लेखा टिप्पणियाँ',
    defer: 'अग्रिम प्राप्त आय / पूर्वदत्त ख़र्च',
    ims: 'IMS ITC कमी और वर्किंग फ़ाइल (GSTR-2B)',
    labels: 'इनवॉइस लेबल और लोगो रंग (डिज़ाइन स्टूडियो)',
    display: 'डिस्प्ले और सुगम्यता (अक्षर आकार, कंट्रास्ट)',
    pkgTypes: 'पैकेज प्रकार (पैकिंग सूची)',
    group: 'बही और आउटपुट',
  },
);

export function r2cDestinations(): StaticEntry[] {
  const rows: { key: 'annual' | 'defer' | 'ims' | 'labels' | 'display' | 'pkgTypes'; href: string; keywords: string[]; books?: boolean }[] = [
    { key: 'annual', href: '/books?tab=rpt', keywords: ['annual accounts', 'final accounts', 'schedule iii', 'notes to accounts', 'balance sheet', 'ca pack'], books: true },
    { key: 'defer', href: '/books?tab=defer', keywords: ['deferral', 'deferred revenue', 'prepaid', 'amc', 'subscription', 'income received in advance'], books: true },
    { key: 'ims', href: '/gst-reports', keywords: ['ims', 'itc reduction', 'credit note', 'gstr-2b', 'remark'] },
    { key: 'labels', href: '/design', keywords: ['labels', 'rename column', 'hours', 'title', 'accent', 'logo colour'] },
    { key: 'display', href: '/settings?tab=security', keywords: ['text size', 'font size', 'contrast', 'accessibility', 'motion', 'zoom'] },
    { key: 'pkgTypes', href: '/settings?tab=items', keywords: ['package', 'carton', 'packing list', 'weight', 'cbm'] },
  ];
  return rows.filter((r) => !r.books || can('view')).map((r) => ({ id: `r2c:${r.key}`, title: cT(r.key), subtitle: cT('group'), icon: 'page', href: r.href, keywords: r.keywords }));
}
