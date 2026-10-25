/** Minimal typings for the Shape Detection API's BarcodeDetector (Chromium; not in lib.dom yet). */
export interface DetectedBarcode {
  rawValue: string;
  format: string;
}
export interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

const WANTED = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'];

/** True when this browser can scan with the camera (BarcodeDetector + getUserMedia on a secure origin). */
export function cameraScanSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'BarcodeDetector' in window &&
    !!navigator.mediaDevices?.getUserMedia &&
    window.isSecureContext !== false
  );
}

/** A detector for the retail formats this browser supports. */
export async function makeDetector(): Promise<BarcodeDetectorLike> {
  const Ctor = (window as unknown as { BarcodeDetector: BarcodeDetectorCtor }).BarcodeDetector;
  let formats = WANTED;
  try {
    const supported = (await Ctor.getSupportedFormats?.()) ?? WANTED;
    const usable = WANTED.filter((f) => supported.includes(f));
    if (usable.length) formats = usable;
  } catch {
    /* use the wanted list */
  }
  return new Ctor({ formats });
}
