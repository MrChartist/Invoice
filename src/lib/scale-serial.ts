/**
 * Live weight from an RS-232 / USB-serial weighing scale over Web Serial (8E, roadmap 8.140).
 * Loaded on demand (dynamic import from the POS), like `escpos.ts`: feature-detected
 * (`navigator.serial`, Chrome / Edge desktop over HTTPS or localhost), and the port is used only
 * after the user picks it in the browser's own chooser. Nothing leaves the device: bytes are read
 * from the scale, decoded as ASCII frames (`parseScaleFrame`) and the first STABLE weight is returned.
 */
import { parseScaleFrame, splitFrames, type ScaleFrame } from './scale-barcode';

interface PortLike {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  getInfo?: () => { usbVendorId?: number };
}
interface SerialLike {
  getPorts(): Promise<PortLike[]>;
  requestPort(): Promise<PortLike>;
}

const api = (): SerialLike | null => {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { serial?: SerialLike }) | undefined;
  return nav?.serial ?? null;
};

export const scaleSerialSupported = (): boolean => !!api();

/** Remembered for the tab: the port the user picked for the scale (a printer may be on another port). */
let scalePort: PortLike | null = null;

/** Ask the user to pick the scale's port (must run from a click / key press). */
export async function chooseScalePort(): Promise<boolean> {
  const s = api();
  if (!s) return false;
  scalePort = await s.requestPort();
  return true;
}

/**
 * Read frames until one is stable (or `timeoutMs` passes: the last weight seen is returned with
 * `stable: false`, or null when nothing readable arrived). Opens and closes the port each time.
 */
export async function readScaleWeight(baud = 9600, timeoutMs = 3000): Promise<ScaleFrame | null> {
  const s = api();
  if (!s) throw new Error('This browser has no Web Serial (Chrome / Edge on a computer).');
  const port = scalePort ?? (await s.requestPort());
  scalePort = port;
  await port.open({ baudRate: baud });
  const reader = port.readable?.getReader();
  if (!reader) {
    await port.close();
    throw new Error('The scale port cannot be read.');
  }
  const decoder = new TextDecoder('ascii');
  let buffer = '';
  let last: ScaleFrame | null = null;
  const timer = setTimeout(() => void reader.cancel().catch(() => {}), timeoutMs);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { frames, rest } = splitFrames(buffer);
      buffer = rest.slice(-256);
      for (const f of frames) {
        const frame = parseScaleFrame(f);
        if (!frame) continue;
        last = frame;
        if (frame.stable && frame.weight > 0) return frame;
      }
    }
  } finally {
    clearTimeout(timer);
    try {
      await reader.cancel();
    } catch {
      /* already cancelled */
    }
    reader.releaseLock();
    await port.close().catch(() => {});
  }
  return last ? { ...last, stable: false } : null;
}
