import { lazy, Suspense, useRef, useState } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { GstinInput } from '../ui/GstinInput';
import { INDIAN_STATES } from '../../lib/india-states';
import { imageToDataUrl } from '../../lib/image';
import { panFromGstin } from '../../lib/gstin';
import { isValidIfsc, isValidPan, isValidUpi } from '../../lib/validators';
import { COMPOSITION_CATEGORY_LABELS, COMPOSITION_DECLARATION } from '../../lib/bill-of-supply';
import { compositionRate, todayIso } from '../../lib/tax-rules';
import type { CompositionCategory, GstScheme, SenderProfile } from '../../types/invoice';
import { useT } from '../../i18n';
import { setT } from '../../i18n/areas/settings';
import { x7T } from '../../i18n/areas/extras-7u';
import controls from '../../styles/controls.module.css';
import { isPackOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import styles from './Settings.module.css';

// R4-C1: IEC / AD code and the LUT register — their own lazy chunk.
const ExportSettingsPanel = lazy(() => import('../trade/ExportSettingsPanel'));
// R5-C3: non-profit registrations (PAN, 12AB, 80G URN, 35(1), FCRA) — only with the non-profit pack on.
const NpoRegistrationsPanel = lazy(() => import('../institutions/r5c-lazy').then((l) => l.r5c()).then((m) => ({ default: m.NpoRegistrationsPanel })));
// R10 (SV-B1): clinic registrations — only with the clinic pack on.
const ClinicRegsPanel = lazy(() => import('../services-r10/ClinicRegsPanel'));

interface Props {
  profile: SenderProfile;
  onChange: (patch: Partial<SenderProfile>) => void;
  onError: (message: string) => void;
}

export function ImageSlot({
  label,
  hint,
  value,
  maxDimension,
  onPick,
  onClear,
  onError,
}: {
  label: string;
  hint: string;
  value?: string;
  maxDimension: number;
  onPick: (dataUrl: string) => void;
  onClear: () => void;
  onError: (message: string) => void;
}) {
  useT(); // re-render on a language switch (5.4)
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      onPick(await imageToDataUrl(file, maxDimension));
    } catch (err) {
      onError(err instanceof DOMException || !(err instanceof Error) ? setT('imageReadFail') : err.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className={styles.slot}>
      <div className={styles.slotPreview}>
        {value ? <img src={value} alt={setT('preview', { label })} /> : <ImagePlus size={22} />}
      </div>
      <div className={styles.slotBody}>
        <div className={controls.label} id={`slot-${label}`}>{label}</div>
        <p className={controls.hint}>{hint}</p>
        <div className={styles.slotActions}>
          <button type="button" className={controls.btnOutline + ' ' + controls.btnSm} onClick={() => input.current?.click()} disabled={busy}>
            <Upload size={14} /> {value ? setT('replace') : setT('upload')}
          </button>
          {value && (
            <button type="button" className={controls.btnGhost + ' ' + controls.btnSm} onClick={onClear}>
              <Trash2 size={14} /> {setT('remove')}
            </button>
          )}
        </div>
        <input ref={input} type="file" aria-label={setT('uploadImage', { label: label.toLowerCase() })} accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => pick(e.target.files?.[0])} />
      </div>
    </div>
  );
}

