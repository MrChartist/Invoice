/**
 * 8I (8.160): "Scan bill" from the Expenses header (myBillBook "Scan invoice" in Purchases). One step to the
 * capture flow: live e-invoice QR scan with the camera (BarcodeDetector, where the browser has it), a photo taken
 * now, or a picked photo / PDF → `openCaptureFromFile`. Lazy chunk; nothing leaves the device.
 */
import { lazy, Suspense, useRef, useState } from 'react';
import { Camera, FileUp, ScanLine } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { cameraScanSupported } from '../scan/camera';
import { captureFromQrText, openCaptureFromFile } from '../../lib/capture-browser';
import { ATTACHMENT_ACCEPT } from '../../lib/attachments';
import { useT } from '../../i18n';
import { bsT } from '../../i18n/areas/bill-scan';
import { capT } from '../../i18n/areas/capture';
import controls from '../../styles/controls.module.css';
import css from './capture.module.css';

const CameraScanner = lazy(() => import('../scan/CameraScanner').then((m) => ({ default: m.CameraScanner })));

type Tone = 'success' | 'error' | 'info';

export interface ScanBillDialogProps {
  onClose: () => void;
  /** Called after a capture: toast text and the inbox route to open (`/expenses?tab=inbox&doc=…`). */
  onDone: (message: string, tone: Tone, route?: string) => void;
}

export default function ScanBillDialog({ onClose, onDone }: ScanBillDialogProps) {
  useT();
  const [mode, setMode] = useState<'choose' | 'camera'>('choose');
  const [busy, setBusy] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const live = cameraScanSupported();

  const onFile = async (file: File | undefined, source: 'camera' | 'upload') => {
    if (!file) return;
    setBusy(true);
    try {
      const out = await openCaptureFromFile(file, { source });
      onDone(out.draft ? capT('drafted', { no: out.qr?.docNo || '-' }) : out.note || bsT('kept'), out.draft ? 'success' : 'info', out.route);
    } catch (err) {
      onDone(`${file.name}: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'camera') {
    return (
      <Suspense fallback={null}>
        <CameraScanner
          open
          onClose={onClose}
          onCode={(code) => {
            try {
              const r = captureFromQrText(code, 'camera');
              onDone(r.message, r.tone, r.route);
            } catch (err) {
              onDone((err as Error).message, 'error');
            }
          }}
        />
      </Suspense>
    );
  }

  return (
    <Modal open onClose={onClose} title={bsT('title')} size="sm">
      <div className={css.stack} data-scan-bill>
        <p className={css.note}>{bsT('hint')}</p>
        {live ? (
          <button type="button" className={controls.btnPrimary} onClick={() => setMode('camera')} disabled={busy}>
            <ScanLine size={16} aria-hidden /> {bsT('camera')}
          </button>
        ) : (
          <p className={css.note}>{bsT('noCamera')}</p>
        )}
        <button type="button" className={live ? controls.btnOutline : controls.btnPrimary} onClick={() => photoRef.current?.click()} disabled={busy}>
          <Camera size={16} aria-hidden /> {busy ? bsT('reading') : bsT('photo')}
        </button>
        <button type="button" className={controls.btnOutline} onClick={() => fileRef.current?.click()} disabled={busy}>
          <FileUp size={16} aria-hidden /> {bsT('file')}
        </button>
        <input ref={photoRef} type="file" hidden accept="image/*" capture="environment" data-testid="scan-bill-photo"
          onChange={(e) => void onFile(e.target.files?.[0], 'camera')} />
        <input ref={fileRef} type="file" hidden accept={ATTACHMENT_ACCEPT} data-testid="scan-bill-file"
          onChange={(e) => void onFile(e.target.files?.[0], 'upload')} />
        <p className={css.note}>{capT('pdfNote')}</p>
      </div>
    </Modal>
  );
}
