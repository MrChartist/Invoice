/**
 * AG-D4 input dealer desk (`/inventory?tab=inputs&view=`, pack `agri_inputs`): licences and principal certificates,
 * subsidised fertiliser (PoS vs book), credit till harvest. One lazy chunk with its views (budget: one chunk per desk).
 */
import { Suspense } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Desk } from './agd-kit';
import type { Done } from './agd-ui';
import LicencesView from './LicencesView';
import SubsidyView from './SubsidyView';
import SeasonCreditView from './SeasonCreditView';

const VIEWS = ['licences', 'subsidy', 'credit'] as const;
const BODY = {
  licences: LicencesView,
  subsidy: SubsidyView,
  credit: SeasonCreditView,
};

export default function InputsDesk({ view, onDone }: { view?: string; onDone: Done }) {
  const v = (VIEWS as readonly string[]).includes(view ?? '') ? (view as (typeof VIEWS)[number]) : 'licences';
  const Body = BODY[v];
  return (
    <Desk tab="inputs" title="inputs" icon={<ShieldCheck size={16} aria-hidden="true" />} views={VIEWS} view={v}>
      <Suspense fallback={null}><Body onDone={onDone} /></Suspense>
    </Desk>
  );
}
