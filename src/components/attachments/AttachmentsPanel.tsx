import { useEffect, useId, useRef, useState } from 'react';
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
import controls from '../../styles/controls.module.css';
import styles from './attachments.module.css';

export interface AttachmentsPanelProps {
  value: AttachmentRef[] | undefined;
  onChange: (next: AttachmentRef[]) => void;
  disabled?: boolean;
  /** Heading; defaults to "Attachments". */
  label?: string;
  hint?: string;
}

/**
 * Attach / view / remove receipt photos and PDFs on a record. Files are stored as soon as
 * they are picked (content-addressed, so re-picking the same file is free); the record only
 * points at them once it is saved. Files picked or removed here that end up used by no
 * record (the form was cancelled, or the draft dropped them) are released shortly after the
 * panel unmounts — `releaseAttachments` only ever deletes files nothing refers to.
 */
export function AttachmentsPanel({ value, onChange, disabled, label = 'Attachments', hint }: AttachmentsPanelProps) {
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
        problems.push(`Up to ${MAX_ATTACHMENTS_PER_RECORD} files per record.`);
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
    if (!openAttachment(ref)) setError(`${ref.name}: the file is missing on this device.`);
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
          {busy ? 'Adding…' : 'Attach file'}
        </button>
        <input
          id={inputId}
          ref={fileInput}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          multiple
          hidden
          disabled={disabled || busy}
          aria-label={`${label}: attach a photo or PDF`}
          onChange={(e) => void pick(e.target.files)}
        />
      </div>
      <p className={styles.hint}>
        {hint ?? `Receipt photos or PDFs (up to ${formatBytes(MAX_PDF_BYTES)} each). Kept on this device and in backups; never printed.`}
      </p>

      {refs.length > 0 && (
        <ul className={styles.list} aria-label={label}>
          {refs.map((ref) => {
            const stored = getAttachment(ref.id);
            const image = isImageMime(ref.mime);
            return (
              <li key={ref.id} className={styles.item}>
                {stored && image ? (
                  <button type="button" className={styles.thumbBtn} onClick={() => setPreview(preview === ref.id ? null : ref.id)} aria-label={`Preview ${ref.name}`}>
                    <img src={stored.data} alt="" className={styles.thumb} />
                  </button>
                ) : (
                  <span className={styles.icon} aria-hidden="true"><FileText size={18} /></span>
                )}
                <span className={styles.meta}>
                  <span className={styles.name} title={ref.name}>{ref.name}</span>
                  <span className={stored ? styles.size : styles.missing}>
                    {stored ? `${ref.mime === 'application/pdf' ? 'PDF' : 'Image'} · ${formatBytes(ref.size)}` : 'File missing on this device'}
                  </span>
                </span>
                {stored && (
                  <>
                    <button type="button" className={controls.btnIcon} onClick={() => open(ref)} aria-label={`Open ${ref.name}`} title="Open in a new tab">
                      <ExternalLink size={15} />
                    </button>
                    <button type="button" className={controls.btnIcon} onClick={() => downloadAttachment(ref)} aria-label={`Download ${ref.name}`} title="Download">
                      <Download size={15} />
                    </button>
                  </>
                )}
                <button type="button" className={controls.btnIcon} onClick={() => remove(ref.id)} disabled={disabled} aria-label={`Remove ${ref.name}`} title="Remove">
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {shown && isImageMime(shown.mime) && (
        <figure className={styles.preview}>
          <img src={shown.data} alt={refs.find((r) => r.id === shown.id)?.name ?? 'Attachment preview'} />
          <button type="button" className={cn(controls.btnIcon, styles.previewClose)} onClick={() => setPreview(null)} aria-label="Close preview">
            <X size={15} />
          </button>
        </figure>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  );
}
