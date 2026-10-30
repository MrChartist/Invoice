/**
 * SV-B3 lab report preview (department-wise rows, flags in bold) and Print: the script-free A4 report
 * (`labReportHtml`) through `printHtmlDocument`; the PDF goes through the browser's print / the existing stack.
 */
import type { LabOrder } from '../../types/services-r10';
import { localDb } from '../../lib/localDb';
import { downloadText } from '../../lib/download';
import { printHtmlDocument } from '../../lib/voucher-print';
import { labReportHtml, reportRows } from '../../lib/services/sv-lab-report';
import { svT } from '../../i18n/areas/services-r10a';
import controls from '../../styles/controls.module.css';
import styles from './services.module.css';

export function LabReportPrint({ o, signers, onPrint }: { o: LabOrder; signers: { name: string; qual?: string }[]; onPrint: () => void }) {
  const print = () => {
    printHtmlDocument(labReportHtml(o, localDb.settings.activeProfile() ?? { companyName: '', companyAddress: '', companyPhone: '' }, signers), (html) => downloadText(`${o.number.replace(/\//g, '-')}.html`, html, 'text/html'));
    onPrint();
  };
  return (
    <div data-lab-report>
      <table className={styles.lines}>
        <tbody>
          {reportRows(o).map((r, i) => (
            <tr key={i} style={r.flag ? { fontWeight: 600 } : undefined}>
              <td>{r.dept}</td><td>{r.test === r.name ? r.name : `${r.test}: ${r.name}`}</td><td>{r.value || '-'}</td><td>{r.unit}</td><td>{r.range}</td><td data-flag>{r.flag}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className={controls.btnPrimary} onClick={print}>{svT('print')}</button>
    </div>
  );
}
