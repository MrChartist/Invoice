/** MF-B1 Shop → Drawings: the register (revisions, hold, owner override, characteristics) and drawing / rev / heat on a draft's lines. */
import { useMemo, useState } from 'react';
import type { DrawingChar, MfLineSnap } from '../../types/mfg-r13';
import type { InvoiceRecord } from '../../types/invoice';
import type { MfgContext } from '../manufacturing/context';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { getTable } from '../../lib/storage';
import { buildItemIndex } from '../../lib/inventory';
import { addRevision, currentRev, docRevWarnings, heatsForBatch, loadDrawings, overrideHold, removeDrawing, saveDrawing, setHold, stampDocLines } from '../../lib/mfg/mf-drawings';
import { loadReports } from '../../lib/mfg/mf-inspection';
import { shT as S } from '../../i18n/areas/mfg-r13b-shop';
import { B, today } from '../transport/shared';
import controls from '../../styles/controls.module.css';
import { Num, Sel, Table, Txt } from './mfb-ui';
import { n, opt, row, useRun, type Done } from './mfb-util';

const blankChar = (): DrawingChar => ({ id: '', name: '', nominal: 0, tol_minus: 0, tol_plus: 0, unit: 'mm' });

export default function DrawingsView({ ctx, done }: { ctx: MfgContext; done: Done }) {
  const [tick, run] = useRun(done, S('saved'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ drawings: loadDrawings(), clients: localDb.clients.getAll(), drafts: localDb.invoices.getAll().filter((i) => i.status === 'Draft') }), [tick, ctx.version]);
  const [f, setF] = useState({ number: '', title: '', client: '', item: '', rev: 'A', grade: '' });
  const [revs, setRevs] = useState<Record<string, string>>({});
  const [edit, setEdit] = useState<{ id: string; chars: DrawingChar[] } | null>(null);
  const [docId, setDocId] = useState('');
  const [lines, setLines] = useState<Record<string, MfLineSnap>>({});
  const doc: InvoiceRecord | undefined = d.drafts.find((x) => x.id === docId);
  const itemName = (id?: string) => ctx.items.find((i) => i.id === id)?.name ?? '-';
  const heat = (l: InvoiceRecord['items'][number]) => {
    const it = buildItemIndex(ctx.items).find(l.name, l.hsn);
    return it && l.batch_no ? heatsForBatch(it.id, l.batch_no, { mfg: getTable('manufacturing_vouchers'), transfers: getTable('stock_transfers'), purchases: getTable('purchases') }).join(', ') : '';
  };
  const pick = (id: string) => {
    setDocId(id);
    const x = d.drafts.find((i) => i.id === id);
    setLines(Object.fromEntries((x?.items ?? []).map((l) => [l.id, { ...x?.mf?.lines?.[l.id], ...(x?.mf?.lines?.[l.id]?.heat ? {} : { heat: heat(l) || undefined }) }])));
  };
  const setLine = (id: string, p: Partial<MfLineSnap>) => setLines({ ...lines, [id]: { ...lines[id], ...p } });
  const owner = can('settings.manage');
  return (
    <div data-mfb-view="drawings">
      <h4>{S('newDrawing')}</h4>
      <div style={row}>
        <Txt l={S('drawingNo')} v={f.number} set={(x) => setF({ ...f, number: x })} x={140} d="dwg-no" />
        <Txt l={S('title')} v={f.title} set={(x) => setF({ ...f, title: x })} x={200} d="dwg-title" />
        <Sel l={S('customer')} v={f.client} set={(x) => setF({ ...f, client: x })} o={opt(d.clients, (c) => c.id ?? '', (c) => c.name)} x={180} />
        <Sel l={S('item')} v={f.item} set={(x) => setF({ ...f, item: x })} o={opt(ctx.items, (i) => i.id, (i) => i.name)} x={180} />
        <Txt l={S('rev')} v={f.rev} set={(x) => setF({ ...f, rev: x })} x={70} d="dwg-rev" />
        <Txt l={S('grade')} v={f.grade} set={(x) => setF({ ...f, grade: x })} x={140} />
        <button type="button" className={B.p} data-mfb-save-drawing onClick={() => run(() => {
          saveDrawing({ number: f.number, title: f.title, client_id: f.client || undefined, item_id: f.item || undefined, rev: f.rev, rev_date: today(), material_grade: f.grade });
          setF({ ...f, number: '', title: '', rev: 'A' });
        })}>{S('add')}</button>
      </div>
      <Table d="drawings" empty={S('none')} head={[S('drawingNo'), S('item'), S('current'), S('revisions'), S('newRev'), '']} rows={d.drawings.map((x) => {
        const cur = currentRev(x);
        return [
          <span key="n"><strong>{x.number}</strong> {x.title}</span>, itemName(x.item_id),
          <span key="c" data-mfb-rev-status={cur?.status}>{cur ? `${cur.rev} · ${S(`st.${cur.status}`)}` : '-'}{x.release_override ? ` · ${S('overridden')}` : ''}</span>,
          x.revisions.map((r) => r.rev).join(' → '),
          <span key="r" style={row}>
            <input className={controls.input} style={{ maxWidth: 60 }} aria-label={S('newRev')} value={revs[x.id] ?? ''} onChange={(e) => setRevs({ ...revs, [x.id]: e.target.value })} data-mfb="new-rev" />
            <button type="button" className={B.os} data-mfb-add-rev onClick={() => run(() => { addRevision(x.id, { rev: revs[x.id] ?? '', date: today() }); setRevs({ ...revs, [x.id]: '' }); })}>{S('add')}</button>
          </span>,
          <span key="a" style={row}>
            <button type="button" className={B.gs} onClick={() => run(() => { setHold(x.id, cur?.status !== 'hold'); })}>{cur?.status === 'hold' ? S('releaseHold') : S('hold')}</button>
            {owner && cur?.status === 'hold' && !x.release_override && <button type="button" className={B.gs} onClick={() => run(() => { overrideHold(x.id); })}>{S('override')}</button>}
            <button type="button" className={B.gs} onClick={() => setEdit({ id: x.id, chars: (x.characteristics ?? []).map((c) => ({ ...c })) })}>{S('chars')}</button>
            <button type="button" className={B.gs} onClick={() => run(() => { removeDrawing(x.id, loadReports().map((r) => r.drawing_id)); })}>{S('del')}</button>
          </span>,
        ];
      })} />

      {edit && (() => {
        const dw = d.drawings.find((x) => x.id === edit.id);
        const setC = (i: number, p: Partial<DrawingChar>) => setEdit({ ...edit, chars: edit.chars.map((c, j) => (j === i ? { ...c, ...p } : c)) });
        return dw && (
          <div data-mfb-chars>
            <h4>{S('chars')} : {dw.number}</h4>
            {edit.chars.map((c, i) => (
              <div key={i} style={row}>
                <Txt l={S('charName')} v={c.name} set={(x) => setC(i, { name: x })} x={160} d="char-name" />
                <Num l={S('nominal')} v={String(c.nominal)} set={(x) => setC(i, { nominal: n(x) })} d="char-nom" />
                <Num l={S('tolMinus')} v={String(c.tol_minus)} set={(x) => setC(i, { tol_minus: n(x) })} x={90} d="char-minus" />
                <Num l={S('tolPlus')} v={String(c.tol_plus)} set={(x) => setC(i, { tol_plus: n(x) })} x={90} d="char-plus" />
                <Txt l={S('unit')} v={c.unit} set={(x) => setC(i, { unit: x })} x={70} />
                <label className={controls.label}><input type="checkbox" checked={!!c.critical} onChange={(e) => setC(i, { critical: e.target.checked })} /> {S('critical')}</label>
              </div>
            ))}
            <div style={row}>
              <button type="button" className={B.os} data-mfb-add-char onClick={() => setEdit({ ...edit, chars: [...edit.chars, blankChar()] })}>{S('addChar')}</button>
              <button type="button" className={B.ps} data-mfb-save-chars onClick={() => run(() => { saveDrawing({ ...dw, characteristics: edit.chars.filter((c) => c.name.trim()) }); setEdit(null); })}>{S('save')}</button>
            </div>
          </div>
        );
      })()}

      <h4>{S('onDraft')}</h4>
      <Sel l={S('draft')} v={docId} set={pick} o={opt(d.drafts, (i) => i.id, (i) => `${i.doc_type} ${i.invoice_number || ''} · ${i.client?.name ?? ''}`)} x={320} d="stamp-doc" />
      {doc && (
        <>
          {docRevWarnings({ lines }, d.drawings).map((w) => <p key={w} className={controls.hint} role="alert" data-mfb-rev-warning>{w}</p>)}
          <Table d="stamp" empty={S('none')} head={[S('line'), S('drawingNo'), S('rev'), S('poLine'), S('heat')]} rows={doc.items.map((l) => [
            l.name,
            <Sel key="d" l={S('drawingNo')} v={lines[l.id]?.drawing ?? ''} set={(x) => setLine(l.id, { drawing: x || undefined, rev: currentRev(d.drawings.find((w) => w.number === x) ?? { revisions: [] })?.rev })} o={opt(d.drawings, (w) => w.number, (w) => w.number)} x={150} d="stamp-dwg" />,
            <Txt key="r" l={S('rev')} v={lines[l.id]?.rev ?? ''} set={(x) => setLine(l.id, { rev: x.toUpperCase() || undefined })} x={70} d="stamp-rev" />,
            <Txt key="p" l={S('poLine')} v={lines[l.id]?.po_line ?? ''} set={(x) => setLine(l.id, { po_line: x || undefined })} x={90} />,
            <Txt key="h" l={S('heat')} v={lines[l.id]?.heat ?? ''} set={(x) => setLine(l.id, { heat: x || undefined })} x={120} />,
          ])} />
          <button type="button" className={B.p} data-mfb-stamp onClick={() => run(() => { stampDocLines(doc.id, lines); return S('stamped'); })}>{S('save')}</button>
        </>
      )}
    </div>
  );
}
