import { lazy, Suspense, useState, type KeyboardEventHandler, type Ref } from 'react';
import { Camera, ScanBarcode } from 'lucide-react';
import { normalizeCode } from '../../lib/scan';
import { cameraScanSupported } from './camera';
import { cn } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './scan.module.css';
import { useT } from '../../i18n';
import { scanT } from '../../i18n/areas/scan';

const CameraScanner = lazy(() => import('./CameraScanner').then((m) => ({ default: m.CameraScanner })));

export interface ScanOutcome {
  ok: boolean;
  message: string;
}

interface Props {
  id: string;
  label: string;
  /** Handle one code (typed, from a USB "keyboard wedge" scanner, or from the camera). */
  onCode: (code: string) => ScanOutcome;
  placeholder?: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** Keep the camera open after a read (POS). */
  continuous?: boolean;
  /** Text typed that is not a code (e.g. an item name in the POS) — called on every change. */
  onText?: (text: string) => void;
  /**
   * Called on Enter instead of `onCode` when it returns true (POS: pick the highlighted search hit).
   * 8E: an outcome object is handled too and shown as the status; `keep` handles it but leaves the text in the box.
   */
  onEnter?: (text: string) => boolean | ScanOutcome | (ScanOutcome & { keep: true });
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

/**
 * Scan box: a USB / Bluetooth scanner types the code and presses Enter into this field; a camera
 * button reads codes with BarcodeDetector where the browser has it. Shows what happened below.
 */
export function ScanField({ id, label, onCode, placeholder, autoFocus, inputRef, continuous, onText, onEnter, onKeyDown }: Props) {
  useT(); // re-render on a language switch (5.4)
  const [text, setText] = useState('');
  const [status, setStatus] = useState<ScanOutcome | null>(null);
  const [camera, setCamera] = useState(false);

  const handle = (raw: string) => {
    const code = normalizeCode(raw);
    if (!code) return;
    setStatus(onCode(code));
  };

  return (
    <div className={styles.bar}>
      <label className={surface.srOnly} htmlFor={id}>{label}</label>
      <div className={styles.field}>
        <ScanBarcode size={16} aria-hidden="true" />
        <input
          id={id}
          ref={inputRef}
          className={cn(controls.input, styles.input)}
          value={text}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder ?? scanT('placeholder')}
          onChange={(e) => {
            setText(e.target.value);
            onText?.(e.target.value);
          }}
          onKeyDown={(e) => {
            onKeyDown?.(e);
            if (e.defaultPrevented) return;
            if (e.key === 'Enter') {
              e.preventDefault();
              const value = text;
              setText('');
              onText?.('');
              const r = onEnter?.(value);
              if (r && typeof r === 'object') {
                setStatus({ ok: r.ok, message: r.message });
                if ('keep' in r && r.keep) {
                  setText(value);
                  onText?.(value);
                }
                return;
              }
              if (r) return;
              handle(value);
            }
          }}
        />
      </div>
      <button
        type="button"
        className={controls.btnOutline}
        onClick={() => {
          if (cameraScanSupported()) setCamera(true);
          else setStatus({ ok: false, message: scanT('noCamera') });
        }}
        aria-label={scanT('withCamera')}
        title={scanT('withCamera')}
      >
        <Camera size={16} /> <span>{scanT('camera')}</span>
      </button>
      <p className={cn(styles.status, status && (status.ok ? styles.statusOk : styles.statusError))} role="status" aria-live="polite">
        {status?.message ?? ''}
      </p>
      {camera && (
        <Suspense fallback={null}>
          <CameraScanner open={camera} onClose={() => setCamera(false)} onCode={handle} continuous={continuous} />
        </Suspense>
      )}
    </div>
  );
}
