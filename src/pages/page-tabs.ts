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
  { id: 'funds', label: 'tabFunds', pack: 'nonprofit' }, // R5-C4 (label in Books.tsx)
] as const;
export type BooksTab = (typeof BOOKS_TABS)[number]['id'];
/* ── Manufacturing ── */
export type MfgTab = 'boms' | 'mfg' | 'journal' | 'physical' | 'jobwork' | 'rejections' | 'plan' | 'reorder' | 'reports' | 'orders' | 'costing' | 'trace' | 'qc' | 'landed';
export const MFG_TABS: readonly MfgTab[] = ['boms', 'mfg', 'orders', 'journal', 'physical', 'jobwork', 'rejections', 'plan', 'costing', 'trace', 'qc', 'landed', 'reorder', 'reports'];
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
export type InventoryTab = 'summary' | 'movement' | 'dead' | 'margin' | 'batches' | 'godowns' | 'transfers' | 'serials' | 'query' | 'orders' | 'analysis' | 'depth' | 'expiry' | 'hsn';
export const INVENTORY_TABS: readonly InventoryTab[] = ['summary', 'movement', 'dead', 'margin', 'batches', 'godowns', 'transfers', 'serials', 'query', 'orders', 'analysis', 'depth', 'expiry', 'hsn']; // 'hsn': R8-C (TR-C4)
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
] as const;
export type TimeTab = (typeof TIME_TABS)[number]['id'];
/* ── Recurring ── */
export const RECURRING_TABS = [
  { id: 'schedules' },
  { id: 'batch' },
  { id: 'fees', pack: 'fees' }, // R5-C
  { id: 'leases', pack: 'leases' }, // R5-C
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
