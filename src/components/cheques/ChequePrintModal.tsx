import { useState } from 'react';
import { Printer, Ruler } from 'lucide-react';
import { Modal } from '../ui/Modal';
import {
  CHEQUE_LAYOUTS,
  buildChequePrint,
  chequeHtml,
  loadChequePrefs,
  saveChequePrefs,
  type ChequeField,
  type ChequePrefs,
} from '../../lib/cheque-print';
import { downloadText } from '../../lib/download';
import type { Cheque } from '../../types/cheques';
import controls from '../../styles/controls.module.css';
import styles from './Cheques.module.css';
import { useT } from '../../i18n';
import { chqT } from '../../i18n/areas/cheques';
import { printWhenReady } from '../../lib/print-fonts';
import { SelectField } from '../ui/SelectField';

const FIELDS: ChequeField[] = ['date', 'payee', 'words1', 'words2', 'figures', 'crossing'];
const fieldLabel = (f: ChequeField) => chqT(`f.${f}`);

/** Open the leaf in a new window and print it (script-free HTML; a blocked pop-up saves the file instead). */
function printHtml(html: string, name: string) {
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    printWhenReady(w);
  } else {
    downloadText(`${name}.html`, html, 'text/html');
  }
}

/** Cheque printing with mm offsets for CTS-2010 leaves (6.26). */
export function ChequePrintModal({ cheque, onClose }: { cheque: Cheque | null; onClose: () => void }) {
  useT(); // re-render on a language switch (5.4)
  const [prefs, setPrefs] = useState<ChequePrefs>(() => loadChequePrefs());
  if (!cheque) return null;

  const print = buildChequePrint(cheque, prefs);
  const { layout } = print;
  const update = (p: ChequePrefs) => {
    setPrefs(p);
    try {
      saveChequePrefs(p);
    } catch {
      /* offsets are a convenience; never block printing */
    }
  };
  const nudge = (field: ChequeField, axis: 'dx' | 'dy', v: number) =>
    update({ ...prefs, fields: { ...prefs.fields, [field]: { dx: 0, dy: 0, ...prefs.fields[field], [axis]: v } } });
  const num = (v: string) => (v === '' || v === '-' ? 0 : Number(v));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={chqT('pTitle', { number: cheque.number })}
      subtitle={`${cheque.party_name} · ${layout.label}`}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={() => printHtml(chequeHtml(print, { guide: true, title: `Test print ${cheque.number}` }), `cheque-${cheque.number}-test`)}>
            <Ruler size={16} /> {chqT('pTest')}
          </button>
          <button type="button" className={controls.btnPrimary} onClick={() => printHtml(chequeHtml(print, { title: `Cheque ${cheque.number}` }), `cheque-${cheque.number}`)}>
            <Printer size={16} /> {chqT('pPrint')}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        <div className={styles.previewWrap} aria-label={chqT('pPreview')}>
          <div className={styles.leaf} style={{ width: `${layout.width}mm`, height: `${layout.height}mm` }}>
            {print.items.map((it) =>
              it.field === 'crossing' ? (
                <div key={it.field} className={`${styles.leafField} ${styles.leafCrossing}`} style={{ left: `${it.x}mm`, top: `${it.y}mm`, width: `${it.w}mm` }}>
                  {it.text}
                </div>
              ) : it.field === 'date' ? (
                <div key={it.field} className={`${styles.leafField} ${styles.leafDate}`} style={{ left: `${it.x}mm`, top: `${it.y}mm` }}>
                  {(it.boxes ?? []).map((d, i) => (
                    <span key={i} style={{ width: `${layout.dateBox}mm` }}>{d}</span>
                  ))}
                </div>
              ) : (
                <div key={it.field} className={styles.leafField} style={{ left: `${it.x}mm`, top: `${it.y}mm`, width: `${it.w}mm`, textAlign: it.field === 'figures' ? 'right' : undefined }}>
                  {it.text}
                </div>
              ),
            )}
          </div>
        </div>
        <p className={controls.hint}>
          {chqT('pHint')}
        </p>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>{chqT('pLayout')}</span>
            <SelectField className={controls.select} value={prefs.layout} onChange={(e) => update({ ...prefs, layout: e.target.value })}>
              {CHEQUE_LAYOUTS.map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </SelectField>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{chqT('pRight')}</span>
            <input className={`${controls.input} ${controls.inputNumeric}`} type="number" step="0.5" value={prefs.offsetX} onChange={(e) => update({ ...prefs, offsetX: num(e.target.value) })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{chqT('pDown')}</span>
            <input className={`${controls.input} ${controls.inputNumeric}`} type="number" step="0.5" value={prefs.offsetY} onChange={(e) => update({ ...prefs, offsetY: num(e.target.value) })} />
          </label>
        </div>
        <details>
          <summary className={controls.label}>{chqT('pAdjust')}</summary>
          <div className={styles.nudgeGrid}>
            {FIELDS.map((f) => (
              <div key={f} className={styles.nudgeRow}>
                <span>{fieldLabel(f)}</span>
                <input className={`${controls.input} ${controls.inputNumeric}`} type="number" step="0.5" aria-label={chqT('pFieldRight', { field: fieldLabel(f) })} value={prefs.fields[f]?.dx ?? 0} onChange={(e) => nudge(f, 'dx', num(e.target.value))} />
                <input className={`${controls.input} ${controls.inputNumeric}`} type="number" step="0.5" aria-label={chqT('pFieldDown', { field: fieldLabel(f) })} value={prefs.fields[f]?.dy ?? 0} onChange={(e) => nudge(f, 'dy', num(e.target.value))} />
              </div>
            ))}
          </div>
        </details>
      </div>
    </Modal>
  );
}
