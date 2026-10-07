import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Download, FileSpreadsheet, FileJson, FileCode2, Send, Info, BookOpen,
} from 'lucide-react';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './ExportCenter.module.css';
import { getTable, setTable, KEYS } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
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
import { useToast } from '../ui/useToast';
import { downloadFile, downloadSequentially } from './download';

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
  };
}

export interface ExportCenterProps {
  /** Overrides the company name detected from the active sender profile. */
  companyName?: string;
}

export function ExportCenter({ companyName }: ExportCenterProps) {
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
    setSource(loadSource());
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
      notify(`Downloaded ${b.files.length + 1} files for your accountant`);
    } catch {
      notify('Download failed — your browser may have blocked multiple downloads.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const noCompany = !prefs.companyName.trim();
  const c = tally.counts;
  const voucherTotal = c.sales + c.creditNotes + c.receipts + c.purchases;

  return (
    <div className={styles.grid}>
      <div className={styles.stack}>
        <section className={surface.card} aria-labelledby="ex-period">
          <div className={surface.cardHead}>
            <span className={surface.cardHeadIcon} id="ex-period">Period and format</span>
          </div>
          <div className={surface.cardBody}>
            <div className={styles.filters}>
              <div className={`${controls.field} ${styles.wide}`}>
                <label className={controls.label} htmlFor="ex-period-sel">Period</label>
                <select
                  id="ex-period-sel"
                  className={controls.select}
                  value={prefs.period}
                  onChange={(e) => update({ period: e.target.value })}
                >
                  {fyOptions.map((y) => (
                    <option key={y} value={`fy:${y}`}>{fyLabel(y)} (Apr {y} – Mar {y + 1})</option>
                  ))}
                  <option value="all">All time</option>
                  <option value="custom">Custom range</option>
                </select>
              </div>
              {prefs.period === 'custom' && (
                <>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="ex-from">From</label>
                    <input id="ex-from" type="date" className={controls.input} value={prefs.from} onChange={(e) => update({ from: e.target.value })} />
                  </div>
                  <div className={controls.field}>
                    <label className={controls.label} htmlFor="ex-to">To</label>
                    <input id="ex-to" type="date" className={controls.input} value={prefs.to} onChange={(e) => update({ to: e.target.value })} />
                  </div>
                </>
              )}
              <div className={controls.field}>
                <label className={controls.label} htmlFor="ex-datefmt">CSV date format</label>
                <select id="ex-datefmt" className={controls.select} value={prefs.dateFormat} onChange={(e) => update({ dateFormat: e.target.value as DateFormat })}>
                  <option value="iso">2025-04-15 (unambiguous)</option>
                  <option value="dmy">15-04-2025 (DD-MM-YYYY)</option>
                </select>
              </div>
            </div>
            <div className={styles.checks}>
              <label className={controls.check}>
                <input type="checkbox" checked={prefs.bom} onChange={(e) => update({ bom: e.target.checked })} />
                UTF-8 BOM (keeps ₹ and accents intact in Excel)
              </label>
              <label className={controls.check}>
                <input type="checkbox" checked={prefs.includeDrafts} onChange={(e) => update({ includeDrafts: e.target.checked })} />
                Include drafts
              </label>
            </div>
            <p className={surface.sectionNote}>
              Quotations, proforma invoices, delivery challans and cancelled documents are never exported.
              Credit notes appear as negative amounts in CSVs and as Credit Note vouchers in Tally.
            </p>
          </div>
        </section>

        <section className={surface.card} aria-labelledby="ex-datasets">
          <div className={surface.cardHead}>
            <span className={surface.cardHeadIcon} id="ex-datasets"><FileSpreadsheet size={16} aria-hidden="true" /> CSV datasets</span>
          </div>
          <ul className={styles.datasetList}>
            {DATASETS.map((d) => {
              const n = tables[d.id].rows.length;
              const on = prefs.selected.includes(d.id);
              return (
                <li key={d.id} className={styles.dataset}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${d.title} in the accountant bundle`}
                    checked={on}
                    onChange={() => toggleDataset(d.id)}
                    style={{ width: 16, height: 16, accentColor: 'var(--primary)' }}
                  />
                  <div className={styles.datasetMain}>
                    <h3 className={styles.datasetTitle}>{d.title}</h3>
                    <p className={styles.datasetText}>{d.description}</p>
                    <p className={styles.datasetFit}>Works with: {d.compatibleWith}</p>
                  </div>
                  <div className={styles.datasetActions}>
                    <span className={`${styles.count} ${n ? styles.countOn : ''}`} aria-label={`${n} rows`}>{n} rows</span>
                    <button
                      type="button"
                      className={`${controls.btnOutline} ${controls.btnSm}`}
                      disabled={n === 0}
                      onClick={() => downloadFile(csvFile(d.id))}
                      aria-label={`Download ${d.title} CSV`}
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
            <div className={styles.tallyCounts} role="list" aria-label="Tally export contents">
              {[
                ['Ledgers', c.ledgers], ['Sales', c.sales], ['Credit notes', c.creditNotes],
                ['Receipts', c.receipts], ['Purchases', c.purchases], ['Stock items', c.stockItems],
              ].map(([k, v]) => (
                <div key={k} className={styles.mini} role="listitem">
                  <span className={styles.miniValue}>{v}</span>
                  <span className={styles.miniLabel}>{k}</span>
                </div>
              ))}
            </div>

            <div className={controls.field}>
              <label className={controls.label} htmlFor="ex-company">Company name in Tally</label>
              <input
                id="ex-company"
                className={`${controls.input} ${noCompany ? controls.inputInvalid : ''}`}
                value={prefs.companyName}
                onChange={(e) => update({ companyName: e.target.value })}
                aria-invalid={noCompany}
                aria-describedby="ex-company-hint"
              />
              <span id="ex-company-hint" className={noCompany ? controls.error : controls.hint}>
                Must match the open company in Tally exactly, including spaces and punctuation.
              </span>
            </div>

            <details className={styles.details}>
              <summary>Ledger names and options</summary>
              <div className={controls.row}>
                {([
                  ['salesLedger', 'Sales ledger'],
                  ['purchaseLedger', 'Purchase ledger'],
                  ['bankLedger', 'Bank ledger'],
                  ['cashLedger', 'Cash ledger'],
                  ['roundOffLedger', 'Round-off ledger'],
                ] as const).map(([key, text]) => (
                  <div className={controls.field} key={key}>
                    <label className={controls.label} htmlFor={`ex-${key}`}>{text}</label>
                    <input id={`ex-${key}`} className={controls.input} value={prefs[key]} onChange={(e) => update({ [key]: e.target.value })} />
                  </div>
                ))}
              </div>
              <label className={controls.check} style={{ marginTop: '0.75rem' }}>
                <input type="checkbox" checked={prefs.includeInventory} onChange={(e) => update({ includeInventory: e.target.checked })} />
                Post item lines as stock-item inventory entries
              </label>
              <p className={surface.sectionNote}>
                Leave inventory off for service businesses. When on, stock items and units are created in the masters file.
              </p>
            </details>

            {tally.build.warnings.length > 0 && (
              <div className={styles.warn} role="alert">
                <AlertTriangle size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2, color: 'var(--warning)' }} />
                <div>
                  <strong>{tally.build.warnings.length} item(s) need a look</strong>
                  <ul>
                    {tally.build.warnings.slice(0, 5).map((w) => <li key={w}>{w}</li>)}
                    {tally.build.warnings.length > 5 && <li>…and {tally.build.warnings.length - 5} more</li>}
                  </ul>
                </div>
              </div>
            )}

            <div className={styles.btnRow}>
              <button type="button" className={`${controls.btnPrimary} ${controls.btn}`} disabled={noCompany || tally.counts.ledgers === 0}
                onClick={() => downloadFile(xmlFile('masters'))}>
                <Download size={16} aria-hidden="true" /> 1. Masters XML
              </button>
              <button type="button" className={`${controls.btnPrimary} ${controls.btn}`} disabled={noCompany || voucherTotal === 0}
                onClick={() => downloadFile(xmlFile('vouchers'))}>
                <Download size={16} aria-hidden="true" /> 2. Vouchers XML ({voucherTotal})
              </button>
              <button type="button" className={`${controls.btnOutline} ${controls.btn}`} disabled={noCompany || voucherTotal === 0}
                onClick={() => downloadFile(xmlFile('combined'))}>
                <Download size={16} aria-hidden="true" /> Combined (single file)
              </button>
            </div>
          </div>
        </section>

        <section className={surface.card} aria-labelledby="ex-send">
          <div className={surface.cardHead}>
            <span className={surface.cardHeadIcon} id="ex-send"><Send size={16} aria-hidden="true" /> Send to accountant</span>
          </div>
          <div className={surface.cardBody}>
            <p className={surface.sectionNote}>
              Downloads every ticked CSV, both Tally XML files and one combined JSON file for {label === 'all-time' ? 'all time' : label}.
              Browsers cannot create zip files without extra software, so the files download one after another —
              attach them all to one email. If your browser asks, allow multiple downloads.
            </p>
            <div className={styles.btnRow}>
              <button type="button" className={`${controls.btnPrimary} ${controls.btn}`} disabled={busy || noCompany} onClick={sendAll}>
                <Send size={16} aria-hidden="true" /> {busy ? 'Downloading…' : 'Download bundle'}
              </button>
              <button type="button" className={`${controls.btnOutline} ${controls.btn}`} disabled={noCompany} onClick={() => { downloadFile(bundle().combined); notify('Combined JSON downloaded'); }}>
                <FileJson size={16} aria-hidden="true" /> Single JSON file
              </button>
            </div>
          </div>
        </section>

        <section className={surface.card} aria-labelledby="ex-help">
          <div className={surface.cardHead}>
            <span className={surface.cardHeadIcon} id="ex-help"><BookOpen size={16} aria-hidden="true" /> Import into Tally Prime</span>
          </div>
          <div className={surface.cardBody}>
            <ol className={styles.steps}>
              <li>Open the company in Tally Prime (name must match <span className={styles.kbd}>{prefs.companyName || 'your company'}</span>).</li>
              <li>Take a backup first: <span className={styles.kbd}>Gateway of Tally</span> → <span className={styles.kbd}>Alt+Y</span> Data → Backup.</li>
              <li>Press <span className={styles.kbd}>Alt+O</span> (Import) → <span className={styles.kbd}>Data</span>, or go to Gateway of Tally → <span className={styles.kbd}>Import Data</span>.</li>
              <li>Choose <strong>Masters XML</strong> first, set “Behaviour of import if master exists” to <em>Combine Opening Balances</em> or <em>Ignore Duplicates</em>, and import.</li>
              <li>Repeat with <strong>Vouchers XML</strong> (or use the Combined file once). Review Day Book for the period.</li>
              <li>If Tally reports exceptions, open <span className={styles.kbd}>tallyimport.log</span> in the Tally folder; the usual cause is a ledger name or company name that does not match exactly.</li>
            </ol>
            <p className={surface.sectionNote}>
              <Info size={12} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Importing the same file twice creates duplicate vouchers —
              export a fresh period range each time. Spreadsheets: Zoho Books, Vyapar and Busy accept the CSVs through their
              Import menus; map columns by header name.
            </p>
          </div>
        </section>
      </div>
      {toastNode}
    </div>
  );
}
