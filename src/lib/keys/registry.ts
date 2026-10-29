/**
 * R20-A2: the ONE key registry — every key row of Round 20 (packages A–D), from docs/prd/round-20-shortcuts.md.
 * Rows are data; handlers live on the screens (`useKeyActions(scope, { [rowId]: fn })`, see `engine.ts`). B / C / D
 * never add or change rows (that goes through the lead): each adds its letter to `BUILT` when it merges, and rows of a
 * package not in `BUILT` never show (cheat sheet, Key bar) and never fire. Labels live in `src/i18n/areas/keys-r20a.ts`
 * under the row's `plain` / `tally` keys (both languages). Notes: docs/features/tally-keys.md.
 */
import type { AccessAction } from '../access';
import { parseCombo } from '../../hooks/useHotkeys';
import type { KeyLike, KeysLayout } from './stub';
import { keysT, type KeysKey } from '../../i18n/areas/keys-r20a';

export { NEVER_CLAIM, type NeverClaim } from './never-claim';

/** The package whose merge makes a row live; `have` = existed before Round 20 (always live). */
export type KeyPkg = 'have' | 'A' | 'B' | 'C' | 'D';
/** Packages merged so far. B / C / D: add your letter here (one line) in your merge. */
export const BUILT: ReadonlySet<KeyPkg> = new Set<KeyPkg>(['have', 'A', 'D']);

/**
 * Where a key works, most specific first: a field (`field:*`, the focused element sits inside
 * `[data-key-field="<name>"]`), a row (`reportRow`, `list`, `line`), a screen (`voucher`, `editor`, `bill`, `master`,
 * `report`, `gateway`), else `global`.
 */
export type KeyScope =
  | 'global' | 'gateway' | 'voucher' | 'editor' | 'bill' | 'master' | 'report'
  | 'reportRow' | 'list' | 'line'
  | 'field:narration' | 'field:picker' | 'field:amount';

export type KeyGroup = 'goto' | 'vouchers' | 'entry' | 'reports' | 'company' | 'app';

export interface KeyRow {
  /** Unique; screens register handlers under it. */
  id: string;
  /** Combo per layout (`mod+f8`, `alt+g`, `g d` for a sequence). `erp9` absent = same as prime; '' = no key in that layout. */
  combo: { prime: string; erp9?: string };
  scope: KeyScope;
  /** `always` works in the simple default; `tally` only with Tally keys on (and on /gateway when `gw`). */
  mode: 'always' | 'tally';
  gw?: true;
  /** Label keys (keys-r20a): the plain name (the id up to its first dot), and the Tally name (`t_<plain>` when the
   * area has it, else as given). */
  plain: KeysKey;
  tally?: KeysKey;
  /** The visible twin (U1): `keybar`, `sheet:vouchers`, `btn:<what>`, `palette:<action>`, `menu:<letter>`. */
  twin: string;
  need?: AccessAction;
  pkg: KeyPkg;
  group: KeyGroup;
  /** Global rows: where the key goes when no screen handles it. */
  route?: string;
  /** Opens the Gateway with this dialog / box. */
  go?: 'date' | 'period' | 'goto';
  /** A different route on one screen (Debit note on /expenses = the purchase-return debit note). */
  on?: { path: string; route: string; need?: AccessAction };
  /** `unsafe:<browser>` (chromium / firefox / safari): never claimed there; the twin is shown instead. */
  browser?: 'safe' | 'claim-tally-only' | `unsafe:${string}`;
  /** Handled by an existing listener outside the engine (useHotkeys, the editor, the Gateway, Books toolbars). */
  ext?: true;
  /** Fires while typing in a field (the scope's own forms). Ctrl+Alt rows never do (AltGr). */
  inField?: true;
  /** Left off the Key bar (Enter, arrows …). */
  bar?: false;
  /** Letter in the F10 vouchers sheet. */
  letter?: string;
}

/**
 * The rows, one per line (compact so the whole round's map stays small): `id combo scope pkg [flags] [k:value]`.
 * `# <group> <default twin>` starts a section. Combo: `_` = a space (sequences); pkg `h` = have. Flags: `a` mode
 * always (else tally), `g` gw, `x` ext, `f` inField, `-` bar false. Values: `t:` Tally label key (default `t_<plain>`
 * when the area has it), `w:` twin, `e:` erp9 combo (`e:` alone = none), `r:` route, `o:` go, `n:` need,
 * `p:<path>,<route>,<need>` on, `l:` letter, `u:` browser. Parsed once into `KEY_ROWS` (the API is the `KeyRow` shape).
 * Changing a row is a lead change (docs/features/tally-keys.md).
 */
