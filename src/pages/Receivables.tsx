import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { mailtoLink, whatsappLink } from '../lib/share';
import { messageLangOf } from '../lib/message-langs';
import { buildWhatsAppStatement } from '../lib/khata';
import { khataT } from '../i18n/areas/khata';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Ban, BellRing, ChevronRight, NotebookPen, Clock, Copy, Download, FileStack, FileText, ListChecks, Mail, MessageCircle, Percent, Printer, Scale, Send, Wallet,
  type LucideIcon,
} from 'lucide-react';
import { localDb } from '../lib/localDb';
import { can } from '../lib/access';
import { uxT } from '../i18n/areas/invoicing-ux';
import { rcv2T as colT } from '../i18n/areas/collections-rcv';
import { STATEMENT_STYLES, loadStatementPrefs, saveStatementPrefs, type StatementStyle } from '../lib/statement-styles';
import type { Client, InvoiceRecord, Payment } from '../types/invoice';
import { KEYS, getTable, peekTable } from '../lib/storage';
import type { CreditLinkRow } from '../lib/amount-due';
import type { PosReturn } from '../lib/pos-returns';
import type { AdvanceRecord } from '../types/advances';
import { loadReceivableOpeningBills } from '../lib/opening-bills';
import { createLateFeeInvoice, describeClientLateFee, lateFeeRuleFor, type ClientLateFee } from '../lib/late-fee';
import {
  AGING_BUCKETS, agingCsv, buildLedger, buildReceivables, buildStatementText, computeDso,
  currenciesIn, debtorShare, monthlyCollections, overallEfficiency, posRefunds, topDebtors,
  type PartyReceivable, type ReceiptRow,
} from '../lib/receivables';
import { formatMoney, formatCurrency, formatDate, todayInput, toDateInput } from '../lib/utils';
import { EmptyState } from '../components/ui/EmptyState';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { useToast } from '../components/ui/useToast';
import { useT } from '../i18n';
import '../i18n/en-pages'; // page strings (5.4)
import { bucketLabel, rcvT } from '../i18n/areas/receivables';
import { printT } from '../i18n/areas/printing';
import { AgingStack, CollectionsChart, ShareBar, AgeChip } from '../components/receivables/Charts';
import { StatementViewer } from '../components/receivables/StatementViewer';
import { downloadTextFile } from '../components/receivables/exportUtils';
import { VirtualGap } from '../components/ui/VirtualGap';
import { useVirtualRows } from '../hooks/useVirtualRows';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import styles from './Receivables.module.css';
import { defineArea } from '../i18n/area';
import { visibleTabs, type PackId } from '../lib/industry-packs'; // R5-A
import { RECEIVABLES_TABS, type ReceivablesTab } from './page-tabs'; // R6-B1

// The TDS register, its 26AS parser and Form 16A tracking load only when opened.
// Bulk statements / confirmation letters (WP-4): loaded with the PDF stack only when opened.
const BulkStatements = lazy(() => import('../components/receivables/BulkStatements').then((m) => ({ default: m.BulkStatements })));
const TdsTab = lazy(() => import('../components/receivables/TdsTab'));
// Advance receipts (5.3): register, vouchers, apply / refund — loaded when opened.
const AdvancesTab = lazy(() => import('../components/advances/AdvancesTab'));
// Daily khata loop (8A): quick ₹ Received / ₹ Given and the party reminder queue, loaded on first use.
const QuickEntrySheet = lazy(() => import('../components/khata/QuickEntrySheet'));
const RemindQueue = lazy(() => import('../components/khata/RemindQueue'));
// 8.106: bulk remind / write-off on the filtered ageing list.
const ReceivablesBulk = lazy(() => import('../components/invoicing-ux/ReceivablesBulk'));
// Round 2 (R2-A): follow-ups & promises, write-off register / single write-off, party timeline — loaded on use.
const FollowUpsTab = lazy(() => import('../components/collections/FollowUpsTab'));
const FollowUpDialog = lazy(() => import('../components/collections/FollowUpDialog'));
const WriteOffRegister = lazy(() => import('../components/collections/WriteOffRegister'));
const WriteOffDialog = lazy(() => import('../components/collections/WriteOffDialog'));
const PartyTimeline = lazy(() => import('../components/collections/PartyTimeline'));

// R4-B1: gift vouchers (a customer liability, like advances) — sell, register, breakage; loaded when opened.
const GiftVouchersPanel = lazy(() => import('../components/retail/GiftVouchersPanel'));
const gvTabT = defineArea({ tab: 'Gift vouchers' } as const, { tab: 'गिफ़्ट वाउचर' });

// R5-A: marketplace seller pack (channels, imports, settlements, TCS / TDS credit, returns) — listed only with the pack on.
const MarketplaceTab = lazy(() => import('../components/marketplace/MarketplaceTab'));
const mpTabT = defineArea({ tab: 'Marketplace' } as const, { tab: 'मार्केटप्लेस' });
// R5-C: donations (non-profit pack) — 80G / 35 receipts, Form 10BD / 10BE.
const DonationsTab = lazy(() => import('../components/institutions/r5c-lazy').then((l) => l.r5c()).then((m) => ({ default: m.DonationsTab })));
const donTabT = defineArea({ tab: 'Donations' } as const, { tab: 'दान' });
// R8-A (TR-A4): party-wise interest on overdue bills and bulk interest invoices (every business, lazy).
const InterestTab = lazy(() => import('../components/trade/InterestTab'));
const intTabT = defineArea({ tab: 'Interest', deliveries: 'Deliveries' } as const, { tab: 'ब्याज', deliveries: 'डिलीवरी' });
// R9 (RT-A3): home-delivery board, riders and rider cash settlement (every business, lazy).
const DeliveriesTab = lazy(() => import('../components/retail-r9/rt-a-hub').then((m) => ({ default: m.DeliveriesTab })));
// R11 (CN-C): the builders' desk (pack `realty`): projects, units, bookings, plans, demands, RERA, cancellations, 80% test.
const RealtyDesk = lazy(() => import('../components/construction/RealtyDesk'));
const realtyT = defineArea({ tab: 'Realty' } as const, { tab: 'रियल्टी' });

