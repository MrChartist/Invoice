import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { generateId } from '../../lib/storage';
import { bomsDb, validateBom } from '../../lib/manufacturing';
import type { Bom } from '../../types/manufacturing';
import { mfgT } from '../../i18n/areas/manufacturing';
import { LinesGrid } from './LinesGrid';
import { blankLine, type GridLine } from './context';
import { qtyText, type MfgContext } from './context';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './manufacturing.module.css';

/** Bill of Materials master (Tally "Components (BoM)"): several per item, one default. */
export function BomTab({ ctx }: { ctx: MfgContext }) {
  const [editing, setEditing] = useState<Bom | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Bom | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const boms = useMemo(() => bomsDb.all(), [ctx.version]);
  const byId = useMemo(() => new Map(ctx.items.map((i) => [i.id, i])), [ctx.items]);
  const sorted = useMemo(
    () => [...boms].sort((a, b) => (byId.get(a.item_id)?.name ?? '').localeCompare(byId.get(b.item_id)?.name ?? '') || Number(!!b.is_default) - Number(!!a.is_default)),
    [boms, byId],
  );

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.muted}>{mfgT('noBoms')}</span>
        {ctx.canMasters && (
          <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setEditing('new')}>
            <Plus size={14} aria-hidden="true" /> {mfgT('newBom')}
          </button>
        )}
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr><th>{mfgT('finished')}</th><th>{mfgT('bomName')}</th><th>{mfgT('components')}</th><th>{mfgT('outputs')}</th><th><span className={surface.srOnly}>{mfgT('actions')}</span></th></tr>
          </thead>
          <tbody>
            {sorted.map((b) => {
              const item = byId.get(b.item_id);
              return (
                <tr key={b.id}>
                  <td>{item?.name ?? '-'}</td>
                  <td>{b.name}{b.is_default && <span className={styles.tag}>{mfgT('defaultTag')}</span>}<div className={styles.muted}>{mfgT('perUnits', { n: qtyText(b.batch_qty), unit: item?.unit ?? '' })}</div></td>
                  <td>{b.components.map((c) => `${byId.get(c.item_id)?.name ?? '?'} × ${qtyText(c.qty)}${num(c.scrap_pct) ? ` (+${c.scrap_pct}%)` : ''}`).join(', ')}</td>
                  <td>{(b.outputs ?? []).map((o) => `${byId.get(o.item_id)?.name ?? '?'} × ${qtyText(o.qty)}`).join(', ') || '-'}</td>
                  <td className={surface.rowActions}>
                    {ctx.canMasters && (
                      <>
                        <button type="button" className={controls.btnIcon} aria-label={`${mfgT('edit')} ${b.name}`} onClick={() => setEditing(b)}><Pencil size={15} /></button>
                        <button type="button" className={controls.btnDanger} aria-label={`${mfgT('delete')} ${b.name}`} onClick={() => setDeleting(b)}><Trash2 size={15} /></button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && <tr><td colSpan={5} className={styles.muted}>-</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <BomModal ctx={ctx} bom={editing === 'new' ? null : editing} boms={boms} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting} destructive title={mfgT('delete')} message={mfgT('confirmDeleteBom')} confirmLabel={mfgT('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          try {
            bomsDb.remove(deleting.id);
            ctx.changed(mfgT('bomDeleted'));
          } catch (e) {
            ctx.error((e as Error).message);
          }
        }}
      />
    </>
  );
}

function BomModal({ ctx, bom, boms, onClose }: { ctx: MfgContext; bom: Bom | null; boms: Bom[]; onClose: () => void }) {
  const tracked = useMemo(() => ctx.items.filter((i) => i.track_stock && !i.track_serials).sort((a, b) => a.name.localeCompare(b.name)), [ctx.items]);
  const [itemId, setItemId] = useState(bom?.item_id ?? '');
  const [name, setName] = useState(bom?.name ?? 'Standard');
  const [batchQty, setBatchQty] = useState(String(bom?.batch_qty ?? 1));
  const [isDefault, setIsDefault] = useState(bom ? !!bom.is_default : true);
  const [components, setComponents] = useState<GridLine[]>(() => bom?.components.map((c) => ({ ...c })) ?? [blankLine()]);
  const [outputs, setOutputs] = useState<GridLine[]>(() => (bom?.outputs ?? []).map((o) => ({ ...o })));
  const [notes, setNotes] = useState(bom?.notes ?? '');
  const [error, setError] = useState('');

  const submit = () => {
    const draft = {
      id: bom?.id, item_id: itemId, name, batch_qty: num(batchQty), is_default: isDefault, notes: notes.trim() || undefined,
      components: components.filter((c) => c.item_id).map((c) => ({ id: c.id || generateId(), item_id: c.item_id, qty: num(c.qty), ...(num(c.scrap_pct) ? { scrap_pct: num(c.scrap_pct) } : {}), ...(c.godown_id ? { godown_id: c.godown_id } : {}) })),
      outputs: outputs.filter((o) => o.item_id).map((o) => {
        const kind = o.kind ?? 'by_product';
        return { id: o.id, item_id: o.item_id, qty: num(o.qty), kind, ...(kind === 'co_product' ? { cost_pct: num(o.cost_pct) } : { rate: num(o.rate) }), ...(o.godown_id ? { godown_id: o.godown_id } : {}) };
      }),
    };
    const err = validateBom(draft, ctx.items, boms.filter((b) => b.id !== bom?.id));
    if (err) return setError(err);
    try {
      const saved = bomsDb.save(draft, ctx.items);
      onClose();
      ctx.changed(mfgT('bomSaved', { name: saved.name }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="xl" title={bom ? mfgT('editBom') : mfgT('newBom')} subtitle={mfgT('keyHint')}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{mfgT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={submit}>{mfgT('save')}</button></>}>
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="bom-item">{mfgT('finished')}</label>
            <select id="bom-item" className={controls.select} value={itemId} onChange={(e) => setItemId(e.target.value)} autoFocus>
              <option value="">{mfgT('choose')}</option>
              {tracked.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="bom-name">{mfgT('bomName')}</label>
            <input id="bom-name" className={controls.input} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="bom-qty">{mfgT('batchQty')}</label>
            <input id="bom-qty" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={batchQty} onChange={(e) => setBatchQty(e.target.value)} />
          </div>
        </div>
        <label className={controls.check}><input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> {mfgT('isDefault')}</label>
        <p className={styles.section}>{mfgT('components')}</p>
        <LinesGrid lines={components} items={tracked} onChange={setComponents} opts={{ label: mfgT('component'), scrapPct: true, godowns: ctx.godowns }} />
        <p className={styles.section}>{mfgT('outputs')}</p>
        <LinesGrid lines={outputs} items={tracked} onChange={setOutputs} opts={{ label: mfgT('byProduct'), outputs: true, godowns: ctx.godowns }} />
        <div className={controls.field}>
          <label className={controls.label} htmlFor="bom-notes">{mfgT('notes')}</label>
          <input id="bom-notes" className={controls.input} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p className={cn(styles.notice, styles.danger)} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
