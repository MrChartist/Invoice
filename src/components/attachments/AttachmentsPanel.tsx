import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Download, ExternalLink, FileText, Paperclip, Trash2, X } from 'lucide-react';
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_RECORD,
  MAX_PDF_BYTES,
  formatBytes,
  getAttachment,
  isImageMime,
  releaseAttachments,
  type AttachmentRef,
} from '../../lib/attachments';
import { attachFile, downloadAttachment, openAttachment } from '../../lib/attachment-upload';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import { fldT } from '../../i18n/areas/fields';
import controls from '../../styles/controls.module.css';
import styles from './attachments.module.css';

// R3-C2: "Print on document" flag for image attachments of a sales document (editor only).
const PrintFlag = lazy(() => import('./PrintFlag'));

export interface AttachmentsPanelProps {
  value: AttachmentRef[] | undefined;
  onChange: (next: AttachmentRef[]) => void;
  disabled?: boolean;
  /** Heading; defaults to "Attachments". */
  label?: string;
  hint?: string;
  /** R3-C2: offer "Print on document" (caption + Before / After / Other) on image attachments. */
  printable?: boolean;
}

/**
 * Attach / view / remove receipt photos and PDFs on a record. Files are stored as soon as
 * they are picked (content-addressed, so re-picking the same file is free); the record only
 * points at them once it is saved. Files picked or removed here that end up used by no
 * record (the form was cancelled, or the draft dropped them) are released shortly after the
 * panel unmounts — `releaseAttachments` only ever deletes files nothing refers to.
 */
export function AttachmentsPanel({ value, onChange, disabled, label: labelProp, hint, printable }: AttachmentsPanelProps) {
  useT(); // re-render on a language switch (5.4)
  const label = labelProp ?? fldT('attachments');
  const refs = value ?? [];
  const inputId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const touched = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    const ids = touched.current;
    return () => {
      // Give a pending draft autosave / the parent's save time to land before checking.
      if (ids.size) setTimeout(() => releaseAttachments(ids), 2000);
    };
  }, []);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    setBusy(true);
    let next = [...refs];
    const problems: string[] = [];
    for (const file of Array.from(files)) {
      if (next.length >= MAX_ATTACHMENTS_PER_RECORD) {
        problems.push(fldT('maxFiles', { n: MAX_ATTACHMENTS_PER_RECORD }));
        break;
      }
      try {
        const ref = await attachFile(file);
        touched.current.add(ref.id);
        if (!next.some((r) => r.id === ref.id)) next = [...next, ref];
      } catch (err) {
        problems.push(`${file.name}: ${(err as Error).message}`);
      }
    }
    setBusy(false);
    if (fileInput.current) fileInput.current.value = '';
    if (next.length !== refs.length) onChange(next);
    if (problems.length) setError(problems.join(' '));
  };

  const remove = (id: string) => {
    touched.current.add(id);
    if (preview === id) setPreview(null);
    onChange(refs.filter((r) => r.id !== id));
  };

  const open = (ref: AttachmentRef) => {
    if (!openAttachment(ref)) setError(fldT('missingFile', { name: ref.name }));
  };

  const shown = preview ? getAttachment(preview) : null;

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.title}>
          <Paperclip size={14} aria-hidden="true" /> {label}
          {refs.length > 0 && <span className={styles.count}>{refs.length}</span>}
        </span>
        <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={disabled || busy} onClick={() => fileInput.current?.click()}>
          {busy ? fldT('adding') : fldT('attachFile')}
        </button>
        <input
          id={inputId}
          ref={fileInput}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          hidden
          disabled={disabled || busy}
          aria-label={fldT('attachAria', { label })}
          onChange={(e) => void pick(e.target.files)}
        />
      </div>
      <p className={styles.hint}>
        {hint ?? fldT('attachHint', { size: formatBytes(MAX_PDF_BYTES) })}
      </p>

      {refs.length > 0 && (
        <ul className={styles.list} aria-label={label}>
          {refs.map((ref) => {
            const stored = getAttachment(ref.id);
            const image = isImageMime(ref.mime);
            return (
              <li key={ref.id} className={styles.item} style={printable && image ? { flexWrap: 'wrap' } : undefined}>
                {stored && image ? (
                  <button type="button" className={styles.thumbBtn} onClick={() => setPreview(preview === ref.id ? null : ref.id)} aria-label={fldT('preview', { name: ref.name })}>
                    <img src={stored.data} alt="" className={styles.thumb} />
                  </button>
                ) : (
                  <span className={styles.icon} aria-hidden="true"><FileText size={18} /></span>
                )}
                <span className={styles.meta}>
                  <span className={styles.name} title={ref.name}>{ref.name}</span>
                  <span className={stored ? styles.size : styles.missing}>
                    {stored ? `${ref.mime === 'application/pdf' ? fldT('pdf') : fldT('image')} · ${formatBytes(ref.size)}` : fldT('missingHere')}
                  </span>
                </span>
                {stored && (
                  <>
                    <button type="button" className={controls.btnIcon} onClick={() => open(ref)} aria-label={fldT('open', { name: ref.name })} title={fldT('openTab')}>
                      <ExternalLink size={15} />
                    </button>
                    <button type="button" className={controls.btnIcon} onClick={() => downloadAttachment(ref)} aria-label={fldT('download', { name: ref.name })} title={fldT('downloadTitle')}>
                      <Download size={15} />
                    </button>
                  </>
                )}
                <button type="button" className={controls.btnIcon} onClick={() => remove(ref.id)} disabled={disabled} aria-label={fldT('remove', { name: ref.name })} title={fldT('removeTitle')}>
                  <Trash2 size={15} />
                </button>
                {printable && image && stored && (
                  <Suspense fallback={null}>
                    <PrintFlag refs={refs} target={ref} disabled={disabled} onChange={onChange} />
                  </Suspense>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {shown && isImageMime(shown.mime) && (
        <figure className={styles.preview}>
          <img src={shown.data} alt={refs.find((r) => r.id === shown.id)?.name ?? fldT('previewAlt')} />
          <button type="button" className={cn(controls.btnIcon, styles.previewClose)} onClick={() => setPreview(null)} aria-label={fldT('closePreview')}>
            <X size={15} />
          </button>
        </figure>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
