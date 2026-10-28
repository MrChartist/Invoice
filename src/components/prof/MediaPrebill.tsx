/**
 * R16-B2: the "Media" rows of the pre-bill (lazy; `media` pack): the client's unbilled media bills by medium, each billed
 * as principal (cost + fee) or pure agent (Rule 33 recovery + fee) through `mediaLines`; the snapshot goes into `ps.media`.
 * A publisher's commission is our service to the publisher, so it becomes its own draft (PS12). Working paper — verify
 * with your CA.
 */
import { useEffect, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { r16bT } from '../../i18n/areas/prof-r16b';
import { psbT } from '../../i18n/areas/prof-r14b';
import { purchasesDb } from '../../lib/purchases';
import { currentLiveInvoiceIds, readTimePrefs } from '../../lib/timesheets';
import { byMedium, mediaLines, mediaSnap, mediaTds, unbilledMedia } from '../../lib/prof/ps-media';
import type { createCommissionDraft, PrebillInput } from '../../lib/prof/ps-prebill';
import { sectionText } from '../../lib/ita2025';
import { formatCurrency, todayInput } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './ps-ui';
import { runWith, type Notify } from './ps-run';

/** `bill` is `createCommissionDraft`, passed in so the pre-bill engine stays in the WIP desk chunk. */
export default function MediaPrebill({ client, onChange, notify, bill }: { client: string; onChange: (x: PrebillInput['extra']) => void; notify: Notify; bill: typeof createCommissionDraft }) {
  useT();
  const run = runWith(notify);
  const prefs = useMemo(() => readTimePrefs(), []);
  const rows = useMemo(() => {
    const live = currentLiveInvoiceIds();
    return unbilledMedia(purchasesDb.all(), client, (id) => !!live.byRow.get(id)?.length);
  }, [client]);
  const [pick, setPick] = useState<ReadonlySet<string>>(() => new Set(rows.map((r) => r.id)));
  const [fee, setFee] = useState(0);
  const [c, setC] = useState({ pub: '', gross: 0, pct: 15 });
  useEffect(() => {
    const sel = rows.filter((r) => pick.has(r.id));
    onChange(sel.length ? { lines: mediaLines(sel, { fee_pct: fee, sac: prefs.sac, gst_rate: prefs.gst_rate }), media: mediaSnap(sel) } : undefined);
  }, [rows, pick, fee, prefs, onChange]);
  const today = todayInput();
  const toggle = (id: string, on: boolean) => setPick((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  return (
    <fieldset className={controls.row} data-prebill-media>
      <legend className={controls.label}>{r16bT('media')}</legend>
      {rows.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <tbody>
              {byMedium(rows).map((g) => [
                <tr key={g.medium}><th colSpan={4}>{psbT(`m.${g.medium}`)}</th><th className={surface.numeric}>{formatCurrency(g.cost)}</th></tr>,
                ...g.rows.map((r) => (
                  <tr key={r.id}>
                    <td><input type="checkbox" aria-label={r.ref} checked={pick.has(r.id)} onChange={(e) => toggle(r.id, e.target.checked)} data-prebill-media-row /></td>
                    <td>{r.date}</td><td>{r.media.publication || r.vendor}{r.media.ro ? ` · RO ${r.media.ro}` : ''}</td><td>{psbT(`mode.${r.media.mode}`)}</td>
                    <td className={surface.numeric}>{formatCurrency(r.media.mode === 'agent' ? r.total : r.cost)}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 0 && <Field label={r16bT('fee')}><input type="number" min={0} step="0.01" className={controls.input} value={fee || ''} onChange={(e) => setFee(Number(e.target.value) || 0)} data-prebill-media-fee /></Field>}
      {rows.length > 0 && <p className={controls.hint}>{r16bT('tds', { s: sectionText(mediaTds(today).section, today) })}</p>}
      <p className={controls.hint}>{r16bT('comm')}</p>
      <Field label={r16bT('pub')}><input className={controls.input} value={c.pub} onChange={(e) => setC({ ...c, pub: e.target.value })} /></Field>
      <Field label={r16bT('gross')}><input type="number" min={0} className={controls.input} value={c.gross || ''} onChange={(e) => setC({ ...c, gross: Number(e.target.value) || 0 })} /></Field>
      <Field label={psbT('commission')}><input type="number" min={0} step="0.01" className={controls.input} value={c.pct} onChange={(e) => setC({ ...c, pct: Number(e.target.value) || 0 })} /></Field>
      <button type="button" className={controls.btnOutline} onClick={() => { const d = run(() => bill(c.pub, c.gross, c.pct, prefs)); if (d) notify(r16bT('commDone', { n: d.invoice_number })); }}>{r16bT('billComm')}</button>
    </fieldset>
  );
}
