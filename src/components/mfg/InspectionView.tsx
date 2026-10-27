/** MF-B1 Shop → Inspection: first-article / lot / final reports against a drawing's characteristics (FAI/FY…). */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InspectionReport } from '../../types/mfg-r13';
import type { MfgContext } from '../manufacturing/context';
import { localDb } from '../../lib/localDb';
import { productionOrdersDb } from '../../lib/production/orders';
import { currentRev, loadDrawings } from '../../lib/mfg/mf-drawings';
import { attachToInvoice, evaluate, loadReports, removeReport, reportHtml, saveReport, tolText } from '../../lib/mfg/mf-inspection';
import { shT as S } from '../../i18n/areas/mfg-r13b-shop';
import { B, printHtml, today } from '../transport/shared';
import controls from '../../styles/controls.module.css';
import { Num, Sel, Table, Txt, n, opt, row, useRun, type Done } from './mfb-ui';

const KINDS: readonly InspectionReport['kind'][] = ['first_article', 'lot', 'final'];
const vals = (s: string) => s.split(/[\s,;]+/).filter(Boolean).map(Number).filter((x) => Number.isFinite(x));

export default function InspectionView({ ctx, done }: { ctx: MfgContext; done: Done }) {
  const [tick, run] = useRun(done, S('saved'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ drawings: loadDrawings(), reports: loadReports(), orders: productionOrdersDb.all().filter((o) => o.status !== 'cancelled'), drafts: localDb.invoices.getAll().filter((i) => i.status === 'Draft') }), [tick, ctx.version]);
  const [f, setF] = useState({ date: today(), drawing: '', rev: '', kind: 'first_article' as InspectionReport['kind'], order: '', sample: '1', inspector: '', note: '', result: '' });
  const [read, setRead] = useState<Record<string, string>>({});
  const [att, setAtt] = useState<Record<string, string>>({});
  const dw = d.drawings.find((x) => x.id === f.drawing);
  const readings = (dw?.characteristics ?? []).map((c) => ({ char_id: c.id, values: vals(read[c.id] ?? '') }));
  const ev = dw ? evaluate(readings, dw.characteristics ?? []) : undefined;
  const business = { name: localDb.settings.activeProfile()?.companyName };
  return (
    <div data-mfb-view="inspection">
      <h4>{S('newReport')}</h4>
      <div style={row}>
        <Txt l={S('date')} type="date" v={f.date} set={(x) => setF({ ...f, date: x })} x={150} />
        <Sel l={S('drawingNo')} v={f.drawing} set={(x) => { const w = d.drawings.find((y) => y.id === x); setF({ ...f, drawing: x, rev: w ? currentRev(w)?.rev ?? '' : '' }); setRead({}); }} o={opt(d.drawings, (x) => x.id, (x) => `${x.number} ${x.title}`)} x={220} d="insp-dwg" />
        <Sel l={S('rev')} v={f.rev} set={(x) => setF({ ...f, rev: x })} o={(dw?.revisions ?? []).map((r) => [r.rev, `${r.rev} · ${S(`st.${r.status}`)}`] as const)} x={140} />
        <Sel l={S('kind')} v={f.kind} set={(x) => setF({ ...f, kind: x as InspectionReport['kind'] })} o={KINDS.map((k) => [k, S(`k.${k}`)] as const)} x={150} />
        <Sel l={S('order')} v={f.order} set={(x) => setF({ ...f, order: x })} o={opt(d.orders, (o) => o.id, (o) => o.number)} x={160} />
        <Num l={S('sample')} v={f.sample} set={(x) => setF({ ...f, sample: x })} x={90} d="insp-sample" />
        <Txt l={S('inspector')} v={f.inspector} set={(x) => setF({ ...f, inspector: x })} x={150} d="insp-by" />
      </div>
      {dw && (
        <>
          <Table d="readings" empty={S('noChars')} head={[S('charName'), S('spec'), S('readings'), '']} rows={ev!.rows.map((r) => [
            `${r.char.name}${r.char.critical ? ' ★' : ''}`, tolText(r.char),
            <input key="v" className={controls.input} aria-label={S('readings')} value={read[r.char.id] ?? ''} onChange={(e) => setRead({ ...read, [r.char.id]: e.target.value })} data-mfb="reading" />,
            r.values.length ? (r.ok ? S('ok') : <strong key="x" data-mfb-out>{S('out', { n: r.out.length })}</strong>) : '',
          ])} />
          <div style={row}>
            <span className={controls.hint} data-mfb-suggested={ev!.suggested}>{S('suggested')}: {S(`r.${ev!.suggested}`)}</span>
            <Sel l={S('result')} v={f.result} set={(x) => setF({ ...f, result: x })} o={[['', S('asSuggested')], ...(['pass', 'fail', 'deviation'] as const).map((k) => [k, S(`r.${k}`)] as const)]} x={170} />
            <Txt l={S('note')} v={f.note} set={(x) => setF({ ...f, note: x })} x={220} />
            <button type="button" className={B.p} data-mfb-save-report onClick={() => run(() => {
              const r = saveReport({ date: f.date, kind: f.kind, drawing_id: dw.id, rev: f.rev, sample: n(f.sample), inspector: f.inspector, readings, ...(f.order ? { order_id: f.order } : {}), ...(f.note ? { note: f.note } : {}), ...(f.result ? { result: f.result as InspectionReport['result'] } : {}) }, dw);
              setRead({});
              return S('reportSaved', { n: r.number, r: S(`r.${r.result}`) });
            })}>{S('save')}</button>
          </div>
        </>
      )}
      <h4>{S('reports')}</h4>
      <Table d="reports" empty={S('none')} head={[S('number'), S('date'), S('drawingNo'), S('result'), S('attach'), '']} rows={d.reports.map((r) => {
        const w = d.drawings.find((x) => x.id === r.drawing_id);
        return [
          r.number, r.date, `${w?.number ?? '—'} rev ${r.rev}`, <span key="r" data-mfb-result={r.result}>{S(`r.${r.result}`)}</span>,
          <span key="a" style={row}>
            <select className={controls.select} style={{ maxWidth: 200 }} aria-label={S('attach')} value={att[r.id] ?? ''} onChange={(e) => setAtt({ ...att, [r.id]: e.target.value })}>{opt(d.drafts, (i) => i.id, (i) => `${i.invoice_number || i.doc_type} · ${i.client?.name ?? ''}`).map(([k, s]) => <option key={k} value={k}>{s}</option>)}</select>
            <button type="button" className={B.gs} disabled={!w || !att[r.id]} onClick={() => run(() => { attachToInvoice(r.id, att[r.id], w!); return S('attached'); })}>{S('attach')}</button>
          </span>,
          <span key="x" style={row}>
            {w && <button type="button" className={B.gs} onClick={() => printHtml(reportHtml(r, w, business), r.number)}>{S('print')}</button>}
            <button type="button" className={B.gs} onClick={() => run(() => { removeReport(r.id); })}>{S('del')}</button>
          </span>,
        ];
      })} />
      <p className={controls.hint}>{S('qcHint')} <Link to="/manufacturing?tab=qc">{S('qcDesk')}</Link></p>
    </div>
  );
}
