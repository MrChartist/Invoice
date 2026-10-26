/**
 * R4-C1 LUT auto-fill and hint under the editor's LUT fields (zero-rated supplies without payment): the register's
 * ARN and filed date for the document's FY are filled in once, unless the user typed an LUT; the hint says where it
 * came from, or that none is on record / the typed one belongs to another FY. Under Rule 96A — verify with your CA.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { fyOf, lutAutofill, lutDb, pickLut } from '../../lib/trade/lut-register';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-trust-r4';
import styles from './trade.module.css';

export default function LutHint() {
  useT();
  const s = useInvoiceStore(useShallow((st) => ({ supply_type: st.supply_type, issue_date: st.issue_date, lut_number: st.lut_number, lut_date: st.lut_date, sender: st.sender, setLut: st.setLut })));
  const register = useMemo(() => lutDb.peek(), []);
  const filled = useRef(false);
  const fill = lutAutofill(s, register);
  const { setLut } = s;
  useEffect(() => {
    if (fill && !filled.current) {
      filled.current = true;
      setLut(fill.lut_number, fill.lut_date);
    }
  }, [fill, setLut]);
  const fy = fyOf(s.issue_date);
  const typed = String(s.lut_number ?? '').trim().toUpperCase();
  const row = typed ? register.find((r) => r.arn === typed) : pickLut(register, s.issue_date, s.sender?.companyGstin);
  if (row && row.fy !== fy) return <p className={`${styles.note}`} role="note" data-lut-hint="outside">{trT('lutOutside', { lutFy: row.fy, fy })}</p>;
  if (row) return <p className={styles.muted} data-lut-hint="filled">{trT('lutFilled', { arn: row.arn, fy: row.fy })}</p>;
  if (!typed) return <p className={styles.note} role="note" data-lut-hint="missing">{trT('lutMissingHint', { fy })}</p>;
  return null;
}
