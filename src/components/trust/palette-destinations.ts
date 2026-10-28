/** R4-C: command palette destinations for the export desk and the trust tools (searched only, like the Tally rows). */
import { can } from '../../lib/access';
import type { StaticEntry } from '../../lib/search';
import { tlT } from '../../i18n/areas/trade-trust-r4-links';

export function r4cDestinations(): StaticEntry[] {
  if (!can('view')) return [];
  const rows: { key: 'palExportDesk' | 'palImportRegister' | 'palBin' | 'palAuditorPack' | 'palExportAll'; href: string; keywords: string[]; need?: Parameters<typeof can>[0] }[] = [
    { key: 'palExportDesk', href: '/gst-reports?tab=export-desk', keywords: ['export', 'realisation', 'realization', 'irm', 'firc', 'ebrc', 'e-brc', 'brc', 'fema', 'rodtep', 'drawback', 'igst refund', 'shipping bill', 'lut', 'iec'] },
    { key: 'palImportRegister', href: '/gst-reports?tab=export-desk&view=imports', keywords: ['import', 'bill of entry', 'boe', 'customs duty', 'bcd', 'sws', 'assessable value'] },
    { key: 'palBin', href: '/settings?tab=activity&bin=1', keywords: ['recycle bin', 'trash', 'deleted', 'restore', 'undo delete', 'undelete'] },
    { key: 'palAuditorPack', href: '/settings?tab=activity&pack=1', keywords: ['auditor', 'audit trail', 'edit log', 'rule 11(g)', '11g', 'mca', 'chain'], need: 'report.export' },
    { key: 'palExportAll', href: '/settings?tab=data&export=1', keywords: ['export everything', 'csv', 'excel', 'xlsx', 'portability', 'download all data', 'schema'], need: 'data.backup' },
  ];
  return rows
    .filter((r) => !r.need || can(r.need))
    .map((r) => ({ id: `r4c:${r.key}`, title: tlT(r.key), subtitle: tlT('group'), icon: 'page', href: r.href, keywords: r.keywords }));
}
