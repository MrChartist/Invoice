import { useMemo, useState } from 'react';
import { Edit3, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { compoundUnits, unitList, unitsDb, type UnitMaster } from '../../lib/units';
import { mapUnitToUqc, UQC_CODES } from '../../lib/einvoice';
import type { StockItem } from '../../lib/inventory';
import { useT } from '../../i18n';
import { imT } from '../../i18n/areas/inventory-masters';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './masters.module.css';
import { errText } from '../../i18n/lib-msg';
import { SelectField } from '../ui/SelectField';

type SimpleDraft = { id?: string; symbol: string; name: string; uqc: string; decimals: string; locked?: boolean };
type CompoundDraft = { id?: string; first: string; factor: string; second: string };

/** Units of measure (WP-8): simple units with UQC + decimals, and compound units (1 BOX = 12 NOS). */
export function UnitsModal({ open, items, onClose, onChanged }: {
  open: boolean;
  items: StockItem[];
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  useT(); // re-render on a language switch (5.4)
  const [version, setVersion] = useState(0);
  const [simple, setSimple] = useState<SimpleDraft | null>(null);
  const [compound, setCompound] = useState<CompoundDraft | null>(null);
  const [error, setError] = useState('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stored = useMemo(() => unitsDb.stored(), [version, open]);
  const units = useMemo(() => unitList(stored), [stored]);
  const compounds = useMemo(() => compoundUnits(stored), [stored]);

  const run = (fn: () => void) => {
    try {
      fn();
      setError('');
      setVersion((v) => v + 1);
      onChanged(imT('saved'));
      return true;
    } catch (err) {
      setError(errText(err));
      return false;
    }
  };

  const saveSimple = () => {
    if (simple && run(() => unitsDb.save({ id: simple.id, symbol: simple.symbol, name: simple.name, uqc: simple.uqc, decimals: Number(simple.decimals) || 0 }))) setSimple(null);
  };
  const saveCompound = () => {
    if (compound && run(() => unitsDb.save({ id: compound.id, symbol: '', first: compound.first, second: compound.second, factor: Number(compound.factor) }))) setCompound(null);
  };
  const remove = (u: UnitMaster) => run(() => unitsDb.remove(u.id, items));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={imT('unitsTitle')}
      subtitle={imT('unitsSub')}
      footer={<button type="button" className={controls.btnOutline} onClick={onClose}>{imT('done')}</button>}
    >
      <div className={styles.rows}>
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{imT('symbol')}</th><th>{imT('formalName')}</th><th>{imT('uqc')}</th><th className={surface.numeric}>{imT('decimals')}</th><th><span className={surface.srOnly}>{imT('thActions')}</span></th></tr></thead>
            <tbody>
              {units.map((u) => {
                const own = !u.id.startsWith('builtin:');
                return (
                  <tr key={u.id}>
                    <td>{u.symbol}{u.id.startsWith('builtin:') && <span className={styles.muted}> · {imT('builtIn')}</span>}</td>
                    <td>{u.name || '-'}</td>
                    <td>{u.uqc || imT('uqcAuto', { uqc: mapUnitToUqc(u.symbol) })}</td>
                    <td className={surface.numeric}>{u.decimals ?? 0}</td>
                    <td>
                      <span className={surface.rowActions}>
                        <button type="button" className={controls.btnIcon} aria-label={imT('edit', { name: u.symbol })}
                          onClick={() => { setCompound(null); setSimple({ id: own ? u.id : stored.find((x) => x.symbol === u.symbol)?.id, symbol: u.symbol, name: u.name ?? '', uqc: u.uqc ?? '', decimals: String(u.decimals ?? 0), locked: true }); }}>
                          <Edit3 size={16} />
                        </button>
                        {stored.some((x) => x.id === u.id) && (
                          <button type="button" className={controls.btnDanger} aria-label={imT('remove', { name: u.symbol })} onClick={() => remove(u)}>
                            <Trash2 size={16} />
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {simple ? (
          <form className={styles.rows} onSubmit={(e) => { e.preventDefault(); saveSimple(); }}>
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="un-sym">{imT('symbol')}</label>
                <input id="un-sym" className={controls.input} value={simple.symbol} maxLength={12} onChange={(e) => setSimple({ ...simple, symbol: e.target.value })} autoFocus disabled={!!simple.locked} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="un-name">{imT('formalName')}</label>
                <input id="un-name" className={controls.input} value={simple.name} onChange={(e) => setSimple({ ...simple, name: e.target.value })} />
              </div>
            </div>
            <div className={controls.row}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="un-uqc">{imT('uqc')}</label>
                <SelectField id="un-uqc" className={controls.select} value={simple.uqc} onChange={(e) => setSimple({ ...simple, uqc: e.target.value })}>
                  <option value="">{imT('uqcAuto', { uqc: mapUnitToUqc(simple.symbol) })}</option>
                  {UQC_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                </SelectField>
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="un-dec">{imT('decimals')}</label>
                <input id="un-dec" type="number" min={0} max={6} className={`${controls.input} ${controls.inputNumeric}`} value={simple.decimals} onChange={(e) => setSimple({ ...simple, decimals: e.target.value })} />
              </div>
            </div>
            <div className={surface.pageActions}>
              <button type="button" className={controls.btnOutline} onClick={() => { setSimple(null); setError(''); }}>{imT('cancel')}</button>
              <button type="submit" className={controls.btnPrimary}>{imT('save')}</button>
            </div>
          </form>
        ) : (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} style={{ alignSelf: 'flex-start' }} onClick={() => { setCompound(null); setSimple({ symbol: '', name: '', uqc: '', decimals: '0' }); }}>
            <Plus size={14} aria-hidden="true" /> {imT('addUnit')}
          </button>
        )}

        <p className={controls.label} style={{ marginTop: '0.5rem' }}>{imT('compoundTitle')}</p>
        <p className={styles.muted}>{imT('compoundHint')}</p>
        {compounds.length === 0 ? <p className={styles.muted}>{imT('noCompound')}</p> : (
          <table className={surface.table}>
            <tbody>
              {compounds.map((u) => (
                <tr key={u.id}>
                  <td>{imT('compoundRow', { first: u.first ?? '', factor: u.factor ?? 0, second: u.second ?? '' })}</td>
                  <td>
                    <span className={surface.rowActions}>
                      <button type="button" className={controls.btnIcon} aria-label={imT('edit', { name: u.symbol })} onClick={() => { setSimple(null); setCompound({ id: u.id, first: u.first ?? '', factor: String(u.factor ?? ''), second: u.second ?? '' }); }}>
                        <Edit3 size={16} />
                      </button>
                      <button type="button" className={controls.btnDanger} aria-label={imT('remove', { name: u.symbol })} onClick={() => remove(u)}>
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {compound ? (
          <form className={styles.rows} onSubmit={(e) => { e.preventDefault(); saveCompound(); }}>
            <div className={controls.row3}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="cu-first">{imT('first')}</label>
                <SelectField id="cu-first" className={controls.select} value={compound.first} onChange={(e) => setCompound({ ...compound, first: e.target.value })}>
                  <option value="" />
                  {units.map((u) => <option key={u.id} value={u.symbol}>{u.symbol}</option>)}
                </SelectField>
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="cu-factor">{imT('factor')}</label>
                <input id="cu-factor" className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={compound.factor} onChange={(e) => setCompound({ ...compound, factor: e.target.value })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="cu-second">{imT('second')}</label>
                <SelectField id="cu-second" className={controls.select} value={compound.second} onChange={(e) => setCompound({ ...compound, second: e.target.value })}>
                  <option value="" />
                  {units.map((u) => <option key={u.id} value={u.symbol}>{u.symbol}</option>)}
                </SelectField>
              </div>
            </div>
            <div className={surface.pageActions}>
              <button type="button" className={controls.btnOutline} onClick={() => { setCompound(null); setError(''); }}>{imT('cancel')}</button>
              <button type="submit" className={controls.btnPrimary}>{imT('save')}</button>
            </div>
          </form>
        ) : (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} style={{ alignSelf: 'flex-start' }} onClick={() => { setSimple(null); setCompound({ first: '', factor: '', second: '' }); }}>
            <Plus size={14} aria-hidden="true" /> {imT('addCompound')}
          </button>
        )}
        {error && <span className={controls.error} role="alert">{error}</span>}
      </div>
    </Modal>
  );
}
