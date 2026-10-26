import { useId, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import {
  MAX_LETTERHEAD_BYTES,
  TEMPLATE_MARGINS_MM,
  sanitizeLetterhead,
  sanitizeMargins,
  storeArtwork,
  type DesignPrefs,
  type LetterheadMode,
  type MarginsMm,
} from '../../lib/design-prefs';
import { itemImageData } from '../../lib/item-images';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import { d3T } from '../../i18n/areas/docs-r3';
import controls from '../../styles/controls.module.css';
import styles from './PagePanel.module.css';

const SIDES: (keyof MarginsMm)[] = ['top', 'right', 'bottom', 'left'];

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg)$/.test(file.type)) return reject(new Error(d3T('pg.onlyRaster')));
    if (file.size > MAX_LETTERHEAD_BYTES) return reject(new Error(d3T('pg.tooBig')));
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(d3T('pg.readFailed')));
    r.readAsDataURL(file);
  });
}

function ArtPicker({ label, value, disabled, onPick, onClear }: { label: string; value?: string; disabled: boolean; onPick: (ref: string) => void; onClear: () => void }) {
  const id = useId();
  const [error, setError] = useState('');
  const src = itemImageData(value);
  return (
    <div className={styles.art}>
      <span className={controls.label}>{label}</span>
      {src && <img className={styles.artPreview} src={src} alt="" />}
      <div className={styles.row}>
        <label htmlFor={id} className={cn(controls.btnOutline, controls.btnSm, disabled && styles.disabled)}>
          <Upload size={14} /> {src ? d3T('pg.replace') : d3T('pg.upload')}
        </label>
        <input
          id={id}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          disabled={disabled}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
              onPick(storeArtwork(await readFile(file)));
              setError('');
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
        {src && (
          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={onClear} disabled={disabled}>
            <Trash2 size={14} /> {d3T('pg.remove')}
          </button>
        )}
      </div>
      {error && <p className={controls.error} role="alert">{error}</p>}
    </div>
  );
}

/**
 * R3-C3 Design Studio → Page: margins (mm, 0–30) and letterhead / footer artwork (PNG / JPEG ≤ 400 kB,
 * stored once in `assets`). Pre-printed stationery and letterhead artwork exclude each other. Design
 * prefs, not snapshots: saved documents re-render with the current letterhead (like the rest of design).
 */
export function PagePanel({ design, onChange, sectionClass, titleClass }: { design: DesignPrefs; onChange: (patch: Partial<DesignPrefs>) => void; sectionClass?: string; titleClass?: string }) {
  useT();
  const margins = sanitizeMargins(design.margins_mm);
  const lh = sanitizeLetterhead(design.letterhead);
  const preprinted = design.preprinted?.on === true;
  const setMargin = (side: keyof MarginsMm, v: number) => onChange({ margins_mm: sanitizeMargins({ ...(margins ?? TEMPLATE_MARGINS_MM), [side]: v }) });
  const modes: { value: LetterheadMode; label: string }[] = [
    { value: 'header', label: d3T('pg.modeHeader') },
    { value: 'background', label: d3T('pg.modeBackground') },
  ];
  return (
    <section className={sectionClass}>
    <h3 className={titleClass}>{d3T('pg.section')}</h3>
    <div className={styles.wrap} data-page-panel>
      {/* R3-C2: catalogue photos on item lines (never on the GST grid / thermal roll). */}
      <label className={controls.check}>
        <input type="checkbox" checked={design.show_item_images === true} onChange={(e) => onChange({ show_item_images: e.target.checked || undefined })} data-item-images />
        {d3T('ph.itemImages')}
      </label>
      <label className={controls.check}>
        <input type="checkbox" checked={!!margins} onChange={(e) => onChange({ margins_mm: e.target.checked ? { ...TEMPLATE_MARGINS_MM } : undefined })} />
        {d3T('pg.customMargins')}
      </label>
      {margins && (
        <div className={styles.grid}>
          {SIDES.map((side) => (
            <label key={side} className={controls.field}>
              <span className={controls.label}>{d3T(`pg.${side}` as const)}</span>
              <input className={controls.input} type="number" min={0} max={30} step={0.5} value={margins[side]} onChange={(e) => setMargin(side, Number(e.target.value))} data-margin={side} />
            </label>
          ))}
        </div>
      )}
      {preprinted ? (
        <div className={styles.notice} role="note">
          <span>{d3T('pg.preprintedOn')}</span>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => onChange({ preprinted: { ...design.preprinted!, on: false } })}>
            {d3T('pg.preprintedOff')}
          </button>
        </div>
      ) : (
        <p className={styles.hint}>{d3T('pg.artHint')}</p>
      )}
      <ArtPicker
        label={d3T('pg.letterhead')}
        value={lh?.image}
        disabled={preprinted}
        onPick={(image) => onChange({ letterhead: { image, mode: lh?.mode ?? 'header', every_page: lh?.every_page ?? false } })}
        onClear={() => onChange({ letterhead: undefined })}
      />
      {lh && (
        <>
          <div className={controls.segment} role="radiogroup" aria-label={d3T('pg.mode')}>
            {modes.map((m) => (
              <button key={m.value} type="button" role="radio" aria-checked={lh.mode === m.value} disabled={preprinted}
                className={lh.mode === m.value ? controls.segmentBtnActive : controls.segmentBtn}
                onClick={() => onChange({ letterhead: { ...lh, mode: m.value } })}>
                {m.label}
              </button>
            ))}
          </div>
          {lh.mode === 'header' && (
            <label className={controls.check}>
              <input type="checkbox" checked={lh.every_page} disabled={preprinted} onChange={(e) => onChange({ letterhead: { ...lh, every_page: e.target.checked } })} />
              {d3T('pg.everyPage')}
            </label>
          )}
        </>
      )}
      <ArtPicker
        label={d3T('pg.footer')}
        value={design.footer_image}
        disabled={preprinted}
        onPick={(footer_image) => onChange({ footer_image })}
        onClear={() => onChange({ footer_image: undefined })}
      />
      <p className={styles.hint}>{d3T('pg.footerHint')}</p>
    </div>
    </section>
  );
}

export default PagePanel;
