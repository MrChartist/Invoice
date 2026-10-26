/**
 * First-run setup wizard: per-step validation and applying the answers to settings.
 * Pure (unit-tested); the UI lives in components/onboarding/SetupWizard.tsx.
 */

import type { AppSettings } from './localDb';
import type { SenderProfile } from '../types/invoice';
import { checkGstin } from './gstin';
import { isValidIfsc, isValidUpi } from './validators';

/** `start` (8H): language + "What do you do?" (business type, applied with `shop-presets.ts`). */
export const WIZARD_STEPS = ['start', 'business', 'gst', 'payment', 'look'] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];

export interface WizardAnswers {
  companyName: string;
  companyAddress: string;
  city: string;
  pin: string;
  companyPhone: string;
  companyEmail: string;
  gstRegistered: boolean;
  /** 8H: registered under the composition scheme — issues Bills of Supply (no tax). */
  composition?: boolean;
  companyGstin: string;
  /** Used when not GST-registered (with a GSTIN, the state comes from it). */
  stateCode: string;
  upiId: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  logo?: string;
  templateId: string;
}

export function answersFrom(profile: SenderProfile | null, templateId: string): WizardAnswers {
  return {
    companyName: profile?.companyName ?? '',
    companyAddress: profile?.companyAddress ?? '',
    city: profile?.city ?? '',
    pin: profile?.pin ?? '',
    companyPhone: profile?.companyPhone ?? '',
    companyEmail: profile?.companyEmail ?? '',
    gstRegistered: Boolean(profile?.companyGstin),
    composition: profile?.gst_scheme === 'composition',
    companyGstin: profile?.companyGstin ?? '',
    stateCode: profile?.stateCode ?? '',
    upiId: profile?.upiId ?? '',
    bankName: profile?.bankName ?? '',
    accountName: profile?.accountName ?? '',
    accountNumber: profile?.accountNumber ?? '',
    ifsc: profile?.ifsc ?? '',
    logo: profile?.logo,
    templateId,
  };
}

/** '' when the step can be left; otherwise a message for the user. */
export function stepProblem(step: WizardStep, a: WizardAnswers): string {
  switch (step) {
    case 'business':
      if (!a.companyName.trim()) return 'Add the name to print on your invoices.';
      if (a.pin && !/^\d{6}$/.test(a.pin)) return 'A PIN code has 6 digits.';
      if (a.companyEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.companyEmail)) return 'That email address looks wrong.';
      return '';
    case 'gst':
      if (a.gstRegistered) {
        const g = checkGstin(a.companyGstin);
        if (!g.valid) return g.message ?? 'That GSTIN is not valid.';
      } else if (!a.stateCode) return 'Choose your state — it decides CGST + SGST vs IGST.';
      return '';
    case 'payment':
      if (a.upiId && !isValidUpi(a.upiId)) return 'The UPI ID should look like name@bank.';
      if (a.ifsc && !isValidIfsc(a.ifsc)) return 'The IFSC code should look like HDFC0001234.';
      if (a.accountNumber && !/^\d{6,18}$/.test(a.accountNumber.replace(/\s/g, ''))) return 'An account number has 6 to 18 digits.';
      return '';
    case 'start':
    case 'look':
      return '';
  }
}

/** Settings with the active profile filled from the answers and the wizard marked done. */
export function applyAnswers(settings: AppSettings, a: WizardAnswers): AppSettings {
  const gstin = a.gstRegistered ? a.companyGstin.trim().toUpperCase() : '';
  const stateCode = gstin ? checkGstin(gstin).stateCode ?? a.stateCode : a.stateCode;
  const patch: Partial<SenderProfile> = {
    companyName: a.companyName.trim(),
    companyAddress: a.companyAddress.trim(),
    city: a.city.trim(),
    pin: a.pin.trim(),
    companyPhone: a.companyPhone.trim(),
    companyEmail: a.companyEmail.trim(),
    companyGstin: gstin,
    stateCode,
    upiId: a.upiId.trim(),
    bankName: a.bankName.trim(),
    accountName: a.accountName.trim() || a.companyName.trim(),
    accountNumber: a.accountNumber.replace(/\s/g, ''),
    ifsc: a.ifsc.trim().toUpperCase(),
    ...(a.logo !== undefined ? { logo: a.logo } : {}),
    // 8H: a composition dealer's new invoices default to a Bill of Supply (the editor switches on gst_scheme).
    ...(gstin && a.composition ? { gst_scheme: 'composition' as const } : {}),
  };
  const activeId = settings.activeProfileId || settings.profiles[0]?.id;
  const profiles = settings.profiles.map((p) => (p.id === activeId ? { ...p, ...patch } : p));
  const frequency = gstin && a.composition ? 'composition' : settings.gst_filing_frequency === 'composition' ? undefined : settings.gst_filing_frequency;
  return { ...settings, profiles, onboarded: true, gst_filing_frequency: frequency };
}

/**
 * What the wizard keeps when the user leaves it for the Demo company (QA-3 F20): everything typed so far goes into the
 * active profile, but the account is NOT marked as set up, so the wizard opens again (prefilled) back in this company.
 * Returns null when nothing was typed (no write needed).
 */
export function wizardDraft(settings: AppSettings, a: WizardAnswers): AppSettings | null {
  const typed = [a.companyName, a.companyAddress, a.city, a.pin, a.companyPhone, a.companyEmail, a.companyGstin, a.upiId, a.bankName, a.accountNumber, a.ifsc].some((v) => String(v ?? '').trim());
  if (!typed && !a.logo) return null;
  return { ...applyAnswers(settings, a), onboarded: settings.onboarded };
}

/** Show the wizard only to a brand-new account: not set up, no invoices yet. */
export function shouldShowWizard(settings: Pick<AppSettings, 'onboarded'>, invoiceCount: number): boolean {
  return !settings.onboarded && invoiceCount === 0;
}
