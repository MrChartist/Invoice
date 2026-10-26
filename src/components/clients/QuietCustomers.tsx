import { useMemo, useState } from 'react';
import { Download, MessageCircle, Users } from 'lucide-react';
import type { Client } from '../../types/invoice';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import {
  exclude, lastNudges, loadQuietSettings, logNudge, quietCustomers, quietRowsToCsv, saveQuietSettings, snooze, type QuietRow, type QuietSettings,
} from '../../lib/quiet-customers';
import { buildNudge, messageLangOf } from '../../lib/message-langs';
import { whatsappLink } from '../../lib/share';
import { downloadText, toCsv } from '../../lib/download';
import { can } from '../../lib/access';
import { cn, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { svcT } from '../../i18n/areas/service-r3';

type Notify = (message: string, tone?: 'success' | 'error') => void;

/** R3-B7 report "Customers gone quiet": last bill, usual gap, days quiet, 12-month sales, top items; nudge / snooze / exclude. */
export default function QuietCustomers({ clients, notify }: { clients: Client[]; notify: Notify }) {
  useT();
  const editable = can('master.edit');
  const [settings, setSettings] = useState<QuietSettings>(() => loadQuietSettings());
  const [version, setVersion] = useState(0);
  const today = todayInput();
  const rows = useMemo(() => quietCustomers(localDb.invoices.getAll(), clients, settings, today), [clients, settings, today]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nudges = useMemo(() => lastNudges(getTable('reminders')), [version]);
  const sender = useMemo(() => localDb.settings.activeProfile(), []);

  const update = (next: QuietSettings, msg?: string) => {
    try {
      saveQuietSettings(next);
      setSettings(next);
      if (msg) notify(msg);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const nudgeHref = (r: QuietRow) => {
    const text = buildNudge(messageLangOf(r.client), { client: r.name, business: sender?.companyName ?? '', items: r.top_items, phone: sender?.companyPhone });
    return whatsappLink(r.client?.phone, text);
  };

  const exportCsv = () => downloadText(`customers-gone-quiet-${today}.csv`, '﻿' + toCsv(quietRowsToCsv(rows)), 'text/csv');

  return (
    <section className={surface.card} aria-label={svcT('quietTitle')} data-quiet-customers>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><Users size={16} /> {svcT('quietTitle')} · {rows.length}</span>
        <div className={surface.rowActions}>
          <label className={controls.field} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <span className={controls.label}>{svcT('threshold')}</span>
            <input type="number" min={1} max={365} className={controls.input} style={{ width: '5rem' }} defaultValue={settings.threshold_days} disabled={!editable}
              onBlur={(e) => { const n = Math.round(Number(e.target.value)); if (n > 0 && n !== settings.threshold_days) update({ ...settings, threshold_days: n }); }} aria-label={svcT('threshold')} />
          </label>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={!rows.length} onClick={exportCsv}><Download size={14} /> {svcT('exportCsv')}</button>
        </div>
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote}>{svcT('quietIntro', { days: settings.threshold_days })}</p>
        {!rows.length ? (
          <p className={surface.sectionNote}>{svcT('quietNone')}</p>
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead>
                <tr>
                  <th>{svcT('client')}</th><th>{svcT('lastBill')}</th><th className={surface.numeric}>{svcT('usualGap')}</th><th className={surface.numeric}>{svcT('daysQuiet')}</th>
                  <th className={surface.numeric}>{svcT('sales12')}</th><th>{svcT('topItems')}</th><th><span className={surface.srOnly}>{svcT('nudge')}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const nudged = nudges.get(r.key);
                  return (
                    <tr key={r.key} data-quiet-row={r.name}>
                      <td>{r.name}</td>
                      <td>{formatDate(r.last_date)}{r.last_number ? ` · ${r.last_number}` : ''}</td>
                      <td className={surface.numeric}>{svcT('nDays', { n: Math.round(r.median_gap) })}</td>
                      <td className={surface.numeric}><strong>{svcT('nDays', { n: r.days_quiet })}</strong></td>
                      <td className={surface.numeric}>{formatCurrency(r.sales_12m, 'INR')} · {r.count_12m}</td>
                      <td>{r.top_items.join(', ') || '–'}{nudged ? <div className={surface.statHint}>{svcT('nudged', { date: formatDate(nudged.slice(0, 10)) })}</div> : null}</td>
                      <td className={surface.rowActions}>
                        {r.client?.phone ? (
                          <a href={nudgeHref(r)} target="_blank" rel="noopener noreferrer" className={controls.btnIcon} aria-label={svcT('nudgeFor', { name: r.name })} title={svcT('nudge')}
                            onClick={() => { try { logNudge(r.key); setVersion((v) => v + 1); } catch { /* the link still opens */ } }} data-quiet-nudge>
                            <MessageCircle size={16} />
                          </a>
                        ) : (
                          <span className={surface.statHint} title={svcT('noPhone')}>—</span>
                        )}
                        {editable && (
                          <>
                            <select className={controls.select} value="" aria-label={`${svcT('snooze')} ${r.name}`}
                              onChange={(e) => { const d = Number(e.target.value); if (d) { const next = snooze(settings, r.key, d, today); update(next, svcT('snoozed', { name: r.name, date: formatDate(next.snoozed[r.key]) })); } }}>
                              <option value="">{svcT('snooze')}</option>
                              <option value="30">{svcT('snooze30')}</option>
                              <option value="60">{svcT('snooze60')}</option>
                              <option value="90">{svcT('snooze90')}</option>
                            </select>
                            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => update(exclude(settings, r.key), svcT('excluded', { name: r.name }))}>{svcT('notRegular')}</button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
