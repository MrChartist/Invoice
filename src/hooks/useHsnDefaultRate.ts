/**
 * WP-6 wiring: the invoice editor takes a line's GST rate from the HSN master when its HSN is typed
 * (see `src/lib/hsn-defaults.ts`). Works by subscribing to the invoice store, so the line editor
 * components are not touched. The HSN logic loads only when the HSN master has rows.
 */
import { useEffect } from 'react';
import { getTable } from '../lib/storage';
import { useInvoiceStore } from '../store/useInvoiceStore';

export function useHsnDefaultRate(): void {
  useEffect(() => {
    const rows = (() => {
      try {
        return getTable('hsn_master').length;
      } catch {
        return 0;
      }
    })();
    if (!rows) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void import('../lib/hsn-defaults').then(({ hsnDefaultPatches, loadHsnMaster }) => {
      if (cancelled) return;
      const master = loadHsnMaster();
      unsubscribe = useInvoiceStore.subscribe((state, prev) => {
        if (state.items === prev.items) return;
        const patches = hsnDefaultPatches(prev.items, state.items, master, state.issue_date, state.tax_rate);
        for (const p of patches) state.patchItem(p.id, { tax_rate: p.tax_rate, ...(p.cess_rate !== undefined ? { cess_rate: p.cess_rate } : {}) });
      });
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
}
