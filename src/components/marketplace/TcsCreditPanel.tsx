/**
 * R5-A5: GST TCS (Sec 52) / GST TDS (Sec 51) credit — books expected, withheld per settlements, the portal's
 * "TDS and TCS credit received" rows (pasted), differences with a reason, and accept / reject per row. 194-O from
 * settlements with an estimate at the 194-O rate. Default export so R5-B can mount it lazily with `kind="tds"`.
 */
import { useMemo, useState } from 'react';
import { Download, Percent } from 'lucide-react';
import { useT } from '../../i18n';
import { mT } from '../../i18n/areas/packs-marketplace-r5';
import { WORKING_PAPER, acceptCredit, creditRows, estimated194o, expectedGstTds, expectedTcs, loadEcoCredits, parsePortalRows, rejectCredit, savePortalRows, undoDecision, withheldTcs, type CreditKind } from '../../lib/marketplace/tcs-credit';
import { loadChannels } from '../../lib/marketplace/channels';
import { loadSettlements } from '../../lib/marketplace/settlement-import';
import { localDb } from '../../lib/localDb';
import { peekTable } from '../../lib/storage';
import { toCsv } from '../../lib/csv';
import { sectionText } from '../../lib/ita2025';
import { senderStateCode } from '../../store/invoice-defaults';
import type { InvoiceRecord } from '../../types/invoice';
import { downloadTextFile } from '../receivables/exportUtils';
import { errText, fmtMoney, today, type Notify } from './file-read';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './marketplace.module.css';

const heads = (h: { igst: number; cgst: number; sgst: number }) => `${fmtMoney(h.igst)} / ${fmtMoney(h.cgst)} / ${fmtMoney(h.sgst)}`;

export default function TcsCreditPanel({ kind = 'tcs', notify }: { kind?: CreditKind; notify: Notify }) {
  useT();
  const [tick, setTick] = useState(0);
  const [paste, setPaste] = useState('');
  const settlements = useMemo(() => (kind === 'tcs' ? loadSettlements() : []), [kind, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => {
    const invoices = peekTable<InvoiceRecord>('invoices');
    const expected = kind === 'tcs' ? expectedTcs(invoices) : expectedGstTds(invoices);
    const withheld = kind === 'tcs' ? withheldTcs(loadChannels(), settlements, senderStateCode(localDb.settings.activeProfile())) : new Map<string, number>();
    return creditRows(kind, expected, withheld, loadEcoCredits(kind));
  }, [kind, settlements, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = (fn: () => unknown) => {
    try {
      fn();
      setTick((n) => n + 1);
      notify(mT('done'));
    } catch (err) {
      notify(errText(err), 'error');
    }
  };
  const addPaste = () => act(() => {
    const { rows: parsed } = parsePortalRows(paste, kind);
    const r = savePortalRows(parsed);
    setPaste('');
    notify(mT('crPasted', { n: r.added, kept: r.kept }));
  });
  const csv = () => downloadTextFile(`gst_${kind}_credit_${today()}.csv`, toCsv([
    [WORKING_PAPER],
    ['GSTIN', 'Month', 'Books IGST', 'Books CGST', 'Books SGST', 'Withheld', 'Portal IGST', 'Portal CGST', 'Portal SGST', 'Reason', 'Decision'],
    ...rows.map((r) => [r.gstin, r.month, r.books.igst, r.books.cgst, r.books.sgst, r.withheld, r.portal?.igst ?? '', r.portal?.cgst ?? '', r.portal?.sgst ?? '', mT(`reason.${r.reason}`), r.portal?.decision ?? '']),
  ]));

  return (
    <div className={styles.stack}>
      <h3 className={surface.cardHead}><Percent size={16} aria-hidden="true" /> {kind === 'tcs' ? mT('crKindTcs') : mT('crKindTds')}</h3>
      <p className={styles.note}>{WORKING_PAPER}</p>
      {rows.length === 0 ? <p className={styles.note}>{mT('crEmpty')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{mT('crGstin')}</th><th>{mT('crMonth')}</th><th className={surface.numeric}>{mT('crBooks')}</th>{kind === 'tcs' && <th className={surface.numeric}>{mT('crWithheld')}</th>}<th className={surface.numeric}>{mT('crPortal')}</th><th>{mT('crDiff')}</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className={surface.mono}>{r.gstin}</td>
                  <td>{r.month}</td>
                  <td className={surface.numeric}>{heads(r.books)}</td>
                  {kind === 'tcs' && <td className={surface.numeric}>{fmtMoney(r.withheld)}</td>}
                  <td className={surface.numeric}>{r.portal ? heads(r.portal) : '—'}</td>
                  <td className={r.reason === 'ok' ? styles.good : styles.bad}>{mT(`reason.${r.reason}`)}</td>
                  <td className={surface.rowActions}>
                    {r.portal && !r.portal.decision && (
                      <>
                        <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={() => act(() => acceptCredit(r.portal!.id))}>{mT('crAccept')}</button>
                        <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => act(() => rejectCredit(r.portal!.id, today()))}>{mT('crReject')}</button>
                      </>
                    )}
                    {r.portal?.decision && (
                      <>
                        <span>{r.portal.decision === 'accepted' ? mT('crAccepted') : mT('crRejected')} {r.portal.decided_on}</span>{' '}
                        <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => act(() => undoDecision(r.portal!.id))}>{mT('crUndo')}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <label className={controls.field}><span className={controls.label}>{mT('crPaste')}</span>
        <textarea className={`${controls.textarea} ${styles.textarea}`} value={paste} onChange={(e) => setPaste(e.target.value)} /></label>
      <div className={styles.toolbar}>
        <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={addPaste} disabled={!paste.trim()}>{mT('crPasteAdd')}</button>
        <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={csv}><Download size={16} aria-hidden="true" /> {mT('exportCsv')}</button>
      </div>
      {kind === 'tcs' && settlements.some((s) => s.lines.some((l) => l.bucket === 'tds_194o')) && (
        <section>
          <h4>{mT('cr194o')}</h4>
          <ul className={styles.list}>
            {settlements.filter((s) => s.lines.some((l) => l.bucket === 'tds_194o')).map((s) => (
              <li key={s.id}>{s.settlement_id} · {s.deposit_date} · {sectionText('194O', s.deposit_date)}: {fmtMoney(-s.lines.filter((l) => l.bucket === 'tds_194o').reduce((a, l) => a + l.amount, 0))} · {mT('cr194oEst')} {fmtMoney(estimated194o(s))}</li>
            ))}
          </ul>
          <p className={styles.note}>{mT('cr194oNote')}</p>
        </section>
      )}
    </div>
  );
}
