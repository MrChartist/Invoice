import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { CustomFieldInputs } from '../custom-fields/CustomFieldInputs';
import { cleanValueMap, customFieldsDb } from '../../lib/custom-fields';
import { GstinInput } from '../ui/GstinInput';
import { ContactPickButton } from './ContactPickButton';
import { INDIAN_STATES, resolveStateCode, stateByCode } from '../../lib/india-states';
import { checkGstin } from '../../lib/gstin';
import { localDb } from '../../lib/localDb';
import { isValidPan, isValidTan } from '../../lib/validators';
import { MAX_FLAT_FEE, sanitizeClientLateFee, type ClientLateFeeMode } from '../../lib/late-fee-rule';
import { priceLevelsDb } from '../../lib/pricing';
import type { Client } from '../../types/invoice';
import { useT } from '../../i18n';
import { salesT } from '../../i18n/areas/sales';
import { reachT } from '../../i18n/areas/reach';
import { MESSAGE_LANGS, isMessageLang } from '../../lib/message-langs';
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
  useT(); // re-render on a language switch (5.4)
  const [form, setForm] = useState<Client>(BLANK);
  const [error, setError] = useState('');
  // Late-fee terms are edited as text so a half-typed number is not coerced on every keystroke.
  const [fee, setFee] = useState<{ mode: '' | ClientLateFeeMode; rate: string; grace: string }>({ mode: '', rate: '', grace: '' });
  const [credit, setCredit] = useState<{ limit: string; days: string }>({ limit: '', days: '' });
  // Price levels (6.9): the picker appears only once a level exists.
  const [levels] = useState(() => priceLevelsDb.all());

  useEffect(() => {
    if (open) {
      setForm({ ...BLANK, ...(client ?? {}) });
      setError('');
      const f = client?.late_fee;
      setFee(f ? { mode: f.mode, rate: String(f.rate), grace: String(f.graceDays) } : { mode: '', rate: '', grace: '' });
      setCredit({ limit: client?.credit_limit ? String(client.credit_limit) : '', days: client?.credit_days ? String(client.credit_days) : '' });
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
    if (!form.name.trim()) return setError(salesT('cf.errName'));
    if (form.gstin && !checkGstin(form.gstin).valid) return setError(salesT('cf.errGstin'));
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email.trim())) return setError(salesT('cf.errEmail'));
    const pan = (form.pan ?? '').trim().toUpperCase();
    const tan = (form.tan ?? '').trim().toUpperCase();
    if (pan && !isValidPan(pan)) return setError(salesT('cf.errPan'));
    if (tan && !isValidTan(tan)) return setError(salesT('cf.errTan'));
    const late_fee = fee.mode ? sanitizeClientLateFee({ mode: fee.mode, rate: fee.rate, graceDays: fee.grace }) : undefined;
    if (fee.mode && !late_fee) return setError(salesT('cf.errFee'));
    const creditLimit = credit.limit.trim() ? Number(credit.limit) : 0;
    const creditDays = credit.days.trim() ? Number(credit.days) : 0;
    if (!Number.isFinite(creditLimit) || creditLimit < 0) return setError(salesT('cf.errLimit'));
    if (!Number.isInteger(creditDays) || creditDays < 0 || creditDays > 365) return setError(salesT('cf.errDays'));
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
        late_fee,
        custom_fields: cleanValueMap(form.custom_fields, customFieldsDb.all()),
        credit_limit: creditLimit > 0 ? Math.round(creditLimit * 100) / 100 : undefined,
        credit_days: creditDays > 0 ? creditDays : undefined,
        price_level: form.price_level && levels.some((l) => l.id === form.price_level) ? form.price_level : undefined,
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
      title={client ? salesT('cf.editTitle') : salesT('cf.addTitle')}
      subtitle={salesT('cf.subtitle')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            {salesT('cancel')}
          </button>
          <button type="submit" form="client-form" className={controls.btnPrimary}>
            {client ? salesT('cf.saveChanges') : salesT('cf.addTitle')}
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
        {!client && (
          // 8.24: Android Chrome — fill name / phone / e-mail / address from the phone's contacts (blank fields only).
          <ContactPickButton
            onPick={(c) => setForm((f) => ({
              ...f,
              name: f.name || c.name,
              phone: f.phone || c.phone,
              email: f.email || c.email,
              address: f.address || c.address,
              city: f.city || c.city || '',
              zip: f.zip || c.zip || '',
            }))}
          />
        )}
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{salesT('cf.name')}</span>
            <input className={controls.input} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Aarav Mehta" aria-invalid={error === salesT('cf.errName') || undefined} autoFocus />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{salesT('cf.company')}</span>
            <input className={controls.input} value={form.company ?? ''} onChange={(e) => set('company', e.target.value)} placeholder="Mehta Traders Pvt. Ltd." />
          </label>
        </div>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{salesT('cf.email')}</span>
            <input className={controls.input} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="accounts@company.com" />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{salesT('cf.phone')}</span>
            <input className={controls.input} type="tel" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98765 43210" />
          </label>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>{salesT('cf.address')}</span>
          <textarea className={controls.textarea} rows={2} value={form.address} onChange={(e) => set('address', e.target.value)} placeholder={salesT('cf.addressPh')} />
        </label>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>{salesT('cf.city')}</span>
            <input className={controls.input} value={form.city} onChange={(e) => set('city', e.target.value)} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{salesT('cf.state')}</span>
            <select className={controls.select} value={form.state_code ?? ''} onChange={(e) => setStateCode(e.target.value)}>
              <option value="">{salesT('cf.selectState')}</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{salesT('cf.pin')}</span>
            <input className={controls.input} inputMode="numeric" maxLength={6} value={form.zip} onChange={(e) => set('zip', e.target.value.replace(/\D/g, ''))} />
          </label>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="client-gstin">
            {salesT('cf.gstin')}
          </label>
          <GstinInput id="client-gstin" value={form.gstin ?? ''} onChange={(v) => set('gstin', v)} onStateCode={setStateCode} />
          <span className={controls.hint}>{salesT('cf.gstinHint')}</span>
        </div>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{salesT('cf.pan')}</span>
            <input className={`${controls.input} ${controls.inputMono}`} value={form.pan ?? ''} maxLength={10} autoCapitalize="characters" spellCheck={false}
              onChange={(e) => set('pan', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="AAAAA9999A"
              aria-invalid={(!!form.pan && !isValidPan(form.pan)) || undefined} />
            {!form.pan && panFromGstin ? (
              <button type="button" className={controls.btnGhost} style={{ alignSelf: 'flex-start' }} onClick={() => set('pan', panFromGstin)}>
                {salesT('cf.usePan', { pan: panFromGstin })}
              </button>
            ) : (
              <span className={controls.hint}>{salesT('cf.panHint')}</span>
            )}
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{salesT('cf.tan')}</span>
            <input className={`${controls.input} ${controls.inputMono}`} value={form.tan ?? ''} maxLength={10} autoCapitalize="characters" spellCheck={false}
              onChange={(e) => set('tan', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} placeholder="AAAA99999A"
              aria-invalid={(!!form.tan && !isValidTan(form.tan)) || undefined} />
            <span className={controls.hint}>{salesT('cf.tanHint')}</span>
          </label>
        </div>
        <fieldset className={controls.field} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className={controls.label}>{salesT('cf.lateTerms')}</legend>
          <div className={controls.row3}>
            <label className={controls.field}>
              <span className={controls.label}>{salesT('cf.lateFee')}</span>
              <select className={controls.select} value={fee.mode} onChange={(e) => setFee((f) => ({ ...f, mode: e.target.value as '' | ClientLateFeeMode }))}>
                <option value="">{salesT('cf.noLateFee')}</option>
                <option value="percent_pa">{salesT('cf.interestPa')}</option>
                <option value="flat">{salesT('cf.flatFee')}</option>
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{fee.mode === 'flat' ? salesT('cf.feeRs') : salesT('cf.ratePa')}</span>
              <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" disabled={!fee.mode} value={fee.rate}
                max={fee.mode === 'flat' ? MAX_FLAT_FEE : 100}
                onChange={(e) => setFee((f) => ({ ...f, rate: e.target.value.replace(/[^0-9.]/g, '') }))} placeholder={fee.mode === 'flat' ? '500' : '18'} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{salesT('cf.graceDays')}</span>
              <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="numeric" disabled={!fee.mode} value={fee.grace}
                onChange={(e) => setFee((f) => ({ ...f, grace: e.target.value.replace(/\D/g, '') }))} placeholder="0" />
            </label>
          </div>
          <span className={controls.hint}>{salesT('cf.lateHint')}</span>
        </fieldset>
        <CustomFieldInputs scope="party" idPrefix="client" value={form.custom_fields} onChange={(v) => set('custom_fields', v)} />
        <fieldset className={controls.field} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className={controls.label}>{salesT('cf.credit')}</legend>
          <div className={controls.row}>
            <label className={controls.field}>
              <span className={controls.label}>{salesT('cf.creditLimit')}</span>
              <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={credit.limit}
                onChange={(e) => setCredit((c) => ({ ...c, limit: e.target.value.replace(/[^0-9.]/g, '') }))} placeholder={salesT('cf.creditLimitPh')} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{salesT('cf.creditDays')}</span>
              <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="numeric" value={credit.days}
                onChange={(e) => setCredit((c) => ({ ...c, days: e.target.value.replace(/\D/g, '') }))} placeholder={salesT('cf.creditDaysPh')} />
            </label>
          </div>
          <span className={controls.hint}>{salesT('cf.creditHint')}</span>
        </fieldset>
        {levels.length > 0 && (
          <label className={controls.field}>
            <span className={controls.label}>{salesT('cf.priceLevel')}</span>
            <select className={controls.select} value={form.price_level ?? ''} onChange={(e) => set('price_level', e.target.value || undefined)}>
              <option value="">{salesT('cf.defaultRates')}</option>
              {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
            <span className={controls.hint}>{salesT('cf.priceHint')}</span>
          </label>
        )}
        <label className={controls.field}>
          <span className={controls.label}>{reachT('msgLang')}</span>
          <select className={controls.select} value={form.message_lang ?? ''} onChange={(e) => set('message_lang', isMessageLang(e.target.value) ? e.target.value : undefined)}>
            <option value="">{reachT('msgLangDefault')}</option>
            {MESSAGE_LANGS.map((l) => <option key={l.code} value={l.code} lang={l.code === 'hinglish' ? 'en' : l.code}>{l.label}</option>)}
          </select>
          <span className={controls.hint}>{reachT('msgLangHint')}</span>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{salesT('cf.notes')}</span>
          <textarea className={controls.textarea} rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder={salesT('cf.notesPh')} />
        </label>
      </form>
    </Modal>
  );
}
