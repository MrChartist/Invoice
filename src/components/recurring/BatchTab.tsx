import { lazy, Suspense, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Layers, RotateCcw } from 'lucide-react';
import type { Client, InvoiceRecord } from '../../types/invoice';
import {
  BatchError, batchRunsDb, batchToRecurring, buildBatchDrafts, issueBatch, matchPastedParties, partyKey, templateFromDocument, undoBatch,
  type BatchParty, type BatchSourceKind, type IssueResult,
} from '../../lib/batch-invoices';
import { recurringDb, type Frequency, type RecurringMode } from '../../lib/recurring';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { creditStatus } from '../../lib/credit-policy';
import { formatPlaceOfSupply } from '../../lib/india-states';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { s2T } from '../../i18n/areas/sales-r2';
import { recT } from '../../i18n/areas/recurring';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './batch.module.css';

const BatchPdfModal = lazy(() => import('../preview/BatchPdfModal').then((m) => ({ default: m.BatchPdfModal })));
const RemindQueue = lazy(() => import('../khata/RemindQueue'));

const FREQS: Frequency[] = ['weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly'];
type Over = { qty?: string; rate?: string; notes?: string; po?: string };
const isBill = (t: string) => t === 'INVOICE' || t === 'TAX_INVOICE' || t === 'BILL_OF_SUPPLY';

/**
 * R2-B1: batch invoices — one source (saved invoice, quotation or recurring template) × many parties,
 * per-party overrides, a preview (place of supply, GST split, credit and e-invoice flags), issue in one
 * all-or-nothing step, undo a run, and "Save as batch recurring".
 */
