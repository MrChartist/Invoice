/** AG-A3 Farm → Quality: cut tables per commodity (no preset values — contract / agency terms; starter rows in help). */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { agT } from '../../i18n/areas/agri-r12a';
import { loadQualityTables, removeQualityTable, saveQualityTable } from '../../lib/agri/ag-quality';
import type { QualityCutTable, QualityParam } from '../../types/agri-r12';
import controls from '../../styles/controls.module.css';
import { F, Grid, In, useRun, wrap, type Done } from './agri-ui';

const KEYS: QualityParam['key'][] = ['moisture', 'foreign', 'damaged', 'immature', 'broken', 'custom'];
type Row = { key: QualityParam['key']; label: string; norm: string; mode: 'weight' | 'price'; per: string; max: string; reject: string };
const row = (): Row => ({ key: 'moisture', label: '', norm: '', mode: 'weight', per: '1', max: '', reject: '' });

export default function QualityView({ onDone }: { onDone: Done }) {
  useT();
  const { tick, run } = useRun(onDone);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tables = useMemo(() => loadQualityTables(), [tick]);
  const [id, setId] = useState<string>();
  const [commodity, setCommodity] = useState('');
  const [rows, setRows] = useState<Row[]>([row()]);
  const edit = (t: QualityCutTable) => {
    setId(t.id);
    setCommodity(t.commodity);
    setRows(t.params.map((p) => ({ key: p.key, label: p.label ?? '', norm: String(p.norm_pct), mode: p.mode, per: String(p.per_point_pct), max: p.max_pct ? String(p.max_pct) : '', reject: p.reject_above ? String(p.reject_above) : '' })));
  };
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const save = () => {
    saveQualityTable({ id, commodity, params: rows.map((r) => ({ key: r.key, label: r.label, norm_pct: Number(r.norm), mode: r.mode, per_point_pct: Number(r.per), ...(r.max ? { max_pct: Number(r.max) } : {}), ...(r.reject ? { reject_above: Number(r.reject) } : {}) })) });
    setId(undefined);
    setCommodity('');
    setRows([row()]);
    return agT('saved');
  };
  return (
    <div data-ag-quality>
      <F label={agT('commodity')}><In v={commodity} set={setCommodity} data-ag-q-commodity /></F>
      {rows.map((r, i) => (
        <div key={i} style={wrap}>
          <F label={agT('param')}><select className={controls.select} value={r.key} onChange={(e) => set(i, { key: e.target.value as Row['key'] })}>{KEYS.map((k) => <option key={k} value={k}>{agT(`q.${k}`)}</option>)}</select></F>
          <F label={agT('label')}><In v={r.label} set={(v) => set(i, { label: v })} w={100} /></F>
          <F label={`${agT('norm')} %`}><In v={r.norm} set={(v) => set(i, { norm: v })} type="number" w={70} data-ag-q-norm /></F>
          <F label={agT('cutOn')}><select className={controls.select} value={r.mode} onChange={(e) => set(i, { mode: e.target.value as Row['mode'] })}><option value="weight">{agT('weight')}</option><option value="price">{agT('price')}</option></select></F>
          <F label={agT('perPoint')}><In v={r.per} set={(v) => set(i, { per: v })} type="number" w={70} data-ag-q-per /></F>
          <F label={agT('maxCut')}><In v={r.max} set={(v) => set(i, { max: v })} type="number" w={70} /></F>
          <F label={agT('rejectAbove')}><In v={r.reject} set={(v) => set(i, { reject: v })} type="number" w={70} /></F>
        </div>
      ))}
      <div style={wrap}>
        <button type="button" className={controls.btnOutline} onClick={() => setRows([...rows, row()])}>{agT('addParam')}</button>
        <button type="button" className={controls.btnPrimary} onClick={() => run(save)} data-ag-q-save>{agT('save')}</button>
      </div>
      <Grid attr="quality" head={[agT('commodity'), agT('params'), '']} rows={tables.map((t) => [t.commodity, t.params.map((p) => `${p.label ?? agT(`q.${p.key}`)} ${p.norm_pct}% (${p.per_point_pct}%/pt ${agT(p.mode)})`).join(' · '), (
        <span key="a"><button type="button" className={controls.btnGhost} onClick={() => edit(t)}>{agT('edit')}</button><button type="button" className={controls.btnGhost} onClick={() => run(() => { removeQualityTable(t.id); return agT('deleted'); })}>{agT('delete')}</button></span>
      )])} />
    </div>
  );
}
