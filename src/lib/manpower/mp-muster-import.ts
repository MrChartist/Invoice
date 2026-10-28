/**
 * R17-B1 muster import (pure): a sheet already read into headers / rows (CSV through `csv.ts`, XLSX through the dynamic
 * `xlsx.ts`, in the view). Fixed template `employee_code, duties, ot_hours, post`, or a day-wise sheet: `employee_code`
 * plus one column a day holding P (1 duty), H / HD (half), DD (double), A / blank (none), and OT columns summed into
 * OT hours. Unknown codes are listed, never created; a post is matched by id or name, else the person's deployed post,
 * else the site's first post.
 */
import type { MusterRow } from '../../types/manpower-r17';
import type { Site } from './mp-sites';
import type { Staff } from './mp-muster';

export interface MusterImport { rows: MusterRow[]; unknown: string[] }

const key = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const DAYV: Record<string, number> = { p: 1, h: 0.5, hd: 0.5, dd: 2 };

export function mapMusterTable(t: { headers: readonly string[]; rows: readonly (readonly string[])[] }, site: Site, staff: readonly Staff[]): MusterImport {
  const hs = t.headers.map(key);
  const col = (...names: string[]) => hs.findIndex((h) => names.includes(h));
  const code = col('employee_code', 'code', 'emp_code', 'employee');
  if (code < 0) throw new Error('The sheet needs an employee_code column.');
  const duty = col('duties', 'duty');
  const ot = col('ot_hours', 'ot');
  const post = col('post');
  const days = hs.map((h, i) => (/^(d(ay)?_?)?([1-9]|[12]\d|3[01])$/.test(h) ? i : -1)).filter((i) => i >= 0);
  const ots = hs.map((h, i) => (i !== ot && /^ot_?\d+$/.test(h) ? i : -1)).filter((i) => i >= 0);
  if (duty < 0 && !days.length) throw new Error('The sheet needs a duties column or one column a day (P / A).');
  const out: MusterImport = { rows: [], unknown: [] };
  const posts = site.mp.posts;
  for (const r of t.rows) {
    const c = String(r[code] ?? '').trim();
    if (!c) continue;
    const e = staff.find((x) => x.code.trim().toLowerCase() === c.toLowerCase());
    if (!e) {
      out.unknown.push(c);
      continue;
    }
    const n = (v: unknown) => Number(String(v ?? '').replace(/,/g, '')) || 0;
    const duties = duty >= 0 ? n(r[duty]) : days.reduce((s, i) => s + (DAYV[String(r[i] ?? '').trim().toLowerCase()] ?? 0), 0);
    const otH = (ot >= 0 ? n(r[ot]) : 0) + ots.reduce((s, i) => s + n(r[i]), 0);
    const pv = post >= 0 ? String(r[post] ?? '').trim().toLowerCase() : '';
    const p = (pv && posts.find((x) => x.id === pv || x.name.trim().toLowerCase() === pv)) || posts.find((x) => x.id === e.mp?.post_id) || posts[0];
    out.rows.push({ employee_id: e.id, post_id: p?.id ?? '', duties: Math.round(duties * 2) / 2, ...(otH > 0 ? { ot_hours: Math.round(otH * 100) / 100 } : {}), ...(e.cost_centre_id !== site.id ? { relief: true } : {}) });
  }
  return out;
}
