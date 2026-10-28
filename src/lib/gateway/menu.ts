/**
 * Gateway of Tally menu (Phase 7): screens → sections → entries, each with a one-letter
 * accelerator unique on its screen. Pure data + helpers; the screen is src/components/gateway/GatewayMenu.tsx.
 *
 * Other modules (payroll, manufacturing, TDS …) add entries through GATEWAY_EXTENSIONS instead of
 * editing the screens, e.g. `{ screen: 'create', section: 0, entry: { id: 'employee', … } }`.
 */
import type { AccessAction } from '../access';
import type { GwKey } from '../../i18n/areas/gateway';
import { mastersHref } from '../../components/masters/screens';

export type ScreenId =
  | 'root'
  | 'create'
  | 'alter'
  | 'vouchers'
  | 'banking'
  | 'impexp'
  | 'more'
  | 'accbooks'
  | 'statements'
  | 'invbooks'
  | 'statutory';

export type MenuAction = 'createLedger' | 'createCustomer' | 'createVendor' | 'date' | 'period';

export type MenuTarget =
  | { screen: ScreenId }
  | { to: string }
  /** Gateway Display report: the query string of /gateway/display (e.g. `r=bs`). */
  | { display: string }
  | { action: MenuAction }
  /** Planned, not built yet: shown dimmed with "not available". */
  | { unavailable: true };

export interface MenuEntry {
  id: string;
  label: GwKey;
  /** Label used when "Tally terms" is on. */
  tally?: GwKey;
  /** One lowercase letter or digit, unique on its screen. */
  accel: string;
  /** Extra keys that open the entry (Tally's own letter when ours differs). */
  alias?: string[];
  target: MenuTarget;
  need?: AccessAction;
  /** Function key shown next to the entry (`f5`, `mod+f8` …). */
  fkey?: string;
  /** Extra search words for Go To (English; the labels are searched in both languages). */
  keywords?: string;
}

export interface MenuSection {
  title?: GwKey;
  entries: MenuEntry[];
}

export interface MenuScreen {
  id: ScreenId;
  title: GwKey;
  parent?: ScreenId;
  sections: MenuSection[];
}

const S = (screen: ScreenId): MenuTarget => ({ screen });
const go = (to: string): MenuTarget => ({ to });
const show = (display: string): MenuTarget => ({ display });

