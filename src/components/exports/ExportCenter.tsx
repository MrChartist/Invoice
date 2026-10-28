import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Download, FileSpreadsheet, FileJson, FileCode2, Send, Info, BookOpen,
} from 'lucide-react';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './ExportCenter.module.css';
import { getTable, setTable, KEYS } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import type { AdvanceRecord } from '../../types/advances';
import type { PurchaseReturn } from '../../types/purchases';
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import {
  DATASETS,
  buildAccountantBundle,
  buildDataset,
  fyLabel,
  fyRange,
  fyStartYearOf,
  isoDate,
  rangeLabelOf,
  toCsv,
  type DatasetId,
  type DateFormat,
  type DateRange,
  type ExportFile,
  type ExportSource,
} from '../../lib/accounting-export';
import { generateTallyExport, DEFAULT_LEDGER_NAMES, type TallyOptions } from '../../lib/tally-xml';
import { loadTallyBooksSource } from '../../lib/tally-books';
import { useToast } from '../ui/useToast';
import { downloadFile, downloadSequentially } from './download';
import { useT } from '../../i18n';
import { expT } from '../../i18n/areas/exports';
import { nodes } from '../../i18n/areas/nodes';

/** Screen names of the datasets (the CSV files and their headers stay English). */
const DATASET_KEYS = {
  sales_register: ['dsSalesRegister', 'dsSalesRegisterText'],
  sales_items: ['dsSalesItems', 'dsSalesItemsText'],
  purchase_register: ['dsPurchaseRegister', 'dsPurchaseRegisterText'],
  receipts: ['dsReceipts', 'dsReceiptsText'],
  parties: ['dsParties', 'dsPartiesText'],
  items: ['dsItems', 'dsItemsText'],
  gst_summary: ['dsGstSummary', 'dsGstSummaryText'],
} as const;
type DatasetKeyed = keyof typeof DATASET_KEYS;
const dsKeys = (id: string) => (id in DATASET_KEYS ? DATASET_KEYS[id as DatasetKeyed] : null);
const dsTitle = (d: { id: string; title: string }) => { const k = dsKeys(d.id); return k ? expT(k[0]) : d.title; };
const dsText = (d: { id: string; description: string }) => { const k = dsKeys(d.id); return k ? expT(k[1]) : d.description; };

const PREFS_TABLE = 'export_prefs';

interface Prefs {
  period: string; // 'all' | 'custom' | 'fy:2025'
  from: string;
  to: string;
  dateFormat: DateFormat;
  bom: boolean;
  includeDrafts: boolean;
  includeInventory: boolean;
  selected: DatasetId[];
  companyName: string;
  salesLedger: string;
  purchaseLedger: string;
  bankLedger: string;
  cashLedger: string;
  roundOffLedger: string;
}

function currentFyStart(): number {
  return fyStartYearOf(isoDate(new Date()));
}

function defaultPrefs(company: string): Prefs {
  return {
    period: `fy:${currentFyStart()}`,
    from: '',
    to: '',
    dateFormat: 'iso',
    bom: true,
    includeDrafts: false,
    includeInventory: false,
    selected: DATASETS.map((d) => d.id),
    companyName: company,
    salesLedger: DEFAULT_LEDGER_NAMES.salesLedger,
    purchaseLedger: DEFAULT_LEDGER_NAMES.purchaseLedger,
    bankLedger: DEFAULT_LEDGER_NAMES.bankLedger,
    cashLedger: DEFAULT_LEDGER_NAMES.cashLedger,
    roundOffLedger: DEFAULT_LEDGER_NAMES.roundOffLedger,
  };
}

function loadSource(): ExportSource {
  return {
    invoices: getTable<InvoiceRecord>(KEYS.invoices),
    payments: getTable<Payment>(KEYS.transactions),
    clients: getTable<Client>(KEYS.clients),
    items: getTable<Record<string, unknown>>(KEYS.items),
    purchases: getTable<unknown>('purchases'),
    vendors: getTable<unknown>('vendors'),
    advances: getTable<AdvanceRecord>('advances'),
    purchaseReturns: getTable<PurchaseReturn>('purchase_returns'),
    // WP-7 (P0-12 / P1-22): supplier payments, manual vouchers, asset journals, stock transfers, openings.
    books: loadTallyBooksSource(isoDate(new Date())),
  };
}