export function ProfileEditor({ profile, onChange, onError }: Props) {
  useT(); // re-render on a language switch (5.4)
  const gstinPan = panFromGstin(profile.companyGstin);
  const upiBad = !!profile.upiId && !isValidUpi(profile.upiId);
  const ifscBad = !!profile.ifsc && !isValidIfsc(profile.ifsc);
  const panBad = !!profile.pan && !isValidPan(profile.pan);

  return (
    <div className={styles.editor}>
      <fieldset className={styles.group}>
        <legend>{setT('identity')}</legend>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{setT('nameOnInvoices')}</span>
            <input className={controls.input} value={profile.companyName} onChange={(e) => onChange({ companyName: e.target.value })} placeholder="Rohit Singh" />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{setT('tagline')}</span>
            <input className={controls.input} value={profile.companyTagline} onChange={(e) => onChange({ companyTagline: e.target.value })} placeholder="Research Analyst" />
          </label>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>{setT('regLine')}</span>
          <input className={controls.input} value={profile.regLine ?? ''} onChange={(e) => onChange({ regLine: e.target.value })} placeholder="SEBI Reg. No. INH000015297" />
          <span className={controls.hint}>{setT('regLineHint')}</span>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{x7T('drugLicence')}</span>
          <input className={controls.input} value={profile.drug_licence ?? ''} onChange={(e) => onChange({ drug_licence: e.target.value || undefined })} placeholder="20B: KA-B12-123456, 21B: KA-B12-123457" />
          <span className={controls.hint}>{x7T('drugLicenceHint')}</span>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{setT('address')}</span>
          <textarea className={controls.textarea} rows={3} value={profile.companyAddress} onChange={(e) => onChange({ companyAddress: e.target.value })} placeholder={setT('addressPh')} />
        </label>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{setT('city')}</span>
            <input className={controls.input} value={profile.city ?? ''} onChange={(e) => onChange({ city: e.target.value })} placeholder="Thane" />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{setT('pin')}</span>
            <input className={controls.input} inputMode="numeric" maxLength={6} value={profile.pin ?? ''} onChange={(e) => onChange({ pin: e.target.value.replace(/\D/g, '') })} placeholder="400601" />
            <span className={controls.hint}>{setT('pinHint')}</span>
          </label>
        </div>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>{setT('phone')}</span>
            <input className={controls.input} type="tel" value={profile.companyPhone} onChange={(e) => onChange({ companyPhone: e.target.value })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{setT('email')}</span>
            <input className={controls.input} type="email" value={profile.companyEmail} onChange={(e) => onChange({ companyEmail: e.target.value })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{setT('website')}</span>
            <input className={controls.input} value={profile.companyWebsite} onChange={(e) => onChange({ companyWebsite: e.target.value })} placeholder="mrchartist.com" />
          </label>
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>{setT('taxReg')}</legend>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="p-gstin">GSTIN</label>
            <GstinInput
              id="p-gstin"
              value={profile.companyGstin}
              onChange={(v) => onChange({ companyGstin: v })}
              onStateCode={(code) => onChange({ stateCode: code, pan: profile.pan || panFromGstin(profile.companyGstin) })}
            />
          </div>
          <label className={controls.field}>
            <span className={controls.label}>PAN</span>
            <input
              className={`${controls.input} ${controls.inputMono} ${panBad ? controls.inputInvalid : ''}`}
              value={profile.pan ?? ''}
              maxLength={10}
              placeholder={gstinPan || 'ABCDE1234F'}
              onChange={(e) => onChange({ pan: e.target.value.toUpperCase() })}
            />
            {panBad && <span className={controls.error}>{setT('panBad')}</span>}
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{setT('stateOfBusiness')}</span>
            <select className={controls.select} value={profile.stateCode ?? ''} onChange={(e) => onChange({ stateCode: e.target.value })}>
              <option value="">{setT('selectState')}</option>
              {INDIAN_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className={controls.hint}>{setT('gstinHint')}</p>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{setT('gstScheme')}</span>
            <select
              className={controls.select}
              value={profile.gst_scheme ?? 'regular'}
              onChange={(e) => {
                const gst_scheme = e.target.value as GstScheme;
                onChange(gst_scheme === 'composition' ? { gst_scheme, composition_category: profile.composition_category ?? 'trader' } : { gst_scheme });
              }}
            >
              <option value="regular">{setT('schemeRegular')}</option>
              <option value="composition">{setT('schemeComposition')}</option>
            </select>
          </label>
          {profile.gst_scheme === 'composition' && (
            <label className={controls.field}>
              <span className={controls.label}>{setT('compositionCategory')}</span>
              <select className={controls.select} value={profile.composition_category ?? 'trader'} onChange={(e) => onChange({ composition_category: e.target.value as CompositionCategory })}>
                {(Object.keys(COMPOSITION_CATEGORY_LABELS) as CompositionCategory[]).map((k) => (
                  <option key={k} value={k}>{COMPOSITION_CATEGORY_LABELS[k]}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {profile.gst_scheme === 'composition' && (
          <p className={controls.hint}>
            {setT('compositionRate', { rate: compositionRate(profile.composition_category ?? 'trader', todayIso()) ?? '—' })}{' '}
            {setT('compositionDocs', { declaration: COMPOSITION_DECLARATION })}
          </p>
        )}
      </fieldset>

      <Suspense fallback={null}>
        <ExportSettingsPanel profile={profile} onChange={onChange} />
      </Suspense>
      {isPackOn(localDb.settings.get(), 'nonprofit') && <Suspense fallback={null}><NpoRegistrationsPanel profile={profile} onChange={onChange} /></Suspense>}
      {isPackOn(localDb.settings.get(), 'clinic') && <Suspense fallback={null}><ClinicRegsPanel profile={profile} onChange={onChange} /></Suspense>}

      <fieldset className={styles.group}>
        <legend>{setT('paymentDetails')}</legend>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{setT('accountHolder')}</span>
            <input className={controls.input} value={profile.accountName} onChange={(e) => onChange({ accountName: e.target.value })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{setT('bankBranch')}</span>
            <input className={controls.input} value={profile.bankName} onChange={(e) => onChange({ bankName: e.target.value })} placeholder="HDFC Bank, Thane" />
          </label>
        </div>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{setT('accountNumber')}</span>
            <input className={`${controls.input} ${controls.inputMono}`} inputMode="numeric" value={profile.accountNumber} onChange={(e) => onChange({ accountNumber: e.target.value.replace(/\s/g, '') })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>IFSC</span>
            <input className={`${controls.input} ${controls.inputMono} ${ifscBad ? controls.inputInvalid : ''}`} maxLength={11} value={profile.ifsc} onChange={(e) => onChange({ ifsc: e.target.value.toUpperCase() })} placeholder="HDFC0000123" />
            {ifscBad && <span className={controls.error}>{setT('ifscBad')}</span>}
          </label>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>{setT('upiId')}</span>
          <input className={`${controls.input} ${upiBad ? controls.inputInvalid : ''}`} value={profile.upiId} onChange={(e) => onChange({ upiId: e.target.value.trim() })} placeholder="name@bank" autoCapitalize="none" />
          {upiBad ? <span className={controls.error}>{setT('upiBad')}</span> : <span className={controls.hint}>{setT('upiHint')}</span>}
        </label>
      </fieldset>

      <fieldset className={styles.group}>
        <legend>{setT('branding')}</legend>
        <div className={styles.slots}>
          <ImageSlot label={setT('logo')} hint={setT('logoHint')} value={profile.logo} maxDimension={480} onPick={(logo) => onChange({ logo })} onClear={() => onChange({ logo: '' })} onError={onError} />
          <ImageSlot label={setT('signature')} hint={setT('signatureHint')} value={profile.signature} maxDimension={420} onPick={(signature) => onChange({ signature })} onClear={() => onChange({ signature: '' })} onError={onError} />
        </div>
        <div className={controls.row}>
          <label className={controls.field}>
            <span className={controls.label}>{setT('numberPrefix')}</span>
            <input className={`${controls.input} ${controls.inputMono}`} maxLength={8} value={profile.invoicePrefix ?? ''} onChange={(e) => onChange({ invoicePrefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder="INV" />
            <span className={controls.hint}>{setT('numbersLook', { example: `${profile.invoicePrefix || 'INV'}/FY25-26/0001` })}</span>
          </label>
        </div>
        <label className={controls.field}>
          <span className={controls.label}>{setT('profileTerms')}</span>
          <textarea className={controls.textarea} rows={3} value={profile.defaultTerms ?? ''} onChange={(e) => onChange({ defaultTerms: e.target.value })} placeholder={setT('profileTermsPh')} />
        </label>
      </fieldset>
    </div>
  );
}
