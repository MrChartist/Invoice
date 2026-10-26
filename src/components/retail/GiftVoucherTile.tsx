import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Gift } from 'lucide-react';
import { GV_TABLE, voucherState } from '../../lib/retail/gift-voucher-core';
import { peekTable } from '../../lib/storage';
import { formatCurrency, todayInput } from '../../lib/utils';
import type { GiftVoucher } from '../../types/stores-r4';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { useT } from '../../i18n';
import { sT } from '../../i18n/areas/stores-r4';
import surface from '../../styles/surface.module.css';
import own from '../dashboard/tiles.module.css';

/** Dashboard tile "Gift vouchers" (R4-B1): outstanding balance, live vouchers and what expired unrecognised. Lazy. */
export default function GiftVoucherTile() {
  useT();
  const s = useMemo(() => {
    const day = todayInput();
    const pays = peekTable<Payment>('transactions');
    const invs = peekTable<InvoiceRecord>('invoices');
    let live = 0;
    let balance = 0;
    let expired = 0;
    for (const v of peekTable<GiftVoucher>(GV_TABLE)) {
      const st = voucherState(v, pays, day, invs);
      if (st.status === 'active') { live++; balance += v.promo ? 0 : st.balance; }
      if (st.status === 'expired' && !v.breakage_voucher_id && !v.promo) expired += st.balance;
    }
    return { live, balance, expired };
  }, []);
  return (
    <section className={surface.card} aria-label={sT('gvTitle')}>
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}><Gift size={16} /> {sT('gvTitle')}</span></div>
      <div className={surface.cardBody}>
        <ul className={own.list}>
          <li><span>{sT('gvOutstanding')}</span><strong>{formatCurrency(s.balance)}</strong></li>
          <li><span>{sT('gvLive')}</span><strong>{s.live}</strong></li>
          {s.expired > 0 && <li><span>{sT('gvExpiredUnrecognised')}</span><strong>{formatCurrency(s.expired)}</strong></li>}
        </ul>
        <Link to="/receivables?tab=giftvouchers">{sT('gvOpen')}</Link>
      </div>
    </section>
  );
}
