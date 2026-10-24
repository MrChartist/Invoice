import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { GstinInput } from '../ui/GstinInput';
import { ImageSlot } from '../settings/ProfileEditor';
import { TEMPLATES } from '../templates/registry';
import { INDIAN_STATES } from '../../lib/india-states';
import { localDb } from '../../lib/localDb';
import { WIZARD_STEPS, answersFrom, applyAnswers, stepProblem, type WizardAnswers } from '../../lib/onboarding';
import controls from '../../styles/controls.module.css';
import styles from './SetupWizard.module.css';

const TITLES = {
  business: 'Your business',
  gst: 'GST registration',
  payment: 'How clients pay you',
  look: 'Logo & invoice design',
} as const;

/** Suggested starting designs (the full gallery stays in the editor and Design Studio). */
const PICKS = ['classic_orange', 'corporate_navy', 'minimal_clean', 'modern_teal', 'freelancer_light', 'tech_startup'];

export interface SetupWizardProps {
  open: boolean;
  /** `finished` = saved; false = skipped. */
  onClose: (finished: boolean) => void;
}

/** First-run setup: four short steps that fill the active sender profile. */
export function SetupWizard({ open, onClose }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [a, setA] = useState<WizardAnswers>(() => answersFrom(localDb.settings.activeProfile(), localDb.template.get()));
  const [error, setError] = useState('');
  const current = WIZARD_STEPS[step];
  const last = step === WIZARD_STEPS.length - 1;
  const set = (patch: Partial<WizardAnswers>) => {
    setA((prev) => ({ ...prev, ...patch }));
    setError('');
  };

  const next = () => {
    const problem = stepProblem(current, a);
    if (problem) return setError(problem);
    if (!last) return setStep((s) => s + 1);
    try {
      localDb.settings.save(applyAnswers(localDb.settings.get(), a));
      localDb.template.set(a.templateId);
      onClose(true);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const skip = () => {
    try {
      localDb.settings.save({ ...localDb.settings.get(), onboarded: true });
    } catch {
      /* the wizard simply shows again next time */
    }
    onClose(false);
  };

  return (
    <Modal
      open={open}
      onClose={skip}
      size="md"
      title={TITLES[current]}
      subtitle={`Step ${step + 1} of ${WIZARD_STEPS.length} · everything stays on this device`}
      footer={
        <div className={styles.footer}>
          <button type="button" className={controls.btnGhost} onClick={skip}>
            Skip for now
          </button>
          <span className={styles.spacer} />
          {step > 0 && (
            <button type="button" className={controls.btnOutline} onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft size={16} /> Back
            </button>
          )}
          <button type="button" className={controls.btnPrimary} onClick={next}>
            {last ? <><Check size={16} /> Finish</> : <>Next <ArrowRight size={16} /></>}
          </button>
        </div>
      }
    >
      <div className={styles.steps} aria-hidden="true">
        {WIZARD_STEPS.map((s, i) => (
          <span key={s} className={i <= step ? `${styles.dot} ${styles.dotDone}` : styles.dot} />
        ))}
      </div>

      <form
        className={styles.body}
        onSubmit={(e) => {
          e.preventDefault();
          next();
        }}
      >
        {current === 'business' && (
          <>
            <label className={controls.field}>
              <span className={controls.label}>Name on invoices *</span>
              <input className={controls.input} autoFocus value={a.companyName} onChange={(e) => set({ companyName: e.target.value })} placeholder="Your name or business" />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>Address</span>
              <textarea className={controls.textarea} rows={2} value={a.companyAddress} onChange={(e) => set({ companyAddress: e.target.value })} placeholder={'Street, area\nCity, State'} />
            </label>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>City</span>
                <input className={controls.input} value={a.city} onChange={(e) => set({ city: e.target.value })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>PIN code</span>
                <input className={controls.input} inputMode="numeric" maxLength={6} value={a.pin} onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '') })} />
              </label>
            </div>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>Phone</span>
                <input className={controls.input} type="tel" value={a.companyPhone} onChange={(e) => set({ companyPhone: e.target.value })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>Email</span>
                <input className={controls.input} type="email" value={a.companyEmail} onChange={(e) => set({ companyEmail: e.target.value })} />
              </label>
            </div>
          </>
        )}

        {current === 'gst' && (
          <>
            <div className={styles.choice} role="radiogroup" aria-label="GST registration">
              <button type="button" role="radio" aria-checked={a.gstRegistered} className={a.gstRegistered ? controls.btnPrimary : controls.btnOutline} onClick={() => set({ gstRegistered: true })}>
                I have a GSTIN
              </button>
              <button type="button" role="radio" aria-checked={!a.gstRegistered} className={!a.gstRegistered ? controls.btnPrimary : controls.btnOutline} onClick={() => set({ gstRegistered: false })}>
                Not registered for GST
              </button>
            </div>
            {a.gstRegistered ? (
              <div className={controls.field}>
                <label className={controls.label} htmlFor="wizard-gstin">GSTIN</label>
                <GstinInput id="wizard-gstin" value={a.companyGstin} onChange={(v) => set({ companyGstin: v })} onStateCode={(code) => set({ stateCode: code })} />
                <span className={controls.hint}>Your state is read from the first two digits.</span>
              </div>
            ) : (
              <label className={controls.field}>
                <span className={controls.label}>State of business *</span>
                <select className={controls.select} value={a.stateCode} onChange={(e) => set({ stateCode: e.target.value })}>
                  <option value="">Choose…</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s.code} value={s.code}>{s.name}</option>
                  ))}
                </select>
                <span className={controls.hint}>Invoices are issued without GST until you add a GSTIN in Settings.</span>
              </label>
            )}
          </>
        )}

        {current === 'payment' && (
          <>
            <label className={controls.field}>
              <span className={controls.label}>UPI ID</span>
              <input className={controls.input} value={a.upiId} onChange={(e) => set({ upiId: e.target.value.trim() })} placeholder="name@okhdfcbank" />
              <span className={controls.hint}>Adds a scan-to-pay QR on every INR invoice.</span>
            </label>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>Bank name</span>
                <input className={controls.input} value={a.bankName} onChange={(e) => set({ bankName: e.target.value })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>Account holder</span>
                <input className={controls.input} value={a.accountName} onChange={(e) => set({ accountName: e.target.value })} placeholder={a.companyName} />
              </label>
            </div>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>Account number</span>
                <input className={controls.input} inputMode="numeric" value={a.accountNumber} onChange={(e) => set({ accountNumber: e.target.value })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>IFSC</span>
                <input className={controls.input} value={a.ifsc} onChange={(e) => set({ ifsc: e.target.value.toUpperCase() })} placeholder="HDFC0001234" />
              </label>
            </div>
            <p className={controls.hint}>All optional — add them later in Settings if you prefer.</p>
          </>
        )}

        {current === 'look' && (
          <>
            <ImageSlot
              label="Logo"
              hint="PNG or JPG. Kept small so every invoice stays light."
              value={a.logo}
              maxDimension={480}
              onPick={(logo) => set({ logo })}
              onClear={() => set({ logo: '' })}
              onError={setError}
            />
            <div className={controls.field}>
              <span className={controls.label}>Invoice design</span>
              <div className={styles.templates}>
                {TEMPLATES.filter((t) => PICKS.includes(t.id)).map((t) => (
                  <button key={t.id} type="button" className={styles.template} aria-pressed={a.templateId === t.id} onClick={() => set({ templateId: t.id })}>
                    {/* The swatch shows the template's own accent, which is data, not a theme colour. */}
                    <span className={styles.swatch} style={{ background: t.accent }} aria-hidden="true" />
                    {t.name}
                  </button>
                ))}
              </div>
              <span className={controls.hint}>{TEMPLATES.length} designs are available in the editor and Design Studio.</span>
            </div>
          </>
        )}

        {error && (
          <p className={controls.error} role="alert">
            {error}
          </p>
        )}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