export function BatchTab() {
  useT(); // re-render on a language switch (5.4)
  const [version, setVersion] = useState(0);
  const docs = useMemo(() => {
    void version;
    return localDb.invoices.getAll().filter((i) => i.status !== 'Cancelled').sort((a, b) => (b.issue_date ?? '').localeCompare(a.issue_date ?? ''));
  }, [version]);
  const schedules = useMemo(() => recurringDb.getAll(), []);
  const clients = useMemo(() => {
    void version;
    return localDb.clients.getAll().sort((a, b) => a.name.localeCompare(b.name));
  }, [version]);
  const areas = useMemo(() => getTable<{ id: string; name: string }>('dist_areas'), []);
  const beats = useMemo(() => getTable<{ id: string; name: string }>('dist_beats'), []);
  const groups = useMemo(() => getTable<{ id: string; name: string }>('groups'), []);

  const [kind, setKind] = useState<BatchSourceKind>('invoice');
  const [sourceId, setSourceId] = useState('');
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('');
  const [beat, setBeat] = useState('');
  const [group, setGroup] = useState('');
  const [selected, setSelected] = useState<Map<string, Client>>(() => new Map());
  const [over, setOver] = useState<Record<string, Over>>({});
  const [paste, setPaste] = useState('');
  const [unknown, setUnknown] = useState<string[]>([]);
  const [date, setDate] = useState(todayInput());
  const [mode, setMode] = useState<RecurringMode>('draft');
  const [force, setForce] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IssueResult | null>(null);
  const [pdf, setPdf] = useState<InvoiceRecord[] | null>(null);
  const [remind, setRemind] = useState(false);
  const [rec, setRec] = useState<{ open: boolean; freq: Frequency; start: string }>({ open: false, freq: 'monthly', start: todayInput() });
  const [undoing, setUndoing] = useState<{ id: string; reason: string } | null>(null);
  const [note, setNote] = useState('');

  const sources = kind === 'recurring'
    ? schedules.map((s) => ({ id: s.id, label: `${s.name} — ${s.template.client.name}` }))
    : docs.filter((d) => (kind === 'invoice' ? isBill(d.doc_type) : d.doc_type === 'QUOTATION')).slice(0, 200).map((d) => ({ id: d.id, label: `${d.invoice_number} — ${d.client?.name ?? ''} · ${formatCurrency(d.total, d.currency || 'INR')}` }));
  const template = useMemo(() => {
    if (!sourceId) return null;
    if (kind === 'recurring') return recurringDb.getById(sourceId)?.template ?? null;
    const d = docs.find((x) => x.id === sourceId);
    return d ? templateFromDocument(d) : null;
  }, [kind, sourceId, docs]);

  const shown = clients.filter((c) => {
    const q = query.trim().toLowerCase();
    if (q && ![c.name, c.company, c.gstin, c.city].some((f) => f?.toLowerCase().includes(q))) return false;
    if (area && c.area_id !== area) return false;
    if (beat && c.beat_id !== beat) return false;
    if (group && c.group_id !== group) return false;
    return true;
  });
  const toggle = (c: Client, on: boolean) => {
    const next = new Map(selected);
    if (on) next.set(partyKey(c), c);
    else next.delete(partyKey(c));
    setSelected(next);
  };
  const parties: BatchParty[] = [...selected.entries()].map(([key, client]) => {
    const o = over[key] ?? {};
    return {
      key, client, override: {
        ...(o.qty ? { qty: Number(o.qty) } : {}), ...(o.rate ? { rate: Number(o.rate) } : {}),
        ...(o.notes ? { notes: o.notes } : {}), ...(o.po ? { po_number: o.po } : {}),
      },
    };
  });
  const partiesKey = JSON.stringify(parties.map((p) => [p.key, p.override]));
  const drafts = useMemo(() => {
    if (!template || !parties.length) return [];
    const profile = localDb.settings.activeProfile() ?? template.sender;
    return buildBatchDrafts(template, parties, {
      date, dueDays: Number(localDb.settings.get().defaultDueDays) || 14, sender: profile,
      creditWarning: (d) => creditStatus(d)?.check.warnings[0] ?? '',
    });
  }, [template, partiesKey, date]); // eslint-disable-line react-hooks/exhaustive-deps

  const issue = () => {
    setError('');
    setNote('');
    try {
      const label = sources.find((s) => s.id === sourceId)?.label;
      const res = issueBatch(drafts, { sourceId, sourceKind: kind, sourceLabel: label, date, mode, force });
      setResult(res);
      setForce(false);
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof BatchError && /already issued/.test(err.message)) setForce(false);
    }
  };
  const toRecurring = () => {
    setError('');
    try {
      if (!template) return;
      const n = batchToRecurring(template, parties, { name: sources.find((s) => s.id === sourceId)?.label.split(' — ')[0] ?? 'Batch', frequency: rec.freq, start_date: rec.start, mode });
      setNote(s2T('b.recurringDone', { n }));
      setRec({ ...rec, open: false });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const doUndo = () => {
    if (!undoing) return;
    setError('');
    try {
      const r = undoBatch(undoing.id, { cancelReason: undoing.reason });
      setNote(`${s2T('b.undone', { removed: r.removed, cancelled: r.cancelled })}${r.kept.length ? ` ${s2T('b.kept', { n: r.kept.length })}` : ''}`);
      setUndoing(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const runs = useMemo(() => {
    void version;
    return batchRunsDb.all().slice().sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
  }, [version]);
  const totals = drafts.reduce((s, d) => s + d.record.total, 0);

  return (
    <div className={styles.wrap} data-batch-tab>
      <section className={surface.card}>
        <div className={styles.body}>
          <h2 className={styles.h}><Layers size={18} aria-hidden="true" /> {s2T('b.title')}</h2>
          <p className={styles.muted}>{s2T('b.intro')}</p>
          {error && <p className={controls.error} role="alert">{error}</p>}
          {note && <p className={controls.ok} role="status">{note}</p>}

          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>{s2T('b.source')}</span>
              <select className={controls.select} value={kind} onChange={(e) => { setKind(e.target.value as BatchSourceKind); setSourceId(''); }} data-batch-kind>
                <option value="invoice">{s2T('b.kindInvoice')}</option>
                <option value="quotation">{s2T('b.kindQuote')}</option>
                <option value="recurring">{s2T('b.kindRecurring')}</option>
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{s2T('b.pickSource')}</span>
              <select className={controls.select} value={sourceId} onChange={(e) => setSourceId(e.target.value)} data-batch-source>
                <option value="">—</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
          </div>
          {sources.length === 0 && <p className={styles.muted}>{s2T('b.noSources')}</p>}

          <h3 className={styles.h3}>{s2T('b.parties')} <span className={styles.muted}>{s2T('b.nSelected', { n: selected.size })}</span></h3>
          <div className={styles.filters}>
            <input className={controls.input} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s2T('b.search')} aria-label={s2T('b.search')} data-batch-search />
            {areas.length > 0 && (
              <select className={controls.select} value={area} onChange={(e) => setArea(e.target.value)} aria-label={s2T('b.area')}>
                <option value="">{s2T('b.area')}: {s2T('b.all')}</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}
            {beats.length > 0 && (
              <select className={controls.select} value={beat} onChange={(e) => setBeat(e.target.value)} aria-label={s2T('b.beat')}>
                <option value="">{s2T('b.beat')}: {s2T('b.all')}</option>
                {beats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
            {groups.length > 0 && (
              <select className={controls.select} value={group} onChange={(e) => setGroup(e.target.value)} aria-label={s2T('b.group')}>
                <option value="">{s2T('b.group')}: {s2T('b.all')}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            )}
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => { const next = new Map(selected); shown.forEach((c) => next.set(partyKey(c), c)); setSelected(next); }} data-batch-select-all>
              {s2T('b.selectShown')}
            </button>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setSelected(new Map())}>{s2T('b.clearSel')}</button>
          </div>
          <div className={styles.partyList}>
            {shown.slice(0, 300).map((c) => (
              <label key={partyKey(c)} className={styles.party}>
                <input type="checkbox" checked={selected.has(partyKey(c))} onChange={(e) => toggle(c, e.target.checked)} />
                <span>{c.name}</span>
                <span className={styles.muted}>{[c.city, c.gstin].filter(Boolean).join(' · ')}</span>
              </label>
            ))}
          </div>
          <div className={styles.pasteRow}>
            <textarea className={controls.textarea} rows={2} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={s2T('b.paste')} aria-label={s2T('b.paste')} />
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!paste.trim()}
              onClick={() => {
                const m = matchPastedParties(paste, clients);
                const next = new Map(selected);
                m.matched.forEach((c) => next.set(partyKey(c), c));
                setSelected(next);
                setUnknown(m.unknown);
                if (!m.unknown.length) setPaste('');
              }}>{s2T('b.match')}</button>
          </div>
          {unknown.length > 0 && <p className={controls.error}>{s2T('b.unknown', { names: unknown.join(', ') })}</p>}

          {selected.size > 0 && (
            <>
              <h3 className={styles.h3}>{s2T('b.overrides')}</h3>
              <div className={styles.scroll}>
                <table className={styles.table}>
                  <thead>
                    <tr><th>{s2T('party')}</th><th>{s2T('qty')}</th><th>{s2T('rate')}</th><th>{s2T('notes')}</th><th>{s2T('b.po')}</th></tr>
                  </thead>
                  <tbody>
                    {[...selected.entries()].map(([key, c]) => (
                      <tr key={key}>
                        <td>{c.name}</td>
                        {(['qty', 'rate', 'notes', 'po'] as const).map((f) => (
                          <td key={f}>
                            <input className={`${controls.input} ${f === 'qty' || f === 'rate' ? `${controls.inputNumeric} ${styles.num}` : ''}`}
                              inputMode={f === 'qty' || f === 'rate' ? 'decimal' : undefined} value={over[key]?.[f] ?? ''}
                              onChange={(e) => setOver({ ...over, [key]: { ...over[key], [f]: f === 'qty' || f === 'rate' ? e.target.value.replace(/[^0-9.]/g, '') : e.target.value } })}
                              aria-label={`${f} ${c.name}`} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>{s2T('b.issueDate')}</span>
              <input className={controls.input} type="date" value={date} onChange={(e) => setDate(e.target.value || todayInput())} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{s2T('b.mode')}</span>
              <select className={controls.select} value={mode} onChange={(e) => setMode(e.target.value as RecurringMode)} data-batch-mode>
                <option value="draft">{s2T('b.modeDraft')}</option>
                <option value="issue">{s2T('b.modeIssue')}</option>
              </select>
            </label>
          </div>
        </div>
      </section>

      {drafts.length > 0 && (
        <section className={surface.card}>
          <div className={styles.body}>
            <h3 className={styles.h3}>{s2T('b.preview')} · {formatCurrency(totals, drafts[0].record.currency || 'INR')}</h3>
            <div className={styles.scroll}>
              <table className={styles.table} data-batch-preview>
                <thead>
                  <tr><th>{s2T('party')}</th><th>{s2T('b.pos')}</th><th>{s2T('b.gst')}</th><th className={styles.num}>{s2T('total')}</th><th>{s2T('b.credit')}</th><th>{s2T('b.einv')}</th></tr>
                </thead>
                <tbody>
                  {drafts.map((d) => (
                    <tr key={d.party.key}>
                      <td>{d.party.client.name}</td>
                      <td className={d.stateWarning ? styles.warn : undefined} title={d.stateWarning ? s2T('b.noState') : undefined}>
                        {formatPlaceOfSupply(d.record.place_of_supply) || '—'}{d.stateWarning ? ' ⚠' : ''}
                      </td>
                      <td>{d.record.gst_mode === 'IGST' ? 'IGST' : d.record.gst_mode === 'CGST_SGST' ? 'CGST + SGST' : '—'}</td>
                      <td className={styles.num}>{formatCurrency(d.record.total, d.record.currency || 'INR')}</td>
                      <td className={d.creditWarning ? styles.warn : styles.muted}>{d.creditWarning || '—'}</td>
                      <td>{d.einvoice === 'yes' ? s2T('b.einvYes') : d.einvoice === 'no' ? s2T('b.einvNo') : s2T('b.einvUnknown')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {drafts.some((d) => d.stateWarning) && <p className={styles.warn}>{s2T('b.noState')}</p>}
            <p className={styles.muted}>{s2T('b.einvNote')}</p>
            <div className={styles.actions}>
              {/already issued/.test(error) && (
                <label className={controls.check}>
                  <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> {s2T('b.issueAgain')}
                </label>
              )}
              <button type="button" className={controls.btnPrimary} onClick={issue} data-batch-issue>{s2T('b.issue', { n: drafts.length })}</button>
              <button type="button" className={controls.btnOutline} onClick={() => setRec({ ...rec, open: !rec.open })}>{s2T('b.asRecurring')}</button>
            </div>
            {rec.open && (
              <div className={controls.row}>
                <label className={controls.field}>
                  <span className={controls.label}>{s2T('b.frequency')}</span>
                  <select className={controls.select} value={rec.freq} onChange={(e) => setRec({ ...rec, freq: e.target.value as Frequency })}>
                    {FREQS.map((f) => <option key={f} value={f}>{recT(`freq.${f}` as Parameters<typeof recT>[0])}</option>)}
                  </select>
                </label>
                <label className={controls.field}>
                  <span className={controls.label}>{s2T('b.start')}</span>
                  <input className={controls.input} type="date" value={rec.start} onChange={(e) => setRec({ ...rec, start: e.target.value || todayInput() })} />
                </label>
                <button type="button" className={controls.btnPrimary} onClick={toRecurring}>{s2T('save')}</button>
              </div>
            )}
          </div>
        </section>
      )}

      {result && (
        <section className={surface.card} data-batch-result>
          <div className={styles.body}>
            {result.invoices.every((i) => !i.invoice_number)
              ? <p className={controls.ok}>{s2T('b.draftsSaved', { n: result.invoices.length })}</p>
              : <p className={controls.ok}>{s2T('b.issued', { n: result.invoices.length, first: result.invoices.find((i) => i.invoice_number)?.invoice_number ?? '', last: [...result.invoices].reverse().find((i) => i.invoice_number)?.invoice_number ?? '' })}</p>}
            {result.held.length > 0 && (
              <>
                <p className={styles.muted}>{s2T('b.held')}</p>
                <ul className={styles.list}>
                  {result.held.map((h) => <li key={h.invoice.id}><Link to={`/invoice/${h.invoice.id}`}>{h.invoice.invoice_number || s2T('b.unnumbered')}</Link> — {h.reason}</li>)}
                </ul>
              </>
            )}
            <div className={styles.actions}>
              <button type="button" className={controls.btnOutline} onClick={() => setPdf(result.invoices)}>{s2T('b.openPdf')}</button>
              <button type="button" className={controls.btnOutline} onClick={() => setRemind(true)}>{s2T('b.remind')}</button>
            </div>
          </div>
        </section>
      )}

      <section className={surface.card}>
        <div className={styles.body}>
          <h3 className={styles.h3}>{s2T('b.runs')}</h3>
          {runs.length === 0 ? <p className={styles.muted}>{s2T('b.noRuns')}</p> : (
            <ul className={styles.list} data-batch-runs>
              {runs.map((r) => (
                <li key={r.id}>
                  {formatDate(r.date)} · {r.source_label ?? r.source_id} · {r.totals.count} · {formatCurrency(r.totals.total)} · <span className={styles.muted}>{s2T(`b.status.${r.status}`)}</span>
                  {r.status !== 'undone' && (
                    <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setUndoing({ id: r.id, reason: '' })}>
                      <RotateCcw size={14} aria-hidden="true" /> {s2T('b.undo')}
                    </button>
                  )}
                  {undoing?.id === r.id && (
                    <div className={styles.undo}>
                      <p className={styles.muted}>{s2T('b.undoMsg')}</p>
                      <input className={controls.input} value={undoing.reason} onChange={(e) => setUndoing({ ...undoing, reason: e.target.value })} placeholder={s2T('b.cancelReason')} aria-label={s2T('b.cancelReason')} />
                      <div className={styles.actions}>
                        <button type="button" className={controls.btnOutline} onClick={() => setUndoing(null)}>{s2T('cancel')}</button>
                        <button type="button" className={controls.btnDanger} onClick={doUndo} data-batch-undo>{s2T('b.undoTitle')}</button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {pdf && (
        <Suspense fallback={null}>
          <BatchPdfModal invoices={pdf} onClose={() => setPdf(null)} />
        </Suspense>
      )}
      {remind && (
        <Suspense fallback={null}>
          <RemindQueue kind="balance" onClose={() => setRemind(false)} />
        </Suspense>
      )}
    </div>
  );
}
