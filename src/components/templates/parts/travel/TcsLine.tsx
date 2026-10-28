import type { TvSnapshot } from '../../../../types/travel-r15';
import styles from '../travel-paper.module.css';

/**
 * R15-D paper lines inside the travel block, from the `tv` snapshot only: the overseas tour package TCS (label, and the
 * 5 % / 20 % split on a crossing invoice; the amount itself prints in the totals as `tcs_label`) and the place-of-supply
 * note (Sec 12(2) / 13(3)(b) / 12(7)(a)). Working papers — verify with your CA.
 */
export default function TcsLine({ tv }: { tv: TvSnapshot }) {
  const t = tv.tcs && !tv.tcs.nr && tv.tcs.rate > 0 ? tv.tcs : null;
  if (!t && !tv.pos_note) return null;
  return (
    <>
      {t && <p className={styles.decl} data-travel-tcs>TCS: {t.label}{t.slab ? ` — ${t.slab}` : ''}. Verify with your CA.</p>}
      {tv.pos_note && <p className={styles.decl} data-travel-pos>{tv.pos_note}</p>}
    </>
  );
}