type Tab = ReceivablesTab;
// R6-B1: the ids (and packs) live in receivables-tabs.ts; the labels stay here.
const TAB_LABEL: Record<Tab, () => string> = {
  aging: () => rcvT('tabAging'),
  statements: () => rcvT('tabStatements'),
  followups: () => colT('tabFollowups'), // R2-A4
  collections: () => rcvT('tabCollections'),
  advances: () => rcvT('tabAdvances'),
  tds: () => rcvT('tabTds'),
  giftvouchers: () => gvTabT('tab'), // R4-B1
  marketplace: () => mpTabT('tab'), // R5-A
  donations: () => donTabT('tab'), // R5-C
  interest: () => intTabT('tab'), // R8-A
  deliveries: () => intTabT('deliveries'), // R9 (RT-A3)
  realty: () => realtyT('tab'), // R11 (CN-A1)
};
const TABS: { id: Tab; label: () => string; pack?: PackId }[] = RECEIVABLES_TABS.map((t) => ({ ...t, label: TAB_LABEL[t.id] }));

/** 1 April of the Indian financial year containing `d`. */
function fyStart(d: Date): Date {
  return new Date(d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1, 3, 1);
}

/*
 * PERF-2: invoices / receipts / clients / links are the shared, parsed-once rows (`peekTable`). This screen and
 * the panels it feeds only read them (writes go through localDb / the collections APIs by id, then reload), so
 * they are typed as plain arrays for the existing props but must never be mutated.
 */
const shared = <T,>(name: string) => peekTable<T>(name) as T[];

function loadData() {
  const clients = shared<Client>(KEYS.clients);
  return {
    invoices: shared<InvoiceRecord>(KEYS.invoices),
    payments: shared<ReceiptRow>(KEYS.transactions),
    clients,
    advances: getTable<AdvanceRecord>('advances'),
    // Credit notes allocated to the invoice they were raised against (src/lib/amount-due.ts).
    links: shared<CreditLinkRow>('doc_links'),
    // Bill-wise opening outstandings (WP-1 masters): age and appear in statements like invoices.
    openingBills: loadReceivableOpeningBills(clients),
    // POS refunds / exchanges pay a credit note back (QA-3 F2).
    refunds: posRefunds(getTable<PosReturn>('pos_returns')),
  };
}