export const GATEWAY_SCREENS: readonly MenuScreen[] = [
  {
    id: 'root',
    title: 'title',
    sections: [
      {
        title: 'secMasters',
        entries: [
          { id: 'create', label: 'create', accel: 'c', target: S('create'), need: 'master.edit', keywords: 'new add master' },
          { id: 'alter', label: 'alter', accel: 'a', target: S('alter'), keywords: 'edit change master' },
          { id: 'coa', label: 'chartOfAccounts', accel: 'h', target: go('/books?tab=coa'), keywords: 'accounts groups ledgers coa' },
        ],
      },
      {
        title: 'secTransactions',
        entries: [
          { id: 'vouchers', label: 'vouchers', accel: 'v', target: S('vouchers'), keywords: 'entry voucher' },
          { id: 'daybook', label: 'dayBook', accel: 'd', alias: ['k'], target: show('r=daybook'), keywords: 'daybook transactions' },
        ],
      },
      {
        title: 'secUtilities',
        entries: [
          { id: 'banking', label: 'banking', accel: 'n', target: S('banking'), keywords: 'bank brs cheque' },
          { id: 'impexp', label: 'importExport', accel: 'i', target: S('impexp'), keywords: 'import export tally xml csv' },
        ],
      },
      {
        title: 'secReports',
        entries: [
          { id: 'bs', label: 'balanceSheet', accel: 'b', target: show('r=bs'), keywords: 'bs schedule iii' },
          { id: 'pl', label: 'profitLoss', accel: 'p', target: show('r=pl'), keywords: 'pnl p&l income statement' },
          { id: 'stock', label: 'stockSummary', accel: 's', target: go('/inventory'), keywords: 'inventory stock' },
          { id: 'more', label: 'moreReports', accel: 'm', target: S('more'), keywords: 'reports display' },
        ],
      },
    ],
  },
  {
    id: 'create',
    title: 'scrCreate',
    parent: 'root',
    sections: [
      {
        title: 'secMasters',
        entries: [
          { id: 'c-ledger', label: 'ledger', accel: 'l', target: { action: 'createLedger' }, need: 'master.edit', keywords: 'account new ledger' },
          { id: 'c-customer', label: 'customer', tally: 'customerTally', accel: 'u', target: { action: 'createCustomer' }, need: 'master.edit', keywords: 'client party debtor' },
          { id: 'c-vendor', label: 'vendor', tally: 'vendorTally', accel: 'e', target: { action: 'createVendor' }, need: 'master.edit', keywords: 'supplier party creditor' },
          { id: 'c-group', label: 'group', accel: 'g', target: go('/books?tab=coa'), keywords: 'group schedule iii' },
          { id: 'c-stock', label: 'stockItem', accel: 'i', target: go('/inventory'), need: 'master.edit', keywords: 'item product' },
          { id: 'c-godown', label: 'godown', accel: 'o', target: go('/inventory?tab=godowns'), need: 'master.edit', keywords: 'warehouse location' },
          { id: 'c-cc', label: 'costCentre', accel: 't', target: go('/books?tab=proj'), need: 'books.edit', keywords: 'project department branch' },
          { id: 'c-price', label: 'priceLevel', accel: 'p', target: go('/settings?tab=items'), need: 'settings.manage', keywords: 'price list wholesale' },
        ],
      },
    ],
  },
  {
    id: 'alter',
    title: 'scrAlter',
    parent: 'root',
    sections: [
      {
        title: 'secMasters',
        entries: [
          { id: 'a-ledger', label: 'ledger', accel: 'l', target: go('/books?tab=coa'), keywords: 'account edit' },
          { id: 'a-customer', label: 'customer', tally: 'customerTally', accel: 'u', target: go('/clients'), keywords: 'client party debtor' },
          { id: 'a-vendor', label: 'vendor', tally: 'vendorTally', accel: 'e', target: go('/expenses?tab=vendors'), keywords: 'supplier party creditor' },
          { id: 'a-group', label: 'group', accel: 'g', target: go('/books?tab=coa'), keywords: 'group' },
          { id: 'a-stock', label: 'stockItem', accel: 'i', target: go('/inventory'), keywords: 'item product' },
          { id: 'a-godown', label: 'godown', accel: 'o', target: go('/inventory?tab=godowns'), keywords: 'warehouse' },
          { id: 'a-cc', label: 'costCentre', accel: 't', target: go('/books?tab=proj'), keywords: 'project' },
          { id: 'a-price', label: 'priceLevel', accel: 'p', target: go('/settings?tab=items'), need: 'settings.manage', keywords: 'price list' },
        ],
      },
    ],
  },
  {
    id: 'vouchers',
    title: 'scrVouchers',
    parent: 'root',
    sections: [
      {
        entries: [
          { id: 'v-contra', label: 'contra', accel: 'c', target: go('/gateway/voucher/contra'), need: 'books.edit', fkey: 'f4', keywords: 'cash bank transfer' },
          { id: 'v-payment', label: 'payment', accel: 'p', target: go('/gateway/voucher/payment'), need: 'books.edit', fkey: 'f5', keywords: 'paid expense' },
          { id: 'v-receipt', label: 'receipt', accel: 'r', target: go('/gateway/voucher/receipt'), need: 'books.edit', fkey: 'f6', keywords: 'received' },
          { id: 'v-journal', label: 'journal', accel: 'j', target: go('/gateway/voucher/journal'), need: 'books.edit', fkey: 'f7', keywords: 'jv adjustment' },
          { id: 'v-sales', label: 'sales', tally: 'salesTally', accel: 's', target: go('/invoice'), need: 'doc.create', fkey: 'f8', keywords: 'invoice sale' },
          { id: 'v-purchase', label: 'purchase', tally: 'purchaseTally', accel: 'u', target: go('/expenses?new=bill'), need: 'books.edit', fkey: 'f9', keywords: 'bill purchase' },
          { id: 'v-cn', label: 'creditNote', accel: 'n', target: go('/invoice?type=CREDIT_NOTE'), need: 'doc.create', fkey: 'mod+f8', keywords: 'return' },
          { id: 'v-dn', label: 'debitNote', accel: 'd', target: go('/invoice?type=DEBIT_NOTE'), need: 'doc.create', fkey: 'mod+f9', keywords: 'debit' },
          { id: 'v-sj', label: 'stockJournal', accel: 'k', target: go('/manufacturing?tab=journal'), need: 'books.edit', fkey: 'alt+f7', keywords: 'stock transfer manufacture manufacturing journal bom' },
          { id: 'v-ps', label: 'physicalStock', accel: 'y', target: go('/manufacturing?tab=physical'), need: 'books.edit', fkey: 'mod+f7', keywords: 'stock count' },
        ],
      },
    ],
  },
  {
    id: 'banking',
    title: 'scrBanking',
    parent: 'root',
    sections: [
      {
        entries: [
          { id: 'b-brs', label: 'brs', accel: 'r', target: go('/reconcile?tab=brs'), need: 'books.edit', keywords: 'brs reconcile' },
          { id: 'b-import', label: 'bankImport', accel: 'i', target: go('/reconcile?tab=import'), need: 'books.edit', keywords: 'statement csv' },
          { id: 'b-cheques', label: 'cheques', accel: 'c', target: go('/cheques'), need: 'books.edit', keywords: 'pdc cheque' },
          { id: 'b-book', label: 'bankBook', accel: 'b', target: show('r=cash'), keywords: 'cash book bank book' },
        ],
      },
    ],
  },
  {
    id: 'impexp',
    title: 'scrImpExp',
    parent: 'root',
    sections: [
      {
        entries: [
          { id: 'ie-import', label: 'importData', accel: 'i', target: go('/settings?tab=data'), need: 'master.edit', keywords: 'csv excel import' },
          { id: 'ie-export', label: 'exports', accel: 'e', target: go('/exports'), keywords: 'tally xml csv export' },
          { id: 'ie-backup', label: 'backup', accel: 'b', target: go('/settings?tab=data'), need: 'data.backup', keywords: 'backup restore' },
        ],
      },
    ],
  },
  {
    id: 'more',
    title: 'scrMore',
    parent: 'root',
    sections: [
      {
        entries: [
          { id: 'm-tb', label: 'trialBalance', accel: 't', target: show('r=tb'), keywords: 'tb trial' },
          { id: 'm-daybook', label: 'dayBook', accel: 'd', target: show('r=daybook'), keywords: 'daybook' },
          { id: 'm-accbooks', label: 'accountBooks', accel: 'a', target: S('accbooks'), keywords: 'books ledger cash' },
          { id: 'm-statements', label: 'statements', accel: 's', target: S('statements'), keywords: 'outstanding statement' },
          { id: 'm-invbooks', label: 'inventoryBooks', accel: 'i', target: S('invbooks'), keywords: 'stock inventory' },
          { id: 'm-statutory', label: 'statutory', accel: 'r', target: S('statutory'), keywords: 'gst tds statutory' },
        ],
      },
    ],
  },
  {
    id: 'accbooks',
    title: 'scrAccBooks',
    parent: 'more',
    sections: [
      {
        entries: [
          { id: 'ab-cash', label: 'bankBook', accel: 'c', target: show('r=cash'), keywords: 'cash book bank book' },
          { id: 'ab-ledger', label: 'ledgerList', accel: 'l', target: show('r=ledgers'), keywords: 'ledger account' },
          { id: 'ab-groups', label: 'groupSummary', accel: 'g', target: show('r=groups'), keywords: 'group summary' },
          { id: 'ab-sales', label: 'salesRegister', accel: 's', target: go('/reports?tab=monthly'), keywords: 'sales register monthly' },
          { id: 'ab-purchase', label: 'purchaseRegister', accel: 'p', target: go('/expenses'), keywords: 'purchase register bills' },
        ],
      },
    ],
  },
  {
    id: 'statements',
    title: 'scrStatements',
    parent: 'more',
    sections: [
      {
        entries: [
          { id: 'st-rec', label: 'outReceivables', accel: 'r', target: show('r=acct&x=debtors'), keywords: 'outstanding receivable debtors' },
          { id: 'st-pay', label: 'outPayables', accel: 'p', target: show('r=acct&x=creditors'), keywords: 'outstanding payable creditors' },
          { id: 'st-ageing', label: 'ageing', accel: 'a', target: go('/receivables'), keywords: 'ageing aging overdue' },
          { id: 'st-party', label: 'partyStatements', accel: 's', target: go('/receivables?tab=statements'), keywords: 'statement of account' },
        ],
      },
    ],
  },
  {
    id: 'invbooks',
    title: 'scrInvBooks',
    parent: 'more',
    sections: [
      {
        entries: [
          { id: 'ib-summary', label: 'stockSummary', accel: 's', target: go('/inventory'), keywords: 'stock summary' },
          { id: 'ib-movement', label: 'movement', accel: 'm', target: go('/inventory?tab=movement'), keywords: 'movement analysis' },
          { id: 'ib-batches', label: 'batches', accel: 'b', target: go('/inventory?tab=batches'), keywords: 'batch expiry' },
          { id: 'ib-godowns', label: 'godownSummary', accel: 'g', target: go('/inventory?tab=godowns'), keywords: 'godown warehouse' },
          { id: 'ib-transfers', label: 'transfers', accel: 't', target: go('/inventory?tab=transfers'), keywords: 'transfer' },
        ],
      },
    ],
  },
  {
    id: 'statutory',
    title: 'scrStatutory',
    parent: 'more',
    sections: [
      {
        entries: [
          { id: 'sr-gst', label: 'gst', accel: 'g', target: go('/gst-reports'), keywords: 'gst returns' },
          { id: 'sr-gstr1', label: 'gstr1', accel: '1', target: go('/gst-reports?tab=b2b'), keywords: 'gstr1 outward' },
          { id: 'sr-gstr3b', label: 'gstr3b', accel: '3', target: go('/gst-reports?tab=gstr3b'), keywords: 'gstr3b summary' },
          { id: 'sr-gstr2b', label: 'gstr2b', accel: '2', target: go('/gst-reports?tab=gstr2b'), keywords: 'gstr2b itc' },
          { id: 'sr-tds', label: 'tds', accel: 't', target: go('/receivables?tab=tds'), keywords: 'tds 26as' },
          { id: 'sr-compliance', label: 'compliance', accel: 'c', target: go('/gst-reports?tab=compliance'), keywords: 'due dates calendar' },
        ],
      },
    ],
  },
];

