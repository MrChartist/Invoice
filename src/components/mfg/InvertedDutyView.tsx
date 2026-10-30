/**
 * MF-C5 Rule 89(5) inverted-duty working paper (lazy): the period's outward and inward lines, the inverted output rates,
 * documents to leave out, the formula, and a DRAFT `INVERTED_DUTY` claim in the existing refund register. Verify with your CA.
 */
import { useMemo, useState } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import { inwardLines, outwardLines, prefillInvertedClaim, rule895, suggestInvertedRates } from '../../lib/mfg/mf-inverted';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { useT } from '../../i18n';
import { iT } from '../../i18n/areas/mfg-r13c-inv';
import controls from '../../styles/controls.module.css';
import PendingNote from '../ui/PendingNote';
import { DateField } from '../ui/DateField';

const q = (d: string) => `${d.slice(0, 5)}${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

export default function InvertedDutyView({ onDone }: { onDone?: (msg: string, error?: boolean) => void }) {
  useT();
  const now = new Date().toLocaleDateString('en-CA');
  const [from, setFrom] = useState(q(now));
  const [to, setTo] = useState(now);
  const outs = useMemo(() => outwardLines(getTable<InvoiceRecord>('invoices'), from, to), [from, to]);
  const ins = useMemo(() => inwardLines(getTable<unknown>('purchases'), from, to), [from, to]);
  const [rates, setRates] = useState<number[] | null>(null);
  const [ex, setEx] = useState<Set<string>>(new Set());
  const pick = rates ?? suggestInvertedRates(outs, ins);
  const r = rule895(outs, ins, pick, to, ex);
  const outRates = [...new Set(outs.map((l) => l.rate))].filter((x) => x > 0).sort((a, b) => a - b);
  const docs = [...new Map([...outs.filter((l) => pick.includes(l.rate)), ...ins.filter((l) => !l.service && !l.capital)].map((l) => [l.doc_id, l])).values()];
  const prefill = () => {
    try {
      prefillInvertedClaim({ from, to, refund: r.refund, gstin: localDb.settings.activeProfile()?.companyGstin });
      onDone?.(iT('prefilled'));
    } catch (e) {
      onDone?.((e as Error).message, true);
    }
  };
  const row = { display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' } as const;
  return (
    <section data-mfc-inverted>
      <h3>{iT('title')}</h3>
      <PendingNote area="refund" day={to} />
      <div style={row}>
        <label className={controls.field}><span className={controls.label}>{iT('from')}</span><DateField className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className={controls.field}><span className={controls.label}>{iT('to')}</span><DateField className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <span>{iT('rates')}:</span>
        {outRates.map((x) => <label key={x}><input type="checkbox" checked={pick.includes(x)} onChange={(e) => setRates(e.target.checked ? [...pick, x] : pick.filter((y) => y !== x))} /> {x}%</label>)}
      </div>
      <table data-mfc-inv-result><tbody>
        {([['inverted', r.invertedTurnover], ['att', r.att], ['netItc', r.netItc], ['availed', r.itcAvailed], ['tax', r.taxPayable], ['first', r.first], ['second', r.second], ['refund', r.refund]] as const).map(([k, v]) => <tr key={k}><th style={{ textAlign: 'left' }}>{iT(k)}</th><td>₹{fmt(v)}</td></tr>)}
      </tbody></table>
      {r.notes.map((n) => <p key={n} className={controls.hint}>{n}</p>)}
      <details><summary>{iT('exclude', { n: ex.size })}</summary>
        {docs.map((l) => <label key={l.doc_id} style={{ display: 'block' }}><input type="checkbox" checked={ex.has(l.doc_id)} onChange={(e) => { const s = new Set(ex); if (e.target.checked) s.add(l.doc_id); else s.delete(l.doc_id); setEx(s); }} /> {l.doc} · {l.date} · {l.rate}%</label>)}
      </details>
      {r.refund > 0 && <button type="button" className={controls.btnPrimary} onClick={prefill} data-mfc="inv-prefill">{iT('prefill')}</button>}
    </section>
  );
}
