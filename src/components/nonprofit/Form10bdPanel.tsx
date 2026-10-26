/** R5-C3 Form 10BD (Form 113 from FY 2026-27) working file, "mark filed", and Form 10BE (114) tracking. */
import { useMemo, useState } from 'react';
import { localDb } from '../../lib/localDb';
import { parseTable } from '../../lib/csv';
import { loadDonations } from '../../lib/nonprofit/donations';
import { build10bd, due10bd, filingFor, form10bdCsv, load10be, markFiled, markSent, parse10beCsv, pending10be, save10be } from '../../lib/nonprofit/form-10bd';
import { formText } from '../../lib/ita2025';
import { ita25Words } from '../../i18n/areas/ita2025';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from '../institutions/institutions.module.css';
import { B, F, S, T, Tbl } from '../institutions/Views';
import { attempt, csv, fyNow, rs, today, type Notify } from '../institutions/ui';

export function Form10bdPanel({ notify, tick, refresh }: { notify: Notify; tick: number; refresh: () => void }) {
  const [fy, setFy] = useState(fyNow() - 1);
  const [f, setF] = useState({ arn: '', on: today() });
  const clients = useMemo(() => localDb.clients.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const donors = useMemo(() => new Map(clients.map((c) => [c.id!, c])), [clients]);
  const res = useMemo(() => build10bd(loadDonations(), donors, fy), [donors, fy]);
  const filing = useMemo(() => filingFor(fy), [fy, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const be = useMemo(() => load10be().filter((r) => r.fy === fy), [fy, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = pending10be(filing, be);
  const due = due10bd(fy);
  const [bd, beName] = (['10BD', '10BE'] as const).map((x) => formText(x, `${fy}-04-01`, ita25Words()));
  const rows = filing?.rows_snapshot ?? res.rows;
  const run = (fn: () => void) => attempt(notify, () => { fn(); refresh(); }, iT('saved'));
  return (
    <div className={styles.stack} data-10bd-panel>
      <div className={styles.toolbar}>
        <S l="FY" v={fy} o={[0, 1, 2, 3].map((k) => [fyNow() - k, `${fyNow() - k}-${String(fyNow() - k + 1).slice(2)}`] as const)} on={(v) => setFy(+v)} />
        <B p d="10bd-csv" l={`${bd} CSV`} on={() => csv(`form-10bd-FY${fy}.csv`, form10bdCsv(rows, fy, localDb.settings.activeProfile()?.npo))} />
      </div>
      <p className={styles.note}>{iT('bdNote', { form: bd, date: due.bd, fee: due.lateFeePerDay })}</p>
      <Tbl d="10bd-rows" h={['#', iT('donor'), iT('idNo'), iT('section'), iT('type'), iT('mode'), iT('amount')]} rows={rows.map((r) => [r.sr, r.name, r.id_no, r.section, r.type, r.mode, rs(r.amount)])} />
      {!filing && res.left.map(({ d, why }) => <p key={d.id} className={styles.warn}>{d.number} · {rs(d.amount)} — {iT(`why.${why}`)}</p>)}
      {filing?.filed_on ? <p>{iT('filed', { form: bd, arn: filing.arn ?? '', date: filing.filed_on })}</p> : (
        <div className={styles.toolbar}>
          <T l="ARN" v={f.arn} on={(arn) => setF({ ...f, arn })} />
          <T l={iT('date')} t="date" v={f.on} on={(on) => setF({ ...f, on })} />
          <B l={iT('markFiled')} dis={!rows.length} on={() => run(() => markFiled(fy, f.arn, f.on, res.rows))} />
        </div>
      )}
      {filing?.filed_on && (<>
        <h3>{beName}</h3>
        <div className={styles.toolbar}>
          <F l={iT('importCsv')} on={async (file) => { const t = parseTable(await file.text()); const p = parse10beCsv(t.headers, t.rows, clients); run(() => { save10be(fy, p.items); notify(iT('nDone', { n: p.items.length })); }); }} />
          <B l={iT('markSent')} dis={!pending.length} on={() => run(() => markSent(fy, pending, today()))} />
          <B l={iT('copy')} on={() => void navigator.clipboard?.writeText(pending.map((id) => iT('beText', { name: donors.get(id)?.name ?? '', form: beName })).join('\n\n'))} />
        </div>
        {[...new Set(rows.map((r) => r.donor_id))].map((id) => {
          const r = be.find((x) => x.donor_id === id);
          return (
            <div key={id} className={styles.toolbar}>
              <span>{donors.get(id)?.name} · {r?.sent_on ?? '—'}</span>
              <T l={iT('certNo')} v={r?.cert_no} on={(cert_no) => attempt(notify, () => { save10be(fy, [{ donor_id: id, cert_no }]); refresh(); })} />
            </div>
          );
        })}
      </>)}
    </div>
  );
}