const DEF = `
# app keybar
palette mod+k global h a x w:btn:search
search / global h a x w:btn:search
keys ? global h a x w:btn:shortcuts
keys.ctrl mod+/ global h a x - w:btn:shortcuts
help f1 global h a x w:btn:help
back escape global h a x
save mod+s editor h a x f t:t_accept w:btn:save
save.enter mod+enter editor h a x f - w:btn:save
print mod+p editor h a x f w:btn:preview
pos alt+p global h a x f - w:nav:pos
repeat alt+r editor h a x w:btn:repeat
undo alt+z global h a x - w:toast:undo
goDash g_d global h a x - w:nav:dashboard
goNew g_i global h a x - w:nav:invoice
goInv g_t global h a x - w:nav:transactions
goCli g_c global h a x - w:nav:clients
goSet g_s global h a x - w:nav:settings
# goto keybar
goto alt+g global A g w:palette o:goto
switch mod+g global A g - w:palette o:goto
help.ctx mod+f1 global A - t:t_helpCtx w:btn:help
date f2 global A g o:date
period alt+f2 global A g o:period
# vouchers sheet:vouchers
vouchers f10 global A g w:keybar
contra f4 global A g r:/gateway/voucher/contra n:books.edit l:C
payment f5 global A g r:/gateway/voucher/payment n:books.edit l:P u:claim-tally-only
receipt f6 global A g r:/gateway/voucher/receipt n:books.edit l:R
journal f7 global A g r:/gateway/voucher/journal n:books.edit l:J
sales f8 global A g r:/invoice n:doc.create l:S
purchase f9 global A g r:/expenses?new=bill n:books.edit l:U
creditNote alt+f6 global A g e:mod+f8 r:/invoice?type=CREDIT_NOTE n:doc.create l:N
debitNote alt+f5 global A g e:mod+f9 r:/invoice?type=DEBIT_NOTE n:doc.create p:/expenses,/expenses?tab=returns&new=dn,books.edit l:D
salesOrder mod+f8 global A g e: r:/invoice?type=SALES_ORDER n:doc.create l:O
purchaseOrder mod+f9 global A g e: r:/expenses?tab=orders n:books.edit l:E
deliveryNote alt+f8 global A g r:/invoice?type=DELIVERY_CHALLAN n:doc.create l:L
receiptNote alt+f9 global A g r:/expenses?tab=returns&new=grn n:books.edit l:G
stockJournal alt+f7 global A g r:/manufacturing?tab=journal n:books.edit l:K
physicalStock mod+f7 global A g r:/manufacturing?tab=physical n:books.edit l:H
payroll mod+shift+f4 global A g r:/payroll n:payroll.view l:Y
rejOut mod+f5 global B g r:/expenses?tab=returns&new=dn n:books.edit l:X u:claim-tally-only
rejIn mod+f6 global B g n:doc.create l:I
# entry keybar
accept.voucher mod+a voucher h g x f
accept.editor mod+a editor B f
accept.bill mod+a bill B f
accept.master mod+a master h g x f
next.voucher enter voucher h g x f -
next.bill enter bill B f -
next.master enter master h g x f -
create.voucher alt+c voucher h g x f
create.picker alt+c field:picker B g
alterMaster mod+enter field:picker B
delete.voucher alt+d voucher h g x
delete.editor alt+d editor B
delete.bill alt+d bill B
cancel.editor alt+x editor B
cancel.voucher alt+x voucher B
dup.editor alt+2 editor B
dup.voucher alt+2 voucher B
rmLine mod+d line B f
postDated alt+t voucher B g
optional mod+l voucher B g
mode.voucher mod+h voucher B g
mode.editor mod+h editor B
more.editor mod+i editor B
more.bill mod+i bill B
more.line mod+i line B f
stockQuery alt+s line B f
stockQuery.alias mod+shift+s line B f -
related.editor mod+o editor B
related.bill mod+o bill B
gstAnalysis.editor alt+a editor B
gstAnalysis.bill alt+a bill B
narrType mod+r field:narration B -
narrParty alt+r field:narration B -
editLog.editor alt+q editor B
editLog.voucher alt+q voucher B
editLog.bill alt+q bill B
prevV.voucher pageup voucher B g
nextV.voucher pagedown voucher B g
prevV.editor pageup editor B
nextV.editor pagedown editor B
contra.voucher f4 voucher h g x
payment.voucher f5 voucher h g x
receipt.voucher f6 voucher h g x
journal.voucher f7 voucher h g x
date.voucher f2 voucher h g x
date.editor f2 editor B g
date.bill f2 bill B g
# reports keybar
drill enter report h a x -
drillUp escape report h a x
detail alt+f1 report h a x
detail.alt alt+f5 report C
options f12 report h a x
period.report alt+f2 report h a x
basis mod+b report C
views mod+h report C
saveView mod+l report C
except mod+j report C
filter mod+f report C
filter.alias alt+f12 report C -
select space reportRow C -
extend.up shift+arrowup reportRow C -
extend.down shift+arrowdown reportRow C -
invert mod+alt+i report C
expand shift+enter reportRow C -
alterRow mod+enter reportRow C - t:t_alterMaster
hide mod+r reportRow C
unhide mod+u report C
unhideAll alt+u report C
stepNext + report C t:t_step
stepPrev - report C t:t_step
stepNext.alias ] report C - t:t_step
stepPrev.alias [ report C - t:t_step
autoCols alt+n report C
addCol alt+c report C
delCol alt+d report C
insert alt+i reportRow C
insert.alias alt+a reportRow C -
dup.row alt+2 reportRow C
delete.row alt+d reportRow C
cancel.row alt+x reportRow C
printReport mod+p report C
export mod+e report C
share mod+m report C
share.alias mod+alt+w report C - t:t_whatsapp
move.up arrowup list D -
move.down arrowdown list D -
move.home home list D -
move.end end list D -
move.pgup pageup list D -
move.pgdn pagedown list D -
drill.list enter list D -
select.list space list D -
delete.list alt+d list D
cancel.list alt+x list D
dup.list alt+2 list D
# company keybar
company f3 global D w:btn:company
companies alt+f3 global D w:menu:company r:/settings?tab=data n:settings.manage
lock mod+f3 global D w:btn:lock
menuCompany alt+k global D
menuData alt+y global D
menuImport alt+o global D
notify mod+alt+n global D w:btn:bell
repair mod+alt+r global D w:menu:data
about mod+alt+b global D w:help:about
features f11 global A g w:nav:settings r:/settings?tab=defaults
configure f12 global A g w:nav:settings r:/settings
`;

