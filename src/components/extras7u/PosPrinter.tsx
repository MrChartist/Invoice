/**
 * POS receipt printer settings and the raw / ESC-POS print path (7U). Off by default: the POS keeps
 * the browser print of the 80 mm layout until the user picks another mode on this device. Web Serial
 * is feature-detected and used only after the user chooses the port; no network.
 */
import { useEffect, useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import { bluetoothSupported, chooseBluetoothPrinter, choosePort, loadPrinterPrefs, savePrinterPrefs, serialSupported, type PrinterPrefs } from '../../lib/escpos';
import type { InvoiceRecord } from '../../types/invoice';
import { printPosRaw } from './pos-raw-print';
import { useT } from '../../i18n';
import { x7T } from '../../i18n/areas/extras-7u';
import controls from '../../styles/controls.module.css';
import own from './x7u.module.css';

/** Runs the raw print for a saved bill, then `onDone`; on failure `onFail` (the POS falls back to the browser print). */
export function RawReceiptPrint({ invoice, onDone, onFail }: { invoice: InvoiceRecord; onDone: () => void; onFail: () => void }) {
  // Callbacks through a ref: the bill prints once per invoice, however often the POS re-renders.
  const cb = useRef({ onDone, onFail });
  useEffect(() => {
    cb.current = { onDone, onFail };
  });
  useEffect(() => {
    let live = true;
    printPosRaw(invoice).then(
      () => live && cb.current.onDone(),
      () => live && cb.current.onFail(),
    );
    return () => {
      live = false;
    };
  }, [invoice]);
  return null;
}

export function PosPrinterButton() {
  useT();
  const [open, setOpen] = useState(false);
  const [p, setP] = useState<PrinterPrefs>(() => loadPrinterPrefs());
  const [note, setNote] = useState('');
  const serial = serialSupported();
  const ble = bluetoothSupported(); // 8.26
  const set = (next: PrinterPrefs) => {
    setP(next);
    savePrinterPrefs(next);
  };
  const test = async () => {
    try {
      const sample = { invoice_number: 'TEST', issue_date: new Date().toISOString().slice(0, 10), doc_type: 'INVOICE', items: [{ id: 't', name: 'Test line', type: 'goods', quantity: 1, rate: 1, amount: 1 }], subtotal: 1, discount_amount: 0, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, round_off: 0, total: 1, client: { name: '' } } as unknown as InvoiceRecord;
      await printPosRaw(sample, { ...p, drawer: false });
      setNote('');
    } catch (err) {
      setNote(x7T('printFailed', { reason: (err as Error).message }));
    }
  };
  return (
    <span>
      <button type="button" className={controls.btnOutline} onClick={() => setOpen(!open)} aria-expanded={open} data-pos-printer>
        <Printer size={16} /> {x7T('printer')}
      </button>
      {open && (
        <div className={own.dialog} role="group" aria-label={x7T('printerTitle')}>
          <p className={own.sub}>{x7T('printerTitle')}</p>
          {(['browser', 'raw', 'serial', 'bluetooth'] as const).map((m) => (
            <label key={m} className={controls.check}>
              <input type="radio" name="pos-printer-mode" checked={p.mode === m} disabled={(m === 'serial' && !serial) || (m === 'bluetooth' && !ble)} onChange={() => set({ ...p, mode: m })} />
              {x7T(m === 'browser' ? 'modeBrowser' : m === 'raw' ? 'modeRaw' : m === 'serial' ? 'modeSerial' : 'modeBluetooth')}
            </label>
          ))}
          {!serial && <p className={own.muted}>{x7T('noSerial')}</p>}
          {!ble && <p className={own.muted}>{x7T('noBluetooth')}</p>}
          {p.mode === 'browser' && <p className={own.muted}>{x7T('browserDrawer')}</p>}
          {p.mode !== 'browser' && (
            <label className={controls.field}><span className={controls.label}>{x7T('width')}</span>
              <select className={controls.select} value={p.width} onChange={(e) => set({ ...p, width: e.target.value === '58' ? 58 : 80 })}>
                <option value={58}>58 mm</option>
                <option value={80}>80 mm</option>
              </select></label>
          )}
          {p.mode === 'bluetooth' && (
            <>
              <p className={own.muted}>{x7T('btNote')}</p>
              <label className={controls.check}><input type="checkbox" checked={p.drawer} onChange={(e) => set({ ...p, drawer: e.target.checked })} /> {x7T('kickDrawer')}</label>
              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => chooseBluetoothPrinter().then((name) => setNote(name ? x7T('btChosen', { name }) : x7T('noBluetooth'))).catch((err: Error) => setNote(err.message))}>{x7T('chooseBt')}</button>
            </>
          )}
          {p.mode === 'serial' && (
            <>
              <label className={controls.field}><span className={controls.label}>{x7T('baud')}</span>
                <select className={controls.select} value={p.baud} onChange={(e) => set({ ...p, baud: Number(e.target.value) })}>
                  {[9600, 19200, 38400, 57600, 115200].map((b) => <option key={b} value={b}>{b}</option>)}
                </select></label>
              <label className={controls.check}><input type="checkbox" checked={p.drawer} onChange={(e) => set({ ...p, drawer: e.target.checked })} /> {x7T('kickDrawer')}</label>
              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => choosePort().then((ok) => setNote(ok ? x7T('portChosen') : x7T('noSerial'))).catch((err: Error) => setNote(err.message))}>{x7T('choosePort')}</button>
            </>
          )}
          {note && <p className={own.muted}>{note}</p>}
          <div className={own.tools}>
            {p.mode !== 'browser' && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={test}>{x7T('testPrint')}</button>}
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setOpen(false)}>{x7T('close')}</button>
          </div>
        </div>
      )}
    </span>
  );
}
