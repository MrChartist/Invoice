/** Settings → Profile → Registrations (R5-C3, `nonprofit` pack): PAN, 12A / 12AB, 80G URN, 35(1), FCRA. Saved with the profile. */
import type { SenderProfile } from '../../types/invoice';
import type { NpoProfile } from '../../types/institutions-r5';
import { isValidPan } from '../../lib/validators';
import { shiftDay } from '../../lib/dates';
import { useT } from '../../i18n';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from '../institutions/institutions.module.css';
import { T } from '../institutions/Views';
import { today } from '../institutions/ui';

const FIELDS = ['pan', 'reg_12ab', 'reg_12ab_valid_to', 'urn_80g', 'urn_80g_date', 'urn_80g_valid_to', 'approval_35', 'fcra_reg'] as const;

export default function NpoRegistrationsPanel({ profile, onChange }: { profile: SenderProfile; onChange: (patch: Partial<SenderProfile>) => void }) {
  useT();
  const npo: NpoProfile = profile.npo ?? { pan: '' };
  const limit = shiftDay(today(), 60);
  const soon = [npo.urn_80g_valid_to, npo.reg_12ab_valid_to].some((d) => d && d <= limit);
  return (
    <fieldset className={styles.stack} data-npo-registrations>
      <legend>{iT('registrations')}</legend>
      <div className={styles.toolbar}>
        {FIELDS.map((k) => <T key={k} l={iT(`npo.${k}`)} t={k.includes('_to') || k.endsWith('date') ? 'date' : undefined} v={npo[k]} bad={k === 'pan' && !!npo.pan && !isValidPan(npo.pan)} on={(v) => onChange({ npo: { ...npo, [k]: k === 'pan' ? v.toUpperCase() : v } })} />)}
      </div>
      {soon && <p className={styles.warn}>{iT('regExpiring')}</p>}
      <p className={styles.note}>{iT('regNote')}</p>
    </fieldset>
  );
}
