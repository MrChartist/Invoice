/**
 * TR-C2 statutory prompts, one lazy chunk for four small mounts:
 *  - `RcmGoodsNotice` (bill modal): notified goods bought from an agriculturist / unregistered person → reverse charge?
 *  - `CompositionTracker` (GST → Compliance): FY aggregate turnover against the composition limit;
 *  - `Buyer194qCard` (TDS → Overview): our preceding-FY turnover for the 194Q buyer test;
 *  - `PartyTaxHints` (editor → Advanced tax): Form 27C / 127 declaration, 206C(1F) value check, customer deducts 194Q.
 * Working papers — verify with your CA (TR13–TR17, TR20).
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-r8c';
import { formatCurrency } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { getIndianFY } from '../../lib/invoice-number';
import { isRevenueDoc } from '../../lib/stats';
import { isNonGstFinancialNote } from '../../lib/financial-note';
import { documentTurnover } from '../../lib/composition-returns';
import { requireAccess } from '../../lib/access';
import { setJson } from '../../lib/storage';
import { tdsThreshold } from '../../lib/tds-rules';
import { TDS_SETTINGS_KEY, readTdsSettings } from '../../lib/tds-payables';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { buyer194q, compositionTracker, customer194qDue, precedingFy, presetOfLabel, rcmGoodsMatches, SPECIAL_CATEGORY_STATES, supplierKinds, tcs1fWarning } from '../../lib/trade/tr-statutory';
import type { InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';

export function RcmGoodsNotice({ lines, date, vendor, onApply }: { lines: readonly { hsn?: string }[]; date: string; vendor?: { gstin?: string; principal_kind?: string }; onApply: () => void }) {
  useT();
  const kinds = supplierKinds(vendor);
  const hits = rcmGoodsMatches(lines, kinds, date);
  if (!hits.length) return null;
  const who = kinds.includes('agriculturist') ? 'agriculturist' : kinds.includes('unregistered') ? 'unregistered' : 'maker';
  return (
    <div className={own.notice} role="note" data-rcm-goods>
      <strong>{trT('rcmTitle')}</strong>{' '}
      {hits.map((h) => trT('rcmText', { goods: h.goods, who: trT(`who.${who}`), ref: h.notification })).join(' ')}{' '}
      <button type="button" className={controls.btnGhost} onClick={onApply}>{trT('rcmApply')}</button> <small>{trT('workingPaper')}</small>
    </div>
  );
}

export function CompositionTracker({ invoices, stateCode, today }: { invoices: readonly InvoiceRecord[]; stateCode?: string; today: string }) {
  useT();
  const profile = localDb.settings.activeProfile();
  const fy = getIndianFY(today);
  const turnover = useMemo(() => {
    const from = `${fy.startYear}-04-01`;
    let t = 0;
    for (const r of invoices) {
      const d = String(r.issue_date).slice(0, 10);
      if (d < from || d > today || isNonGstFinancialNote(r)) continue;
      if (isRevenueDoc(r) || (r.doc_type === 'CREDIT_NOTE' && r.status !== 'Draft' && r.status !== 'Cancelled')) t += documentTurnover(r).value;
    }
    return Math.round(t * 100) / 100;
  }, [invoices, today, fy.startYear]);
  if (profile?.gst_scheme !== 'composition') return null;
  const c = compositionTracker(turnover, today, SPECIAL_CATEGORY_STATES.has(stateCode ?? ''));
  return (
    <div className={c.level === 'ok' ? own.muted : `${own.notice}${c.level === 'red' ? ` ${own.danger}` : ''}`} data-composition-tracker={c.level}>
      <strong>{trT('compTitle')}</strong>{' '}
      {trT('compText', { turnover: formatCurrency(turnover), limit: formatCurrency(c.limit), pct: `${Math.round(c.share * 100)}%` })}{' '}
      {c.level === 'amber' && trT('compAmber')}
      {c.level === 'red' && trT('compRed', { n: c.optOutDays })}
    </div>
  );
}

export function Buyer194qCard({ today }: { today: string }) {
  useT();
  const fy = precedingFy(today);
  const [value, setValue] = useState(() => readTdsSettings().turnover_by_fy?.[fy]);
  const status = buyer194q(today, value === undefined ? {} : { [fy]: value }).status;
  const save = (v: number | undefined) => {
    setValue(v);
    try {
      requireAccess('settings.manage');
      const s = readTdsSettings();
      const by = { ...(s.turnover_by_fy ?? {}) };
      if (v === undefined) delete by[fy];
      else by[fy] = v;
      setJson(TDS_SETTINGS_KEY, { ...s, turnover_by_fy: by });
    } catch {
      /* a clerk / viewer sees the figure but cannot change it */
    }
  };
  return (
    <div className={own.stack} data-194q-card>
      <label className={controls.field}>
        <span className={controls.label}>{trT('q194Title')} — {trT('q194Text', { fy })}</span>
        <input type="number" min={0} className={controls.input} style={{ maxWidth: 240 }} value={value ?? ''} onChange={(e) => save(e.target.value === '' ? undefined : Math.max(Number(e.target.value) || 0, 0))} />
      </label>
      <p className={own.muted}>{trT(status === 'applies' ? 'q194Applies' : status === 'below' ? 'q194Below' : 'q194Unknown')} {trT('workingPaper')}</p>
    </div>
  );
}

export function PartyTaxHints() {
  useT();
  const s = useInvoiceStore((x) => x);
  const client = s.client?.id ? localDb.clients.getById(s.client.id) : undefined;
  const [, bump] = useState(0);
  const preset = s.tcs_enabled ? presetOfLabel(s.tcs_label, s.issue_date) : undefined;
  const values = (s.totals?.lines ?? []).map((l) => l.taxable);
  const warn = tcs1fWarning(preset, values);
  const limit = tdsThreshold('194Q', s.issue_date)?.aggregate ?? 0;
  const fySales = useMemo(() => {
    if (!client?.deducts_194q) return 0;
    const from = `${getIndianFY(s.issue_date).startYear}-04-01`;
    return localDb.invoices.getAll().filter((r) => r.client?.id === client.id && r.id !== s.id && isRevenueDoc(r) && r.issue_date >= from && r.issue_date <= s.issue_date).reduce((t, r) => t + (Number(r.taxable_value) || 0), 0) + (Number(s.totals?.taxable_value) || 0);
  }, [client?.id, client?.deducts_194q, s.id, s.issue_date, s.totals?.taxable_value]);
  if (!client) return null;
  const setFlag = (patch: Partial<typeof client>) => {
    try {
      localDb.clients.upsert({ ...client, ...patch });
      bump((n) => n + 1);
    } catch {
      /* viewers cannot change clients */
    }
  };
  return (
    <div className={own.stack} data-party-tax-hints>
      {s.tcs_enabled && (
        <label className={controls.check}>
          <input type="checkbox" checked={!!client.tcs_declaration} onChange={(e) => setFlag({ tcs_declaration: e.target.checked ? { on: s.issue_date } : undefined })} /> {trT('tcsDecl')}
        </label>
      )}
      {warn && <p className={own.notice} role="note">{trT('tcs1fWarn')}</p>}
      <label className={controls.check}>
        <input type="checkbox" checked={!!client.deducts_194q} onChange={(e) => setFlag({ deducts_194q: e.target.checked || undefined })} /> {trT('deducts194q')}
      </label>
      {client.deducts_194q && customer194qDue(fySales, limit) && <p className={own.notice} role="note">{trT('deducts194qDue', { limit: formatCurrency(limit) })}</p>}
    </div>
  );
}
