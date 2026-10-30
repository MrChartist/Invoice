import type { MpSnapshot } from '../../../../types/manpower-r17';
import { formatMoney } from '../../../../lib/utils';
import styles from '../manpower-paper.module.css';

/**
 * R17-B3 / B4 parts of the manpower block: the duty annexure (name, code, post, duties, OT — no UAN or bank details,
 * DPDP minimisation) and, when the bill was made with "Print expected TDS", the expected client TDS line. From the
 * `mp` snapshot only. Accent variable only.
 */
export default function DutyAnnex({ mp }: { mp: MpSnapshot }) {
  return (
    <>
      {!!mp.annex?.length && (
        <table className={styles.posts} data-manpower-annex>
          <thead><tr><th>Duty annexure</th><th>Code</th><th>Post</th><th>Duties</th><th>OT h</th></tr></thead>
          <tbody>{mp.annex.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.code}</td><td>{r.post ?? ''}</td><td>{r.duties}</td><td>{r.ot ?? ''}</td></tr>)}</tbody>
        </table>
      )}
      {mp.tds_print && mp.tds && <p className={styles.decl} data-manpower-tds>TDS expected: ₹{formatMoney(mp.tds.expected)} ({mp.tds.rate} %, {mp.tds.label ?? mp.tds.section}): verify with your CA.</p>}
    </>
  );
}
