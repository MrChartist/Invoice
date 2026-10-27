/**
 * R14 PS-C2 card on GST → Compliance (pack `svcexport` only, lazy): EDF due in 30 days or past due, services realisation
 * due in 30 days, and past due (ask the AD bank for an extension — Reg 5(1) second proviso). Reminders only.
 */
import { localDb } from '../../lib/localDb';
import { liveRegister } from '../../lib/trade/export-register';
import { edfDb, edfDueList } from '../../lib/prof/ps-edf';
import { realisationReminders, servicesRows } from '../../lib/prof/ps-fema';
import { useT } from '../../i18n';
import { pcT } from '../../i18n/areas/prof-r14c-export';
import surface from '../../styles/surface.module.css';

export default function ExportSvcCalendar({ today }: { today: string }) {
  useT();
  const rows = [
    ...edfDueList(edfDb.all(), today).map((r) => [`${pcT('cal.edf')} — ${r.period} ${pcT(`k.${r.kind}`)} ${r.currency}`, r.due]),
    ...realisationReminders(servicesRows(liveRegister(today), localDb.invoices.getAll(), today)).map(({ kind, row }) => [`${pcT(kind === 'past' ? 'cal.past' : 'cal.soon')} — ${row.number}`, row.dueDate]),
  ];
  if (!rows.length) return null;
  return (
    <section className={surface.card} data-ps-calendar>
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}>{pcT('v.edf')} · {pcT('v.realisation')}</span></div>
      <ul className={surface.cardBody}>{rows.map(([l, d], i) => <li key={i} data-ps-cal>{l}: {d}</li>)}</ul>
    </section>
  );
}
