/**
 * R6-B1: the tab lists of the pages with tabs, moved out of the pages (no behaviour change) so Ctrl+K can index every
 * tab without loading page code (`src/lib/palette/tab-index.ts`). One data-only module on purpose: shared by the pages
 * and the palette, it is one small lazy chunk instead of one per page (each chunk name costs first-paint bytes in the
 * preload map). Type imports only. The TDS list stays in `Tds.tsx` and the GST list in `src/lib/gst-tabs.ts`.
 */
import type { AccessAction } from '../lib/access';

/* ── Books ── */
export const BOOKS_TABS = [
  { id: 'day', label: 'tabDay' },
  { id: 'cash', label: 'tabCash' },
  { id: 'vch', label: 'tabVch' },
  { id: 'ledger', label: 'tabLedger' },
  { id: 'tb', label: 'tabTb' },
  { id: 'pnl', label: 'tabPnl' },
  { id: 'bs', label: 'tabBs' },
  { id: 'cf', label: 'tabCf' },
  { id: 'rpt', label: 'tabRpt' },
  { id: 'proj', label: 'tabProj' },
  { id: 'budget', label: 'tabBudget' },
  { id: 'coa', label: 'tabCoa' },
  { id: 'fcst', label: 'tabFcst' },
  { id: 'fx', label: 'tabFx' },
  { id: 'billwise', label: 'tabBillwise' },
  { id: 'vreg', label: 'tabVreg' },
  { id: 'ratio', label: 'tabRatio' },
  { id: 'defer', label: 'tabDefer' }, // R2-C2 (label from the books-r2 area)
  { id: 'funds', label: 'tabFunds', pack: 'nonprofit', alsoPacks: ['society'] }, // R5-C4 (label in Books.tsx); R18-A: + society
] as const;
export type BooksTab = (typeof BOOKS_TABS)[number]['id'];
/* ── Manufacturing ── */
export type MfgTab = 'boms' | 'mfg' | 'journal' | 'physical' | 'jobwork' | 'rejections' | 'plan' | 'reorder' | 'reports' | 'orders' | 'costing' | 'trace' | 'qc' | 'landed';
export const MFG_TABS: readonly MfgTab[] = ['boms', 'mfg', 'orders', 'journal', 'physical', 'jobwork', 'rejections', 'plan', 'costing', 'trace', 'qc', 'landed', 'reorder', 'reports'];
/** R13 (MF-A1): manufacturing desks, one tab per pack (views in `&view=`; packages never edit these rows). */
export const MFG_PACK_TABS = [
  { id: 'floor', pack: 'shopfloor' }, // MF-A: views centres / routings / cards / load / wip (wip: MF-D)
  { id: 'shop', pack: 'fabrication' }, // MF-B: views drawings / quotes / inspection / scrap
  { id: 'moulding', pack: 'plastics' }, // MF-B: views runs / balance / epr
  { id: 'press', pack: 'press' }, // MF-B: views estimates / tickets / paper
  { id: 'garments', pack: 'garments' }, // MF-C: views styles / cutplans / bundles / cmt / karigars
  { id: 'food', pack: 'foodmfg' }, // MF-D: views costcards / shelflife / schemes
  { id: 'statutory', pack: 'shopfloor' }, // MF-D: views msme / incentives / authorisations / inventories
] as const;
export type MfgPackTab = (typeof MFG_PACK_TABS)[number]['id'];
/* ── Payroll ── */
export const PAYROLL_TABS = ['employees', 'heads', 'structures', 'attendance', 'leave', 'run', 'arrears', 'extras', 'loans', 'payments', 'fnf', 'reports', 'more'] as const;
export type PayrollTab = (typeof PAYROLL_TABS)[number];
/* ── Expenses ── */
export const EXPENSES_TABS = ['bills', 'orders', 'vendors', 'returns', 'inbox'] as const;
export type ExpensesTab = (typeof EXPENSES_TABS)[number];
/* ── Receivables ── */
export const RECEIVABLES_TABS = [
  { id: 'aging' },
  { id: 'statements' },
  { id: 'followups' }, // R2-A4
  { id: 'collections' },
  { id: 'advances' },
  { id: 'tds' },
  { id: 'giftvouchers' }, // R4-B1
  { id: 'marketplace', pack: 'marketplace' }, // R5-A
  { id: 'donations', pack: 'nonprofit' }, // R5-C
  { id: 'interest' }, // R8-A (TR-A4)
  { id: 'deliveries' }, // R9 (RT-A3): home-delivery board and rider cash
  { id: 'realty', pack: 'realty' }, // R11 (CN-A1): builders' desk (screens in CN-C)
] as const;
export type ReceivablesTab = (typeof RECEIVABLES_TABS)[number]['id'];
/* ── Reports ── */
export const REPORTS_TABS = [
  { id: 'customers', label: 'tabCustomers' },
  { id: 'items', label: 'tabItems' },
  { id: 'monthly', label: 'tabMonthly' },
  { id: 'top', label: 'tabTop' },
  { id: 'tax', label: 'tabTax' },
  { id: 'payments', label: 'tabPayments' },
  { id: 'expenses', label: 'tabExpenses' },
  { id: 'profit', label: 'tabProfit' },
  { id: 'party', label: 'tabParty' },
  { id: 'stockstatement', label: 'tabStockStatement' }, // R8-C (TR-C4, lazy tab)
] as const;
export type ReportsTab = (typeof REPORTS_TABS)[number]['id'];
/* ── Inventory ── */
export type InventoryTab = 'summary' | 'movement' | 'dead' | 'margin' | 'batches' | 'godowns' | 'transfers' | 'serials' | 'query' | 'orders' | 'analysis' | 'depth' | 'expiry' | 'hsn' | 'shortbook';
export const INVENTORY_TABS: readonly InventoryTab[] = ['summary', 'movement', 'dead', 'margin', 'batches', 'godowns', 'transfers', 'serials', 'query', 'orders', 'analysis', 'depth', 'expiry', 'hsn', 'shortbook']; // 'hsn': R8-C (TR-C4); 'shortbook': R9 (RT-A4)
/** R9 (RT-A1): the retail pack desks on Inventory, one tab per pack (listed through `visibleTabs`; views in `&view=`). */
export const INVENTORY_PACK_TABS = [
  { id: 'pharmacy', pack: 'pharmacy' }, // RT-B: views rx / doctors / registers / refills / prices
  { id: 'apparel', pack: 'apparel' }, // RT-C: views matrix / alterations / bands
  { id: 'devices', pack: 'electronics' }, // RT-D: views imei / finance / buyback / service
  { id: 'jewellery', pack: 'jewellery' }, // RT-E: views rates / tags / oldgold / karigar
  // R12 (AG-A1): agri desks, one tab per pack (packages never edit these rows)
  { id: 'farm', pack: 'agri' }, // AG-A: views farmers / vouchers / cycles / quality / batches
  { id: 'dairy', pack: 'dairy' }, // AG-B: views charts / collection / bills / dispatch / products / cards
  { id: 'mill', pack: 'mill' }, // AG-C: views intake / batches / cmr / yield
  { id: 'cold', pack: 'coldstore' }, // AG-D: views lots / gatepasses / rent / loans / chambers
  { id: 'inputs', pack: 'agri_inputs' }, // AG-D: views licences / subsidy / credit
  { id: 'members', pack: 'fpo' }, // AG-D: views register / shares / patronage / papers
] as const;
export type InventoryPackTab = (typeof INVENTORY_PACK_TABS)[number]['id'];
/* ── Distribution ── */
export const DISTRIBUTION_TABS = [
  { id: 'masters' },
  { id: 'reports' },
  { id: 'plan' },
  { id: 'van' },
  { id: 'orders' },
  { id: 'credit' },
  { id: 'transport', pack: 'transport' }, // R5-B
  // R8: trading packs (`visiblePackTabs` in industry-packs.ts reads `alsoPacks`)
  { id: 'claims', pack: 'distributor' }, // R8-A (views schemes / pricedrop / claims)
  { id: 'packaging', pack: 'distributor', alsoPacks: ['commodity', 'agency'] }, // R8-A
  { id: 'mandi', pack: 'commodity', alsoPacks: ['agency'] }, // R8-B
  { id: 'brokers', pack: 'commodity', alsoPacks: ['agency'] }, // R8-B
  { id: 'agency', pack: 'agency' }, // R8-C (views arrivals / pattis / indents)
] as const;
export type DistributionTab = (typeof DISTRIBUTION_TABS)[number]['id'];
/* ── Time ── */
export const TIME_TABS = [
  { id: 'timesheet' },
  { id: 'mileage' },
  { id: 'billing' },
  { id: 'projects' },
  { id: 'retainers' },
  { id: 'settings' },
  { id: 'works', pack: 'works' }, // R5-B
  // R10: service desks (listed through `visiblePackTabs`; views in `&view=`)
  { id: 'appointments', pack: 'clinic', alsoPacks: ['salon', 'fitness', 'workshop'] }, // SV-A2: views day / week / queue / birthdays
  { id: 'commission', pack: 'salon', alsoPacks: ['fitness', 'clinic', 'workshop'] }, // SV-A3: views staff / plans / statement
  { id: 'clinic', pack: 'clinic' }, // SV-B: views patients / opd / ipd / lab / tests / referrals / rates
  { id: 'members', pack: 'fitness', alsoPacks: ['salon'] }, // SV-C: views plans / members / checkin / classes / recipes
  { id: 'workshop', pack: 'workshop' }, // SV-D: views jobs / estimates / claims / reminders / labour / vehicles
  // R14: professional desks (one lazy chunk each; views in `&view=`). B / C / D append clientmoney, exportsvc, firm, cadesk.
  { id: 'matters', pack: 'practice' }, // PS-A2: views matters / engagements / conflicts / letters
  { id: 'wip', pack: 'practice' }, // PS-A3 / A4: views wip / prebill / realisation / utilisation / profit / yearend
  { id: 'firm', pack: 'partners', alsoPacks: ['practice'] }, // PS-D1–D4: views partners / appropriation / tds194t / presumptive / tds194j
  { id: 'cadesk', pack: 'cafirm' }, // PS-D5: views events / fees / udin
  { id: 'clientmoney', pack: 'legal', alsoPacks: ['cafirm'] }, // PS-B3: views ledger / reconcile / statements
  { id: 'exportsvc', pack: 'svcexport' }, // PS-C: views checker / edf / realisation / refund / platforms
  // R15: the Trips desk (one lazy chunk; views trips / bookings (B), statements (C), tcs / events (D) in `&view=`)
  { id: 'trips', pack: 'travel', alsoPacks: ['events'] },
  // R17: the Deploy desk (one lazy chunk; views sites (A), muster / bills (B), compliance / profit (C), statutory (D))
  { id: 'deploy', pack: 'manpower', alsoPacks: ['security'] },
] as const;
export type TimeTab = (typeof TIME_TABS)[number]['id'];
/* ── Recurring ── */
export const RECURRING_TABS = [
  { id: 'schedules' },
  { id: 'batch' },
  { id: 'fees', pack: 'fees' }, // R5-C
  { id: 'leases', pack: 'leases' }, // R5-C
  { id: 'society', pack: 'society' }, // R18-A: the Society desk (views in `&view=`; packages add views, never tabs)
] as const;
export type RecurringTab = (typeof RECURRING_TABS)[number]['id'];
/* ── Reconcile ── */
export const RECONCILE_TABS = [
  { id: 'reconcile', label: 'tabReconcile' },
  { id: 'brs', label: 'tabBrs' },
  { id: 'statements', label: 'tabStatements' },
  { id: 'import', label: 'tabImport' },
  { id: 'documents', label: 'tabDocuments' },
  { id: 'rules', label: 'tabRules' },
] as const;
export type ReconcileTab = (typeof RECONCILE_TABS)[number]['id'];
/* ── Settings ── */
export type SettingsTab = 'business' | 'items' | 'fields' | 'defaults' | 'features' | 'data' | 'activity' | 'security';
/** `need`: local roles (6.21) — a clerk or viewer sees only the tabs their role may use. */
export const SETTINGS_TABS = [
  { id: 'business', label: 'tabBusiness', need: 'settings.manage' },
  { id: 'items', label: 'tabItems', need: 'master.edit' },
  { id: 'fields', label: 'tabFields', need: 'settings.manage' },
  { id: 'defaults', label: 'tabDefaults', need: 'settings.manage' },
  { id: 'features', label: 'tabFeatures', need: 'view' }, // R6-B5: owner switches; others read it
  { id: 'data', label: 'tabData', need: 'data.restore' },
  { id: 'activity', label: 'tabActivity', need: 'view' },
  { id: 'security', label: 'tabSecurity', need: 'view' },
] as const satisfies readonly { id: SettingsTab; label: string; need: AccessAction }[];
