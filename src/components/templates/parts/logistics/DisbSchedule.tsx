import type { LgSnapshot } from '../../../../types/logistics-r19';
import { disbSchedule } from '../../../../lib/logistics/lg-disb';
import { formatMoney } from '../../../../lib/utils';
import styles from '../manpower-paper.module.css';

/**
 * R19-C3 part of the logistics block: the disbursement schedule (date, paid for, challan / invoice no., paid to,
 * amount) of a reimbursement bill and the total recoverable at actual, apart from the taxable value — from the `lg.disb`
 * snapshot only (an issued document never changes). Template variables only (the R17 particulars styles).
 */
export default function DisbSchedule({ lg }: { lg: LgSnapshot }) {
  const s = disbSchedule(lg);
  if (!s.rows.length) return null;
  return (
    <>
      <table className={styles.posts} data-lg-disb-schedule>
        <thead><tr><th>Disbursements paid on your behalf</th><th>Paid for</th><th>Challan / invoice</th><th>Paid to</th><th>₹</th></tr></thead>
        <tbody>{s.rows.map((r, i) => <tr key={i}>{r.map((v, k) => <td key={k}>{k === 4 ? formatMoney(v as number) : v}</td>)}</tr>)}</tbody>
      </table>
      <p className={styles.decl} data-lg-disb-total>Recoverable at actual (Rule 33, outside the taxable value): ₹{formatMoney(s.total)}</p>
    </>
  );
}
