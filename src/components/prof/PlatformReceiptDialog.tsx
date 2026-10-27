/**
 * R14 PS-C4 "Receive via platform" on a foreign-currency invoice: gross, platform fee, conversion fee (in the invoice
 * currency) and the rupees credited → one receipt of the gross at the realised rate, one fee bill (import RCM for a
 * non-resident platform of a registered company), paid from the payout bank. Opened from the receipt dialog and the
 * Platforms view.
 */
import { useState, type ReactNode } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import { Modal } from '../ui/Modal';
import { localDb } from '../../lib/localDb';
import { impliedPacks } from '../../lib/shop-mode';
import { todayInput } from '../../lib/utils';
import { loadPlatforms, planPlatformReceipt, receiveViaPlatform } from '../../lib/prof/ps-platforms';
import { useT } from '../../i18n';
import { pcT, type PcKey } from '../../i18n/areas/prof-r14c-export';
import type { Notify } from './pc-run';
import controls from '../../styles/controls.module.css';
import css from './exportsvc.module.css';

/** The "Receive via platform" button and its dialog (nothing without the `svcexport` pack). */
export default function PlatformReceiptDialog(props: Props) {
  useT();
  const [open, setOpen] = useState(false);
  if (!impliedPacks(localDb.settings.get()).includes('svcexport')) return null;
  return (
    <>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setOpen(true)} data-ps-via-platform>{pcT('receive')}</button>
      {open && <Dialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

const fld = (l: string, c: ReactNode) => <label className={controls.field}><span className={controls.label}>{l}</span>{c}</label>;

type Props = { invoice: Pick<InvoiceRecord, 'id' | 'invoice_number' | 'currency' | 'balance_due'>; onDone?: () => void; notify?: Notify };

function Dialog({ invoice, onClose, onDone, notify }: Props & { onClose: () => void }) {
  const platforms = loadPlatforms();
  const cur = String(invoice.currency || 'INR').toUpperCase();
  const [f, setF] = useState({ platform: platforms[0]?.name ?? '', gross: String(invoice.balance_due ?? ''), fee: '', conv: '', inr: '', date: todayInput(), ref: '' });
  const [err, setErr] = useState('');
  const pf = platforms.find((p) => p.name === f.platform);
  const registered = !!localDb.settings.activeProfile()?.companyGstin?.trim();
  const input = { gross: Number(f.gross), fee: Number(f.fee) || 0, conversion: Number(f.conv) || 0, inr: Number(f.inr), date: f.date, reference: f.ref.trim() || undefined };
  let preview = '';
  try {
    if (pf) {
      const p = planPlatformReceipt(input, pf, registered);
      preview = pcT('plan', { gross: `${cur} ${input.gross}`, rate: p.rate, fee: p.feeInr, rcm: p.rcm ? pcT('rcm', { igst: p.igst }) : '' });
    }
  } catch {
    preview = '';
  }
  const save = () => {
    try {
      if (!pf) throw new Error('noPlatforms');
      receiveViaPlatform(invoice, pf, input, registered);
      notify?.(`${pcT('save')} ✓`);
      onDone?.();
      onClose();
    } catch (e) {
      const m = (e as Error).message;
      setErr(m in pcT.en ? pcT(m as PcKey) : m);
    }
  };
  const num = (k: 'gross' | 'fee' | 'conv' | 'inr', l: string) => fld(l, <input type="number" min="0" step="0.01" className={controls.input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...{ [`data-ps-plat-${k}`]: '' }} />);
  return (
    <Modal open onClose={onClose} title={pcT('receive')} subtitle={invoice.invoice_number} size="md"
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>✕</button><button type="button" className={controls.btnPrimary} disabled={!pf} onClick={save} data-ps-plat-save>{pcT('save')}</button></>}>
      {!platforms.length ? <p className={controls.hint}>{pcT('noPlatforms')}</p> : (
        <div className={css.form}>
          {fld(pcT('pkind'), <select className={controls.select} value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })}>{platforms.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</select>)}
          {num('gross', pcT('gross', { cur }))}
          {num('fee', pcT('fee', { cur }))}
          {num('conv', pcT('conv', { cur }))}
          {num('inr', pcT('inr'))}
          {fld(pcT('date'), <input type="date" className={controls.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />)}
          {fld(pcT('ref'), <input className={controls.input} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} />)}
        </div>
      )}
      {preview && <p data-ps-plat-plan>{preview}</p>}
      {err && <p className={controls.error} role="alert">{err}</p>}
      <p className={controls.hint}>{pcT('rule342')}</p>
    </Modal>
  );
}
