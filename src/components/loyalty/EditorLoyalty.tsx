/**
 * Loyalty redemption in the invoice editor (WP-9). Lazy: the summary panel mounts it only while the
 * loyalty programme is switched on, for a sales bill with a saved customer. The redeemed value joins
 * the invoice's amount discount exactly as on the POS (`redeemOnBill`).
 */
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RECORD_KEYS, useInvoiceStore } from '../../store/useInvoiceStore';
import { redeemOnBill } from '../../lib/loyalty';
import type { InvoiceRecord } from '../../types/invoice';
import { LoyaltyRedeem } from './LoyaltyRedeem';

export default function EditorLoyalty() {
  const { name, points } = useInvoiceStore(useShallow((st) => ({ name: st.client?.name ?? '', points: st.loyalty_redeem?.points ?? 0 })));
  const [errors, setErrors] = useState<string[]>([]);
  if (!name.trim()) return null;
  const apply = (pts: number) => {
    const st = useInvoiceStore.getState();
    const rec = Object.fromEntries(RECORD_KEYS.map((k) => [k, st[k]])) as unknown as InvoiceRecord;
    const res = redeemOnBill(rec, pts);
    setErrors(res.errors);
    if (!res.record) return;
    st.patch({ discount_type: res.record.discount_type, discount_rate: res.record.discount_rate, loyalty_redeem: res.record.loyalty_redeem });
  };
  return <LoyaltyRedeem key={name} customer={name} points={points} errors={errors} onApply={apply} />;
}
