/**
 * AG-A3 panel in the bill form (lazy, mounted with the `agri` pack for a farmer vendor): use our own `FPV/FY…` number
 * for a bill from a farmer (he issues no invoice) and see the declaration the voucher prints. Full weighment and quality
 * cuts are on Inventory → Farm → Vouchers.
 */
import { agT } from '../../i18n/areas/agri-r12a';
import { nextFpvNumber } from '../../lib/agri/ag-vouchers';
import { voucherDeclaration } from '../../lib/agri/ag-tax';
import type { PurchaseLine, Vendor } from '../../types/purchases';
import controls from '../../styles/controls.module.css';

export default function VoucherAgriPanel({ vendor, lines, date, billNumber, onNumber }: { vendor: Vendor; lines: readonly PurchaseLine[]; date: string; billNumber: string; onNumber: (n: string) => void }) {
  const decl = voucherDeclaration(vendor, lines, date);
  return (
    <div className={controls.hint} data-ag-bill-panel>
      {!billNumber.startsWith('FPV/') && <button type="button" className={controls.btnGhost} onClick={() => onNumber(nextFpvNumber(date))}>{agT('useFpv')}</button>}
      {decl && <span> {decl}</span>}
    </div>
  );
}