const FLAG: Record<string, Partial<KeyRow>> = { a: { mode: 'always' }, g: { gw: true }, x: { ext: true }, f: { inField: true }, '-': { bar: false } };

function parseRows(def: string): KeyRow[] {
  let group = 'app' as KeyGroup;
  let twin = 'keybar';
  const rows: KeyRow[] = [];
  for (const line of def.trim().split('\n')) {
    const [id, prime, scope, pkg, ...rest] = line.trim().split(' ');
    if (id === '#') {
      group = prime as KeyGroup;
      twin = scope;
      continue;
    }
    const plain = id.split('.')[0] as KeysKey;
    const row: KeyRow = { id, combo: { prime: prime.replace(/_/g, ' ') }, scope: scope as KeyScope, mode: 'tally', plain, twin, pkg: (pkg === 'h' ? 'have' : pkg) as KeyPkg, group };
    if (`t_${plain}` in keysT.en) row.tally = `t_${plain}` as KeysKey;
    for (const t of rest) {
      const i = t.indexOf(':');
      const k = i < 0 ? t : t.slice(0, i);
      const v = t.slice(i + 1);
      if (i < 0) Object.assign(row, FLAG[k]);
      else if (k === 't') row.tally = v as KeysKey;
      else if (k === 'w') row.twin = v;
      else if (k === 'e') row.combo.erp9 = v;
      else if (k === 'r') row.route = v;
      else if (k === 'o') row.go = v as KeyRow['go'];
      else if (k === 'n') row.need = v as AccessAction;
      else if (k === 'l') row.letter = v;
      else if (k === 'u') row.browser = v as KeyRow['browser'];
      else if (k === 'p') {
        const [path, route, need] = v.split(',');
        row.on = { path, route, ...(need ? { need: need as AccessAction } : {}) };
      }
    }
    rows.push(row);
  }
  return rows;
}

export const KEY_ROWS: readonly KeyRow[] = parseRows(DEF);

