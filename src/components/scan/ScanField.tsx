import { lazy, Suspense, useState, type KeyboardEventHandler, type Ref } from 'react';
import { Camera, ScanBarcode } from 'lucide-react';
import { normalizeCode } from '../../lib/scan';
import { cameraScanSupported } from './camera';
import { cn } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './scan.module.css';

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
  /** Called on Enter instead of `onCode` when it returns true (POS: pick the highlighted search hit). */
  onEnter?: (text: string) => boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
}

/**
 * Scan box: a USB / Bluetooth scanner types the code and presses Enter into this field; a camera
 * button reads codes with BarcodeDetector where the browser has it. Shows what happened below.
 */
export function ScanField({ id, label, onCode, placeholder, autoFocus, inputRef, continuous, onText, onEnter, onKeyDown }: Props) {
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
          placeholder={placeholder ?? 'Scan or type a barcode / SKU, then Enter'}
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
              if (onEnter?.(value)) return;
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
          else setStatus({ ok: false, message: 'Camera scanning needs a browser with barcode detection (Chrome or Edge on Android, ChromeOS, macOS). Use a USB scanner or type the code.' });
        }}
        aria-label="Scan with camera"
        title="Scan with camera"
      >
        <Camera size={16} /> <span>Camera</span>
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
