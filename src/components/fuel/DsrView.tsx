/**
 * R21-B4 daily sales register: the day's closed / posted shifts in the OMC layout (nozzle readings, products, collections,
 * credit sales, short / excess), printed A4 landscape in a script-free window (`escHtml`; a blocked pop-up saves the
 * file) (the CSV export was cut at the R21-B cap, PRD §11 cut 1). Working papers — verify with your CA (FU19).
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { fuT } from '../../i18n/areas/fuel-r21a';
import { fbT } from '../../i18n/areas/fuel-r21b';
import { localDayOf } from '../../lib/dates';
import { stockDb } from '../../lib/inventory';
import { escHtml } from '../../lib/html-esc';
import { downloadText } from '../../lib/download';
import { buildDsr, type Cell } from '../../lib/fuel/fu-dsr';
import { readShifts } from '../../lib/fuel/fu-dayclose';
import { fuData } from '../../lib/fuel/fu-issue-io';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { In, Row } from './fu-ui';

export default function DsrView() {
  useT();
  const [d, set] = useState<Record<string, string>>({ day: localDayOf(new Date()) });
  const items = stockDb.items();
  const r = buildDsr(d.day, readShifts(), { ...fuData(), names: (id) => items.find((i) => i.id === id)?.name ?? id });
  const mode = (m: Cell) => fbT(`m.${m}` as 'm.cash');
  const parts: [string, string[], Cell[][]][] = [
    [fuT('nozzle'), [fuT('shift'), fuT('nozzle'), fuT('product'), fbT('opening'), fbT('closing'), fuT('test'), fbT('sold'), fbT('rate'), fbT('value')], r.nozzles],
    [fbT('products'), [fuT('product'), fuT('litres'), fbT('rate'), fbT('value')], r.products],
    [fbT('collections'), ['', '₹'], r.modes.map(([m, v]) => [mode(m), v])],
    [fbT('people'), [fuT('shift'), fuT('attendant'), fbT('expected'), fbT('collected'), fbT('diff')], r.people],
  ];
  const head = `${fbT('title')}: ${d.day}`;
  const print = () => {
    const tbl = parts.map(([t, h, rows]) => `<h3>${escHtml(t)}</h3><table><tr>${h.map((x) => `<th>${escHtml(x)}</th>`).join('')}</tr>${rows.map((row) => `<tr>${row.map((c) => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escHtml(head)}</title><style>@page{size:A4 landscape;margin:10mm}body{font:12px sans-serif}table{border-collapse:collapse;width:100%}td,th{border:1px solid gray;padding:3px 5px;text-align:left}</style></head><body><h2>${escHtml(head)}</h2>${tbl}<p>${escHtml(fbT('credit', { v: r.credit }))}</p><p>${escHtml(fuT('wp'))}</p></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return downloadText(`dsr-${d.day}.html`, html, 'text/html');
    w.document.write(html);
    w.document.close();
    w.print();
  };
  return (
    <div data-fuel-dsr>
      <Row>
        <In d={d} set={set} k="day" label={fuT('date')} type="date" />
        <button type="button" className={controls.btnPrimary} onClick={print} data-fu-dsr-print>{fbT('print')}</button>
      </Row>
      {r.errors.map((e) => <p key={e} className={controls.error}>{e}</p>)}
      {!r.nozzles.length && <p className={controls.hint}>{fbT('noShifts')}</p>}
      {parts.filter(([, , rows]) => rows.length).map(([t, h, rows]) => (
        <div key={t} className={surface.tableWrap}>
          <h3>{t}</h3>
          <table className={surface.table} data-fu-dsr-table>
            <thead><tr>{h.map((x, i) => <th key={i}>{x}</th>)}</tr></thead>
            <tbody>{rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ))}
      {r.credit > 0 && <p className={controls.hint}>{fbT('credit', { v: r.credit })}</p>}
    </div>
  );
}
