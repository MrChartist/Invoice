/**
 * AG-D5 members desk (`/inventory?tab=members&view=`, pack `fpo`): register of members, share entries and certificates,
 * patronage and the distribution paper, 80P / Sec 149 / 80PA papers and the statutory calendar; member loans (the D3
 * view) when the cold-storage pack is off. One lazy chunk with its views; loans are a shared sub-chunk.
 */
import { lazy, Suspense } from 'react';
import { Users } from 'lucide-react';
import { localDb } from '../../lib/localDb';
import { isPackOn } from '../../lib/industry-packs';
import { Desk } from './agd-kit';
import type { Done } from './agd-ui';
import ShareRegisterView from './ShareRegisterView';
import PatronageView from './PatronageView';
import PapersView from './PapersView';

const Register = ShareRegisterView;
const BODY = {
  register: (p: { onDone: Done }) => <Register {...p} mode="register" />,
  shares: (p: { onDone: Done }) => <Register {...p} mode="shares" />,
  patronage: PatronageView,
  papers: PapersView,
  loans: lazy(() => import('./LoansView')),
};

export default function MembersDesk({ view, onDone }: { view?: string; onDone: Done }) {
  const views = ['register', 'shares', 'patronage', 'papers', ...(isPackOn(localDb.settings.get(), 'coldstore' as never) ? [] : ['loans'])] as (keyof typeof BODY)[];
  const v = views.includes(view as keyof typeof BODY) ? (view as keyof typeof BODY) : 'register';
  const Body = BODY[v];
  return (
    <Desk tab="members" title="members" icon={<Users size={16} aria-hidden="true" />} views={views} view={v}>
      <Suspense fallback={null}><Body onDone={onDone} /></Suspense>
    </Desk>
  );
}
