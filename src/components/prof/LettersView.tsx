/** PS-A2 Letters: each engagement's letter (a quotation with proposal sections) and its acceptance; make one in a click. */
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { localDb } from '../../lib/localDb';
import { loadEngagements, syncAcceptances } from '../../lib/prof/ps-engagements';
import { makeLetter } from '../../lib/prof/ps-letters';
import { formatDate } from '../../lib/utils';
import { pmT } from '../../i18n/areas/prof-r14a-matters';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { runWith, type PsDeskProps } from './ps-run';

export default function LettersView({ notify }: Pick<PsDeskProps, 'notify'>) {
  const run = runWith(notify);
  const go = useNavigate();
  const list = useMemo(() => { syncAcceptances(localDb.invoices.getAll()); return loadEngagements(); }, []);
  return (
    <div className={surface.card}>
      <div className={surface.cardBody}>
        <div className={surface.tableWrap}>
          <table className={surface.table} data-letters>
            <thead><tr><th>{psT('engagement')}</th><th>{psT('client')}</th><th>{pmT('quote')}</th><th>{psT('status')}</th><th>{pmT('accepted')}</th></tr></thead>
            <tbody>
              {list.map((e) => {
                const q = e.letter_quote_id ? localDb.invoices.getById(e.letter_quote_id) : undefined;
                return (
                  <tr key={e.id}>
                    <td>{e.number} · {e.title}</td>
                    <td>{localDb.clients.getById(e.client_id)?.name ?? ''}</td>
                    <td>{q ? <Link to={`/invoice/${q.id}`}>{q.invoice_number || pmT('quote')}</Link> : <button type="button" className={controls.btnGhost} onClick={() => { const d = run(() => makeLetter(e.id)); if (d) go(`/invoice/${d.id}`); }}>{pmT('letter')}</button>}</td>
                    <td>{psT(`s.${e.status}`)}</td>
                    <td>{e.accepted_at ? formatDate(e.accepted_at) : q ? '' : pmT('noLetter')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
