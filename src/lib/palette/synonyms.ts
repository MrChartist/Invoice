/**
 * R6-B1: extra words Ctrl+K matches for a tab — portal form names, short forms testers type ("3b", "tb", "lr"),
 * and a few Hindi words. Keyed by the tab's href (`route?tab=id`, or a pack sub-view href). Data only.
 */
export const TAB_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  // GST — GSTR-1 sections
  '/gst-reports?tab=overview': ['gst summary', 'gst return', 'जीएसटी'],
  '/gst-reports?tab=b2b': ['b2b invoices', 'registered sales', 'table 4'],
  '/gst-reports?tab=b2cl': ['b2cl', 'large', 'b2c large', 'interstate b2c'],
  '/gst-reports?tab=b2cs': ['b2cs', 'small', 'b2c small', 'consumer sales'],
  '/gst-reports?tab=cdnr': ['credit note', 'debit note', 'cdn'],
  '/gst-reports?tab=cdnur': ['cdnur', 'credit note unregistered'],
  '/gst-reports?tab=exp': ['export', 'lut', 'zero rated', 'sez'],
  '/gst-reports?tab=nil': ['nil rated', 'exempt', 'non gst'],
  '/gst-reports?tab=at': ['advance', 'advance received'],
  '/gst-reports?tab=txpd': ['advance adjusted'],
  '/gst-reports?tab=hsn': ['hsn', 'hsn summary', 'sac'],
  '/gst-reports?tab=docs': ['documents issued', 'serial numbers'],
  '/gst-reports?tab=amend': ['b2ba', 'amendment', 'cdnra'],
  '/gst-reports?tab=eco': ['ecommerce', 'operator', 'section 9(5)'],
  // GSTR-3B and payment
  '/gst-reports?tab=gstr3b': ['3b', 'gstr3b', 'gstr 3b', 'monthly return', 'summary return', 'itc', 'rcm', '3बी'],
  '/gst-reports?tab=setoff': ['set off', 'challan', 'pmt-06', 'cash ledger', 'tax payable'],
  '/gst-reports?tab=cashref': ['refund', 'electronic cash ledger', 'rfd'],
  '/gst-reports?tab=rcmdocs': ['rcm', 'reverse charge', 'self invoice'],
  // reconciliation
  '/gst-reports?tab=gstr2b': ['2b', 'gstr2b', 'gstr 2b', 'itc match', 'ims', 'purchase match'],
  '/gst-reports?tab=purhsn': ['purchase hsn', 'inward hsn'],
  '/gst-reports?tab=recon': ['gstr1 vs 3b', 'reconcile', 'mismatch'],
  '/gst-reports?tab=guards': ['gst checks', 'warnings'],
  '/gst-reports?tab=bygstin': ['branch gstin', 'multi gstin'],
  // tools
  '/gst-reports?tab=compliance': ['due dates', 'calendar', 'late fee', 'gstr1 due', 'filing'],
  '/gst-reports?tab=composition': ['cmp-08', 'cmp08', 'gstr-4', 'gstr4', 'composition dealer'],
  '/gst-reports?tab=hsnmaster': ['hsn rates', 'hsn master'],
  '/gst-reports?tab=gstr9c': ['gstr9', 'gstr-9', 'annual return', '9c', 'reconciliation statement'],
  '/gst-reports?tab=isd': ['isd', 'gstr6', 'input service distributor'],
  '/gst-reports?tab=ewbcons': ['eway', 'e-way', 'consolidated ewb', 'cewb'],
  '/gst-reports?tab=portal-files': ['gstr1 json', 'portal upload', 'offline tool', 'irn', 'e-invoice'],
  '/gst-reports?tab=eway-desk': ['eway', 'e-way bill', 'ewb', 'vehicle update', 'validity'],
  '/gst-reports?tab=export-desk': ['export', 'lut', 'irm', 'ebrc', 'e-brc', 'realisation', 'boe'],
  '/gst-reports?tab=common-credit': ['rule 42', 'rule 43', 'itc reversal', 'common credit'],
  // TDS (Income-tax Act 2025 sections keep the 1961 names as words too)
  '/tds?tab=overview': ['tds', 'tcs', 'withholding'],
  '/tds?tab=deductions': ['194c', '194j', '194h', '194i', '194q', '393', 'deduction'],
  '/tds?tab=challans': ['challan', '281', 'itns 281', 'bsr', 'oltas'],
  '/tds?tab=returns': ['26q', '24q', '27eq', 'tds return', 'fvu', 'quarterly return'],
  '/tds?tab=27q': ['27q', 'non resident', '195', 'nri'],
  '/tds?tab=f16a': ['form 16a', '16a', 'tds certificate'],
  '/tds?tab=traces': ['traces', 'tan', '26as', 'ais'],
  // Books
  '/books?tab=day': ['day book', 'daybook', 'रोजनामचा'],
  '/books?tab=cash': ['cash book', 'bank book', 'रोकड़'],
  '/books?tab=vch': ['journal', 'voucher', 'contra', 'payment voucher', 'receipt voucher'],
  '/books?tab=ledger': ['ledger', 'account statement', 'खाता'],
  '/books?tab=tb': ['tb', 'trial balance', 'तलपट'],
  '/books?tab=pnl': ['p&l', 'pnl', 'profit', 'loss', 'income statement', 'लाभ हानि'],
  '/books?tab=bs': ['bs', 'balance sheet', 'तुलन पत्र'],
  '/books?tab=cf': ['cash flow', 'fund flow'],
  '/books?tab=rpt': ['group summary', 'annual accounts', 'schedule iii', 'registers'],
  '/books?tab=proj': ['cost centre', 'cost center', 'project'],
  '/books?tab=coa': ['chart of accounts', 'ledgers', 'groups', 'opening balance', 'masters'],
  '/books?tab=fcst': ['forecast', 'cash planning'],
  '/books?tab=fx': ['forex', 'exchange gain', 'exchange loss'],
  '/books?tab=billwise': ['payables', 'creditors', 'bill wise', 'outstanding bills'],
  '/books?tab=vreg': ['voucher register', 'sales register', 'purchase register'],
  '/books?tab=ratio': ['ratios', 'current ratio', 'ratio analysis'],
  '/books?tab=defer': ['prepaid', 'deferred revenue', 'amc'],
  '/reconcile?tab=brs': ['brs', 'bank reconciliation statement'],
  '/reconcile?tab=reconcile': ['bank reco', 'bank match', 'brs'],
  '/reconcile?tab=import': ['bank statement', 'csv', 'xlsx', 'statement import'],
  // Payroll
  '/payroll?tab=run': ['salary', 'payslip', 'salary slip', 'वेतन'],
  '/payroll?tab=reports': ['pf', 'epf', 'esi', 'ecr', 'professional tax', 'pt', 'form 16', '24q'],
  '/payroll?tab=fnf': ['gratuity', 'full and final', 'fnf'],
  '/payroll?tab=attendance': ['attendance', 'muster'],
  // Stock & manufacturing
  '/manufacturing?tab=boms': ['bom', 'recipe'],
  '/manufacturing?tab=jobwork': ['itc-04', 'itc04', 'job worker'],
  '/manufacturing?tab=physical': ['stock count', 'stock take', 'physical verification'],
  '/inventory?tab=batches': ['batch', 'expiry', 'fefo', 'lot'],
  '/inventory?tab=serials': ['serial', 'imei'],
  '/inventory?tab=godowns': ['warehouse', 'godown', 'location'],
  // Sales & purchase
  '/receivables?tab=aging': ['ageing', 'outstanding', 'debtors', 'overdue', 'बकाया'],
  '/receivables?tab=statements': ['statement of account', 'soa', 'party ledger'],
  '/receivables?tab=tds': ['26as', 'tds receivable', 'tds by customer'],
  '/expenses?tab=orders': ['po', 'purchase order'],
  '/expenses?tab=returns': ['grn', 'debit note', 'purchase return', 'goods receipt'],
  '/expenses?tab=vendors': ['supplier', 'creditor', 'vendor'],
  '/recurring?tab=batch': ['bulk invoices', 'batch billing'],
  '/settings?tab=data': ['backup', 'restore', 'import', 'companies'],
  '/settings?tab=security': ['pin', 'users', 'vault', 'lock', 'text size'],
  '/settings?tab=features': ['modules', 'packs', 'shop mode', 'show all features', 'enable'],
  // Industry packs (rows of the R5 "Industry packs" group)
  '/distribution?tab=transport': ['lr', 'bilty', 'consignment', 'consignment note', 'gta', 'freight', 'transport'],
  '/distribution?tab=transport&view=trips': ['trip', 'trip sheet', 'lorry', 'freight'],
  '/distribution?tab=transport&view=vehicles': ['vehicle', 'truck', 'fleet'],
  // R8: trading packs and tabs
  '/distribution?tab=claims': ['scheme claim', 'price protection', 'claim'],
  '/distribution?tab=claims&view=pricedrop': ['price drop', 'rate difference'],
  '/distribution?tab=packaging': ['crates', 'bardana', 'returnable'],
  '/distribution?tab=mandi': ['mandi', 'market fee', 'hamali', 'tulai', 'aadat charges'],
  '/distribution?tab=brokers': ['broker', 'dalali', 'brokerage'],
  '/distribution?tab=agency': ['aadat', 'arhatiya', 'commission agent'],
  '/distribution?tab=agency&view=arrivals': ['arrival', 'aamad', 'lot'],
  '/distribution?tab=agency&view=pattis': ['patti', 'bikri patti', 'settlement'],
  '/distribution?tab=agency&view=indents': ['indent', 'indenting agent'],
  '/reports?tab=stockstatement': ['drawing power', 'stock statement', 'cc limit', 'book debts'],
  '/inventory?tab=hsn': ['hsn stock', 'hsn wise'],
  '/time?tab=works': ['ra bill', 'running bill', 'boq', 'measurement', 'works contract'],
  '/time?tab=works&view=retention': ['retention', 'retention money'],
  '/time?tab=works&view=sites': ['site', 'project site'],
  '/receivables?tab=donations': ['80g', '10bd', 'form 10bd', 'donation', 'receipt 80g', 'दान'],
  '/books?tab=funds': ['fund', 'fcra', 'fc-4', 'corpus', 'earmarked'],
  '/recurring?tab=fees': ['fee', 'fees', 'tuition', 'school fees', 'student'],
  '/recurring?tab=leases': ['lease', 'rent', 'cam', 'tenant', 'किराया'],
  '/receivables?tab=marketplace': ['settlement', 'payout', 'amazon', 'flipkart', 'meesho', 'marketplace'],
  '/receivables?tab=marketplace&view=settlements': ['settlement', 'payout', 'amazon', 'flipkart', 'meesho'],
  '/receivables?tab=marketplace&view=tcs': ['tcs', 'gstr-8', 'section 52'],
};

/** Words for one href: its own row, else the row of its base tab (`&view=` dropped). */
export function synonymsFor(href: string): readonly string[] {
  if (Object.hasOwn(TAB_SYNONYMS, href)) return TAB_SYNONYMS[href];
  const base = href.replace(/&view=[^&]*/, '');
  return Object.hasOwn(TAB_SYNONYMS, base) ? TAB_SYNONYMS[base] : [];
}

/** GST page groups (the four rows of tabs) and the words that name every tab in them. */
export const GST_GROUP_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  gstr1: ['gstr1', 'gstr-1', 'r1', 'outward supplies'],
  gstr3b: ['gstr3b', 'gstr-3b', '3b'],
  recon: ['reconciliation', 'itc'],
  tools: ['gst tools'],
};
