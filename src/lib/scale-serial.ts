/**
 * Live weight from an RS-232 / USB-serial weighing scale over Web Serial (8E, roadmap 8.140).
 * Loaded on demand (dynamic import from the POS), like `escpos.ts`: feature-detected
 * (`navigator.serial`, Chrome / Edge desktop over HTTPS or localhost), and the port is used only
 * after the user picks it in the browser's own chooser. Nothing leaves the device: bytes are read
 * from the scale, decoded as ASCII frames (`parseScaleFrame`) and the first STABLE weight is returned.
 *
 * PENDING 50: two more links, each optional and feature-detected, chosen in the counter settings:
 *  - USB HID scales over WebHID (`navigator.hid`): the USB-IF HID Point-of-Sale "Scale Data Report" (usage page 0x8D):
 *    status, unit, signed exponent, 16-bit weight (`parseHidScaleReport`);
 *  - Bluetooth scales over Web Bluetooth exposing the Bluetooth SIG Weight Scale Service (0x181D, Weight
 *    Measurement 0x2A9D: flags, 16-bit weight at 0.005 kg / 0.01 lb; `parseBleWeight`). Scales with their own
 *    proprietary services are not read.
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

export type ScaleLink = 'serial' | 'hid' | 'ble';
type Nav = Navigator & { hid?: { requestDevice(o: unknown): Promise<HidDev[]> }; bluetooth?: { requestDevice(o: unknown): Promise<BleDev> } };
interface HidDev { opened: boolean; open(): Promise<void>; close(): Promise<void>; addEventListener(t: 'inputreport', f: (e: { data: DataView }) => void): void; removeEventListener(t: 'inputreport', f: (e: { data: DataView }) => void): void }
interface BleChar { startNotifications(): Promise<BleChar>; stopNotifications(): Promise<BleChar>; value?: DataView; addEventListener(t: string, f: () => void): void; removeEventListener(t: string, f: () => void): void }
interface BleDev { gatt?: { connect(): Promise<{ getPrimaryService(s: number): Promise<{ getCharacteristic(c: number): Promise<BleChar> }> }>; disconnect(): void } }
const nav = (): Nav | undefined => (typeof navigator !== 'undefined' ? (navigator as Nav) : undefined);

/** Can this browser reach a scale over `link`? */
export const scaleLinkSupported = (link: ScaleLink = 'serial'): boolean => (link === 'hid' ? !!nav()?.hid : link === 'ble' ? !!nav()?.bluetooth : !!api());

const HID_UNITS: Record<number, number> = { 1: 1e-6, 2: 1e-3, 3: 1, 11: 0.028349523125, 12: 0.45359237 };

/** USB HID POS scale data report (report id stripped): [status, unit, exponent, weight LSB, weight MSB] → kg. */
export function parseHidScaleReport(b: ArrayLike<number>): ScaleFrame | null {
  if (b.length < 5) return null;
  const status = b[0];
  const unit = HID_UNITS[b[1]];
  if (!unit || status === 1 || status >= 6) return null;
  const exp = b[2] > 127 ? b[2] - 256 : b[2];
  const raw = (b[3] | (b[4] << 8)) * 10 ** exp * unit;
  const weight = status === 5 ? -raw : status === 2 ? 0 : raw;
  return { weight: Math.round(weight * 1000) / 1000, stable: status === 2 || status === 4 };
}

/** Bluetooth SIG Weight Measurement (0x2A9D): flags bit 0 = imperial; weight uint16 LE; 0xFFFF = failed. */
export function parseBleWeight(b: ArrayLike<number>): ScaleFrame | null {
  if (b.length < 3) return null;
  const raw = b[1] | (b[2] << 8);
  if (raw === 0xffff) return null;
  const kg = b[0] & 1 ? raw * 0.01 * 0.45359237 : raw * 0.005;
  return { weight: Math.round(kg * 1000) / 1000, stable: true };
}

let hidDev: HidDev | null = null;
let bleDev: BleDev | null = null;

/** Wait for the first stable frame from an event source (or the last one seen when time runs out). */
function firstStable(subscribe: (on: (f: ScaleFrame | null) => void) => () => void, timeoutMs: number): Promise<ScaleFrame | null> {
  return new Promise((resolve) => {
    let last: ScaleFrame | null = null;
    let off = () => {};
    const done = (f: ScaleFrame | null) => {
      clearTimeout(timer);
      off();
      resolve(f);
    };
    const timer = setTimeout(() => done(last ? { ...last, stable: false } : null), timeoutMs);
    off = subscribe((f) => {
      if (!f) return;
      last = f;
      if (f.stable && f.weight > 0) done(f);
    });
  });
}

async function readHid(timeoutMs: number): Promise<ScaleFrame | null> {
  const dev = hidDev ?? (await nav()!.hid!.requestDevice({ filters: [{ usagePage: 0x8d }] }))[0];
  if (!dev) return null;
  hidDev = dev;
  if (!dev.opened) await dev.open();
  return firstStable((on) => {
    const f = (e: { data: DataView }) => on(parseHidScaleReport(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength)));
    dev.addEventListener('inputreport', f);
    return () => dev.removeEventListener('inputreport', f);
  }, timeoutMs);
}

async function readBle(timeoutMs: number): Promise<ScaleFrame | null> {
  const dev = bleDev ?? (await nav()!.bluetooth!.requestDevice({ filters: [{ services: [0x181d] }] }));
  bleDev = dev;
  const server = await dev.gatt!.connect();
  const ch = await (await server.getPrimaryService(0x181d)).getCharacteristic(0x2a9d);
  await ch.startNotifications();
  try {
    return await firstStable((on) => {
      const f = () => on(ch.value ? parseBleWeight(new Uint8Array(ch.value.buffer, ch.value.byteOffset, ch.value.byteLength)) : null);
      ch.addEventListener('characteristicvaluechanged', f);
      return () => ch.removeEventListener('characteristicvaluechanged', f);
    }, timeoutMs);
  } finally {
    await ch.stopNotifications().catch(() => ch);
  }
}

/** Remembered for the tab: the port the user picked for the scale (a printer may be on another port). */
let scalePort: PortLike | null = null;

/** Ask the user to pick the scale's port / device (must run from a click / key press). */
export async function chooseScalePort(link: ScaleLink = 'serial'): Promise<boolean> {
  if (link === 'hid') return !!(hidDev = (await nav()!.hid!.requestDevice({ filters: [{ usagePage: 0x8d }] }))[0] ?? null);
  if (link === 'ble') return !!(bleDev = await nav()!.bluetooth!.requestDevice({ filters: [{ services: [0x181d] }] }));
  const s = api();
  if (!s) return false;
  scalePort = await s.requestPort();
  return true;
}

/**
 * Read frames until one is stable (or `timeoutMs` passes: the last weight seen is returned with
 * `stable: false`, or null when nothing readable arrived). Opens and closes the port each time.
 */
export async function readScaleWeight(baud = 9600, timeoutMs = 3000, link: ScaleLink = 'serial'): Promise<ScaleFrame | null> {
  if (link === 'hid') return readHid(timeoutMs);
  if (link === 'ble') return readBle(timeoutMs);
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
