/**
 * SV-A3 / A4 editor parts, lazy (mounted by `creator/ItemsTable.tsx` only with a service profile or pack on, or for a
 * line that already carries `sv`):
 *  - `SvLineRow`: staff on the line (`sv.staff_id`), the service class (`sv.cls`: suggests rate / SAC by the document
 *    date; a typed rate is kept) and, on a 0% line, its Table 8 column (`sv.exempt`: exempt / nil / non-GST);
 *  - `EditorService`: snapshots `sv.rule46a` (the Rule 46A title switch) on the document and says which paper it gets.
 * Working papers — verify with your CA (SV2, SV5, SV11).
 */
import { useEffect, useMemo } from 'react';
import type { InvoiceItem } from '../../types/invoice';
import type { SvClass, SvExempt } from '../../types/services-r10';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { localDb } from '../../lib/localDb';
import { bookableStaff } from '../../lib/services/sv-staff';
import { readServiceSettings } from '../../lib/services/sv-settings';
import { SV_CLASSES, classPatch, offerSplit, rule46aApplies } from '../../lib/services/sv-tax';
import { withStaff } from '../../lib/services/sv-pos';
import { useT } from '../../i18n';
import { svT } from '../../i18n/areas/services-r10a';
import controls from '../../styles/controls.module.css';

const EXEMPTS: SvExempt[] = ['EXEMPT', 'NIL', 'NON_GST'];

export function SvLineRow({ item, index, date }: { item: InvoiceItem; index: number; date: string }) {
  useT();
  const staff = useMemo(() => bookableStaff(), []);
  const patch = (p: Partial<InvoiceItem>) => useInvoiceStore.getState().patchItem(item.id, p);
  const sv = item.sv ?? {};
  // A rate other than 0 or the default was typed: the class never overrides it (the exceptions report flags an old rate).
  const typed = Number(item.tax_rate) !== 0 && Number(item.tax_rate) !== Number(localDb.settings.get().defaultTaxRate);
  const setSv = (p: Partial<NonNullable<InvoiceItem['sv']>>) => {
    const next = { ...sv, ...p };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined || next[k] === '') delete next[k];
    patch({ sv: Object.keys(next).length ? next : undefined });
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }} data-sv-line={index}>
      {!!staff.length && (
        <select className={controls.ghost} value={sv.staff_id ?? ''} aria-label={`${svT('e.staff')} ${index + 1}`} data-sv-staff={index}
          onChange={(e) => patch({ sv: withStaff(item, staff.find((s) => s.id === e.target.value), !!readServiceSettings().print_staff).sv })}>
          <option value="">{svT('e.staff')}: —</option>
          {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      <select className={controls.ghost} value={sv.cls ?? ''} aria-label={`${svT('e.cls')} ${index + 1}`} data-sv-class={index}
        onChange={(e) => patch(classPatch(item, e.target.value as SvClass | '', date, typed))}>
        <option value="">{svT('e.cls')}: —</option>
        {SV_CLASSES.map((c) => <option key={c} value={c}>{svT(`cl.${c}`)}</option>)}
      </select>
      {Number(item.tax_rate) === 0 && (
        <select className={controls.ghost} value={sv.exempt ?? ''} aria-label={`${svT('e.exempt')} ${index + 1}`} data-sv-exempt={index}
          onChange={(e) => setSv({ exempt: (e.target.value || undefined) as SvExempt | undefined })}>
          <option value="">{svT('e.exempt')}: {svT('x.none')}</option>
          {EXEMPTS.map((x) => <option key={x} value={x}>{svT(`x.${x}`)}</option>)}
        </select>
      )}
    </div>
  );
}

export function EditorService() {
  useT();
  const doc = useInvoiceStore(useShallow((s) => ({ doc_type: s.doc_type, client: s.client, items: s.items, sv: s.sv })));
  const on = useMemo(() => readServiceSettings().rule46a === true, []);
  const draft = useInvoiceStore((s) => s.status === 'Draft' || !s.invoice_number);
  useEffect(() => {
    // Snapshot the switch on documents still being written; an issued document keeps what it was saved with.
    if (!draft || !!doc.sv?.rule46a === on) return;
    const sv = { ...doc.sv, rule46a: on || undefined };
    if (!on) delete sv.rule46a;
    useInvoiceStore.setState({ sv: Object.keys(sv).length ? sv : undefined });
  }, [on, draft, doc.sv]);
  if (rule46aApplies(doc)) return <p className={controls.hint} data-sv-46a>{svT('e.46a')}</p>;
  if (offerSplit(doc)) return <p className={controls.hint} role="note">{svT('e.split')}</p>;
  return null;
}
