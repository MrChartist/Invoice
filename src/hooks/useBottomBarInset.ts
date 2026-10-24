import { useEffect } from 'react';

/** Lift toasts above the editor's fixed mobile save bar (≤900px) so they never cover Save. */
export function useBottomBarInset() {
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 900px)');
    if (!mq) return;
    const apply = () => document.documentElement.style.setProperty('--bottom-bar-h', mq.matches ? '4.25rem' : '0px');
    apply();
    mq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      document.documentElement.style.removeProperty('--bottom-bar-h');
    };
  }, []);
}
