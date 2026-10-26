/** R5-B4: RA register per BOQ (RA no., gross, cumulative, deductions, net, received, balance) + the abstract print. */
import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { raRegister, registerCsvRows } from '../../lib/works/measurements';
import { abstractCsvRows, abstractHtml, abstractRows } from '../../lib/works/ra-abstract';
import { localDb } from '../../lib/localDb';
import { peekTable } from '../../lib/storage';
import { B, csvDownload, fmtMoney, printHtml, today, type PanelProps } from '../transport/shared';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';

export function RaRegister({ boq, tick }: PanelProps & { boq: InvoiceRecord }) {
  const invoices = useMemo(() => localDb.invoices.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => raRegister(boq.id, invoices, peekTable<Payment>('transactions')), [boq.id, invoices]);
  const abstract = (id: string, kind: 'print' | 'csv') => {
    const bill = invoices.find((i) => i.id === id);
    if (!bill) return;
    const a = abstractRows(boq, bill, invoices);
    if (kind === 'csv') return csvDownload(`RA${bill.ra_no}-abstract.csv`, abstractCsvRows(a));
    printHtml(abstractHtml(boq, bill, a, localDb.settings.activeProfile()?.companyName ?? ''), `RA${bill.ra_no}-${bill.invoice_number}`);
  };
  if (!rows.length) return <p className={styles.note}>{twT('raEmpty')}</p>;
  return (
    <section className={styles.stack}>
      <div className={styles.toolbar}>
        <h4>{twT('raRegister')}</h4>
        <button type="button" className={B.os} onClick={() => csvDownload(`ra_register_${today()}.csv`, registerCsvRows(rows))}><Download size={14} aria-hidden="true" /> CSV</button>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-ra-register>
          <thead><tr><th>{twT('raNo')}</th><th>{twT('invoice')}</th><th>{twT('date')}</th><th className={surface.numeric}>{twT('gross')}</th><th className={surface.numeric}>{twT('cumGross')}</th><th className={surface.numeric}>{twT('deductions')}</th><th className={surface.numeric}>{twT('netPayable')}</th><th className={surface.numeric}>{twT('received')}</th><th className={surface.numeric}>{twT('balance')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.invoiceId} data-ra-row={r.raNo}>
                <td>{r.raNo}{r.final ? ` (${twT('final')})` : ''}</td><td className={surface.mono}>{r.number}</td><td>{r.date}</td>
                <td className={surface.numeric}>{fmtMoney(r.gross)}</td><td className={surface.numeric}>{fmtMoney(r.cumulative)}</td><td className={surface.numeric}>{fmtMoney(r.deductions)}</td>
                <td className={surface.numeric} data-ra-net>{fmtMoney(r.net)}</td><td className={surface.numeric}>{fmtMoney(r.received)}</td><td className={surface.numeric}>{fmtMoney(r.balance)}</td>
                <td className={surface.rowActions}>
                  <button type="button" className={B.gs} onClick={() => abstract(r.invoiceId, 'print')}>{twT('abstract')}</button>
                  <button type="button" className={B.gs} onClick={() => abstract(r.invoiceId, 'csv')}>CSV</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