/** Entries added by other modules (payroll's Employee, manufacturing's Stock journal …). */
export const GATEWAY_EXTENSIONS: Array<{ screen: ScreenId; section: number; entry: MenuEntry }> = [
  // Payroll (Phase 7, docs/features/payroll.md) — owner only (`payroll.view`).
  { screen: 'create', section: 0, entry: { id: 'employee', label: 'employee', accel: 'm', target: go('/payroll?tab=employees'), need: 'payroll.view', keywords: 'employee staff payroll salary' } },
  { screen: 'alter', section: 0, entry: { id: 'employee', label: 'employee', accel: 'm', target: go('/payroll?tab=employees'), need: 'payroll.view', keywords: 'employee staff payroll salary' } },
  { screen: 'vouchers', section: 0, entry: { id: 'v-payroll', label: 'payrollVoucher', accel: 'l', target: go('/payroll?tab=run'), need: 'payroll.view', keywords: 'payroll salary attendance' } },
  { screen: 'statutory', section: 0, entry: { id: 'sr-payroll', label: 'payrollReports', accel: 'p', target: go('/payroll?tab=reports'), need: 'payroll.view', keywords: 'pf esi ecr pt 24q form 16 payroll' } },

  // P1-13 (7Q): Voucher Types master (Accounts Info screen).
  { screen: 'create', section: 0, entry: { id: 'c-vtype', label: 'voucherTypes', accel: 'y', target: go(mastersHref('voucher-types', 'new')), need: 'master.edit', keywords: 'voucher type numbering series prefix suffix sales export receipt cash pos' } },
  { screen: 'alter', section: 0, entry: { id: 'a-vtype', label: 'voucherTypes', accel: 'y', target: go(mastersHref('voucher-types')), keywords: 'voucher type numbering series prefix suffix' } },

  /* ── Phase 7 integration pass: every Tally-parity package reachable from the Gateway ── */
  // WP-1 masters ("Accounts Info": groups, ledgers, opening trial balance, bill-wise openings).
  { screen: 'root', section: 0, entry: { id: 'accinfo', label: 'accountsInfo', accel: 'o', target: go(mastersHref('menu')), keywords: 'accounts info masters group ledger opening balance trial balance billwise' } },
  // WP-7 year-end wizard and Tally import (also Books header, Settings → Data).
  { screen: 'root', section: 2, entry: { id: 'yearend', label: 'yearEnd', accel: 'y', target: go('/books?open=yearend'), need: 'books.edit', keywords: 'year end closing split company new year carry forward' } },
  { screen: 'impexp', section: 0, entry: { id: 'ie-tally', label: 'tallyImport', accel: 't', target: go('/books?open=tally'), need: 'data.restore', keywords: 'tally xml import masters vouchers migration' } },
  // WP-5 banking documents.
  { screen: 'banking', section: 0, entry: { id: 'b-deposit', label: 'depositSlip', accel: 'd', target: go('/reconcile?tab=documents&doc=deposit'), need: 'books.edit', keywords: 'deposit slip pay in cheque cash' } },
  { screen: 'banking', section: 0, entry: { id: 'b-advice', label: 'paymentAdvice', accel: 'a', target: go('/reconcile?tab=documents&doc=advice'), need: 'books.edit', keywords: 'payment advice remittance supplier' } },
  { screen: 'banking', section: 0, entry: { id: 'b-epay', label: 'ePayments', accel: 'e', target: go('/reconcile?tab=documents&doc=epay'), need: 'books.edit', keywords: 'e-payment neft rtgs bulk upload bank file' } },
  { screen: 'banking', section: 0, entry: { id: 'b-cash', label: 'cashTally', accel: 't', target: go('/reconcile?tab=documents&doc=cash'), need: 'books.edit', keywords: 'cash tally denomination day end' } },
  // WP-3 purchase side and manufacturing vouchers.
  { screen: 'vouchers', section: 0, entry: { id: 'v-pdn', label: 'purchaseReturn', accel: 'e', target: go('/expenses?tab=returns&new=dn'), need: 'books.edit', keywords: 'debit note purchase return supplier rejection' } },
  { screen: 'vouchers', section: 0, entry: { id: 'v-grn', label: 'receiptNote', accel: 'g', target: go('/expenses?tab=returns&new=grn'), need: 'books.edit', keywords: 'grn receipt note goods received inward' } },
  { screen: 'vouchers', section: 0, entry: { id: 'v-mfg', label: 'mfgJournal', accel: 'm', target: go('/manufacturing?tab=mfg'), need: 'books.edit', keywords: 'manufacturing journal production bom assemble' } },
  // Phase 7M: job work (P1-9) and Rejections In (P1-8).
  { screen: 'vouchers', section: 0, entry: { id: 'v-jwo', label: 'jobWorkOrder', accel: 'w', target: go('/manufacturing?tab=jobwork&jw=orders'), need: 'books.edit', keywords: 'job work order job worker processing' } },
  { screen: 'vouchers', section: 0, entry: { id: 'v-mout', label: 'materialOut', accel: 'o', target: go('/manufacturing?tab=jobwork&jw=out'), need: 'books.edit', keywords: 'material out job work challan rule 55 send job worker' } },
  { screen: 'vouchers', section: 0, entry: { id: 'v-min', label: 'materialIn', accel: 'i', target: go('/manufacturing?tab=jobwork&jw=in'), need: 'books.edit', keywords: 'material in job work received processed scrap' } },
  { screen: 'vouchers', section: 0, entry: { id: 'v-rji', label: 'rejectionsIn', accel: 'x', target: go('/manufacturing?tab=rejections'), need: 'books.edit', keywords: 'rejection in customer rejected delivery challan return' } },
  { screen: 'invbooks', section: 0, entry: { id: 'ib-jobwork', label: 'jobWorkRegister', accel: 'j', target: go('/manufacturing?tab=jobwork&jw=clocks'), keywords: 'job work register stock with job worker return clock 143' } },
  { screen: 'statutory', section: 0, entry: { id: 'sr-itc04', label: 'itc04', accel: '4', target: go('/manufacturing?tab=jobwork&jw=itc04'), keywords: 'itc-04 itc04 job work return' } },
  // TDS payables (deducted by us), GST set-off (WP-6), ratio analysis (WP-2).
  { screen: 'statutory', section: 0, entry: { id: 'sr-tdsp', label: 'tdsPayables', accel: 'd', target: go('/tds'), keywords: 'tds tcs payable 26q 27eq challan 16a deducted' } },
  { screen: 'statutory', section: 0, entry: { id: 'sr-setoff', label: 'gstSetoff', accel: 'o', target: go('/gst-reports?tab=setoff'), keywords: 'gst set off pmt-06 challan cash ledger credit ledger utilisation' } },
  { screen: 'more', section: 0, entry: { id: 'm-ratio', label: 'ratioAnalysis', accel: 'o', target: go('/books?tab=ratio'), keywords: 'ratio analysis current ratio quick ratio working capital' } },
];

