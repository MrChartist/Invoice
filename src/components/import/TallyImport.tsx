/**
 * Tally import screen (WP-7, P0-7). Lazy: load with
 *   const TallyImport = lazy(() => import('../import/TallyImport').then((m) => ({ default: m.TallyImport })));
 * Separate from the CSV import wizard. Steps: choose file + options → dry run (mapping, statuses,
 * opening TB) → import (one undo copy first) → result with the opening TB side by side.
 */
import { useMemo, useState } from 'react';
import { FileCode2, RotateCcw, Upload } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useCan } from '../../hooks/useCan';
import { useT } from '../../i18n';
import { vtT } from '../../i18n/areas/voucher-types';
import { migT } from '../../i18n/areas/migration';
import { clearSafetySnapshot, getSafetySnapshot, restoreBackup, saveSafetySnapshot } from '../../lib/backup';
import { reloadAfterFlush } from '../../lib/storage';
import { isoDay } from '../../lib/dates';
import { decodeTallyBytes, parseXmlLite, sanitizeTallyXml, xmlNodeFromDom, type XmlNode } from '../../lib/tally-xml-read';
import { parseTallyXml, planTallyImport, suggestBooksBegin, type ImportPlan, type PlannedVoucherStatus, type TallyParsed } from '../../lib/tally-import';
import { applyTallyImport, loadExistingBooks, openingCheck, type ImportResult, type OpeningCheckRow } from '../../lib/tally-import-apply';
import { storedBooksBegin } from '../../lib/ledger/openings';
import controls from '../../styles/controls.module.css';
import styles from './TallyImport.module.css';

const MAX_FILE_MB = 128;
const ROWS = 300;

export interface TallyImportProps {
  open: boolean;
  onClose: () => void;
  notify?: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

/** DOMParser when it accepts the (sanitised, DOCTYPE-free) file, else the built-in parser. */
function parseWithDom(text: string): XmlNode {
  const clean = sanitizeTallyXml(text);
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(clean, 'application/xml');
    if (!doc.getElementsByTagName('parsererror').length) return xmlNodeFromDom(doc as unknown as Parameters<typeof xmlNodeFromDom>[0]);
  }
  return parseXmlLite(clean);
}

