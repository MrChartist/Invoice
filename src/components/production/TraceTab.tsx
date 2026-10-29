import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ListTree } from 'lucide-react';
import { cn, formatDate } from '../../lib/utils';
import { getTable } from '../../lib/storage';
import { collectEvents } from '../../lib/inventory';
import { batchesOnDocument, buildGenealogy, traceBackward, traceForward, traceSerial, type TraceNode } from '../../lib/production/genealogy';
import type { InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { pT } from '../../i18n/areas/production-r4';
import { qtyText, type MfgContext } from '../manufacturing/context';
import { RecallList } from './RecallList';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import mfg from '../manufacturing/manufacturing.module.css';
import styles from './production.module.css';

type Dir = 'back' | 'fwd';

/** /manufacturing?tab=trace — batch genealogy (backward / forward) and the recall list (R4-A3). */
export function TraceTab({ ctx }: { ctx: MfgContext }) {
  useT();
  const [params, setParams] = useSearchParams();
  const [dir, setDir] = useState<Dir>(params.get('dir') === 'fwd' ? 'fwd' : 'back');
  const [itemId, setItemId] = useState(params.get('item') ?? '');
  const [batch, setBatch] = useState(params.get('batch') ?? '');
  const [serial, setSerial] = useState(params.get('serial') ?? '');
  const [doc, setDoc] = useState('');
  const [query, setQuery] = useState<{ dir: Dir; itemId: string; batch: string; serial: string; doc: string } | null>(() => (params.get('item') ? { dir: params.get('dir') === 'fwd' ? 'fwd' : 'back', itemId: params.get('item') ?? '', batch: params.get('batch') ?? '', serial: params.get('serial') ?? '', doc: '' } : null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const index = useMemo(() => buildGenealogy(collectEvents({ ...ctx.inputs, includeTransfers: true })), [ctx.inputs, ctx.version]);
  const tracked = useMemo(() => ctx.items.filter((i) => i.track_stock && (i.track_batches || i.track_serials)).sort((a, b) => a.name.localeCompare(b.name)), [ctx.items]);
  const item = ctx.items.find((i) => i.id === itemId);
  const batchList = useMemo(() => {
    const t = ctx.inputs && itemId ? [...index.nodes.keys()].filter((k) => k.startsWith(`${itemId}|`) && k.length > itemId.length + 1).map((k) => k.slice(itemId.length + 1)) : [];
    return [...new Set(t)].sort();
  }, [index, itemId, ctx.inputs]);
  const name = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? '?';

  const run = () => {
    setQuery({ dir, itemId, batch, serial, doc });
    setParams((p) => { p.set('dir', dir); if (itemId) p.set('item', itemId); else p.delete('item'); if (batch) p.set('batch', batch); else p.delete('batch'); if (serial) p.set('serial', serial); else p.delete('serial'); return p; }, { replace: true });
  };

  const result = useMemo(() => {
    if (!query) return null;
    if (query.dir === 'fwd') return { fwd: traceForward(index, [{ itemId: query.itemId, batch: query.batch }]) };
    if (query.doc.trim()) {
      const d = getTable<InvoiceRecord>('invoices').find((x) => (x.invoice_number ?? '').trim().toUpperCase() === query.doc.trim().toUpperCase());
      const keys = d ? batchesOnDocument(index, d.id, query.itemId || undefined) : [];
      return { back: keys.map((k) => traceBackward(index, k.itemId, k.batch)), docFound: !!d };
    }
    if (query.serial.trim() && query.itemId) return { back: [traceSerial(index, query.itemId, query.serial)] };
    return { back: query.itemId && query.batch ? [traceBackward(index, query.itemId, query.batch)] : [] };
  }, [query, index]);

  return (
    <>
      <p className={mfg.muted} style={{ margin: '0 0 0.75rem' }}>{pT('traceIntro')}</p>
      <div className={styles.inline}>
        <div className={controls.segment} role="group" aria-label={pT('direction')}>
          {(['back', 'fwd'] as const).map((k) => <button key={k} type="button" aria-pressed={dir === k} className={dir === k ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setDir(k)}>{pT(k === 'back' ? 'traceBack' : 'traceFwd')}</button>)}
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="tr-item">{pT('item')}</label>
          <select id="tr-item" className={controls.select} value={itemId} onChange={(e) => { setItemId(e.target.value); setBatch(''); }}>
            <option value="">{pT('choose')}</option>
            {tracked.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="tr-batch">{pT('batch')}</label>
          <input id="tr-batch" className={controls.input} list="tr-batches" value={batch} onChange={(e) => setBatch(e.target.value)} />
          <datalist id="tr-batches">{batchList.map((b) => <option key={b} value={b} />)}</datalist>
        </div>
        {dir === 'back' && item?.track_serials && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor="tr-serial">{pT('serial')}</label>
            <input id="tr-serial" className={controls.input} value={serial} onChange={(e) => setSerial(e.target.value)} />
          </div>
        )}
        {dir === 'back' && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor="tr-doc">{pT('saleDoc')}</label>
            <input id="tr-doc" className={controls.input} value={doc} placeholder="INV/FY26-27/0001" onChange={(e) => setDoc(e.target.value)} />
          </div>
        )}
        <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={run} disabled={!itemId && !doc.trim()} data-testid="trace-run"><ListTree size={14} aria-hidden="true" /> {pT('trace')}</button>
      </div>

      {result?.back && (
        <section style={{ marginTop: '1rem' }} aria-label={pT('traceBack')}>
          {result.back.length === 0 ? <p className={mfg.muted}>{result.docFound === false ? pT('docNotFound') : pT('nothingTraced')}</p> : (
            <ul className={styles.tree}>{result.back.map((n, i) => <Node key={i} n={n} name={name} />)}</ul>
          )}
        </section>
      )}
      {result?.fwd && (
        <section style={{ marginTop: '1rem' }} aria-label={pT('traceFwd')}>
          <p className={mfg.section}>{pT('batchesReached')}</p>
          <ul className={styles.tree}>{result.fwd.batches.map((b) => <li key={`${b.itemId}|${b.batch}`}>{'↳ '.repeat(b.depth)}{name(b.itemId)} · {b.batch}{b.mixed && <span className={styles.mixed}>{pT('mixed')}</span>}</li>)}</ul>
          {result.fwd.consumedBy.length > 0 && <p className={mfg.muted}>{pT('consumedBy')}: {[...new Set(result.fwd.consumedBy.map((c) => c.refNumber))].join(', ')}</p>}
          <p className={mfg.section} style={{ marginTop: '0.75rem' }}>{pT('wentOut')}</p>
          <div className={surface.tableWrap}>
            <table className={surface.table} data-testid="trace-out">
              <thead><tr><th>{pT('document')}</th><th>{pT('date')}</th><th>{pT('party')}</th><th>{pT('item')}</th><th>{pT('batch')}</th><th className={mfg.num}>{pT('qty')}</th><th>{pT('kind')}</th></tr></thead>
              <tbody>
                {[...result.fwd.outward, ...result.fwd.returned].map((o, i) => (
                  <tr key={i}>
                    <td className={surface.mono}>{o.refNumber}</td><td>{formatDate(o.date)}</td><td>{o.party || '-'}</td><td>{name(o.itemId)}</td><td>{o.batch}</td>
                    <td className={mfg.num}>{qtyText(o.qty)}</td><td>{pT(`out_${o.kind}` as 'out_sale')}</td>
                  </tr>
                ))}
                {result.fwd.outward.length + result.fwd.returned.length === 0 && <tr><td colSpan={7} className={mfg.muted}>{pT('nothingOut')}</td></tr>}
              </tbody>
            </table>
          </div>
          <RecallList ctx={ctx} forward={result.fwd} />
        </section>
      )}
    </>
  );
}

function Node({ n, name }: { n: TraceNode & { qty?: number }; name: (id: string) => string }) {
  return (
    <li>
      <strong>{name(n.itemId)}</strong> · {n.batch || pT('noBatch')}{n.qty ? ` × ${qtyText(n.qty)}` : ''}
      {n.mixed && <span className={styles.mixed}>{pT('mixed')}</span>}
      {n.untracked && <span className={mfg.muted}> ({pT('untracked')})</span>}
      {n.repeat && <span className={mfg.muted}> ({pT('repeat')})</span>}
      {n.sources.length > 0 && (
        <span className={mfg.muted}> ← {n.sources.map((s) => `${pT(`src_${s.kind}` as 'src_purchase')} ${s.refNumber || ''}${s.party ? ` · ${s.party}` : ''} · ${(s.kind === 'opening' ? '-' : formatDate(s.date))} (${qtyText(s.qty)})`).join('; ')}</span>
      )}
      {n.madeBy.map((m, i) => (
        <ul key={i} className={styles.tree}>
          <li>{pT('madeBy')} {m.ref.refNumber} · {formatDate(m.ref.date)}{m.ref.refType === 'job_work_in' && m.ref.party ? ` · ${m.ref.party}` : ''}
            <ul className={styles.tree}>{m.components.map((c, j) => <Node key={j} n={c} name={name} />)}</ul>
          </li>
        </ul>
      ))}
    </li>
  );
}
