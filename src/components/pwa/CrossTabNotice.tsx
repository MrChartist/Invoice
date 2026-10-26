import { lazy, Suspense, useState, useSyncExternalStore } from 'react';
import { companyMoved, externalVersion, subscribeExternal } from '../../lib/cross-tab';
import { useT } from '../../i18n';

const CrossTabBanner = lazy(() => import('./CrossTabBanner').then((m) => ({ default: m.CrossTabBanner })));

/**
 * "Changed in another tab" notice. Screens are not refreshed behind the user's back
 * (that would drop half-typed input); Refresh remounts the current page with fresh data.
 * QA7 G1: when another tab switched the company, the banner says "This tab is on another company — reload".
 */
export function CrossTabNotice({ onRefresh }: { onRefresh: () => void }) {
  useT(); // re-render on a language switch (5.4)
  const version = useSyncExternalStore(subscribeExternal, externalVersion, externalVersion);
  const [seen, setSeen] = useState(version);
  if (version === seen) return null;
  return (
    <Suspense fallback={null}>
      <CrossTabBanner moved={companyMoved()} onRefresh={onRefresh} onDismiss={() => setSeen(version)} />
    </Suspense>
  );
}