const rs = (p: number) => `₹${(Math.abs(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const drcr = (p: number) => (p ? `${rs(p)} ${p > 0 ? 'Dr' : 'Cr'}` : '—');

const STATUS_KEY: Record<PlannedVoucherStatus, 'stOk' | 'stDuplicate' | 'stLocked' | 'stCancelled' | 'stBefore' | 'stError' | 'stStockOnly'> = {
  ok: 'stOk', duplicate: 'stDuplicate', locked: 'stLocked', cancelled: 'stCancelled', before_books: 'stBefore', error: 'stError', stock_only: 'stStockOnly',
};

export function TallyImport({ open, onClose, notify }: TallyImportProps) {
  useT();
  const { can } = useCan();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<TallyParsed | null>(null);
  const [booksBegin, setBooksBegin] = useState('');
  const [opts, setOpts] = useState({ includeOpenings: true, includeVouchers: true, includeStock: true });
  const [mapTo, setMapTo] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<'ledgers' | 'vouchers' | 'problems'>('ledgers');
  const [result, setResult] = useState<{ res: ImportResult; check: { rows: OpeningCheckRow[]; matches: boolean } } | null>(null);

  const existing = useMemo(() => (parsed ? loadExistingBooks() : null), [parsed, result]); // eslint-disable-line react-hooks/exhaustive-deps
  const { plan, planError } = useMemo((): { plan: ImportPlan | null; planError: string } => {
    if (!parsed || !existing || !booksBegin) return { plan: null, planError: '' };
    try {
      return { plan: planTallyImport(parsed, existing, { booksBegin, ...opts, mapTo }), planError: '' };
    } catch (err) {
      return { plan: null, planError: (err as Error).message };
    }
  }, [parsed, existing, booksBegin, opts, mapTo]);

  const reset = () => {
    setParsed(null);
    setResult(null);
    setError('');
    setMapTo({});
  };
  const close = () => {
    reset();
    onClose();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (file.size > MAX_FILE_MB * 1024 * 1024) return setError(migT('tooLarge', { mb: MAX_FILE_MB }));
    setBusy(true);
    try {
      const text = decodeTallyBytes(new Uint8Array(await file.arrayBuffer()));
      const p = parseTallyXml(text, parseWithDom);
      setParsed(p);
      setBooksBegin(storedBooksBegin() || suggestBooksBegin(p, isoDay(new Date())));
    } catch (err) {
      setError(migT('readFailed', { msg: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!plan) return;
    setBusy(true);
    setError('');
    try {
      if (!(await saveSafetySnapshot('import')) && !window.confirm(migT('noUndoCopy'))) return;
      const res = applyTallyImport(plan);
      setResult({ res, check: openingCheck(plan, res.ledgerIds) });
      notify?.(migT('doneTitle'), 'success');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    setBusy(true);
    try {
      const snap = await getSafetySnapshot();
      if (snap) {
        restoreBackup(snap.data);
        await clearSafetySnapshot();
      }
      notify?.(migT('undone'), 'info');
      setTimeout(reloadAfterFlush, 600);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const accountChoices = existing ? existing.chart.filter((a) => !a.id.startsWith('new:')) : [];

  let body: React.ReactNode;
  if (!can('data.restore')) {
    body = <p className={styles.warnBox}>{migT('impOwnerOnly')}</p>;
  } else if (result) {
    const r = result.res;
    body = (
      <div className={styles.stack}>
        <p className={styles.note}>{migT('doneCounts', { groups: r.groups, accounts: r.accounts, clients: r.clients, vendors: r.vendors, openings: r.openings, bills: r.openingBills, stock: r.stockItems, vouchers: r.vouchers })}</p>
        {r.stockMoves ? <p className={styles.note}>{vtT('stockMoves')}: {r.stockMoves}</p> : null}
        {r.failed.length > 0 && (
          <div className={styles.warnBox}>
            <strong>{migT('refused', { n: r.failed.length })}</strong>
            <ul className={styles.list}>{r.failed.slice(0, 20).map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        )}
        {result.check.rows.length > 0 && (
          <>
            <strong>{migT('tbCheck')}</strong>
            <p className={result.check.matches ? styles.okText : styles.badText}>{result.check.matches ? migT('tbMatches') : migT('tbDiffers')}</p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead><tr><th>{migT('colLedger')}</th><th className={styles.num}>{migT('colTally')}</th><th className={styles.num}>{migT('colBooks')}</th></tr></thead>
                <tbody>
                  {result.check.rows.slice(0, ROWS).map((row) => (
                    <tr key={row.ledger}><td>{row.ledger}</td><td className={styles.num}>{drcr(row.tally)}</td><td className={styles.num}>{drcr(row.books)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className={styles.muted}>{migT('caNote')}</p>
      </div>
    );
  } else if (!parsed) {
    body = (
      <div className={styles.stack}>
        <strong>{migT('howTitle')}</strong>
        <ol className={styles.how}>
          <li>{migT('how1')}</li>
          <li>{migT('how2')}</li>
          <li>{migT('how3')}</li>
        </ol>
        <p className={styles.note}>{migT('gstNote')}</p>
        <label className={`${controls.btnPrimary} ${controls.btn}`} style={{ alignSelf: 'flex-start' }}>
          <Upload size={16} aria-hidden="true" /> {busy ? migT('reading') : migT('chooseFile')}
          <input type="file" accept=".xml,text/xml,application/xml" hidden disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
      </div>
    );
  } else if (plan) {
    const c = plan.counts;
    const problems = [...plan.errors, ...plan.warnings, ...plan.ledgers.flatMap((l) => l.issues.map((i) => `${l.rec.name}: ${i}`))];
    const vouchersShown = plan.vouchers.slice(0, ROWS);
    body = (
      <div className={styles.stack}>
        <strong>{migT('previewTitle')}</strong>
        {plan.company && <p className={styles.muted}>{migT('company')}: {plan.company}</p>}
        <div className={styles.options}>
          <label className={controls.field}>
            <span className={controls.label}>{migT('booksBegin')}</span>
            <input type="date" className={controls.input} value={booksBegin} onChange={(e) => setBooksBegin(e.target.value)} />
            <span className={controls.hint}>{migT('booksBeginHint')}</span>
          </label>
          {(['includeOpenings', 'includeVouchers', 'includeStock'] as const).map((k) => (
            <label key={k} className={controls.check}>
              <input type="checkbox" checked={opts[k]} onChange={(e) => setOpts({ ...opts, [k]: e.target.checked })} />
              {migT(k === 'includeOpenings' ? 'incOpenings' : k === 'includeVouchers' ? 'incVouchers' : 'incStock')}
            </label>
          ))}
        </div>
        <div className={styles.summary} role="list">
          {[
            [migT('sumGroups'), `${c.groupsNew} ${migT('newWord')} · ${c.groupsExisting} ${migT('existingWord')}`],
            [migT('sumLedgers'), `${c.accountsNew} ${migT('newWord')} · ${c.accountsExisting} ${migT('existingWord')}`],
            [migT('sumParties'), `${c.clientsNew + c.vendorsNew} ${migT('newWord')} · ${c.clientsExisting + c.vendorsExisting} ${migT('existingWord')}`],
            [migT('sumOpenings'), `${c.openings} · ${c.openingBills}`],
            [migT('sumStock'), `${c.stockNew} ${migT('newWord')}`],
            [vtT('stockMoves'), vtT('stockMovesCount', { ok: (plan.stockMoves ?? []).filter((m) => m.status === 'ok').length, skip: (plan.stockMoves ?? []).filter((m) => m.status !== 'ok').length })],
            [migT('sumVouchers'), String(c.vouchersOk)],
            [migT('sumDuplicates'), String(c.vouchersDuplicate)],
            [migT('sumSkipped'), String(c.vouchersSkipped)],
            [migT('sumErrors'), String(c.vouchersError)],
          ].map(([k, v]) => (
            <div key={k} className={styles.tile} role="listitem"><span className={styles.tileValue}>{v}</span><span className={styles.tileLabel}>{k}</span></div>
          ))}
        </div>
        {opts.includeOpenings && (
          <p className={plan.openingTotals.diff ? styles.warnBox : styles.note}>
            {migT('openingTb')}: {rs(plan.openingTotals.dr)} Dr · {rs(plan.openingTotals.cr)} Cr — {plan.openingTotals.diff ? migT('openingDiff', { amount: drcr(plan.openingTotals.diff) }) : migT('openingOk')}
          </p>
        )}
        <div className={styles.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'ledgers'} className={tab === 'ledgers' ? styles.tabActive : styles.tab} onClick={() => setTab('ledgers')}>{migT('tabLedgers', { n: plan.ledgers.length })}</button>
          <button type="button" role="tab" aria-selected={tab === 'vouchers'} className={tab === 'vouchers' ? styles.tabActive : styles.tab} onClick={() => setTab('vouchers')}>{migT('tabVouchers', { n: plan.vouchers.length })}</button>
          <button type="button" role="tab" aria-selected={tab === 'problems'} className={tab === 'problems' ? styles.tabActive : styles.tab} onClick={() => setTab('problems')}>{migT('tabProblems', { n: problems.length })}</button>
        </div>
        {tab === 'ledgers' && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>{migT('colLedger')}</th><th>{migT('colTallyGroup')}</th><th>{migT('colBecomes')}</th><th className={styles.num}>{migT('colOpening')}</th></tr></thead>
              <tbody>
                {plan.ledgers.slice(0, ROWS).map((l) => {
                  const t = l.target;
                  const key = l.rec.name.trim().toLowerCase();
                  return (
                    <tr key={l.rec.name}>
                      <td>{l.rec.name}{l.issues.length > 0 && <div className={styles.muted}>{l.issues[0]}</div>}</td>
                      <td className={styles.muted}>{l.rec.parent || '—'}</td>
                      <td>
                        {t.kind === 'client' || t.kind === 'vendor' ? (
                          <span className={styles.chip}>{migT(t.kind === 'client' ? 'tClient' : 'tVendor')}{t.existingId ? ` · ${migT('existingWord')}` : ''}</span>
                        ) : (
                          <select className={controls.select} aria-label={`${migT('mapAs')} ${l.rec.name}`} value={mapTo[key] ?? (t.existing === true ? t.accountId : '')}
                            onChange={(e) => setMapTo((m) => { const n = { ...m }; if (e.target.value) n[key] = e.target.value; else delete n[key]; return n; })}>
                            <option value="">{migT('mapNew')}</option>
                            {accountChoices.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                          </select>
                        )}
                      </td>
                      <td className={styles.num}>{drcr(l.rec.opening)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {plan.ledgers.length > ROWS && <p className={styles.muted}>{migT('moreRows', { n: plan.ledgers.length - ROWS })}</p>}
          </div>
        )}
        {tab === 'vouchers' && (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>{migT('colDate')}</th><th>{migT('colType')}</th><th>{migT('colNumber')}</th><th className={styles.num}>{migT('colAmount')}</th><th>{migT('colStatus')}</th></tr></thead>
              <tbody>
                {vouchersShown.map((v, i) => (
                  <tr key={`${v.tag}-${i}`}>
                    <td>{v.rec.date}</td>
                    <td>{v.rec.vtype}</td>
                    <td>{v.rec.number}</td>
                    <td className={styles.num}>{rs(v.lines.reduce((s, l) => s + l.dr, 0))}</td>
                    <td>
                      <span className={v.status === 'ok' ? styles.chipOk : v.status === 'error' ? styles.chipBad : styles.chipWarn}>{migT(STATUS_KEY[v.status])}</span>
                      {v.reason && <div className={styles.muted}>{v.reason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.vouchers.length > ROWS && <p className={styles.muted}>{migT('moreRows', { n: plan.vouchers.length - ROWS })}</p>}
          </div>
        )}
        {tab === 'problems' && (problems.length ? <ul className={styles.list}>{problems.slice(0, ROWS).map((p, i) => <li key={i}>{p}</li>)}</ul> : <p className={styles.okText}>{migT('noProblems')}</p>)}
        <p className={styles.note}>{migT('gstNote')} {migT('undoNote')}</p>
        <p className={styles.muted}>{migT('caNote')}</p>
      </div>
    );
  } else body = null;

  const footer = (
    <div className={styles.footer}>
      {result ? (
        <>
          <button type="button" className={`${controls.btnOutline} ${controls.btn}`} disabled={busy} onClick={() => void undo()}>
            <RotateCcw size={16} aria-hidden="true" /> {migT('undoImport')}
          </button>
          <button type="button" className={`${controls.btnPrimary} ${controls.btn}`} onClick={() => { close(); setTimeout(reloadAfterFlush, 0); }}>{migT('close')}</button>
        </>
      ) : parsed ? (
        <>
          <button type="button" className={`${controls.btnOutline} ${controls.btn}`} disabled={busy} onClick={reset}>{migT('back')}</button>
          <button type="button" className={`${controls.btnPrimary} ${controls.btn}`} disabled={busy || !plan} onClick={() => void runImport()}>
            <FileCode2 size={16} aria-hidden="true" /> {busy ? migT('importing') : migT('importNow', { n: plan?.counts.vouchersOk ?? 0 })}
          </button>
        </>
      ) : (
        <button type="button" className={`${controls.btnOutline} ${controls.btn}`} onClick={close}>{migT('close')}</button>
      )}
    </div>
  );

  return (
    <Modal open={open} onClose={close} size="xl" title={migT('impTitle')} subtitle={migT('impSubtitle')} footer={footer}>
      {(error || planError) && <p className={styles.errBox} role="alert">{error || planError}</p>}
      {body}
    </Modal>
  );
}
