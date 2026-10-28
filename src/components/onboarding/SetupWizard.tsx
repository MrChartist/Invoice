import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { GstinInput } from '../ui/GstinInput';
import { ImageSlot } from '../settings/ProfileEditor';
import { TEMPLATES } from '../templates/registry';
import { INDIAN_STATES } from '../../lib/india-states';
import { localDb } from '../../lib/localDb';
import { WIZARD_STEPS, answersFrom, applyAnswers, stepProblem, wizardDraft, type WizardAnswers } from '../../lib/onboarding';
import { LANGUAGES, isLang, setLanguage, useT } from '../../i18n';
import { setupT } from '../../i18n/areas/setup';
import { reachT } from '../../i18n/areas/reach';
import { SHOP_MODE_EVENT, type BusinessType } from '../../lib/shop-mode';
import { BUSINESS_DEFAULTS, BUSINESS_TYPES, CONSTRUCTION_PROFILES, RETAIL_PROFILES, SERVICE_PROFILES, TRADE_PROFILES, applyBusinessDefaults, applyConstructionKind, applyRetailKind, applyServiceKind, applyTradeKind, isConstructionKind, isRetailKind, isServiceKind, isTradeKind, type ConstructionKindId, type RetailKindId, type ServiceKindId, type TradeKindId } from '../../lib/shop-presets';
import { ServiceKindPicker } from '../services-r10/ServiceKindPicker'; // R10 (SV-A1)
import { AgriKindPicker } from '../agri/AgriKindPicker'; // R12 (AG-A1)
import { agPickT } from '../../i18n/areas/agri-r12-pick';
import { AGRI_PROFILES, applyAgriKind, isAgriKind, type AgriKindId } from '../../lib/shop-presets';
import { MfgKindPicker, type UdyamValue } from '../mfg/MfgKindPicker'; // R13 (MF-A1)
import { mfPickT } from '../../i18n/areas/mfg-r13a-pick';
import { MFG_PROFILES, applyMfgKind, isMfgKind, type MfgKindId } from '../../lib/shop-presets';
import { PROF_PROFILES, applyProfKind, isProfKind, type ProfKindId } from '../../lib/shop-presets'; // R14 (PS-A1)
import { ProfKindPicker } from '../prof/ProfKindPicker';
import { TRAVEL_LANDING, applyTravelKind, isTravelKind, type TravelKindId } from '../../lib/shop-presets'; // R15-B1
import { TravelKindPicker } from '../travel/TravelKindPicker';
import type { ProfIds } from '../../lib/prof/ps-profile';
import { normalizeUdyam, validateUdyam } from '../../lib/msme';
import { activePacks } from '../../lib/industry-packs';
import { svPickT } from '../../i18n/areas/services-r10-pick';
import { ConstructionKindPicker } from '../construction/ConstructionKindPicker'; // R11 (CN-A1)
import { cnPickT } from '../../i18n/areas/construction-r11-pick';
import { TradeKindPicker } from '../trade/TradeKindPicker'; // R8-C (TR-C5)
import { RetailKindPicker } from '../retail-r9/RetailKindPicker';
import { pickT } from '../../i18n/areas/retail-r9-pick'; // R9 (RT-A1)
import { trT } from '../../i18n/areas/trade-r8c';
import { startDemoCompany, useDemoPending } from './demo-company';
import { companiesSupported } from '../../lib/companies';
import { discoverT } from '../../i18n/areas/discover-r6';
import controls from '../../styles/controls.module.css';
import styles from './SetupWizard.module.css';

/** Suggested starting designs (the full gallery stays in the editor and Design Studio). */
const PICKS = ['classic_orange', 'corporate_navy', 'minimal_clean', 'modern_teal', 'freelancer_light', 'tech_startup', 'retail_receipt', 'gst_tax_invoice'];

