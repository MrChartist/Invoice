import { useState } from 'react';
import type { AttachmentRef } from '../../lib/attachments';
import type { PhotoGroup } from '../../types/docs-r3';
import { MAX_PRINTED_PHOTOS, PHOTO_GROUPS, sanitizePrint, setPrintFlag } from '../../lib/doc-evidence';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import { d3T } from '../../i18n/areas/docs-r3';
import controls from '../../styles/controls.module.css';
import styles from './PrintFlag.module.css';
import { SelectField } from '../ui/SelectField';

/** R3-C2: mark an image attachment "Print on document" with a caption and a group (Before / After / Other). */
export default function PrintFlag({ refs, target, disabled, onChange }: { refs: AttachmentRef[]; target: AttachmentRef; disabled?: boolean; onChange: (next: AttachmentRef[]) => void }) {
  useT();
  const print = sanitizePrint(target.print);
  const [full, setFull] = useState(false);
  const apply = (next: { caption?: string; group?: PhotoGroup } | null) => {
    const out = setPrintFlag(refs, target.id, next);
    if (out === false) return setFull(true);
    setFull(false);
    onChange(out);
  };
  return (
    <div className={styles.row} data-print-flag>
      <label className={styles.check}>
        <input type="checkbox" checked={!!print} disabled={disabled} onChange={(e) => apply(e.target.checked ? { group: 'other' } : null)} />
        {d3T('ph.print')}
      </label>
      {print && (
        <>
          <SelectField className={controls.select} value={print.group} disabled={disabled} aria-label={d3T('ph.group')} onChange={(e) => apply({ ...print, group: e.target.value as PhotoGroup })}>
            {PHOTO_GROUPS.map((g) => <option key={g} value={g}>{d3T(`ph.${g}` as const)}</option>)}
          </SelectField>
          <input className={cn(controls.input, styles.caption)} value={print.caption ?? ''} placeholder={d3T('ph.caption')} aria-label={d3T('ph.caption')} disabled={disabled} maxLength={80} onChange={(e) => apply({ ...print, caption: e.target.value })} />
        </>
      )}
      {full && <span className={styles.note} role="status">{d3T('ph.max', { n: MAX_PRINTED_PHOTOS })}</span>}
    </div>
  );
}
