/** TR-B editor helpers shared by the summary strip and the bill modal (kept apart from the components for fast refresh). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { tbT } from '../../i18n/areas/trade-r8b';
import { getTable } from '../../lib/storage';
import { downloadText } from '../../lib/download';
import { chargeLine, headsFor, loadHeads, withCharges, type GoodsLine } from '../../lib/trade/tr-charges';
import { weighNet } from '../../lib/trade/tr-weight';
import type { LineWeight } from '../../types/trade-r8';
import { escHtml as esc } from '../../lib/html-esc';

/** Is `name` a stock item sold by weight / bags? */
export const weighItem = (name: string | undefined) => {
  const k = String(name ?? '').trim().toLowerCase();
  return !!k && getTable<{ name?: string; sold_by_weight_bags?: boolean }>('stock_items').some((s) => s?.sold_by_weight_bags && s.name?.trim().toLowerCase() === k);
};

type Made = ReturnType<typeof chargeLine>;
const sigOf = (lines: readonly GoodsLine[]) => JSON.stringify(lines.map((l) => (l.charge_head_id ? [l.charge_head_id, l.rate, l.hsn, l.tax_rate] : [l.quantity, l.rate, l.discount_percent, l.hsn, l.tax_rate, l.unit, l.wt?.packages])));

/** Charge heads of a side, which are on, and the recomputed lines (applied through `setLines` only when they differ). */
export function useChargeLines<L extends GoodsLine & { id?: string }>(lines: readonly L[], side: 'sale' | 'purchase', setLines: (next: L[]) => void, make: (c: Made, prev: L | undefined) => L, auto: boolean) {
  const heads = useMemo(() => headsFor(loadHeads(), side), [side]);
  const [on, setOn] = useState<Set<string>>(() => {
    const present = lines.filter((l) => l.charge_head_id).map((l) => l.charge_head_id as string);
    return new Set(present.length || !auto ? present : heads.filter((h) => h.auto).map((h) => h.id));
  });
  const sig = sigOf(lines);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false; // opening a saved document never rewrites its charges
      return;
    }
    const next = withCharges(lines, heads, on, make);
    if (sigOf(next) !== sig) setLines(next);
  }, [sig, on]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string) => setOn((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  return { heads, on, toggle };
}


/** Weight slip for the dispatch: weighed lines only, no prices. */
export function printWeightSlip(title: string, party: string, lines: readonly { name?: string; wt?: LineWeight }[]) {
  const rows = lines.filter((l) => l.wt).map((l) => {
    const w = weighNet(l.wt!);
    return `<tr><td>${esc(l.name)}</td><td>${esc(l.wt!.packages)} ${esc(l.wt!.kind)}</td><td>${w.gross}</td><td>${w.tare}</td><td>${w.ded}</td><td><b>${w.net}</b></td></tr>`;
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(tbT('slip'))}</title><style>body{font:13px sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid gray;padding:4px 6px;text-align:left}</style></head><body><h2>${esc(tbT('slip'))} — ${esc(title)}</h2><p>${esc(party)}</p><table><tr><th>Item</th><th>Packages</th><th>Gross kg</th><th>Tare kg</th><th>Dhalta kg</th><th>Net kg</th></tr>${rows.join('')}</table></body></html>`;
  const w = window.open('', '_blank'); // script-free HTML; blocked pop-ups get the file instead
  if (!w) return downloadText('weight-slip.html', html, 'text/html');
  w.document.write(html);
  w.document.close();
  w.print();
}

