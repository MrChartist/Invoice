/**
 * PS-D3 editor hint (lazy, mounted in the editor's tax panel only for a professional profile or a client with a TDS
 * default): the TDS the client is expected to deduct on this fee note — on the fee base (fee lines, GST and pure-agent
 * recoveries out) once the client's FY total passes the section's threshold. A NEW document to that client gets the
 * section and rate filled once; below the threshold the fields stay empty and the hint says how far the client is.
 */
import { useEffect, useRef } from 'react';
import { useT } from '../../i18n';
import { ptT } from '../../i18n/areas/prof-r14d-tds';
import { localDb } from '../../lib/localDb';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { clientTdsDefault, expectedTds, feeBase } from '../../lib/prof/ps-tds-recv';
import { firmForm, profKind } from '../../lib/prof/ps-d-settings';
import { sectionText } from '../../lib/ita2025';
import controls from '../../styles/controls.module.css';

export default function Tds194jHint() {
  useT();
  const s = useInvoiceStore((x) => x);
  const client = s.client?.id ? localDb.clients.getById(s.client.id) : undefined;
  const def = client ? clientTdsDefault(client, profKind()) : undefined;
  const isNew = !localDb.invoices.getById(s.id);
  const exp = client && def && (s.doc_type ?? 'INVOICE') !== 'CREDIT_NOTE'
    ? expectedTds({ client, def, date: s.issue_date, base: feeBase(s as never), invoices: localDb.invoices.getAll(), ourForm: firmForm(), excludeId: s.id })
    : null;
  const done = useRef('');
  useEffect(() => {
    if (!exp?.applies || !isNew || s.tds_enabled || done.current === client?.id) return;
    done.current = client?.id ?? '';
    s.setTds({ enabled: true, section: exp.code, rate: exp.rate, onTaxable: true });
  }, [exp?.applies, exp?.code, exp?.rate, isNew, s, client?.id]);
  if (!exp) return null;
  const section = sectionText(exp.code, s.issue_date);
  return <p className={controls.hint} role="note" data-ps-tds-hint>{exp.applies ? ptT('onBase', { section, rate: exp.rate, base: exp.base, amount: exp.amount }) : ptT('notYet', { sofar: Math.round((exp.fyBefore + exp.base) * 100) / 100, limit: exp.threshold, section })}</p>;
}
