/** R18-B3: the inward-RCM hint on a society's supplier bill (security services, entry 14; lazy, `society` pack only, HS15). */
import { useT } from '../../../i18n';
import { hsbT } from '../../../i18n/areas/society-r18b';
import { localDb } from '../../../lib/localDb';
import { ruleAt } from '../../../lib/tax-rules';
import { SECURITY_RCM_RULES } from '../../../lib/manpower-rules';
import { rcmHint } from '../../../lib/society/hs-turnover';
import controls from '../../../styles/controls.module.css';

export default function RcmHint({ lines, vendor, date, rcm }: { lines: readonly { hsn?: string }[]; vendor?: { gstin?: string; pan?: string }; date: string; rcm: boolean }) {
  useT();
  const on = rcmHint({ lines, reverse_charge: rcm }, vendor, !!localDb.settings.activeProfile()?.companyGstin?.trim(), ruleAt(SECURITY_RCM_RULES, date));
  return on ? <p className={controls.hint} style={{ color: 'var(--warning)' }} role="note" data-hs-rcm-hint>{hsbT('rcm')}</p> : null;
}
