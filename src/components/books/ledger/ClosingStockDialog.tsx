/**
 * Closing-stock source (WP-2): value stock from the inventory engine (the company costing method:
 * FIFO or weighted average), type the closing stock date-wise (Tally's closing-stock entry when
 * inventory is not maintained), or leave stock out. Saved to the company's `closing_stock` key.
 */
import { useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { loadClosingStockConfig, saveClosingStockConfig, type ClosingStockEntry, type ClosingStockMode } from '../../../lib/ledger';
import { loadSettings } from '../../../lib/inventory';
import { todayIso } from '../../../lib/tax-rules';
import { StorageWriteError } from '../../../lib/storage';
import { reportsT } from '../../../i18n/areas/reports-engine';
import { useT } from '../../../i18n';
import { Modal } from '../../ui/Modal';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import { DateField } from '../../ui/DateField';

type Mode = ClosingStockMode | 'auto';

export function ClosingStockDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  useT();
  const uid = useId();
  const [initial] = useState(loadClosingStockConfig);
  const [mode, setMode] = useState<Mode>(initial.mode ?? 'auto');
  const [opening, setOpening] = useState(initial.opening ? String(initial.opening / 100) : '');
  const [entries, setEntries] = useState<Array<{ date: string; value: string }>>(
    (initial.entries ?? []).map((e) => ({ date: e.date, value: String(e.value / 100) })),
  );
  const [error, setError] = useState('');
  const method = loadSettings().method === 'FIFO' ? 'FIFO' : reportsT('wac');

  const save = () => {
    const clean: ClosingStockEntry[] = [];
    for (const e of entries) {
      if (!e.date && !e.value) continue;
      const v = Number(e.value);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(v)) {
        setError(reportsT('stockEntryError'));
        return;
      }
      clean.push({ date: e.date, value: Math.round(v * 100) });
    }
    const op = opening.trim() === '' ? 0 : Number(opening);
    if (!Number.isFinite(op)) {
      setError(reportsT('stockEntryError'));
      return;
    }
    try {
      saveClosingStockConfig({ ...(mode === 'auto' ? {} : { mode }), opening: Math.round(op * 100), entries: clean });
      onSaved();
    } catch (err) {
      setError(err instanceof StorageWriteError ? err.message : String(err));
    }
  };

  const radio = (m: Mode, label: string, hint: string) => (
    <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
      <input type="radio" name={`${uid}-mode`} checked={mode === m} onChange={() => setMode(m)} />
      <span>
        <strong>{label}</strong>
        <br />
        <span className={books.muted}>{hint}</span>
      </span>
    </label>
  );

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={reportsT('closingStockSettings')}
      subtitle={reportsT('stockDialogSub')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{reportsT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save}>{reportsT('save')}</button>
        </>
      }
    >
      <div className={books.stack}>
        <fieldset style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
          <legend className={controls.label}>{reportsT('stockSource')}</legend>
          {radio('auto', reportsT('stockAuto'), reportsT('stockAutoHint'))}
          {radio('inventory', reportsT('stockInventory', { method }), reportsT('stockInventoryHint'))}
          {radio('manual', reportsT('stockManual'), reportsT('stockManualHint'))}
          {radio('none', reportsT('stockNone'), reportsT('stockNoneHint'))}
        </fieldset>
        {mode === 'manual' && (
          <>
            <div className={controls.field}>
              <label className={controls.label} htmlFor={`${uid}-open`}>{reportsT('stockOpening')}</label>
              <input id={`${uid}-open`} className={controls.input} type="number" step="0.01" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
            </div>
            {entries.map((e, i) => (
              <div key={i} className={controls.row}>
                <div className={controls.field}>
                  <label className={controls.label} htmlFor={`${uid}-d${i}`}>{reportsT('stockAsAt')}</label>
                  <DateField id={`${uid}-d${i}`} className={controls.input} value={e.date} onChange={(ev) => setEntries((l) => l.map((x, k) => (k === i ? { ...x, date: ev.target.value } : x)))} />
                </div>
                <div className={controls.field}>
                  <label className={controls.label} htmlFor={`${uid}-v${i}`}>{reportsT('stockValue')}</label>
                  <input id={`${uid}-v${i}`} className={controls.input} type="number" step="0.01" inputMode="decimal" value={e.value} onChange={(ev) => setEntries((l) => l.map((x, k) => (k === i ? { ...x, value: ev.target.value } : x)))} />
                </div>
                <button type="button" className={controls.btnIcon} aria-label={reportsT('remove')} onClick={() => setEntries((l) => l.filter((_, k) => k !== i))}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button type="button" className={controls.btnOutline} onClick={() => setEntries((l) => [...l, { date: todayIso(), value: '' }])}>
              <Plus size={16} /> {reportsT('stockAddEntry')}
            </button>
          </>
        )}
        {error && <div className={controls.error} role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
