/** R6-A labels shared by the help components: a topic's title in the interface language, a setup step's label. */
import { getLanguage } from '../../i18n';
import { reachT } from '../../i18n/areas/reach';
import type { ChecklistStepV3, StepKind } from '../../lib/checklist-steps';
import type { HelpTopic } from '../../lib/help/types';

export const topicTitle = (x: Pick<HelpTopic, 'title' | 'hiTitle'>): string => (getLanguage() === 'hi' && x.hiTitle ? x.hiTitle : x.title);

export const stepLabel = (s: ChecklistStepV3): string =>
  s.kind === 'packFirst' && s.pack ? reachT(`ck.pack.${s.pack}` as Parameters<typeof reachT>[0]) /* packFirst: PACK_FIRST_TABLE packs only */ : reachT(`ck.${s.kind as Exclude<StepKind, 'packFirst'>}`);
