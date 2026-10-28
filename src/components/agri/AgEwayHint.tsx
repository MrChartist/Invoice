/**
 * PENDING 10 (AG-C4-4): the agriculture e-Way bill hint in the invoice editor (lazy; mounted by the items footer only
 * with an agri pack, which passes the editor's computed lines and items). Shows `ewayHint`: exempt-only goods → "may
 * not be needed — verify with your CA (AG12)"; taxable goods above the threshold → the e-Way prompt with that value.
 * Nothing otherwise. Reads no store of its own (keeps the shared vendor chunk's module order unchanged).
 */
import { useT } from '../../i18n';
import { mlT } from '../../i18n/areas/agri-r12c';
import { editorEwayHint } from '../../lib/agri/ag-packing';
import { formatMoney } from '../../lib/utils';
import controls from '../../styles/controls.module.css';

type Lines = Parameters<typeof editorEwayHint>[0];
type Items = Parameters<typeof editorEwayHint>[1];

export default function AgEwayHint({ lines, items }: { lines: Lines; items: Items }) {
  useT();
  const h = editorEwayHint(lines, items);
  if (h.kind === 'none') return null;
  return (
    <p className={controls.hint} style={{ flexBasis: '100%' }} data-ag-eway={h.kind}>
      {h.kind === 'exempt_note' ? mlT('ewExempt') : mlT('ewPrompt', { v: formatMoney(h.taxable) })}
    </p>
  );
}
