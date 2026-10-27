/**
 * AG-D cold storage desk (`/inventory?tab=cold&view=`, pack `coldstore`): lots and receipts, gate passes, rent plans and
 * bills, loans against lots, chambers. One lazy chunk with its views; the loans view (shared with the members desk) is
 * its own sub-chunk. Lots are custody only — never stock.
 */
import { lazy, Suspense } from 'react';
import { Snowflake } from 'lucide-react';
import { Desk } from './agd-kit';
import type { Done } from './agd-ui';
import LotsView from './LotsView';
import GatePassView from './GatePassView';
import RentView from './RentView';
import ChambersView from './ChambersView';

const VIEWS = ['lots', 'gatepasses', 'rent', 'loans', 'chambers'] as const;
const BODY = {
  lots: LotsView,
  gatepasses: GatePassView,
  rent: RentView,
  loans: lazy(() => import('./LoansView')),
  chambers: ChambersView,
};

export default function ColdDesk({ view, onDone }: { view?: string; onDone: Done }) {
  const v = (VIEWS as readonly string[]).includes(view ?? '') ? (view as (typeof VIEWS)[number]) : 'lots';
  const Body = BODY[v];
  return (
    <Desk tab="cold" title="cold" icon={<Snowflake size={16} aria-hidden="true" />} views={VIEWS} view={v}>
      <Suspense fallback={null}><Body onDone={onDone} /></Suspense>
    </Desk>
  );
}