/** Keys of the simple default (U7): the only combos a `mode: 'always'` row may use. */
export const SIMPLE_KEYS: ReadonlySet<string> = new Set([
  'mod+k', '/', '?', 'mod+/', 'f1', 'escape', 'mod+s', 'mod+enter', 'mod+p', 'alt+p', 'alt+r', 'alt+z',
  'g d', 'g i', 'g t', 'g c', 'g s', 'enter', 'alt+f1', 'f12', 'alt+f2',
]);

/** Canonical combo of an event: `mod+alt+shift+key`; letters / digits by `e.code` with a modifier down (Mac Option, AltGr). */
export function comboOf(e: KeyLike): string {
  const m = e.ctrlKey || e.metaKey;
  const c = e.code || '';
  let k = (m || e.altKey) && /^(Key[A-Z]|Digit\d)$/.test(c) ? c.slice(c[0] === 'K' ? 3 : 5).toLowerCase() : e.key.toLowerCase();
  if (k === ' ') k = 'space';
  return (m ? 'mod+' : '') + (e.altKey ? 'alt+' : '') + (e.shiftKey && !(k.length === 1 && !/[a-z0-9]/.test(k)) ? 'shift+' : '') + k;
}

/** "mod+f8" → "Control+F8" for aria-keyshortcuts. */
export const ariaCombo = (combo: string): string =>
  combo.split('+').map((p) => (p === 'mod' ? 'Control' : p === 'alt' ? 'Alt' : p === 'shift' ? 'Shift' : p.length <= 3 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1))).join('+');

/** Canonical combo (`mod+alt+shift+key`), the same shape `comboOf(event)` yields; sequences kept as typed. */
export function normCombo(combo: string): string {
  const s = combo.trim().toLowerCase();
  if (!s || /\s/.test(s)) return s;
  const p = parseCombo(s);
  const k = p.key === ' ' ? 'space' : p.key;
  return (p.mod ? 'mod+' : '') + (p.alt ? 'alt+' : '') + (p.shift && !(k.length === 1 && !/[a-z0-9]/.test(k)) ? 'shift+' : '') + k;
}

/** The row's combo in a layout ('' = no key there). */
export const comboFor = (row: KeyRow, layout: KeysLayout): string => normCombo(layout === 'erp9' && row.combo.erp9 !== undefined ? row.combo.erp9 : row.combo.prime);

export const isBuilt = (row: KeyRow): boolean => BUILT.has(row.pkg);
export const rowById = (id: string): KeyRow | undefined => KEY_ROWS.find((r) => r.id === id);

/** Combos the stub claims in a layout: built global Tally rows the engine runs, never `ext` or browser-unsafe ones. */
export const claimed = (layout: KeysLayout): KeyRow[] =>
  KEY_ROWS.filter((r) => r.scope === 'global' && r.mode === 'tally' && isBuilt(r) && !r.ext && !r.browser?.startsWith('unsafe:') && comboFor(r, layout));

/**
 * The stub's claim string (`KEY_CLAIMS` in stub.ts must equal it, tests/keys-stub.test.ts prints the new one): every
 * combo claimed in either layout, `~` = only with the mode on (not a Gateway key), then `^` = TallyPrime only or
 * `%` = Tally.ERP 9 only.
 */
export function claimList(): string {
  const tok = new Map<string, string>();
  const sets = (['prime', 'erp9'] as const).map((l) => new Map(claimed(l).map((r) => [comboFor(r, l), r.gw ? '' : '~'])));
  for (const [i, m] of sets.entries()) {
    for (const [c, gw] of m) if (!tok.has(c)) tok.set(c, c + gw + (sets[1 - i].has(c) ? '' : i ? '%' : '^'));
  }
  return [...tok.values()].join(' ');
}

/** Screen scopes implied by the route (for the Key bar and the cheat sheet's "This screen"); handlers add more. */
export const SCREEN_SCOPES: readonly [RegExp, KeyScope[]][] = [
  [/^\/gateway\/voucher/, ['voucher']],
  [/^\/gateway\/display/, ['report', 'reportRow']],
  [/^\/gateway/, ['gateway']],
  [/^\/invoice/, ['editor', 'line', 'field:picker', 'field:narration']],
  [/^\/expenses/, ['bill', 'line', 'list']],
  [/^\/(books|reports)/, ['report', 'reportRow']],
  [/^\/(transactions|clients)/, ['list']],
];
export const scopesOfPath = (path: string): KeyScope[] => SCREEN_SCOPES.find(([re]) => re.test(path))?.[1] ?? [];