export function Receivables() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(loadData);
  const { notify, toastNode } = useToast();
  const { t } = useT();

  useEffect(() => {
    // Window focus: keep the same data object (and every memo on it) when no table changed.
    const refresh = () => setData((prev) => {
      const next = loadData();
      const same = next.invoices === prev.invoices && next.payments === prev.payments && next.clients === prev.clients && next.links === prev.links
        && JSON.stringify([next.advances, next.openingBills, next.refunds]) === JSON.stringify([prev.advances, prev.openingBills, prev.refunds]);
      return same ? prev : next;
    });
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  const tab: Tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'aging');
  // R5-A: pack tabs show only with their pack on (a pack tab opened by URL stays listed while it is shown).
  const shownTabs = useMemo(() => visibleTabs(TABS, localDb.settings.get(), tab), [tab]);
  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next, { replace: true });
  };

  const currencies = useMemo(() => currenciesIn(data.invoices), [data.invoices]);
  const [currencyPick, setCurrencyPick] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAct, setBulkAct] = useState(false);
  const [queue, setQueue] = useState<'overdue' | 'balance' | null>(null);
  const currency = currencyPick || currencies[0] || 'INR';

  const now = useMemo(() => new Date(), []);
  const report = useMemo(() => buildReceivables(data, { currency, now }), [data, currency, now]);
  const months = useMemo(() => monthlyCollections(report, 12, now), [report, now]);
  const dso = useMemo(() => computeDso(report, 90, now), [report, now]);
  const efficiency = overallEfficiency(months);
  const fmt = (n: number) => formatCurrency(n, currency);
  // R2-A7: how each party usually pays (settled bills of the last 12 months, promises kept / broken) — loaded
  // after the screen renders so the route chunk stays small.
  const [extras, setExtras] = useState<typeof import('../components/collections/aging-extras') | null>(null);
  useEffect(() => {
    import('../components/collections/aging-extras').then((m) => setExtras(m)).catch(() => undefined);
  }, []);
  const scores = useMemo(
    () => (extras ? extras.computeScores({ invoices: data.invoices, payments: data.payments as Payment[], links: data.links, clients: data.clients }, toDateInput(now)) : null),
    [extras, data, now],
  );
  const badge = (key: string): ReactNode => (extras && scores ? <extras.PaymentScoreBadge score={scores.get(key)} /> : null);

  // Per-client late-fee terms (roadmap 6.15): overdue bills of such clients get "Add late fee",
  // which creates a NEW draft invoice; the overdue one is never edited.
  const navigate = useNavigate();
  const lateFeeRules = useMemo(() => {
    const raised = new Set(data.invoices.filter((i) => i.late_fee_for && i.status !== 'Cancelled').map((i) => i.late_fee_for));
    const m = new Map<string, ClientLateFee>();
    for (const inv of data.invoices) {
      if (raised.has(inv.id)) continue;
      const rule = lateFeeRuleFor(inv, data.clients);
      if (rule) m.set(inv.id, rule);
    }
    return m;
  }, [data]);
  const addLateFee = (invoiceId: string) => {
    const inv = data.invoices.find((i) => i.id === invoiceId);
    if (!inv) return;
    try {
      const saved = createLateFeeInvoice(inv);
      notify(rcvT('lateFeeCreated', { number: saved.invoice_number }));
      navigate(`/invoice/${saved.id}`);
    } catch (err) {
      notify((err as Error).message || rcvT('lateFeeFailed'), 'error');
    }
  };

  if (report.parties.length === 0 && tab !== 'advances' && tab !== 'giftvouchers') {
    return (
      <div className={surface.page}>
        <Header />
        <div className={surface.card}>
          <EmptyState
            icon={Scale}
            title={t('list.rcvEmptyTitle')}
            text={t('list.rcvEmptyText')}
            action={
              <>
                {can('doc.create') && <Link to="/invoice" className={`${controls.btn} ${controls.btnPrimary}`}>{t('list.rcvCreate')}</Link>}{' '}
                {can('payment.record') && <Link to="/receivables?tab=advances" className={`${controls.btn} ${controls.btnOutline}`}>{t('list.rcvAdvance')}</Link>}
              </>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className={surface.page}>
      <Header>
        {currencies.length > 1 && (
          <label className={styles.inline}>
            <span className={controls.label}>{rcvT('currency')}</span>
            <select className={controls.select} value={currency} onChange={(e) => setCurrencyPick(e.target.value)}>
              {currencies.map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
        )}
        <button type="button" className={`${controls.btn} ${controls.btnOutline}`}
          onClick={() => downloadTextFile(`Receivables_aging_${todayInput()}.csv`, agingCsv(report))}>
          <Download size={16} /> {rcvT('exportCsv')}
        </button>
        <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => setBulkOpen(true)} disabled={report.parties.length === 0}>
          <FileStack size={16} /> {printT('bulkStatements')}
        </button>
        {currency === 'INR' && (
          <>
            <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => setQueue('overdue')} disabled={report.totals.overdue <= 0}>
              <BellRing size={16} /> {khataT('remindAll')}
            </button>
            <button type="button" className={`${controls.btn} ${controls.btnGhost}`} onClick={() => setQueue('balance')} disabled={report.totals.net <= 0}>
              <Send size={16} /> {khataT('sendBalances')}
            </button>
            {can('payment.record') && (
              <button type="button" className={`${controls.btn} ${controls.btnGhost}`} onClick={() => setBulkAct(true)} disabled={report.totals.billCount === 0} data-receivables-bulk-open>
                <ListChecks size={16} /> {uxT('bkOpenBtn')}
              </button>
            )}
          </>
        )}
      </Header>
      {bulkAct && (
        <Suspense fallback={null}>
          <ReceivablesBulk report={report} invoices={data.invoices} onClose={() => setBulkAct(false)} onDone={(m) => { notify(m, 'success'); setData(loadData()); }} />
        </Suspense>
      )}
      {queue && (
        <Suspense fallback={null}>
          <RemindQueue kind={queue} onClose={() => setQueue(null)} />
        </Suspense>
      )}
      {bulkOpen && (
        <Suspense fallback={null}>
          <BulkStatements parties={report.parties} clients={data.clients} sender={localDb.settings.activeProfile()} currency={currency}
            defaultFrom={toDateInput(fyStart(now))} defaultTo={toDateInput(now)} onClose={() => setBulkOpen(false)} />
        </Suspense>
      )}

      <div className={surface.statGrid}>
        <Stat label={rcvT('netOutstanding')} value={fmt(report.totals.net)} icon={Wallet}
          hint={
            // QA-3 F15: the Dashboard's "Outstanding" is the open bills; say how net differs from it.
            report.totals.creditNotes + report.totals.advances > 0.004
              ? rcvT('netOfCredits', { gross: fmt(report.totals.gross), credits: fmt(report.totals.creditNotes + report.totals.advances) })
              : report.totals.billCount === 1 ? rcvT('openBillsOne') : rcvT('openBillsMany', { n: report.totals.billCount })
          } />
        <Stat label={rcvT('overdue')} value={fmt(report.totals.overdue)} icon={AlertTriangle} tone="loss"
          hint={report.totals.gross > 0 ? rcvT('pctOfOpen', { pct: Math.round((report.totals.overdue / report.totals.gross) * 100) }) : rcvT('allClear')} />
        <Stat label={rcvT('dso')} value={dso === null ? '—' : rcvT('days', { n: dso })} icon={Clock}
          hint={rcvT('dsoHint')} />
        <Stat label={rcvT('efficiency')} value={efficiency === null ? '—' : `${efficiency}%`} icon={Percent}
          hint={rcvT('efficiencyHint')} />
      </div>

      <div className={styles.tabs} role="tablist" aria-label={rcvT('tabsAria')}>
        {shownTabs.map((t) => (
          <button key={t.id} type="button" role="tab" id={`rcv-tab-${t.id}`} aria-selected={tab === t.id}
            aria-controls={`rcv-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? styles.tabActive : styles.tab} onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const i = shownTabs.findIndex((x) => x.id === t.id);
              const next = shownTabs[(i + (e.key === 'ArrowRight' ? 1 : shownTabs.length - 1)) % shownTabs.length];
              setTab(next.id);
              requestAnimationFrame(() => document.getElementById(`rcv-tab-${next.id}`)?.focus());
            }}>
            {t.label()}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`rcv-panel-${tab}`} aria-labelledby={`rcv-tab-${tab}`}>
        {tab === 'aging' && <AgingTab report={report} currency={currency} fmt={fmt} lateFeeRules={lateFeeRules} onLateFee={addLateFee} clients={data.clients}
          badge={badge} notify={notify} onChanged={() => setData(loadData())}
          onStatement={(p) => { const n = new URLSearchParams(params); n.set('tab', 'statements'); n.set('party', p.key); setParams(n, { replace: true }); }} />}
        {tab === 'statements' && <StatementsTab report={report} data={data} currency={currency} now={now}
          partyKey={params.get('party') ?? ''} onPick={(k) => { const n = new URLSearchParams(params); n.set('party', k); setParams(n, { replace: true }); }}
          notify={notify} onChanged={() => setData(loadData())} badge={badge} />}
        {tab === 'followups' && (
          <Suspense fallback={null}>
            <FollowUpsTab report={report} invoices={data.invoices} payments={data.payments as Payment[]} clients={data.clients} notify={notify} />
          </Suspense>
        )}
        {tab === 'collections' && (
          <div className={surface.card}>
            <div className={surface.cardHead}><h2 className={styles.h2}>{rcvT('billedVsReceived')}</h2></div>
            <div className={surface.cardBody}>
              <CollectionsChart rows={months} currency={currency} />
            </div>
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <caption className={surface.srOnly}>{rcvT('monthlyCollections')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{rcvT('month')}</th><th scope="col" className={surface.numeric}>{rcvT('billed')}</th>
                    <th scope="col" className={surface.numeric}>{rcvT('creditNotes')}</th>
                    <th scope="col" className={surface.numeric}>{rcvT('received')}</th>
                    <th scope="col" className={surface.numeric}>{rcvT('efficiencyCol')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...months].reverse().map((r) => (
                    <tr key={r.month}>
                      <td>{formatDate(`${r.month}-01`).replace(/^1 /, '')}</td>
                      <td className={surface.numeric}>{formatMoney(r.billed, currency)}</td>
                      <td className={surface.numeric}>{r.credited ? formatMoney(r.credited, currency) : '—'}</td>
                      <td className={surface.numeric}>{formatMoney(r.received, currency)}</td>
                      <td className={surface.numeric}>{r.efficiency === null ? '—' : `${r.efficiency}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {tab === 'collections' && (
          <Suspense fallback={null}>
            <WriteOffRegister notify={notify} onChanged={() => setData(loadData())} />
          </Suspense>
        )}
        {tab === 'advances' && (
          <Suspense fallback={<div className={surface.card}><p className={styles.note}>{rcvT('loadingAdvances')}</p></div>}>
            <AdvancesTab partyKey={params.get('party') ?? ''} notify={notify} onChanged={() => setData(loadData())} />
          </Suspense>
        )}
        {tab === 'tds' && (
          <Suspense fallback={<div className={surface.card}><p className={styles.note}>{rcvT('loadingTds')}</p></div>}>
            <TdsTab data={data} notify={notify} />
          </Suspense>
        )}
        {tab === 'giftvouchers' && <Suspense fallback={null}><GiftVouchersPanel /></Suspense>}
        {tab === 'marketplace' && <Suspense fallback={<div className={surface.card}><p className={styles.note}>…</p></div>}><MarketplaceTab notify={notify} /></Suspense>}
        {tab === 'donations' && <Suspense fallback={null}><DonationsTab notify={notify} /></Suspense>}
        {tab === 'deliveries' && <Suspense fallback={null}><DeliveriesTab onDone={(m, e) => notify(m, e ? 'error' : 'success')} /></Suspense>}
        {tab === 'realty' && <Suspense fallback={null}><div className={surface.card}><RealtyDesk onDone={notify} /></div></Suspense>}
        {tab === 'interest' && <Suspense fallback={null}><div className={surface.card}><InterestTab onDone={(m, e) => notify(m, e ? 'error' : 'success')} /></div></Suspense>}
      </div>
      {toastNode}
    </div>
  );
}

function Header({ children }: { children?: ReactNode }) {
  return (
    <PageHeader
      title={rcvT('title')}
      subtitle={rcvT('subtitle')}
      actions={children}
    />
  );
}

function Stat({ label, value, hint, icon, tone }: {
  label: string; value: string; hint: string; icon: LucideIcon; tone?: 'loss';
}) {
  return <StatCard label={label} value={value} hint={hint} icon={icon} tone={tone} />;
}

/* ── Aging ────────────────────────────────────────────────────── */

function AgingTab({ report, currency, fmt, onStatement, lateFeeRules, onLateFee, clients, badge, notify, onChanged }: {
  report: ReturnType<typeof buildReceivables>;
  clients: ReturnType<typeof loadData>['clients'];
  badge: (partyKey: string) => ReactNode;
  notify: (m: string, tone?: 'success' | 'error' | 'info') => void;
  onChanged: () => void;
  currency: string;
  fmt: (n: number) => string;
  onStatement: (p: PartyReceivable) => void;
  lateFeeRules: Map<string, ClientLateFee>;
  onLateFee: (invoiceId: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const sender = useMemo(() => localDb.settings.activeProfile(), []);
  const [followUp, setFollowUp] = useState<PartyReceivable | null>(null);
  const [writeOff, setWriteOff] = useState<{ party: PartyReceivable; bill: PartyReceivable['bills'][number] } | null>(null);
  const modeOf = (p: PartyReceivable) => clients.find((x) => (p.clientId && x.id === p.clientId) || x.name?.trim().toLowerCase() === p.name.trim().toLowerCase())?.reminder_mode;
  // WhatsApp statement per party row (8.3): wa.me with open bills, net due and a upi:// link.
  const waHref = (p: PartyReceivable) => {
    const c = clients.find((x) => (p.clientId && x.id === p.clientId) || x.name?.trim().toLowerCase() === p.name.trim().toLowerCase());
    return whatsappLink(c?.phone, buildWhatsAppStatement({ sender, party: p, lang: messageLangOf(c) }));
  };
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const top = topDebtors(report, 5);
  const m = (n: number) => (n ? formatMoney(n, currency) : '—');

  // Long party lists mount only the rows in view; an expanded party's bill row is measured with it.
  const partyKeys = useMemo(() => report.parties.map((p) => p.key), [report.parties]);
  const virtual = useVirtualRows(partyKeys, { estimate: 49 });
  // aria-rowindex must count the expanded detail rows above each party (header row is 1).
  const ariaIndex = useMemo(() => {
    const out: number[] = [];
    let next = 2;
    for (const p of report.parties) {
      out.push(next);
      next += open.has(p.key) && p.bills.length > 0 ? 2 : 1;
    }
    return { rows: out, total: next };
  }, [report.parties, open]);

  return (
    <div className={styles.stack}>
      <div className={surface.card}>
        <div className={surface.cardHead}><h2 className={styles.h2}>{rcvT('byAge')}</h2></div>
        <div className={surface.cardBody}><AgingStack buckets={report.totals.buckets} currency={currency} /></div>
      </div>

      {top.length > 0 && (
        <div className={surface.card}>
          <div className={surface.cardHead}><h2 className={styles.h2}>{rcvT('topDebtors')}</h2></div>
          <ol className={styles.debtors}>
            {top.map((p) => (
              <li key={p.key} className={styles.debtor}>
                <div className={styles.debtorTop}>
                  <button type="button" className={styles.linkBtn} onClick={() => onStatement(p)}>{p.name}</button>
                  <strong className={styles.amt}>{fmt(p.net)}</strong>
                </div>
                <ShareBar percent={debtorShare(report, p)} />
                <span className={surface.statHint}>
                  {rcvT('shareOf', { pct: debtorShare(report, p) })}{p.oldestOverdueDays > 0 ? rcvT('oldest', { n: p.oldestOverdueDays }) : ''}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className={surface.card}>
        <div className={surface.cardHead}><h2 className={styles.h2}>{rcvT('partyWise')}</h2></div>
        <div className={surface.tableWrap}>
          <table className={`${surface.table} ${styles.agingTable}`} aria-rowcount={virtual.enabled ? ariaIndex.total : undefined}>
            <caption className={surface.srOnly}>{rcvT('agingCaption')}</caption>
            <thead>
              <tr aria-rowindex={virtual.enabled ? 1 : undefined}>
                <th scope="col">{rcvT('party')}</th>
                {AGING_BUCKETS.map((b) => <th key={b} scope="col" className={surface.numeric}>{bucketLabel(b)}</th>)}
                <th scope="col" className={surface.numeric}>{rcvT('credits')}</th>
                <th scope="col" className={surface.numeric}>{rcvT('net')}</th>
              </tr>
            </thead>
            <tbody {...virtual.bodyProps}>
              {virtual.slots.map((slot) => {
                if (slot.kind === 'gap') return <VirtualGap key={slot.key} height={slot.height} colSpan={8} />;
                const p = report.parties[slot.index];
                const expanded = open.has(p.key);
                const canExpand = p.bills.length > 0;
                const vrow = virtual.rowProps(slot.index);
                const rowIndex = virtual.enabled ? ariaIndex.rows[slot.index] : undefined;
                return (
                  <Fragment key={p.key}>
                    <tr {...vrow} aria-rowindex={rowIndex}>
                      <th scope="row" className={styles.partyCell}>
                        <div className={styles.partyLine}>
                        {canExpand ? (
                          <button type="button" className={styles.expand} aria-expanded={expanded} onClick={() => toggle(p.key)}>
                            <ChevronRight size={16} className={expanded ? styles.chevOpen : styles.chev} aria-hidden="true" />
                            {p.name}
                          </button>
                        ) : <span className={styles.noExpand}>{p.name}</span>}
                        {badge(p.key)}
                        {modeOf(p) === 'never' && <span className={`${surface.badge} ${surface.badgeDraft}`}>{colT('rmNeverBadge')}</span>}
                        {modeOf(p) === 'manual' && <span className={`${surface.badge} ${surface.badgeDraft}`}>{colT('rmManualBadge')}</span>}
                        {currency === 'INR' && p.net > 0.004 && can('payment.record') && (
                          <button type="button" className={controls.btnIcon} aria-label={`${colT('fuLog')}: ${p.name}`} title={colT('fuLog')}
                            onClick={() => setFollowUp(p)} data-log-followup>
                            <NotebookPen size={14} />
                          </button>
                        )}
                        {currency === 'INR' && p.net > 0.004 && (
                          <a href={waHref(p)} target="_blank" rel="noopener noreferrer" className={controls.btnIcon} data-wa-statement
                            aria-label={khataT('waStatementFor', { name: p.name })} title={khataT('waStatement')}>
                            <MessageCircle size={14} />
                          </a>
                        )}
                        </div>
                      </th>
                      {AGING_BUCKETS.map((b) => <td key={b} className={surface.numeric}>{m(p.buckets[b])}</td>)}
                      <td className={surface.numeric}>{m(p.creditNotes + p.advances)}</td>
                      <td className={`${surface.numeric} ${p.net < 0 ? styles.credit : ''}`}><strong>{formatMoney(p.net, currency)}</strong></td>
                    </tr>
                    {expanded && (
                      <tr className={styles.billsRow} data-vindex={vrow['data-vindex']} aria-rowindex={rowIndex === undefined ? undefined : rowIndex + 1}>
                        <td colSpan={8}>
                          <BillsTable party={p} currency={currency} lateFeeRules={lateFeeRules} onLateFee={onLateFee}
                            onWriteOff={currency === 'INR' && can('doc.deleteIssued') ? (bill) => setWriteOff({ party: p, bill }) : undefined} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className={styles.totalRow} aria-rowindex={virtual.enabled ? ariaIndex.total : undefined}>
                <th scope="row">{rcvT('total')}</th>
                {AGING_BUCKETS.map((b) => <td key={b} className={surface.numeric}>{m(report.totals.buckets[b])}</td>)}
                <td className={surface.numeric}>{m(report.totals.creditNotes + report.totals.advances)}</td>
                <td className={surface.numeric}>{formatMoney(report.totals.net, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      {followUp && (
        <Suspense fallback={null}>
          <FollowUpDialog partyKey={followUp.key} partyName={followUp.name}
            bills={followUp.bills.filter((b) => !b.opening).map((b) => ({ id: b.invoiceId, number: b.number, outstanding: b.outstanding }))}
            onClose={() => setFollowUp(null)} onSaved={(m) => { notify(m); onChanged(); }} />
        </Suspense>
      )}
      {writeOff && (
        <Suspense fallback={null}>
          <WriteOffDialog invoiceId={writeOff.bill.invoiceId} number={writeOff.bill.number} party={writeOff.party.name} outstanding={writeOff.bill.outstanding}
            onClose={() => setWriteOff(null)} onDone={(m) => { notify(m); onChanged(); }} />
        </Suspense>
      )}
    </div>
  );
}

/** One party's open bills (inside its expanded aging row); long lists are windowed too. */
function BillsTable({ party: p, currency, lateFeeRules, onLateFee, onWriteOff }: {
  party: PartyReceivable;
  currency: string;
  lateFeeRules: Map<string, ClientLateFee>;
  onLateFee: (invoiceId: string) => void;
  /** R2-A3: owner-only single write-off of an invoice's open balance. */
  onWriteOff?: (bill: PartyReceivable['bills'][number]) => void;
}) {
  const m = (n: number) => (n ? formatMoney(n, currency) : '—');
  const billKeys = useMemo(() => p.bills.map((b) => b.invoiceId), [p.bills]);
  const virtual = useVirtualRows(billKeys, { estimate: 45 });
  const hasCredits = p.creditNotes > 0 || p.advances > 0;
  return (
    <table className={styles.bills} aria-rowcount={virtual.ariaRowCount(hasCredits ? 2 : 1)}>
      <thead>
        <tr aria-rowindex={virtual.enabled ? 1 : undefined}><th scope="col">{rcvT('bill')}</th><th scope="col">{rcvT('issued')}</th><th scope="col">{rcvT('due')}</th>
          <th scope="col" className={surface.numeric}>{rcvT('total')}</th>
          <th scope="col" className={surface.numeric}>{rcvT('paid')}</th>
          <th scope="col" className={surface.numeric}>{rcvT('outstanding')}</th>
          <th scope="col">{rcvT('age')}</th></tr>
      </thead>
      <tbody {...virtual.bodyProps}>
        {virtual.slots.map((slot) => {
          if (slot.kind === 'gap') return <VirtualGap key={slot.key} height={slot.height} colSpan={7} />;
          const b = p.bills[slot.index];
          return (
            <tr key={b.invoiceId} {...virtual.rowProps(slot.index)}>
              <td className={surface.mono}>{b.number}</td>
              <td>{formatDate(b.issueDate)}</td>
              <td>{formatDate(b.dueDate)}</td>
              <td className={surface.numeric}>{formatMoney(b.total, currency)}</td>
              <td className={surface.numeric}>{m(b.paid)}</td>
              <td className={surface.numeric}><strong>{formatMoney(b.outstanding, currency)}</strong></td>
              <td>
                <AgeChip bucket={b.bucket}>
                  {b.daysOverdue > 0 ? rcvT('daysOverdue', { n: b.daysOverdue }) : rcvT('notDue')}
                </AgeChip>
                {b.daysOverdue > 0 && lateFeeRules.has(b.invoiceId) && (
                  <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
                    title={rcvT('lateFeeTitle', { rule: describeClientLateFee(lateFeeRules.get(b.invoiceId)!) })}
                    aria-label={rcvT('lateFeeOn', { number: b.number })} onClick={() => onLateFee(b.invoiceId)}>
                    <Percent size={14} aria-hidden="true" /> {rcvT('addLateFee')}
                  </button>
                )}
                {onWriteOff && !b.opening && b.daysOverdue > 0 && (
                  <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => onWriteOff(b)}
                    aria-label={`${colT('woBtn')}: ${b.number}`} data-writeoff-open>
                    <Ban size={14} aria-hidden="true" /> {colT('woBtn')}
                  </button>
                )}
              </td>
            </tr>
          );
        })}
        {hasCredits && (
          <tr aria-rowindex={virtual.enabled ? p.bills.length + 2 : undefined}>
            <td colSpan={7} className={surface.statHint}>
              {rcvT('lessCredits')}{p.creditNotes > 0 && rcvT('lessCN', { amount: formatMoney(p.creditNotes, currency) })}
              {p.creditNotes > 0 && p.advances > 0 && ', '}
              {p.advances > 0 && rcvT('lessAdv', { amount: formatMoney(p.advances, currency) })}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

/* ── Statements ───────────────────────────────────────────────── */

function StatementsTab({ report, data, currency, now, partyKey, onPick, notify, onChanged, badge }: {
  badge: (partyKey: string) => ReactNode;
  report: ReturnType<typeof buildReceivables>;
  data: ReturnType<typeof loadData>;
  currency: string;
  now: Date;
  partyKey: string;
  onPick: (key: string) => void;
  notify: (m: string, tone?: 'success' | 'error' | 'info') => void;
  onChanged: () => void;
}) {
  const party = report.parties.find((p) => p.key === partyKey) ?? report.parties[0];
  const [entry, setEntry] = useState<'received' | 'given' | null>(null);
  const [from, setFrom] = useState(() => toDateInput(fyStart(now)));
  const [to, setTo] = useState(() => toDateInput(now));
  const [viewer, setViewer] = useState(false);
  const sender = useMemo(() => localDb.settings.activeProfile(), []);
  const [followUp, setFollowUp] = useState(false);
  const [tlVersion, setTlVersion] = useState(0);
  // R2-A6: statement style + ageing strip (device-local preference).
  const [prefs, setPrefs] = useState(loadStatementPrefs);
  const setStyle = (next: typeof prefs) => { setPrefs(next); saveStatementPrefs(next); };

  const ledger = useMemo(() => buildLedger(party, from, to), [party, from, to]);
  const entryKeys = useMemo(() => ledger.entries.map((e, i) => `${e.ref}-${i}`), [ledger.entries]);
  // Header and opening-balance rows come first; the closing row follows in the footer.
  const virtual = useVirtualRows(entryKeys, { estimate: 49, rowIndexOffset: 2 });
  const client = data.clients.find((c) => (party.clientId && c.id === party.clientId)
    || c.name?.trim().toLowerCase() === party.name.trim().toLowerCase());
  const text = useMemo(() => buildStatementText({ sender, party, ledger, currency }), [sender, party, ledger, currency]);
  const closeViewer = useCallback(() => setViewer(false), []);

  const presetRange = (kind: 'fy' | 'lastfy' | 'q' | 'all'): [string, string] => {
    const fy = fyStart(now);
    if (kind === 'fy') return [toDateInput(fy), toDateInput(now)];
    if (kind === 'lastfy') {
      return [toDateInput(new Date(fy.getFullYear() - 1, 3, 1)), toDateInput(new Date(fy.getFullYear(), 2, 31))];
    }
    if (kind === 'q') return [toDateInput(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89)), toDateInput(now)];
    return ['', ''];
  };
  const preset = (kind: 'fy' | 'lastfy' | 'q' | 'all') => {
    const [f, t] = presetRange(kind);
    setFrom(f);
    setTo(t);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notify(rcvT('copied'));
    } catch {
      notify(rcvT('noClipboard'), 'error');
    }
  };

  const invalidRange = Boolean(from && to && from > to);

  return (
    <div className={styles.stack}>
      <div className={`${surface.card} ${styles.filters}`}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rcv-party">{rcvT('party')}</label>
          <select id="rcv-party" className={controls.select} value={party.key} onChange={(e) => onPick(e.target.value)}>
            {[...report.parties].sort((a, b) => a.name.localeCompare(b.name)).map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rcv-from">{rcvT('from')}</label>
          <input id="rcv-from" type="date" className={controls.input} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="rcv-to">{rcvT('to')}</label>
          <input id="rcv-to" type="date" className={controls.input} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className={styles.presets} role="group" aria-label={rcvT('presets')}>
          {([['fy', rcvT('thisFy')], ['lastfy', rcvT('lastFy')], ['q', rcvT('last90')], ['all', rcvT('allTime')]] as const).map(([k, l]) => (
            <Fragment key={k}>{(() => {
              const [pf, pt] = presetRange(k);
              const on = pf === from && pt === to;
              return (
                <button key={k} type="button" aria-pressed={on}
                  className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm} ${on ? styles.presetOn : ''}`}
                  onClick={() => preset(k)}>{l}</button>
              );
            })()}</Fragment>
          ))}
        </div>
        {invalidRange && <p className={controls.error} role="alert">{rcvT('badRange')}</p>}
      </div>

      <div className={surface.card}>
        <div className={surface.cardHead}>
          <h2 className={styles.h2}>{party.name} {badge(party.key)}</h2>
          <div className={surface.pageActions}>
            {currency === 'INR' && can('payment.record') && (
              <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => setFollowUp(true)} data-log-followup>
                <NotebookPen size={14} /> {colT('fuLog')}
              </button>
            )}
            {currency === 'INR' && client && can('payment.record') && (
              <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => setEntry('received')}
                aria-label={khataT('receivedFrom', { name: party.name })}>
                {khataT('received')}
              </button>
            )}
            {currency === 'INR' && client && can('doc.create') && (
              <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => setEntry('given')}
                aria-label={khataT('givenTo', { name: party.name })}>
                {khataT('given')}
              </button>
            )}
            {currency === 'INR' && (
              <a className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} target="_blank" rel="noopener noreferrer" data-wa-statement
                href={whatsappLink(client?.phone, buildWhatsAppStatement({ sender, party, lang: messageLangOf(client) }))}>
                <MessageCircle size={14} /> {khataT('waStatement')}
              </a>
            )}
            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={copy}>
              <Copy size={14} /> {rcvT('copyText')}
            </button>
            {client?.email && (
              <a className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
                href={mailtoLink({ to: client.email, subject: `Statement of account – ${sender?.companyName ?? ''}`, body: text })}>
                <Mail size={14} /> {rcvT('email')}
              </a>
            )}
            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} disabled={invalidRange}
              onClick={() => void import('../components/receivables/letters').then((m) => m.printConfirmationLetters([party], data.clients, sender, from, to, currency))}>
              <Printer size={14} /> {printT('letterOne')}
            </button>
            <label className={styles.inline}>
              <span className={surface.srOnly}>{colT('stStyle')}</span>
              <select className={controls.select} value={prefs.style} aria-label={colT('stStyle')} onChange={(e) => setStyle({ ...prefs, style: e.target.value as StatementStyle })} data-statement-style>
                {STATEMENT_STYLES.map((st) => <option key={st} value={st}>{colT(`st.${st}`)}</option>)}
              </select>
            </label>
            <label className={controls.check}>
              <input type="checkbox" checked={prefs.ageing} onChange={(e) => setStyle({ ...prefs, ageing: e.target.checked })} data-statement-ageing />
              {colT('stAgeing')}
            </label>
            <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={() => setViewer(true)} disabled={invalidRange}>
              <FileText size={14} /> {rcvT('printPdf')}
            </button>
          </div>
        </div>

        <div className={styles.ledgerSummary}>
          <Mini label={rcvT('opening')} value={formatMoney(ledger.opening, currency)} dir={ledger.opening} />
          <Mini label={rcvT('debit')} value={formatMoney(ledger.totalDebit, currency)} />
          <Mini label={rcvT('credit')} value={formatMoney(ledger.totalCredit, currency)} />
          <Mini label={rcvT('closing')} value={formatMoney(ledger.closing, currency)} dir={ledger.closing} strong />
        </div>

        <div className={surface.tableWrap}>
          <table className={surface.table} aria-rowcount={virtual.ariaRowCount(3)}>
            <caption className={surface.srOnly}>{rcvT('ledgerFor', { name: party.name })}</caption>
            <thead>
              <tr aria-rowindex={virtual.enabled ? 1 : undefined}>
                <th scope="col">{rcvT('date')}</th><th scope="col">{rcvT('voucher')}</th><th scope="col">{rcvT('particulars')}</th>
                <th scope="col" className={surface.numeric}>{rcvT('debit')}</th>
                <th scope="col" className={surface.numeric}>{rcvT('credit')}</th>
                <th scope="col" className={surface.numeric}>{rcvT('balance')}</th>
              </tr>
            </thead>
            <tbody {...virtual.bodyProps}>
              <tr className={styles.openingRow} aria-rowindex={virtual.enabled ? 2 : undefined}>
                <td>{from ? formatDate(from) : '—'}</td><td /><td><em>{rcvT('openingBalance')}</em></td><td /><td />
                <td className={surface.numeric}>{drcr(ledger.opening, currency)}</td>
              </tr>
              {virtual.slots.map((slot) => {
                if (slot.kind === 'gap') return <VirtualGap key={slot.key} height={slot.height} colSpan={6} />;
                const e = ledger.entries[slot.index];
                return (
                <tr key={entryKeys[slot.index]} {...virtual.rowProps(slot.index)}>
                  <td>{formatDate(e.date)}</td>
                  <td className={surface.mono}>{e.ref}</td>
                  <td>{e.particulars}</td>
                  <td className={surface.numeric}>{e.debit ? formatMoney(e.debit, currency) : ''}</td>
                  <td className={surface.numeric}>{e.credit ? formatMoney(e.credit, currency) : ''}</td>
                  <td className={surface.numeric}>{drcr(e.balance, currency)}</td>
                </tr>
                );
              })}
              {ledger.entries.length === 0 && (
                <tr><td colSpan={6} className={surface.statHint}>{rcvT('noTx')}</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className={styles.totalRow} aria-rowindex={virtual.enabled ? ledger.entries.length + 3 : undefined}>
                <th scope="row" colSpan={3}>{rcvT('closingBalance')}</th>
                <td className={surface.numeric}>{formatMoney(ledger.totalDebit, currency)}</td>
                <td className={surface.numeric}>{formatMoney(ledger.totalCredit, currency)}</td>
                <td className={surface.numeric}>{drcr(ledger.closing, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className={`${surface.sectionNote} ${styles.note}`}>
          {rcvT('drcrNote')}
        </p>
      </div>

      {currency === 'INR' && (
        <Suspense fallback={null}>
          <PartyTimeline partyKey={party.key} invoices={data.invoices} payments={data.payments as Payment[]} clients={data.clients} version={tlVersion} />
        </Suspense>
      )}
      <StatementViewer open={viewer} onClose={closeViewer} sender={sender} party={party} client={client}
        ledger={ledger} currency={currency} onError={(msg) => notify(msg, 'error')}
        styleKind={prefs.style} ageing={prefs.ageing ? { asOf: to || toDateInput(now) } : undefined} />
      {followUp && (
        <Suspense fallback={null}>
          <FollowUpDialog partyKey={party.key} partyName={party.name}
            bills={party.bills.filter((b) => !b.opening).map((b) => ({ id: b.invoiceId, number: b.number, outstanding: b.outstanding }))}
            onClose={() => setFollowUp(false)} onSaved={(m) => { notify(m); setTlVersion((v) => v + 1); }} />
        </Suspense>
      )}
      {entry && client && (
        <Suspense fallback={null}>
          <QuickEntrySheet mode={entry} client={client} party={party} onClose={() => setEntry(null)}
            onSaved={(message) => { notify(message); onChanged(); }} />
        </Suspense>
      )}
    </div>
  );
}

function drcr(n: number, currency: string): string {
  return Math.abs(n) < 0.005 ? formatMoney(0, currency) : `${formatMoney(Math.abs(n), currency)} ${n > 0 ? 'Dr' : 'Cr'}`;
}

function Mini({ label, value, dir, strong }: { label: string; value: string; dir?: number; strong?: boolean }) {
  return (
    <div className={styles.mini}>
      <span className={surface.statLabel}>{label}</span>
      <span className={strong ? styles.miniStrong : styles.miniValue}>
        {value}{dir !== undefined && Math.abs(dir) >= 0.005 ? (dir > 0 ? ' Dr' : ' Cr') : ''}
      </span>
    </div>
  );
}
