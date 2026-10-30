/** R18-B2: the GST regime of a society bill as a small chip (label from `society-r18b`, data attribute for tests). */
import { hsbT } from '../../../i18n/areas/society-r18b';
import type { HsRegime } from '../../../lib/society/hs-regime';

const REGIMES: readonly HsRegime[] = ['unregistered', 'agency', 'exempt77c', 'taxable_whole', 'taxable_excess', 'outsider'];

export default function RegimeChip({ regime }: { regime?: HsRegime }) {
  if (!regime) return null;
  const tax = regime !== 'exempt77c' && regime !== 'unregistered';
  return <span data-hs-regime={regime} style={{ padding: '0 0.4rem', borderRadius: 'var(--r-8)', fontSize: 'var(--text-xs)', background: tax ? 'var(--tint-soft)' : 'var(--muted)', whiteSpace: 'nowrap' }}>{hsbT('regimes').split(',')[REGIMES.indexOf(regime)]}</span>;
}
