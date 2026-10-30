import { lazy, Suspense } from 'react';
import type { PopupSpec } from './types';

/** The one lazy popup of every picker field; it loads on the first open (or first focus, `preloadPopup`). */
const LazyPopup = lazy(() => import('./PickerPopup'));

export function Popup({ spec }: { spec: PopupSpec | null }) {
  return spec ? <Suspense fallback={null}><LazyPopup spec={spec} /></Suspense> : null;
}
