/** R4-A: command palette destinations for production, trace, QC and landed cost (searched only, like the Tally rows). */
import { can } from '../../lib/access';
import type { StaticEntry } from '../../lib/search';
import { defineArea } from '../../i18n/area';

const cT = defineArea(
  {
    orders: 'Production orders (work orders)',
    costing: 'Order costing & variance',
    trace: 'Batch trace & recall',
    qc: 'QC desk (hold & release)',
    landed: 'Landed-cost voucher',
    group: 'Production',
  } as const,
  {
    orders: 'उत्पादन ऑर्डर (वर्क ऑर्डर)',
    costing: 'ऑर्डर लागत और अंतर',
    trace: 'बैच ट्रेस और रिकॉल',
    qc: 'QC डेस्क (होल्ड और रिलीज़)',
    landed: 'लैंडेड-कॉस्ट वाउचर',
    group: 'उत्पादन',
  },
);

export function r4aDestinations(): StaticEntry[] {
  if (!can('view')) return [];
  const rows: { key: 'orders' | 'costing' | 'trace' | 'qc' | 'landed'; keywords: string[] }[] = [
    { key: 'orders', keywords: ['production order', 'work order', 'wo', 'manufacturing order', 'mo', 'shop floor', 'wip', 'make to order', 'issue material'] },
    { key: 'costing', keywords: ['standard cost', 'actual cost', 'variance', 'yield', 'job costing', 'order profitability', 'so margin'] },
    { key: 'trace', keywords: ['genealogy', 'traceability', 'recall', 'batch', 'lot', 'fssai', 'drug recall', 'block batch'] },
    { key: 'qc', keywords: ['quality check', 'qc', 'inspection', 'hold', 'release', 'reject', 'quarantine'] },
    { key: 'landed', keywords: ['landed cost', 'freight', 'cha', 'clearing', 'customs', 'lcv', 'import cost'] },
  ];
  return rows.map((r) => ({ id: `r4a:${r.key}`, title: cT(r.key), subtitle: cT('group'), icon: 'page', href: `/manufacturing?tab=${r.key}`, keywords: r.keywords }));
}
