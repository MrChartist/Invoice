import { PageHeader } from '../components/ui/PageHeader';
import surface from '../styles/surface.module.css';
import { ExportCenter } from '../components/exports/ExportCenter';

/** Route: /exports — hand data to accountants (Tally Prime XML, CSV registers, JSON bundle). */
export function Exports() {
  return (
    <div className={surface.page}>
      <PageHeader
        title="Export center"
        subtitle="Tally Prime XML, Zoho / Vyapar / Busy-ready CSVs and a one-click bundle for your accountant."
      />
      <ExportCenter />
    </div>
  );
}

export default Exports;
