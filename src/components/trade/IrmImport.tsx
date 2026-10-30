/**
 * R4-C2 IRM CSV import: a file the user downloaded from the DGFT IRM repository or their bank (no network), columns
 * mapped automatically (the import-mapping scorer) and adjustable, duplicates by IRM number skipped.
 */
import { useMemo, useState } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { MAX_IMPORT_BYTES } from '../../lib/csv';
import { parseDate } from '../../lib/importers';
import { IRM_FIELDS, irmsDb, parseIrmCsv, type IrmField, type IrmMapping } from '../../lib/trade/export-register';
import { useT } from '../../i18n';
import { trErr, trT } from '../../i18n/areas/trade-trust-r4';
import controls from '../../styles/controls.module.css';
import styles from './trade.module.css';
import { SelectField } from '../ui/SelectField';

export default function IrmImport({ onClose, onDone }: { onClose: () => void; onDone: (n: number) => void }) {
  useT();
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<IrmMapping | undefined>(undefined);
  const [error, setError] = useState('');
  const result = useMemo(() => {
    if (!text) return { parsed: null, problem: '' };
    try {
      return { parsed: parseIrmCsv(text, parseDate, mapping), problem: '' };
    } catch (err) {
      return { parsed: null, problem: trErr(err) };
    }
  }, [text, mapping]);
  const parsed = result.parsed;
  const pick = async (file: File | undefined) => {
    setError('');
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setError(trT('importTooBig'));
    setMapping(undefined);
    setText(await file.text());
  };
  const save = () => {
    if (!parsed) return;
    try {
      onDone(irmsDb.importMany(parsed.rows));
    } catch (err) {
      setError(trErr(err));
    }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={trT('importTitle')}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{trT('cancel')}</button><button type="button" className={controls.btnPrimary} disabled={!parsed?.rows.length} onClick={save}>{trT('importSave', { n: parsed?.rows.length ?? 0 })}</button></>}>
      <div className={styles.stack}>
        <p className={styles.muted}>{trT('importHint')}</p>
        <label className={controls.field}>
          <span className={controls.label}><Upload size={14} aria-hidden="true" /> {trT('importFile')}</span>
          <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        {parsed && (
          <>
            <div className={styles.inline}>
              {IRM_FIELDS.map((f) => (
                <label key={f.key} className={`${controls.field} ${styles.narrow}`}>
                  <span className={controls.label}>{trT('importColumn', { field: trT(`f_${f.key}` as `f_${IrmField}`) })}</span>
                  <SelectField className={controls.select} value={String(parsed.mapping[f.key] ?? -1)} onChange={(e) => setMapping({ ...parsed.mapping, [f.key]: Number(e.target.value) })}>
                    <option value="-1">{trT('importNotMapped')}</option>
                    {parsed.header.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </SelectField>
                </label>
              ))}
            </div>
            <p className={styles.muted} role="status">{trT('importPreview', { n: parsed.rows.length, skipped: parsed.skipped.length })}</p>
          </>
        )}
        {(error || result.problem) && <p className={controls.error} role="alert">{error || result.problem}</p>}
      </div>
    </Modal>
  );
}
