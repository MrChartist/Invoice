/** R6-B5: the title and "who needs it" line of a Settings → Features row (shared by the panel and Ctrl+K). */
import type { FeatureRow } from '../../lib/features-catalog';
import { reachT } from '../../i18n/areas/reach';
import { discoverT } from '../../i18n/areas/discover-r6';

type DKey = Parameters<typeof discoverT>[0];
type RKey = Parameters<typeof reachT>[0];

export function featureText(row: FeatureRow): { title: string; who: string } {
  const [kind, id] = row.id.split('.') as ['mod' | 'pack' | 'adv', string];
  if (kind === 'mod') return { title: reachT(`mod.${id}` as RKey), who: discoverT(`mwho.${id}` as DKey) };
  if (kind === 'pack') return { title: reachT(`pack.${id}` as RKey), who: reachT(`packDesc.${id}` as RKey) };
  return { title: discoverT(`adv.${id}` as DKey), who: discoverT(`awho.${id}` as DKey) };
}