export type Can = (action: AccessAction) => boolean;

const allowed = (e: MenuEntry, can?: Can) => !e.need || !can || can(e.need);

/** A screen with extensions merged in and entries the role cannot use removed (empty sections dropped). */
export function resolveScreen(id: ScreenId, can?: Can, screens: readonly MenuScreen[] = GATEWAY_SCREENS, extensions = GATEWAY_EXTENSIONS): MenuScreen | null {
  const base = screens.find((s) => s.id === id);
  if (!base) return null;
  const sections = base.sections.map((sec, i) => {
    const extra = extensions.filter((x) => x.screen === id && x.section === i).map((x) => x.entry);
    // An extension replaces a built-in entry with the same id (e.g. Stock journal once it exists).
    const ids = new Set(extra.map((e) => e.id));
    return { ...sec, entries: [...sec.entries.filter((e) => !ids.has(e.id)), ...extra].filter((e) => allowed(e, can)) };
  });
  return { ...base, sections: sections.filter((s) => s.entries.length > 0) };
}

/** Entries of a resolved screen in display order. */
export function screenEntries(screen: MenuScreen | null): MenuEntry[] {
  return screen ? screen.sections.flatMap((s) => s.entries) : [];
}

/** The entry a key press opens on this screen (accelerator or alias), or undefined. */
export function entryForKey(screen: MenuScreen | null, key: string): MenuEntry | undefined {
  const k = key.toLowerCase();
  if (k.length !== 1) return undefined;
  const list = screenEntries(screen);
  return list.find((e) => e.accel === k) ?? list.find((e) => e.alias?.includes(k));
}

