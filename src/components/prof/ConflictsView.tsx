/** PS-A2 Conflict checks: search names / PAN / GSTIN across clients, suppliers and matter parties; record the result. */
import { useMemo, useState } from 'react';
import type { ConflictCheck, ConflictHit } from '../../types/prof-r14';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { candidates, deleteCheck, loadChecks, saveCheck, searchConflicts } from '../../lib/prof/ps-conflicts';
import { loadMatters } from '../../lib/prof/ps-matters';
import { loadEngagements } from '../../lib/prof/ps-engagements';
import { can } from '../../lib/access';
import { todayInput } from '../../lib/utils';
import { pmT } from '../../i18n/areas/prof-r14a-matters';
import { r16bT } from '../../i18n/areas/prof-r16b';
import { psT } from '../../i18n/areas/prof-r14-common';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './ps-ui';
import { runWith, type PsDeskProps } from './ps-run';

export default function ConflictsView({ notify }: Pick<PsDeskProps, 'notify'>) {
  const run = runWith(notify);
  const [tick, setTick] = useState(0);
  const [text, setText] = useState('');
  const [hits, setHits] = useState<ConflictHit[] | null>(null);
  const [reason, setReason] = useState('');
  const [consent, setConsent] = useState('');
  const list = useMemo(() => candidates({ clients: localDb.clients.getAll().filter((c) => c.id), vendors: getTable('vendors'), matters: loadMatters(), engagements: loadEngagements() }), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const checks = useMemo(() => loadChecks().sort((a, b) => b.date.localeCompare(a.date)), [tick]);
  const terms = text.split('\n').map((t) => t.trim()).filter(Boolean);
  const record = (result: ConflictCheck['result']) => run(() => saveCheck({ date: todayInput(), terms, hits: hits ?? [], result, ...(reason.trim() ? { reason: reason.trim() } : {}), ...(consent.trim() ? { consent_note: consent.trim() } : {}) }), psT('saved')) && (setHits(null), setText(''), setReason(''), setConsent(''), setTick((x) => x + 1));
  return (
    <div className={surface.card}>
      <div className={surface.cardBody}>
        <Field label={pmT('terms')}><textarea className={controls.textarea} rows={3} value={text} onChange={(e) => { setText(e.target.value); setHits(null); }} data-conflict-terms /></Field>
        <button type="button" className={controls.btnPrimary} disabled={!terms.length} onClick={() => setHits(searchConflicts(terms, list))} data-conflict-search>{pmT('search')}</button>
        {hits && (
          <>
            <p className={controls.hint} data-conflict-hits={hits.length}>{hits.length ? pmT('hits', { n: hits.length }) : pmT('noHits')}</p>
            {hits.length > 0 && (
              <div className={surface.tableWrap}>
                <table className={surface.table}>
                  <tbody>{hits.map((h, i) => <tr key={i}><td>{h.name}</td><td>{h.source}</td><td>{h.matter_code ?? ''}</td><td>{h.role ? pmT(`r.${h.role}` as 'r.client') : ''}</td><td className={surface.numeric}>{Math.round(h.score * 100)}%</td></tr>)}</tbody>
                </table>
              </div>
            )}
            <div className={controls.row3}>
              <Field label={psT('reason')}><input className={controls.input} value={reason} onChange={(e) => setReason(e.target.value)} data-conflict-reason /></Field>
              <Field label={pmT('consent')}><input className={controls.input} value={consent} onChange={(e) => setConsent(e.target.value)} /></Field>
            </div>
            <div className={controls.row}>
              <button type="button" className={controls.btnOutline} onClick={() => record('clear')} data-conflict-clear>{pmT('clear')}</button>
              <button type="button" className={controls.btnOutline} onClick={() => record('conflict')}>{pmT('conflict')}</button>
              {can('settings.manage') && <button type="button" className={controls.btnOutline} onClick={() => record('waived')} data-conflict-waive>{pmT('waive')}</button>}
            </div>
          </>
        )}
        <p className={controls.hint}>{pmT('rule')}</p>
        <div className={surface.tableWrap}>
          <table className={surface.table} data-conflict-checks>
            <thead><tr><th>{psT('date')}</th><th>{pmT('terms')}</th><th>{psT('status')}</th><th>{psT('reason')}</th><th /></tr></thead>
            <tbody>{checks.map((c) => <tr key={c.id}><td>{c.date}</td><td>{c.terms.join(', ')}</td><td>{pmT(`res.${c.result}`)}</td><td>{[c.reason, c.consent_note].filter(Boolean).join(' · ')}</td><td>{can('master.edit') && <button type="button" className={controls.btnOutline} onClick={() => window.confirm(r16bT('delAsk', { name: c.terms.join(', ') })) && run(() => (deleteCheck(c.id), true), r16bT('deleted')) && setTick((x) => x + 1)} data-conflict-del>{r16bT('del')}</button>}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
