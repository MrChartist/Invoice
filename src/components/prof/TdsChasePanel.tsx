/** PS-D3 certificates to chase (Form 131 / 16A) per client × quarter, with a chase letter (print, `wa.me`, `mailto:`). */
import { useMemo } from 'react';
import { ptT } from '../../i18n/areas/prof-r14d-tds';
import { todayInput } from '../../lib/utils';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { printHtmlDocument } from '../../lib/voucher-print';
import { downloadText } from '../../lib/download';
import { TDS_CERT_TABLE, buildTdsRegister, type TdsCertificate, type TdsRegister } from '../../lib/tds-register';
import { chaseLetter, chaseList } from '../../lib/prof/ps-tds-recv';
import type { Client, Payment } from '../../types/invoice';
import { Tbl } from './ps-d-ui';
import { inr, sm } from './ps-desk';
import controls from '../../styles/controls.module.css';
import { escHtml as esc } from '../../lib/html-esc';
import { PRINT_FONT } from '../../lib/print-fonts';


/** The chase list with letters (Receivables → TDS passes its register; the desk builds one). */
export default function ChasePanel({ reg, clients }: { reg?: TdsRegister; clients?: readonly Client[] }) {
  const today = todayInput();
  const list = useMemo(() => {
    const r = reg ?? buildTdsRegister({ invoices: localDb.invoices.getAll(), payments: getTable<Payment>('transactions'), clients: localDb.clients.getAll(), certificates: getTable<TdsCertificate>(TDS_CERT_TABLE) }, { today });
    return chaseList(r, today);
  }, [reg, today]);
  const firm = localDb.settings.activeProfile()?.companyName || '';
  const cl = clients ?? localDb.clients.getAll();
  return (
    <section data-ps-chase>
      <p className={controls.label}>{ptT('chase')}</p>
      <Tbl empty={ptT('none')} head={[ptT('client'), ptT('quarter'), ptT('due'), ptT('tds'), '']} rows={list.map((r) => {
        const text = chaseLetter(r, firm);
        const c = cl.find((x) => x.id === r.partyKey);
        const phone = String(c?.phone ?? '').replace(/\D/g, '');
        return [r.partyName, `Q${r.quarter} FY${String(r.fy).slice(2)}`, `${r.due}${r.overdue ? ` · ${ptT('overdue')}` : ''}`, inr(r.tds),
          <span key="a">
            <button type="button" className={sm} onClick={() => printHtmlDocument(`<!doctype html><meta charset="utf-8"><pre style="font:14px/1.5 ${PRINT_FONT};white-space:pre-wrap">${esc(text)}</pre>`, (h) => downloadText('tds-chase.html', h, 'text/html'))} data-ps-b="chase-letter">{ptT('letter')}</button>
            <a className={sm} href={`https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">{ptT('whatsapp')}</a>
            <a className={sm} href={`mailto:${c?.email ?? ''}?subject=${encodeURIComponent(`TDS certificate Q${r.quarter}`)}&body=${encodeURIComponent(text)}`}>{ptT('email')}</a>
          </span>];
      })} />
    </section>
  );
}
