/**
 * Command palette destinations for the Tally-parity screens (Phase 7 integration pass). Lives in the
 * lazy palette chunk; entries are searched only (not listed on the empty palette) so the default
 * list stays short. Role-gated like the Gateway rows.
 */
import { can, type AccessAction } from '../../lib/access';
import type { StaticEntry } from '../../lib/search';
import { mastersHref } from '../masters/screens';
import { wireT } from '../../i18n/areas/wiring';

type Key = Parameters<typeof wireT>[0];

const ROWS: Array<{ key: Key; href: string; need?: AccessAction; keywords: string[] }> = [
  { key: 'pGateway', href: '/gateway', keywords: ['tally', 'gateway', 'got'] },
  { key: 'pAccountsInfo', href: mastersHref('menu'), keywords: ['masters', 'group', 'ledger', 'opening', 'tally'] },
  { key: 'pYearEnd', href: '/books?open=yearend', need: 'books.edit', keywords: ['year end', 'closing', 'new year', 'carry forward'] },
  { key: 'pTallyImport', href: '/books?open=tally', need: 'data.restore', keywords: ['tally', 'import', 'xml', 'migration'] },
  { key: 'pDepositSlip', href: '/reconcile?tab=documents&doc=deposit', need: 'books.edit', keywords: ['bank', 'deposit', 'pay in'] },
  { key: 'pPaymentAdvice', href: '/reconcile?tab=documents&doc=advice', need: 'books.edit', keywords: ['remittance', 'supplier', 'bank'] },
  { key: 'pEpay', href: '/reconcile?tab=documents&doc=epay', need: 'books.edit', keywords: ['neft', 'rtgs', 'bulk', 'upload'] },
  { key: 'pCashTally', href: '/reconcile?tab=documents&doc=cash', need: 'books.edit', keywords: ['denomination', 'cash'] },
  { key: 'pTds', href: '/tds', keywords: ['tds', 'tcs', '26q', '27eq', 'challan'] },
  { key: 'pRatio', href: '/books?tab=ratio', keywords: ['ratio', 'current ratio', 'analysis'] },
  { key: 'pSetoff', href: '/gst-reports?tab=setoff', keywords: ['gst', 'set off', 'pmt-06', 'challan'] },
  { key: 'pPurchaseReturn', href: '/expenses?tab=returns&new=dn', need: 'books.edit', keywords: ['debit note', 'return', 'supplier'] },
  { key: 'pGrn', href: '/expenses?tab=returns&new=grn', need: 'books.edit', keywords: ['grn', 'goods received', 'inward'] },
  { key: 'pMfg', href: '/manufacturing?tab=mfg', need: 'books.edit', keywords: ['manufacturing', 'production', 'bom'] },
  { key: 'pReturnExchange', href: '/pos', need: 'doc.create', keywords: ['return', 'exchange', 'pos', 'refund'] },
];

export function tallyDestinations(): StaticEntry[] {
  const group = wireT('groupTally');
  return ROWS.filter((r) => !r.need || can(r.need)).map((r) => ({
    id: `tally:${r.href}`,
    title: wireT(r.key),
    subtitle: group,
    icon: 'page',
    href: r.href,
    keywords: r.keywords,
  }));
}