/** Where to highlight the accelerator in a label: index of its first occurrence, or -1 (then show it as a badge). */
export function accelIndex(label: string, accel: string): number {
  return label.toLowerCase().indexOf(accel.toLowerCase());
}

/** Accelerators used more than once on a screen (should always be empty; tested). */
export function duplicateAccelerators(screen: MenuScreen): string[] {
  const seen = new Map<string, number>();
  for (const e of screenEntries(screen)) for (const k of [e.accel, ...(e.alias ?? [])]) seen.set(k, (seen.get(k) ?? 0) + 1);
  return [...seen].filter(([, n]) => n > 1).map(([k]) => k);
}

export interface GotoItem {
  entry: MenuEntry;
  screen: ScreenId;
  /** Display label (active language, Tally terms applied). */
  label: string;
  /** Screen titles from the Gateway down to the entry's screen. */
  path: string[];
  /** Lowercased haystack: labels in both languages, path and keywords. */
  haystack: string;
}

/**
 * Every leaf entry reachable from the Gateway for this role (entries that open another menu screen are
 * left out: their children are listed instead), with the breadcrumb for Go To.
 * `label(key)` gives the active-language text; `alt(key)` the other language (searched too).
 */
export function flattenMenu(opts: { can?: Can; label: (k: GwKey) => string; alt?: (k: GwKey) => string; terms?: boolean }): GotoItem[] {
  const out: GotoItem[] = [];
  const seen = new Set<string>();
  const walk = (id: ScreenId, path: string[]) => {
    const screen = resolveScreen(id, opts.can);
    if (!screen) return;
    const here = id === 'root' ? path : [...path, opts.label(screen.title)];
    for (const e of screenEntries(screen)) {
      if ('screen' in e.target) {
        walk(e.target.screen, here);
        continue;
      }
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      const key = opts.terms && e.tally ? e.tally : e.label;
      const label = opts.label(key);
      const words = [label, opts.label(e.label), opts.alt?.(e.label) ?? '', e.tally ? opts.label(e.tally) : '', e.tally && opts.alt ? opts.alt(e.tally) : '', ...here, e.keywords ?? ''];
      out.push({ entry: e, screen: id, label, path: here, haystack: words.join(' ').toLowerCase() });
    }
  };
  walk('root', []);
  return out;
}

/**
 * Go To filter: every word of the query must appear in the item; ranked by label prefix, then a word
 * of the label starting with the query, then anything else (stable within a rank).
 */
export function filterGoto(items: readonly GotoItem[], query: string, limit = 30): GotoItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+/);
  const rank = (it: GotoItem) => {
    const l = it.label.toLowerCase();
    if (l.startsWith(q)) return 0;
    if (l.split(/[\s(/:&-]+/).some((w) => w.startsWith(words[0]))) return 1;
    return 2;
  };
  return items
    .filter((it) => words.every((w) => it.haystack.includes(w)))
    .map((it, i) => ({ it, i, r: rank(it) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.it);
}

/** Route for an entry's target (null for actions, sub-screens and unavailable entries). */
export function entryRoute(target: MenuTarget, from: ScreenId): string | null {
  if ('to' in target) return target.to;
  if ('display' in target) return `/gateway/display?${target.display}&from=${from}`;
  if ('screen' in target) return target.screen === 'root' ? '/gateway' : `/gateway?m=${target.screen}`;
  return null;
}

export function isScreenId(v: unknown): v is ScreenId {
  return typeof v === 'string' && GATEWAY_SCREENS.some((s) => s.id === v);
}
