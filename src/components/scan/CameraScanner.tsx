import { useEffect, useRef, useState } from 'react';
import { Modal } from '../ui/Modal';
import { makeDetector } from './camera';
import controls from '../../styles/controls.module.css';
import styles from './scan.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called with each new code read. */
  onCode: (code: string) => void;
  /** Keep scanning after a read (POS); otherwise close after the first code. */
  continuous?: boolean;
}

/**
 * Camera scanning with the browser's BarcodeDetector (no library, nothing leaves the device).
 * The same code is ignored for 1.5 s so one pack held in front of the camera adds one unit.
 */
export function CameraScanner({ open, onClose, onCode, continuous }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [last, setLast] = useState('');
  const onCodeRef = useRef(onCode);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCodeRef.current = onCode;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const seen = { code: '', at: 0 };
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        if (stopped) return;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        const detector = await makeDetector();
        const tick = async () => {
          if (stopped) return;
          try {
            if (video.readyState >= 2) {
              const found = await detector.detect(video);
              const code = found[0]?.rawValue?.trim();
              const now = Date.now();
              if (code && !(code === seen.code && now - seen.at < 1500)) {
                seen.code = code;
                seen.at = now;
                setLast(code);
                onCodeRef.current(code);
                if (!continuous) {
                  onCloseRef.current();
                  return;
                }
              }
            }
          } catch {
            /* a frame that cannot be read is skipped */
          }
          timer = setTimeout(tick, 200);
        };
        tick();
      } catch (err) {
        const name = (err as Error)?.name;
        setError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Camera access was refused. Allow the camera for this site in the browser settings, or use a USB scanner / type the code.'
            : 'The camera could not be started. Use a USB scanner or type the code instead.',
        );
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, continuous]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title="Scan with camera"
      subtitle="Hold the barcode inside the frame"
      footer={
        <button type="button" className={controls.btnOutline} onClick={onClose}>
          {continuous ? 'Done' : 'Cancel'}
        </button>
      }
    >
      {error ? (
        <p role="alert" className={styles.statusError}>{error}</p>
      ) : (
        <div className={styles.camWrap}>
          <video ref={videoRef} className={styles.video} muted playsInline aria-label="Camera preview" />
          <div className={styles.aim} aria-hidden="true" />
        </div>
      )}
      <p className={styles.note} role="status">
        {last ? `Read ${last}` : 'Nothing is uploaded — the image is read on this device.'}
      </p>
    </Modal>
  );
}
