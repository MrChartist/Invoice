/**
 * R3-C1 gate for the live preview pane: true only on a wide viewport (`PREVIEW_MEDIA`) with the device
 * toggle on, so phones never request the pane chunk. Kept tiny — it lives in the editor chunk.
 */
import { useCallback, useEffect, useState } from 'react';
import { PREVIEW_MEDIA, readEditorLayout, writeEditorLayout } from '../../lib/editor-layout';
import { defineArea } from '../../i18n/area';

// The two toggle labels live here (not in docs-r3.ts) so the editor chunk does not pull the R3-C string area.
const lpT = defineArea({ show: 'Show live preview', hide: 'Hide live preview' } as const, { show: 'लाइव प्रीव्यू दिखाएँ', hide: 'लाइव प्रीव्यू छिपाएँ' });

const matches = () => {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.(PREVIEW_MEDIA).matches;
  } catch {
    return false;
  }
};

export function useLivePreviewPane(): { wide: boolean; on: boolean; toggle: () => void; showLabel: string; hideLabel: string } {
  const [wide, setWide] = useState(matches);
  const [pref, setPref] = useState(() => readEditorLayout().preview);
  useEffect(() => {
    const mq = window.matchMedia?.(PREVIEW_MEDIA);
    if (!mq) return;
    const onChange = () => setWide(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  const toggle = useCallback(() => setPref((p) => writeEditorLayout({ preview: !p }).preview), []);
  return { wide, on: wide && pref, toggle, showLabel: lpT('show'), hideLabel: lpT('hide') };
}
