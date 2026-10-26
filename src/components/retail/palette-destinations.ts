/** R4-B: command palette destinations for gift vouchers, transfers and store prices (searched only, like the Tally rows). */
import { can } from '../../lib/access';
import type { StaticEntry } from '../../lib/search';
import { defineArea } from '../../i18n/area';

const cT = defineArea(
  {
    gv: 'Gift vouchers (sell, register, breakage)',
    requests: 'Transfer requests',
    transit: 'Goods in transit',
    prices: 'Store prices (price list per branch)',
    replenish: 'Store replenishment',
    group: 'Stores & chains',
  } as const,
  {
    gv: 'गिफ़्ट वाउचर (बिक्री, रजिस्टर, ब्रेकेज)',
    requests: 'ट्रांसफ़र अनुरोध',
    transit: 'रास्ते में माल',
    prices: 'स्टोर मूल्य (शाखा-वार मूल्य सूची)',
    replenish: 'स्टोर पुनःपूर्ति',
    group: 'स्टोर और चेन',
  },
);

export function r4bDestinations(): StaticEntry[] {
  if (!can('view')) return [];
  const rows: { key: 'gv' | 'requests' | 'transit' | 'prices' | 'replenish'; href: string; keywords: string[] }[] = [
    { key: 'gv', href: '/receivables?tab=giftvouchers', keywords: ['gift voucher', 'gift card', 'voucher', 'gv', 'breakage', 'unredeemed', 'promo voucher'] },
    { key: 'requests', href: '/inventory?tab=transfers&view=requests', keywords: ['transfer request', 'indent', 'trq', 'store request', 'dispatch', 'receive', 'shortage', 'challan', 'own use eway'] },
    { key: 'transit', href: '/inventory?tab=transfers&view=transit', keywords: ['in transit', 'transit', 'goods on the way', 'fill rate'] },
    { key: 'prices', href: '/settings?tab=items&storeprices=1', keywords: ['store price', 'branch price', 'price list', 'mall price', 'location price'] },
    { key: 'replenish', href: '/manufacturing?tab=reorder', keywords: ['replenish', 'replenishment', 'refill store', 'warehouse', 'reorder'] },
  ];
  return rows.map((r) => ({ id: `r4b:${r.key}`, title: cT(r.key), subtitle: cT('group'), icon: 'page', href: r.href, keywords: r.keywords }));
}
