import { FileDown } from 'lucide-react';
import surface from '../styles/surface.module.css';
import { ExportCenter } from '../components/exports/ExportCenter';

/** Route: /exports — hand data to accountants (Tally Prime XML, CSV registers, JSON bundle). */
export function Exports() {
  return (
    <div className={surface.page}>
      <div className={surface.pageHead}>
        <div>
          <h1 className={surface.pageTitle}>
            <FileDown size={22} aria-hidden="true" /> Export center
          </h1>
          <p className={surface.pageSubtitle}>
            Tally Prime XML, Zoho / Vyapar / Busy-ready CSVs and a one-click bundle for your accountant.
          </p>
        </div>
      </div>
      <ExportCenter />
    </div>
  );
}

export default Exports;
