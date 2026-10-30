/**
 * R17-A4 manpower paper (pure): the header rows (site code and name, service month), the post summary (≤ 12 rows) and
 * the regime sentence — from the document's `mp` snapshot only, so an issued invoice never changes. B–D add their
 * parts (duty annexure, TDS line, compliance refs, arrears) as their own files under `templates/parts/manpower/`.
 */
import type { MpPostRow, MpSnapshot } from '../../types/manpower-r17';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** `2026-10` → "Oct 2026". */
export const monthText = (m?: string): string => (m && /^\d{4}-\d{2}$/.test(m) ? `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}` : '');

export interface MpPaper { rows: [string, string][]; posts: MpPostRow[]; decl: string }

export function mpPaper(mp: MpSnapshot): MpPaper {
  const rows: [string, string][] = [];
  if (mp.site) rows.push(['Site', `${mp.site.code}: ${mp.site.name}`]);
  if (monthText(mp.month)) rows.push(['Service month', monthText(mp.month)]);
  return { rows, posts: (mp.posts ?? []).slice(0, 12), decl: mp.decl ?? '' };
}
