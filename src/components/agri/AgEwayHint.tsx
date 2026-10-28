/**
 * PENDING 10 (AG-C4-4): the agriculture e-Way bill hint in the invoice editor (lazy; mounted by the items footer only
 * with an agri pack). Reads the editor's computed lines and shows `ewayHint`: exempt-only goods → "may not be needed —
 * verify with your CA (AG12)"; taxable goods above the threshold → the e-Way prompt with that value. Nothing otherwise.
 */
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { useT } from '../../i18n';
import { editorEwayHint } from '../../lib/agri/ag-packing';
import { formatMoney } from '../../lib/utils';
import { T } from './mill-kit';
import controls from '../../styles/controls.module.css';

export default function AgEwayHint() {
  useT();
  const lines = useInvoiceStore((s) => s.totals.lines);
  const items = useInvoiceStore((s) => s.items);
  const h = editorEwayHint(lines, items);
  if (h.kind === 'none') return null;
  return (
    <p className={controls.hint} style={{ flexBasis: '100%' }} data-ag-eway={h.kind}>
      {h.kind === 'exempt_note' ? T('ewExempt') : T('ewPrompt', { v: formatMoney(h.taxable) })}
    </p>
  );
}
