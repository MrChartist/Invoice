import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { GstinInput } from '../ui/GstinInput';
import { INDIAN_STATES, resolveStateCode, stateByCode } from '../../lib/india-states';
import { checkGstin } from '../../lib/gstin';
import { localDb } from '../../lib/localDb';
import { isValidPan, isValidTan } from '../../lib/validators';
import type { Client } from '../../types/invoice';
import controls from '../../styles/controls.module.css';

const BLANK: Client = {
  name: '',
  company: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  state_code: '',
  zip: '',
  gstin: '',
  notes: '',
};

export interface ClientFormModalProps {
  open: boolean;
  /** The client being edited, or null to add a new one. */
  client: Client | null;
  onClose: () => void;
  onSaved: (client: Client, isNew: boolean) => void;
}

export function ClientFormModal({ open, client, onClose, onSaved }: ClientFormModalProps) {
  const [form, setForm] = useState<Client>(BLANK);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setForm({ ...BLANK, ...(client ?? {}) });
      setError('');
    }
  }, [open, client]);

  const set = <K extends keyof Client>(key: K, value: Client[K]) => setForm((f) => ({ ...f, [key]: value }));

  // Characters 3–12 of a GSTIN are the holder's PAN.
  const gstinPan = (form.gstin ?? '').trim().toUpperCase().slice(2, 12);
  const panFromGstin = checkGstin(form.gstin ?? '').valid && isValidPan(gstinPan) ? gstinPan : '';

  const setStateCode = (code: string) =>
    setForm((f) => ({ ...f, state_code: code, state: stateByCode(code)?.name ?? f.state }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Client name is required.');
    if (form.gstin && !checkGstin(form.gstin).valid) return setError('Fix the GSTIN or clear it before saving.');
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError('That email address does not look right.');
    const pan = (form.pan ?? '').trim().toUpperCase();
    const tan = (form.tan ?? '').trim().toUpperCase();
    if (pan && !isValidPan(pan)) return setError('PAN should look like AAAAA9999A (five letters, four digits, one letter).');
    if (tan && !isValidTan(tan)) return setError('TAN should look like AAAA99999A (four letters, five digits, one letter).');
    try {
      const state_code = resolveStateCode({ code: form.state_code, gstin: form.gstin, name: form.state });
      const payload: Client = {
        ...form,
        name: form.name.trim(),
        email: form.email.trim(),
        state_code,
        state: stateByCode(state_code)?.name ?? form.state,
        // Optional: keep the keys (as undefined) so clearing a value overwrites the stored one.
        pan: pan || undefined,
        tan: tan || undefined,
        updated_at: new Date().toISOString(),
      };
      const id = localDb.clients.upsert({ ...payload, id: client?.id });
      onSaved({ ...payload, id }, !client);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={client ? 'Edit client' : 'Add client'}
      subtitle="Saved only on this device."
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="client-form" className={controls.btnPrimary}>
            {client ? 'Save changes' : 'Add client'}
          </button>
        </>
      }
    >
      <form id="client-form" onSubmit={submit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
        {error && (
          <p className={controls.error} role="alert" ref={(el) => el?.scrollIntoView?.({ block: 'nearest' })}>
            {error}
          </p>
        )}
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>Client name *</span>
            <input className={controls.input} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Aarav Mehta" aria-invalid={error.startsWith('Client name') || undefined} autoFocus />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Company</span>
            <input className={controls.input} value={form.company ?? ''} onChange={(e) => set('company', e.target.value)} placeholder="Mehta Traders Pvt. Ltd." />
          </label>
        </div>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>Email</span>
            <input className={controls.input} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="accounts@company.com" />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Phone</span>
            <input className={controls.input} type="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98765 43210" />
          </label>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>Billing address</span>
          <textarea className={controls.textarea} rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street, area" />
        </label>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>City</span>
            <input className={controls.input} value={form.city} onChange={(e) => set('city', e.target.value)} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>State</span>
            <select className={controls.select} value={form.state_code ?? ''} onChange={(e) => setStateCode(e.target.value)}>
              <option value="">Select state</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>PIN code</span>
            <input className={controls.input} inputMode="numeric" maxLength={6} value={form.zip} onChange={(e) => set('zip', e.target.value.replace(/\D/g, ''))} />
          </label>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="client-gstin">
            GSTIN (optional)
          </label>
          <GstinInput id="client-gstin" value={form.gstin ?? ''} onChange={(v) => set('gstin', v)} onStateCode={setStateCode} />
          <span className={controls.hint}>The state is picked from the GSTIN and decides CGST + SGST vs IGST on invoices.</span>
        </div>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>PAN (optional)</span>
            <input className={`${controls.input} ${controls.inputMono}`} value={form.pan ?? ''} maxLength={10} autoCapitalize="characters" spellCheck={false}
              onChange={(e) => set('pan', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="AAAAA9999A"
              aria-invalid={(!!form.pan && !isValidPan(form.pan)) || undefined} />
            {!form.pan && panFromGstin ? (
              <button type="button" className={controls.btnGhost} style={{ alignSelf: 'flex-start' }} onClick={() => set('pan', panFromGstin)}>
                Use {panFromGstin} from the GSTIN
              </button>
            ) : (
              <span className={controls.hint}>Printed on Form 16A / 26AS against TDS they deduct.</span>
            )}
          </label>
          <label className={controls.field}>
            <span className={controls.label}>TAN (optional)</span>
            <input className={`${controls.input} ${controls.inputMono}`} value={form.tan ?? ''} maxLength={10} autoCapitalize="characters" spellCheck={false}
              onChange={(e) => set('tan', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="AAAA99999A"
              aria-invalid={(!!form.tan && !isValidTan(form.tan)) || undefined} />
            <span className={controls.hint}>Their TDS account number — matches your 26AS / AIS to this client.</span>
          </label>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>Private notes</span>
          <textarea className={controls.textarea} rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Never printed on documents" />
        </label>
      </form>
    </Modal>
  );
}