export interface ExportCenterProps {
  /** Overrides the company name detected from the active sender profile. */
  companyName?: string;
}

export function ExportCenter({ companyName }: ExportCenterProps) {
  useT();
  const { notify, toastNode } = useToast();
  const [source, setSource] = useState<ExportSource | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Hydrate from localStorage once on mount (the app's standard pattern).
    const detected = companyName || localDb.settings.activeProfile()?.companyName || '';
    const saved = getTable<Partial<Prefs>>(PREFS_TABLE)[0] ?? {};
    const base = defaultPrefs(detected);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs({ ...base, ...saved, companyName: companyName || saved.companyName || detected });
    const s = loadSource();
    setSource(s);
    // 7.49: TDS / TCS challans in the Tally export (tally-tds.ts reads the ledger's challan postings, lazily).
    if (s.books) void import('../../lib/tally-tds').then((m) => m.withTdsChallans(s.books!)).then((books) => setSource((cur) => (cur === s ? { ...s, books } : cur)));
  }, [companyName]);

  const update = useCallback((patch: Partial<Prefs>) => {
    setPrefs((p) => {
      if (!p) return p;
      const next = { ...p, ...patch };
      try {
        setTable(PREFS_TABLE, [next]);
      } catch {
        /* preferences are a convenience; never block an export on them */
      }
      return next;
    });
  }, []);

  const fyOptions = useMemo(() => {
    const years = new Set<number>([currentFyStart()]);
    for (const i of source?.invoices ?? []) {
      const d = isoDate(i.issue_date);
      if (d) years.add(fyStartYearOf(d));
    }
    return [...years].sort((a, b) => b - a);
  }, [source]);

  const range: DateRange = useMemo(() => {
    if (!prefs) return {};
    if (prefs.period === 'all') return {};
    if (prefs.period === 'custom') return { from: prefs.from || undefined, to: prefs.to || undefined };
    const y = Number(prefs.period.replace('fy:', ''));
    return Number.isFinite(y) ? fyRange(y) : {};
  }, [prefs]);

  const fyStart = prefs?.period.startsWith('fy:') ? Number(prefs.period.slice(3)) : undefined;
  const label = rangeLabelOf(range, fyStart);

  const tallyOpts: TallyOptions | null = prefs && {
    companyName: prefs.companyName,
    range,
    includeDrafts: prefs.includeDrafts,
    includeInventory: prefs.includeInventory,
    salesLedger: prefs.salesLedger,
    purchaseLedger: prefs.purchaseLedger,
    bankLedger: prefs.bankLedger,
    cashLedger: prefs.cashLedger,
    roundOffLedger: prefs.roundOffLedger,
  };

  const tables = useMemo(() => {
    if (!source || !prefs) return null;
    const opts = { range, dateFormat: prefs.dateFormat, includeDrafts: prefs.includeDrafts };
    return Object.fromEntries(DATASETS.map((d) => [d.id, buildDataset(d.id, source, opts)])) as Record<
      DatasetId,
      ReturnType<typeof buildDataset>
    >;
  }, [source, prefs, range]);

  const tally = useMemo(
    () => (source && tallyOpts ? generateTallyExport(source, tallyOpts) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [source, prefs, range],
  );

  if (!prefs || !source || !tables || !tally || !tallyOpts) return null;

  const base = (prefs.companyName || 'company').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'company';
  const fileName = (suffix: string) => `${base}_${label.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}_${suffix}`;
  const csvFile = (id: DatasetId): ExportFile => ({
    filename: fileName(tables[id].filename),
    mime: 'text/csv;charset=utf-8',
    content: toCsv(tables[id], { bom: prefs.bom }),
  });
  const xmlFile = (kind: 'masters' | 'vouchers' | 'combined'): ExportFile => ({
    filename: fileName(`tally-${kind}.xml`),
    mime: 'application/xml;charset=utf-8',
    content: kind === 'masters' ? tally.mastersXml : kind === 'vouchers' ? tally.vouchersXml : tally.combinedXml,
  });

  const toggleDataset = (id: DatasetId) =>
    update({ selected: prefs.selected.includes(id) ? prefs.selected.filter((s) => s !== id) : [...prefs.selected, id] });

  const bundle = () =>
    buildAccountantBundle(source, {
      companyName: prefs.companyName,
      datasets: DATASETS.map((d) => d.id).filter((id) => prefs.selected.includes(id)),
      tally: { masters: true, vouchers: true, options: tallyOpts },
      bom: prefs.bom,
      range,
      rangeLabel: label,
      dateFormat: prefs.dateFormat,
      includeDrafts: prefs.includeDrafts,
    });

  const sendAll = async () => {
    setBusy(true);
    try {
      const b = bundle();
      await downloadSequentially([...b.files, b.combined]);
      notify(expT('downloaded', { n: b.files.length + 1 }));
    } catch {
      notify(expT('downloadFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const noCompany = !prefs.companyName.trim();
  const c = tally.counts;
  const voucherTotal = c.sales + c.creditNotes + c.receipts + c.purchases + (c.payments ?? 0) + (c.journals ?? 0) + (c.contras ?? 0) + (c.stockJournals ?? 0);

  return (
    <div className={styles.grid}>
      <div className={styles.stack}>
        <section className={surface.card} aria-labelledby="ex-period">
          <div className={surface.cardHead}>
            <span className={surface.cardHeadIcon} id="ex-period">{expT('periodFormat')}</span>
          </div>
          <div className={surface.cardBody}>
            <div className={styles.filters}>
              <div className={`${controls.field} ${styles.wide}`}>
                <label className={controls.label} htmlFor="ex-period-sel">{expT('period')}</label>
                <select
                  id="ex-period-sel"
                  className={controls.select}
                  value={prefs.period}
                  onChange={(e) => update({ period: e.target.value })}
                >
                  {fyOptions.map((y) => (
                    <option key={y} value={`fy:${y}`}>{expT('fyOption', { fy: fyLabel(y), from: y, to: y + 1 })}</option>
                  ))}
                  <option value="all">{expT('allTime')}</option>
                  <option value="custom">{expT('customRange')}</option>
                </select>
              </div>
              {prefs.period === 'custom' && (
                <>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="ex-from">{expT('from')}</label>
                    <input id="ex-from" type="date" className={controls.input} value={prefs.from} onChange={(e) => update({ from: e.target.value })} />
                  </div>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="ex-to">{expT('to')}</label>
                    <input id="ex-to" type="date" className={controls.input} value={prefs.to} onChange={(e) => update({ to: e.target.value })} />
                  </div>
                </>
              )}
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ex-datefmt">{expT('dateFormat')}</label>
                <select id="ex-datefmt" className={controls.select} value={prefs.dateFormat} onChange={(e) => update({ dateFormat: e.target.value as DateFormat })}>
                  <option value="iso">{expT('isoOption')}</option>
                  <option value="dmy">15-04-2025 (DD-MM-YYYY)</option>
                </select>
              </div>
            </div>
            <div className={styles.checks}>
              <label className={controls.check}>
                <input type="checkbox" checked={prefs.bom} onChange={(e) => update({ bom: e.target.checked })} />
                {expT('bom')}
              </label>
              <label className={controls.check}>
                <input type="checkbox" checked={prefs.includeDrafts} onChange={(e) => update({ includeDrafts: e.target.checked })} />
                {expT('includeDrafts')}
              </label>
            </div>
            <p className={surface.sectionNote}>
              {expT('neverExported')}
            </p>
          </div>
        </section>

        <section className={surface.card} aria-labelledby="ex-datasets">
          <div className={surface.cardHead}>
            <span className={surface.cardHeadIcon} id="ex-datasets"><FileSpreadsheet size={16} aria-hidden="true" /> {expT('csvDatasets')}</span>
          </div>
          <ul className={styles.datasetList}>
            {DATASETS.map((d) => {
              const n = tables[d.id].rows.length;
              const on = prefs.selected.includes(d.id);
              return (
                <li key={d.id} className={styles.dataset}>
                  <input
                    type="checkbox"
                    aria-label={expT('includeInBundle', { title: dsTitle(d) })}
                    checked={on}
                    onChange={() => toggleDataset(d.id)}
                    style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                  />
                  <div className={styles.datasetMain}>
                    <h3 className={styles.datasetTitle}>{dsTitle(d)}</h3>
                    <p className={styles.datasetText}>{dsText(d)}</p>
                    <p className={styles.datasetFit}>{expT('worksWith', { list: d.compatibleWith })}</p>
                  </div>
                  <div className={styles.datasetActions}>
                    <span className={`${styles.count} ${n ? styles.countOn : ''}`} aria-label={expT('rows', { n })}>{expT('rows', { n })}</span>
                    <button
                      type="button"
                      className={`${controls.btnOutline} ${controls.btnSm}`}
                      disabled={n === 0}
                      onClick={() => downloadFile(csvFile(d.id))}
                      aria-label={expT('downloadCsvOf', { title: dsTitle(d) })}
                    >
                      <Download size={14} aria-hidden="true" /> CSV
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className={styles.stack}>
        <section className={surface.card} aria-labelledby="ex-tally">
          <div className={surface.cardHead}>
            <span className={surface.cardHeadIcon} id="ex-tally"><FileCode2 size={16} aria-hidden="true" /> Tally Prime XML</span>
          </div>
          <div className={surface.cardBody}>
            <div className={styles.tallyCounts} role="list" aria-label={expT('tallyContents')}>
              {[
                [expT('cLedgers'), c.ledgers], [expT('cSales'), c.sales], [expT('cCreditNotes'), c.creditNotes],
                [expT('cReceipts'), c.receipts], [expT('cPurchases'), c.purchases], [expT('cStockItems'), c.stockItems],
                [expT('cPayments'), c.payments ?? 0], [expT('cJournals'), (c.journals ?? 0) + (c.contras ?? 0)], [expT('cStockJournals'), c.stockJournals ?? 0],
              ].map(([k, v]) => (
                <div key={k} className={styles.mini} role="listitem">
                  <span className={styles.miniValue}>{v}</span>
                  <span className={styles.miniLabel}>{k}</span>
                </div>
              ))}
            </div>

            <div className={controls.field}>
              <label className={controls.label} htmlFor="ex-company">{expT('companyInTally')}</label>
              <input
                id="ex-company"
                className={`${controls.input} ${noCompany ? controls.inputInvalid : ''}`}
                value={prefs.companyName}
                onChange={(e) => update({ companyName: e.target.value })}
                aria-invalid={noCompany}
                aria-describedby="ex-company-hint"
              />
              <span id="ex-company-hint" className={noCompany ? controls.error : controls.hint}>
                {expT('companyHint')}
              </span>
            </div>

            <details className={styles.details}>
              <summary>{expT('ledgerOptions')}</summary>
              <div className={controls.row}>
                {([
                  ['salesLedger', expT('salesLedger')],
                  ['purchaseLedger', expT('purchaseLedger')],
                  ['bankLedger', expT('bankLedger')],
                  ['cashLedger', expT('cashLedger')],
                  ['roundOffLedger', expT('roundOffLedger')],
                ] as const).map(([key, text]) => (
                  <div className={controls.field} key={key}>
                    <label className={controls.label} htmlFor={`ex-${key}`}>{text}</label>
                    <input id={`ex-${key}`} className={controls.input} value={prefs[key]} onChange={(e) => update({ [key]: e.target.value })} />
                  </div>
                ))}
              </div>
              <label className={controls.check} style={{ marginTop: '0.75rem' }}>
                <input type="checkbox" checked={prefs.includeInventory} onChange={(e) => update({ includeInventory: e.target.checked })} />
                {expT('postInventory')}
              </label>
              <p className={surface.sectionNote}>
                {expT('inventoryHint')}
              </p>
            </details>

            {tally.build.warnings.length > 0 && (
              <div className={styles.warn} role="alert">
                <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: 'var(--warning)' }} />
                <div>
                  <strong>{expT('needLook', { n: tally.build.warnings.length })}</strong>
                  <ul>
                    {tally.build.warnings.slice(0, 5).map((w) => <li key={w}>{w}</li>)}
                    {tally.build.warnings.length > 5 && <li>{expT('andMore', { n: tally.build.warnings.length - 5 })}</li>}
                  </ul>
                </div>
              </div>
            )}

            <div className={styles.btnRow}>
              <button type="button" className={`${controls.btnPrimary} ${controls.btn}`} disabled={noCompany || tally.counts.ledgers === 0}
                onClick={() => downloadFile(xmlFile('masters'))}>
                <Download size={16} aria-hidden="true" /> {expT('mastersXml')}
              </button>
              <button type="button" className={`${controls.btnPrimary} ${controls.btn}`} disabled={noCompany || voucherTotal === 0}
                onClick={() => downloadFile(xmlFile('vouchers'))}>
                <Download size={16} aria-hidden="true" /> {expT('vouchersXml', { n: voucherTotal })}
              </button>
              <button type="button" className={`${controls.btnOutline} ${controls.btn}`} disabled={noCompany || voucherTotal === 0}
                onClick={() => downloadFile(xmlFile('combined'))}>
                <Download size={16} aria-hidden="true" /> {expT('combined')}
              </button>
            </div>
          </div>
        </section>

        <section className={surface.card} aria-labelledby="ex-send">
          <div className={surface.cardHead}>
            <span className={surface.cardHeadIcon} id="ex-send"><Send size={16} aria-hidden="true" /> {expT('sendHead')}</span>
          </div>
          <div className={surface.cardBody}>
            <p className={surface.sectionNote}>
              {expT('sendNote', { period: label === 'all-time' ? expT('allTimeLower') : label })}
            </p>
            <div className={styles.btnRow}>
              <button type="button" className={`${controls.btnPrimary} ${controls.btn}`} disabled={busy || noCompany} onClick={sendAll}>
                <Send size={16} aria-hidden="true" /> {busy ? expT('downloading') : expT('downloadBundle')}
              </button>
              <button type="button" className={`${controls.btnOutline} ${controls.btn}`} disabled={noCompany} onClick={() => { downloadFile(bundle().combined); notify(expT('jsonDownloaded')); }}>
                <FileJson size={16} aria-hidden="true" /> {expT('singleJson')}
              </button>
            </div>
          </div>
        </section>

        <section className={surface.card} aria-labelledby="ex-help">
          <div className={surface.cardHead}>
            <span className={surface.cardHeadIcon} id="ex-help"><BookOpen size={16} aria-hidden="true" /> {expT('importHead')}</span>
          </div>
          <div className={surface.cardBody}>
            <ol className={styles.steps}>
              <li>{nodes(expT('step1'), { company: <span className={styles.kbd}>{prefs.companyName || expT('yourCompany')}</span> })}</li>
              <li>{nodes(expT('step2'), { gateway: <span className={styles.kbd}>Gateway of Tally</span>, alty: <span className={styles.kbd}>Alt+Y</span> })}</li>
              <li>{nodes(expT('step3'), { alto: <span className={styles.kbd}>Alt+O</span>, data: <span className={styles.kbd}>Data</span>, importData: <span className={styles.kbd}>Import Data</span> })}</li>
              <li>{nodes(expT('step4'), { masters: <strong>Masters XML</strong>, combine: <em>Combine Opening Balances</em>, ignore: <em>Ignore Duplicates</em> })}</li>
              <li>{nodes(expT('step5'), { vouchers: <strong>Vouchers XML</strong> })}</li>
              <li>{nodes(expT('step6'), { log: <span className={styles.kbd}>tallyimport.log</span> })}</li>
            </ol>
            <p className={surface.sectionNote}>
              <Info size={12} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> {expT('duplicates')}
            </p>
          </div>
        </section>
      </div>
      {toastNode}
    </div>
  );
}
