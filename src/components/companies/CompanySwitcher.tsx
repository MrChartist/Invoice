import { Suspense, lazy, useState } from 'react';
import { readRegistry } from '../../lib/companies';

// R20-D: the select loads only on a device with a second company, so it is off first paint (that pays for the
// Tally keys' F3 / Alt+K … claims the shell stub gained). F3 opens the same list as a sheet (keys/MenuSheets.tsx).
const List = lazy(() => import('./CompanySwitcherList'));

/** Sidebar switcher (6.20); renders nothing until a second company exists. */
export function CompanySwitcher() {
  const [many] = useState(() => readRegistry().list.length > 1);
  return many ? <Suspense fallback={null}><List /></Suspense> : null;
}