export interface SetupWizardProps {
  open: boolean;
  /** `finished` = saved (true, or the route to open next, e.g. '/pos' for a kirana counter); false = skipped. */
  onClose: (finished: boolean | string) => void;
}

/** First-run setup: four short steps that fill the active sender profile. */
export function SetupWizard({ open, onClose }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [a, setA] = useState<WizardAnswers>(() => answersFrom(localDb.settings.activeProfile(), localDb.template.get()));
  const [error, setError] = useState('');
  // Shop mode (8H): what the business does; "full" keeps every module (the default).
  const [business, setBusiness] = useState<BusinessType>(() => localDb.settings.get().business_type ?? 'full');
  // R8-C (TR-C5): the trade under "Wholesale" (business type stays `wholesale`).
  const [tradeKind, setTradeKind] = useState<TradeKindId | ''>(() => (isTradeKind(localDb.settings.get().trade_kind) ? (localDb.settings.get().trade_kind as TradeKindId) : ''));
  // R9 (RT-A1): the shop under "Kirana / retail shop" (business type stays `kirana`).
  const [retailKind, setRetailKind] = useState<RetailKindId | ''>(() => (isRetailKind(localDb.settings.get().retail_kind) ? (localDb.settings.get().retail_kind as RetailKindId) : ''));
  const pickRetail = (k: RetailKindId | '') => {
    setRetailKind(k);
    if (k) setA((prev) => ({ ...prev, templateId: RETAIL_PROFILES[k].templateId }));
  };
  // R11 (CN-A1): the construction business under "Contractor" (business type stays `contractor`).
  const [cnKind, setCnKind] = useState<ConstructionKindId | ''>(() => (isConstructionKind(localDb.settings.get().construction_kind) ? (localDb.settings.get().construction_kind as ConstructionKindId) : ''));
  const [cnGov, setCnGov] = useState(false);
  const pickConstruction = (k: ConstructionKindId | '') => {
    setCnKind(k);
    if (k) setA((prev) => ({ ...prev, templateId: CONSTRUCTION_PROFILES[k].templateId }));
  };
  // R10 (SV-A1): the service business under "Services" (business type stays `services`).
  const [svKind, setSvKind] = useState<ServiceKindId | ''>(() => (isServiceKind(localDb.settings.get().service_kind) ? (localDb.settings.get().service_kind as ServiceKindId) : ''));
  const [svPharmacy, setSvPharmacy] = useState(false);
  const pickService = (k: ServiceKindId | '') => {
    setSvKind(k);
    if (k) setA((prev) => ({ ...prev, templateId: SERVICE_PROFILES[k].templateId }));
  };
  // R14 (PS-A1): the professional's kind under Services → Professional (business type stays `services`).
  const [pfKind, setPfKind] = useState<ProfKindId | ''>(() => (isProfKind(localDb.settings.get().prof_kind) ? (localDb.settings.get().prof_kind as ProfKindId) : ''));
  const [pfSub, setPfSub] = useState<string>(() => localDb.settings.get().prof_sub ?? '');
  const [pfForm, setPfForm] = useState('proprietorship');
  const [pfIds, setPfIds] = useState<ProfIds>({});
  const pickProf = (k: ProfKindId | '') => {
    setPfKind(k);
    const t = k ? PROF_PROFILES[k].templateId : undefined;
    if (t) setA((prev) => ({ ...prev, templateId: t }));
  };
  // R15-B1: the travel kind under Services → Travel, tours and events (business type stays `services`).
  const [tvKind, setTvKind] = useState<TravelKindId | ''>(() => (isTravelKind(localDb.settings.get().travel_kind) ? (localDb.settings.get().travel_kind as TravelKindId) : ''));
  const [tvBsp, setTvBsp] = useState(false);
  const [tvAlso, setTvAlso] = useState(false);
  // R12 (AG-A1): the "Farm, dairy & food processing" card is not a business type: its kind writes one (or none).
  const [agOn, setAgOn] = useState(() => isAgriKind(localDb.settings.get().agri_kind));
  const [agKind, setAgKind] = useState<AgriKindId | ''>(() => (isAgriKind(localDb.settings.get().agri_kind) ? (localDb.settings.get().agri_kind as AgriKindId) : ''));
  const [agMill, setAgMill] = useState<string>(() => localDb.settings.get().mill_kind ?? 'rice');
  const pickAgri = (k: AgriKindId | '') => {
    setAgKind(k);
    const p = k ? AGRI_PROFILES[k] : undefined;
    if (p?.type) setBusiness(p.type);
    if (p?.templateId) setA((prev) => ({ ...prev, templateId: p.templateId! }));
  };
  // R13 (MF-A1): the "Factory / manufacturing" card is not a business type: its kind writes `manufacturer` (or none).
  const [mfOn, setMfOn] = useState(() => isMfgKind(localDb.settings.get().mfg_kind));
  const [mfKind, setMfKind] = useState<MfgKindId | ''>(() => (isMfgKind(localDb.settings.get().mfg_kind) ? (localDb.settings.get().mfg_kind as MfgKindId) : ''));
  const [mfSub, setMfSub] = useState<string>(() => localDb.settings.get().mfg_sub ?? '');
  const [mfUdyam, setMfUdyam] = useState<UdyamValue>({ no: '', category: 'MICRO' });
  const pickMfg = (k: MfgKindId | '') => {
    setMfKind(k);
    const p = k ? MFG_PROFILES[k] : undefined;
    if (p?.type) setBusiness(p.type);
    if (p?.templateId) setA((prev) => ({ ...prev, templateId: p.templateId! }));
  };
  const { lang } = useT();
  const pickBusiness = (b: BusinessType) => {
    setAgOn(false); // R12
    setMfOn(false); // R13
    setBusiness(b);
    // The design follows the business type until the user picks one on the last step.
    set({ templateId: BUSINESS_DEFAULTS[b].templateId });
  };
  const [demoBusy, setDemoBusy] = useState(false);
  // "Explore with sample data instead": a separate Demo company (when this browser supports companies).
  const exploreDemo = () => {
    setDemoBusy(true);
    try {
      // QA-3 F20: keep what was typed for the user's own company (still not set up, so the wizard returns prefilled).
      // (R6-B4: sample data only ever goes to a separate Demo company; a browser without one gets none.)
      const draft = companiesSupported() ? wizardDraft(localDb.settings.get(), a) : null;
      if (draft) localDb.settings.save(draft);
      // F27: the company left behind is labelled with the typed business name, not "Main business".
      if (!startDemoCompany(a.companyName.trim() || undefined)) throw new Error(discoverT('sampleNoCompanies'));
    } catch (err) {
      setError((err as Error).message);
      setDemoBusy(false);
    }
  };
  const current = WIZARD_STEPS[step];
  useDemoPending(onClose);
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
      const mfg = mfOn && mfKind ? mfKind : null; // R13 (MF-A1): the manufacturing profile, like the agri card
      const agri = !mfg && agOn && agKind ? agKind : null; // R12 (AG-A1): the agri profile wins over the type's own picker
      if (mfg && mfUdyam.no.trim() && validateUdyam(mfUdyam.no)) return setError(validateUdyam(mfUdyam.no));
      const trade = !agri && !mfg && business === 'wholesale' && tradeKind ? tradeKind : null; // R8-C
      const retail = !agri && !mfg && business === 'kirana' && retailKind ? retailKind : null; // R9 (RT-A1)
      const cons = !agri && !mfg && business === 'contractor' && cnKind ? cnKind : null; // R11 (CN-A1)
      const svc = !agri && !mfg && business === 'services' && svKind ? svKind : null; // R10 (SV-A1)
      const prof = svc === 'professional' && pfKind ? pfKind : null; // R14 (PS-A1)
      const travel = svc === 'travel' && tvKind ? tvKind : null; // R15-B1
      const saved = {
        ...applyBusinessDefaults(applyAnswers(localDb.settings.get(), a), business),
        ...(trade ? { ...applyTradeKind(trade), defaultDueDays: TRADE_PROFILES[trade].defaultDueDays } : {}),
        ...(retail ? { ...applyRetailKind(retail, { registered: a.gstRegistered }), defaultDueDays: RETAIL_PROFILES[retail].defaultDueDays } : {}),
        ...(cons ? { ...applyConstructionKind(cons, { registered: a.gstRegistered }), defaultDueDays: CONSTRUCTION_PROFILES[cons].defaultDueDays } : {}),
        ...(svc ? { ...applyServiceKind(svc, { registered: a.gstRegistered, pharmacy: svPharmacy }), defaultDueDays: SERVICE_PROFILES[svc].defaultDueDays } : {}),
        ...(travel ? applyTravelKind(travel, { registered: a.gstRegistered, alsoTravel: tvAlso, currentPacks: activePacks(localDb.settings.get()) }) : {}),
        ...(prof ? { ...applyProfKind(prof, { registered: a.gstRegistered, sub: pfSub, firmForm: pfForm, currentPacks: activePacks(localDb.settings.get()) }), defaultDueDays: PROF_PROFILES[prof].defaultDueDays } : {}),
        ...(agri ? { ...applyAgriKind(agri, { registered: a.gstRegistered, mill_kind: agMill, currentPacks: activePacks(localDb.settings.get()) }), ...(AGRI_PROFILES[agri].defaultDueDays !== undefined ? { defaultDueDays: AGRI_PROFILES[agri].defaultDueDays } : {}) } : {}),
        ...(mfg ? { ...applyMfgKind(mfg, { registered: a.gstRegistered, sub: mfSub, currentPacks: activePacks(localDb.settings.get()) }), ...(MFG_PROFILES[mfg].defaultDueDays !== undefined ? { defaultDueDays: MFG_PROFILES[mfg].defaultDueDays } : {}) } : {}),
      };
      // R13 (MF-A1): the Udyam number and category go on the active sender profile (snapshotted on every document).
      const udyam = mfg && normalizeUdyam(mfUdyam.no);
      localDb.settings.save(udyam ? { ...saved, profiles: saved.profiles.map((p) => (p.id === saved.activeProfileId ? { ...p, msme_udyam: udyam, msme_category: mfUdyam.category as 'MICRO' } : p)) } : saved);
      if (mfg) void import('../../lib/mfg/mf-profile').then((m) => m.applyMfgSwitches(mfg, mfSub || undefined)).catch(() => undefined);
      if (agri) void import('../../lib/agri/ag-profile').then((m) => m.applyAgriSwitches(agri)).catch(() => undefined);
      if (svc) void import('../../lib/services/sv-profile').then((m) => m.applyServiceSwitches(svc)).catch(() => undefined);
      if (prof) void import('../../lib/prof/ps-profile').then((m) => { m.applyProfSwitches(prof, pfSub || undefined, pfIds); m.writeFirmForm(pfForm as 'proprietorship'); }).catch(() => undefined);
      if (travel) void import('../../lib/travel/tv-profile').then((m) => m.applyTravelSwitches(travel, tvBsp)).catch(() => undefined);
      if (cons) void import('../../lib/construction/cn-profile').then((m) => m.applyConstructionSwitches(cons, { government: cnGov })).catch(() => undefined);
      if (retail) void import('../../lib/retail/rt-profile').then((m) => m.applyRetailSwitches(retail)).catch(() => undefined);
      window.dispatchEvent(new Event(SHOP_MODE_EVENT));
      localDb.template.set(a.templateId);
      onClose(mfg ? MFG_PROFILES[mfg].landing : agri ? AGRI_PROFILES[agri].landing : trade ? TRADE_PROFILES[trade].landing : retail ? RETAIL_PROFILES[retail].landing : cons ? CONSTRUCTION_PROFILES[cons].landing : prof ? PROF_PROFILES[prof].landing : travel ? TRAVEL_LANDING[travel] : svc ? SERVICE_PROFILES[svc].landing : BUSINESS_DEFAULTS[business].landing);
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
      title={current === 'start' ? reachT('title.shop') : setupT(`title.${current}`)}
      subtitle={setupT('stepOf', { n: step + 1, total: WIZARD_STEPS.length })}
      footer={
        <div className={styles.footer}>
          <button type="button" className={controls.btnGhost} onClick={skip}>
            {setupT('skip')}
          </button>
          <span className={styles.spacer} />
          {step > 0 && (
            <button type="button" className={controls.btnOutline} onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft size={16} /> {setupT('back')}
            </button>
          )}
          <button type="button" className={controls.btnPrimary} onClick={next}>
            {last ? <><Check size={16} /> {setupT('finish')}</> : <>{setupT('next')} <ArrowRight size={16} /></>}
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
              <span className={controls.label}>{setupT('nameOnInvoices')}</span>
              <input className={controls.input} autoFocus value={a.companyName} onChange={(e) => set({ companyName: e.target.value })} placeholder={setupT('namePh')} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{setupT('address')}</span>
              <textarea className={controls.textarea} rows={2} value={a.companyAddress} onChange={(e) => set({ companyAddress: e.target.value })} placeholder={setupT('addressPh')} />
            </label>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{setupT('city')}</span>
                <input className={controls.input} value={a.city} onChange={(e) => set({ city: e.target.value })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{setupT('pin')}</span>
                <input className={controls.input} inputMode="numeric" maxLength={6} value={a.pin} onChange={(e) => set({ pin: e.target.value.replace(/\D/g, '') })} />
              </label>
            </div>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{setupT('phone')}</span>
                <input className={controls.input} type="tel" value={a.companyPhone} onChange={(e) => set({ companyPhone: e.target.value })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{setupT('email')}</span>
                <input className={controls.input} type="email" value={a.companyEmail} onChange={(e) => set({ companyEmail: e.target.value })} />
              </label>
            </div>
          </>
        )}

        {current === 'start' && (
          <>
            <label className={controls.field}>
              <span className={controls.label}>{lang === 'en' ? `${reachT('language')} / भाषा` : reachT('language')}</span>
              <select className={controls.select} value={lang} onChange={(e) => isLang(e.target.value) && void setLanguage(e.target.value).catch(() => undefined)}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.native}</option>)}
              </select>
            </label>
            <p className={controls.hint}>{reachT('shopLede')}</p>
            <div className={styles.shopGrid} role="radiogroup" aria-label={reachT('title.shop')}>
              {BUSINESS_TYPES.map((b) => (
                <button key={b} type="button" role="radio" aria-checked={business === b && !agOn && !mfOn} className={styles.shopCard} onClick={() => pickBusiness(b)}>
                  <strong>{reachT(`type.${b}`)}</strong>
                  <span>{reachT(`hint.${b}`)}</span>
                </button>
              ))}
              {/* R12 (AG-A1): not a business type — its kind writes one */}
              <button type="button" role="radio" aria-checked={agOn} className={styles.shopCard} onClick={() => { setAgOn(true); setMfOn(false); }} data-wizard-agri-card>
                <strong>{agPickT('card')}</strong>
                <span>{agPickT('cardHint')}</span>
              </button>
              {/* R13 (MF-A1): not a business type — its kind writes `manufacturer` */}
              <button type="button" role="radio" aria-checked={mfOn} className={styles.shopCard} onClick={() => { setMfOn(true); setAgOn(false); }} data-wizard-mfg-card>
                <strong>{mfPickT('card')}</strong>
                <span>{mfPickT('cardHint')}</span>
              </button>
            </div>
            {mfOn && (
              <div className={controls.field} data-wizard-mfg>
                <span className={controls.label}>{mfPickT('title')}</span>
                <span className={controls.hint}>{mfPickT('lede')}</span>
                <MfgKindPicker value={mfKind} onPick={pickMfg} sub={mfSub} onSub={setMfSub} udyam={mfUdyam} onUdyam={setMfUdyam} gridClass={styles.shopGrid} cardClass={styles.shopCard} />
              </div>
            )}
            {agOn && (
              <div className={controls.field} data-wizard-agri>
                <span className={controls.label}>{agPickT('title')}</span>
                <span className={controls.hint}>{agPickT('lede')}</span>
                <AgriKindPicker value={agKind} onPick={pickAgri} mill={agMill} onMill={setAgMill} gridClass={styles.shopGrid} cardClass={styles.shopCard} />
              </div>
            )}
            {!agOn && !mfOn && business === 'wholesale' && (
              <div className={controls.field} data-wizard-trade>
                <span className={controls.label}>{trT('tradeTitle')}</span>
                <span className={controls.hint}>{trT('tradeLede')}</span>
                <TradeKindPicker value={tradeKind} onPick={setTradeKind} gridClass={styles.shopGrid} cardClass={styles.shopCard} />
              </div>
            )}
            {!agOn && !mfOn && business === 'kirana' && (
              <div className={controls.field} data-wizard-retail>
                <span className={controls.label}>{pickT('retailTitle')}</span>
                <span className={controls.hint}>{pickT('retailLede')}</span>
                <RetailKindPicker value={retailKind} onPick={pickRetail} gridClass={styles.shopGrid} cardClass={styles.shopCard} />
              </div>
            )}
            {!agOn && !mfOn && business === 'contractor' && (
              <div className={controls.field} data-wizard-construction>
                <span className={controls.label}>{cnPickT('title')}</span>
                <span className={controls.hint}>{cnPickT('lede')}</span>
                <ConstructionKindPicker value={cnKind} onPick={pickConstruction} government={cnGov} onGovernment={setCnGov} gridClass={styles.shopGrid} cardClass={styles.shopCard} />
              </div>
            )}
            {!agOn && !mfOn && business === 'services' && (
              <div className={controls.field} data-wizard-service>
                <span className={controls.label}>{svPickT('title')}</span>
                <span className={controls.hint}>{svPickT('lede')}</span>
                <ServiceKindPicker value={svKind} onPick={pickService} pharmacy={svPharmacy} onPharmacy={setSvPharmacy} gridClass={styles.shopGrid} cardClass={styles.shopCard} />
                {svKind === 'professional' && <ProfKindPicker value={pfKind} onPick={pickProf} sub={pfSub} onSub={setPfSub} form={pfForm} onForm={setPfForm} ids={pfIds} onIds={setPfIds} gridClass={styles.shopGrid} cardClass={styles.shopCard} />}
                {svKind === 'travel' && <TravelKindPicker value={tvKind} onPick={setTvKind} bsp={tvBsp} onBsp={setTvBsp} alsoTravel={tvAlso} onAlsoTravel={setTvAlso} gridClass={styles.shopGrid} cardClass={styles.shopCard} />}
              </div>
            )}
            {/* QA-3 F20: the demo choice belongs on the first step, before any required field. */}
            <div className={controls.field}>
              <button type="button" className={controls.btnOutline} onClick={exploreDemo} disabled={demoBusy} data-wizard-demo>
                {reachT('demoCta')}
              </button>
              <span className={controls.hint}>{reachT('demoHint')}</span>
            </div>
          </>
        )}

        {current === 'gst' && (
          <>
            <div className={styles.choice} role="radiogroup" aria-label={setupT('gstAria')}>
              <button type="button" role="radio" aria-checked={a.gstRegistered} className={a.gstRegistered ? controls.btnPrimary : controls.btnOutline} onClick={() => set({ gstRegistered: true })}>
                {setupT('haveGstin')}
              </button>
              <button type="button" role="radio" aria-checked={!a.gstRegistered} className={!a.gstRegistered ? controls.btnPrimary : controls.btnOutline} onClick={() => set({ gstRegistered: false })}>
                {setupT('notRegistered')}
              </button>
            </div>
            {a.gstRegistered ? (
              <div className={controls.field}>
                <label className={controls.label} htmlFor="wizard-gstin">GSTIN</label>
                <GstinInput id="wizard-gstin" value={a.companyGstin} onChange={(v) => set({ companyGstin: v })} onStateCode={(code) => set({ stateCode: code })} />
                <span className={controls.hint}>{setupT('stateFromGstin')}</span>
                <label className={controls.check}>
                  <input type="checkbox" checked={!!a.composition} onChange={(e) => set({ composition: e.target.checked })} /> {reachT('composition')}
                </label>
              </div>
            ) : (
              <label className={controls.field}>
                <span className={controls.label}>{setupT('stateReq')}</span>
                <select className={controls.select} value={a.stateCode} onChange={(e) => set({ stateCode: e.target.value })}>
                  <option value="">{setupT('choose')}</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s.code} value={s.code}>{s.name}</option>
                  ))}
                </select>
                <span className={controls.hint}>{setupT('noGstHint')}</span>
              </label>
            )}
          </>
        )}

        {current === 'payment' && (
          <>
            <label className={controls.field}>
              <span className={controls.label}>UPI ID</span>
              <input className={controls.input} value={a.upiId} onChange={(e) => set({ upiId: e.target.value.trim() })} placeholder="name@okhdfcbank" />
              <span className={controls.hint}>{setupT('upiHint')}</span>
            </label>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{setupT('bankName')}</span>
                <input className={controls.input} value={a.bankName} onChange={(e) => set({ bankName: e.target.value })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{setupT('accountHolder')}</span>
                <input className={controls.input} value={a.accountName} onChange={(e) => set({ accountName: e.target.value })} placeholder={a.companyName} />
              </label>
            </div>
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{setupT('accountNumber')}</span>
                <input className={controls.input} inputMode="numeric" value={a.accountNumber} onChange={(e) => set({ accountNumber: e.target.value })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>IFSC</span>
                <input className={controls.input} value={a.ifsc} onChange={(e) => set({ ifsc: e.target.value.toUpperCase() })} placeholder="HDFC0001234" />
              </label>
            </div>
            <p className={controls.hint}>{setupT('allOptional')}</p>
          </>
        )}

        {current === 'look' && (
          <>
            <ImageSlot
              label={setupT('logo')}
              hint={setupT('logoHint')}
              value={a.logo}
              maxDimension={480}
              onPick={(logo) => set({ logo })}
              onClear={() => set({ logo: '' })}
              onError={setError}
            />
            <div className={controls.field}>
              <span className={controls.label}>{setupT('design')}</span>
              <div className={styles.templates}>
                {TEMPLATES.filter((t) => PICKS.includes(t.id)).map((t) => (
                  <button key={t.id} type="button" className={styles.template} aria-pressed={a.templateId === t.id} onClick={() => set({ templateId: t.id })}>
                    {/* The swatch shows the template's own accent, which is data, not a theme colour. */}
                    <span className={styles.swatch} style={{ background: t.accent }} aria-hidden="true" />
                    {t.name}
                  </button>
                ))}
              </div>
              <span className={controls.hint}>{setupT('designsAvailable', { n: TEMPLATES.length })}</span>
            </div>
            <div className={controls.field}>
              <button type="button" className={controls.btnOutline} onClick={exploreDemo} disabled={demoBusy}>
                {reachT('demoCta')}
              </button>
              <span className={controls.hint}>{reachT('demoHint')}</span>
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
