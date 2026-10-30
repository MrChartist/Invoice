/**
 * Lock-in for the iOS-grade interface (docs/theme/IOS-UI.md; plan and rule list: docs/prd/ios-ui.md section 5).
 *
 *  1. every token of the spec exists in all four themes of src/styles/ios.css (light, dark, HC light, HC dark);
 *  2. contrast is recomputed from ios.css: labels, tint and every --sys-*-ink reach 4.5:1 on their surfaces and on their
 *     own pill; icon tiles reach 3:1 with their glyph;
 *  3-12. ratchets: raw colour, radii, borders, shadows, z-index, motion, media queries / vh, materials, page frame,
 *     common weight. Each counts today's offenders per owning package; a count may only go DOWN. A package lowers only
 *     its own const below (shared-file protocol, docs/prd/ios-ui.md section 4); QA sets the final values;
 * 13. shell facts: viewport-fit=cover and one pair of theme colours equal to --bg-grouped.
 *
 * Out of scope: src/components/templates/ (printed paper) and the printed documents allow-listed in PRINTED.
 * `IOS_UI_PRINT=1` prints the current counts per package (to lower a ceiling after a clean-up).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const walk = (d: string, ext: RegExp): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p, ext) : ext.test(n) ? [p] : [];
  });
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');

/** Printed paper keeps its own fixed colours, sizes and rules. */
const PRINTED = [
  /^src\/components\/templates\//, // invoice templates (printed paper, spec scope)
  /^src\/components\/receivables\/StatementDocument\./, // printed statement of account
  /\/[A-Za-z]*Print[A-Za-z]*\.tsx$/, // print documents (cheque, job card, lab report, POS receipt …)
];
const inScope = (f: string) => !PRINTED.some((r) => r.test(f));
const CSS = walk(join(ROOT, 'src'), /\.css$/).map(rel).filter(inScope);
const TSX = walk(join(ROOT, 'src'), /\.tsx$/).map(rel).filter(inScope);
/** The token files and the button rulebook define raw values on purpose. */
const TOKEN_FILES = new Set(['src/styles/ios.css', 'src/index.css', 'src/styles/buttons.css']);

// ── 1. Tokens ─────────────────────────────────────────────────────────────────────────────────────────────────

const COLOURS = ['blue', 'green', 'indigo', 'orange', 'pink', 'purple', 'red', 'teal', 'mint', 'cyan', 'yellow', 'brown', 'gray'];
const TOKENS = [
  ...COLOURS.flatMap((c) => [`--sys-${c}`, `--sys-${c}-ink`, `--sys-${c}-tile`, `--sys-${c}-soft`]),
  '--sys-gray2', '--sys-gray3', '--sys-gray4', '--sys-gray5', '--sys-gray6', '--on-tile', '--brand-gold',
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => `--chart-${i}`),
  '--tint', '--tint-soft', '--on-tint',
  '--label', '--label-2', '--label-3', '--label-4',
  '--bg', '--bg-2', '--bg-3', '--bg-grouped', '--bg-grouped-2', '--bg-grouped-3', '--bg-elevated', '--bg-elevated-2',
  '--fill', '--fill-2', '--fill-3', '--fill-4',
  '--sep', '--sep-opaque', '--hairline', '--field-edge', '--card-edge',
  ...['ultrathin', 'thin', 'regular', 'thick', 'chrome'].flatMap((m) => [`--mat-${m}`, `--mat-${m}-blur`]),
  '--r-4', '--r-6', '--r-8', '--r-10', '--r-12', '--r-16', '--r-20', '--r-28', '--r-full', '--r-tile', '--squircle-boost',
  '--elev-0', '--elev-1', '--elev-2', '--elev-3', '--scrim',
  '--sp-0-5', '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6', '--sp-8', '--sp-10', '--sp-12', '--sp-16',
  '--gutter', '--row-inset', '--row-inset-tile', '--section-gap',
  '--ease-out', '--ease-in-out', '--spring', '--spring-soft', '--dur-1', '--dur-2', '--dur-3', '--dur-4',
  '--z-base', '--z-raised', '--z-sticky', '--z-bar', '--z-sidebar', '--z-dropdown', '--z-scrim', '--z-sheet', '--z-palette',
  '--z-toast', '--z-alert', '--z-skip',
  '--bp-phone', '--bp-phone-lg', '--bp-sidebar', '--bp-tablet', '--bp-laptop', '--bp-desktop', '--bp-wide', '--bp-short',
  '--safe-t', '--safe-b', '--safe-l', '--safe-r', '--bar-h', '--sidebar-w', '--rail-w',
  '--page-max', '--form-max', '--measure', '--inspector-w',
  '--row-h', '--field-h', '--card-pad', '--cell-py', '--cell-px',
];
/** The only width-query breakpoints (spec 3.1), in em; a max-width query sits 1px (0.0625em) below one. */
const BREAKPOINTS_EM = [23.4375, 26.9375, 37.5, 52.125, 74.6875, 90, 120];

const IOS = read('src/styles/ios.css').replace(/\/\*[\s\S]*?\*\//g, '');
function block(selector: string): Record<string, string> {
  const at = IOS.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `ios.css has no top-level "${selector} {" block`);
  const body = IOS.slice(IOS.indexOf('{', at) + 1, IOS.indexOf('\n}', at));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const ROOT_T = block(':root');
const THEMES: Record<string, Record<string, string>> = {
  light: ROOT_T,
  dark: { ...ROOT_T, ...block('.dark') },
  'hc-light': { ...ROOT_T, ...block('html.a11y-contrast:not(.dark)') },
  'hc-dark': { ...ROOT_T, ...block('.dark'), ...block('html.dark.a11y-contrast') },
};

test('1. every token exists in all four themes of ios.css', () => {
  for (const [theme, t] of Object.entries(THEMES)) {
    const missing = TOKENS.filter((n) => !(n in t));
    assert.deepEqual(missing, [], `${theme} is missing tokens`);
  }
  assert.equal(new Set(TOKENS).size, TOKENS.length);
});

// ── 2. Contrast ───────────────────────────────────────────────────────────────────────────────────────────────

type RGBA = [number, number, number, number];
function colour(value: string, t: Record<string, string>, depth = 0): RGBA {
  assert.ok(depth < 12, `var() loop at ${value}`);
  const v = value.trim();
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) {
    assert.ok(ref[1] in t, `${ref[1]} undefined`);
    return colour(t[ref[1]], t, depth + 1);
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgb = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(v);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3], rgb[4] === undefined ? 1 : +rgb[4]];
  const mix = /^color-mix\(in srgb, (.+) (var\(--[\w-]+\)|[\d.]+%), transparent\)$/.exec(v);
  if (mix) {
    const pct = mix[2].startsWith('var(') ? t[mix[2].slice(4, -1)] : mix[2];
    const c = colour(mix[1], t, depth + 1);
    return [c[0], c[1], c[2], c[3] * (parseFloat(pct) / 100)];
  }
  throw new Error(`cannot read colour "${v}"`);
}
const over = (fg: RGBA, bg: RGBA): RGBA => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1) as RGBA;
const lum = (c: RGBA) =>
  [0, 1, 2]
    .map((i) => c[i] / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
    .reduce((s, x, i) => s + x * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a: RGBA, b: RGBA) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test('2. text colours reach 4.5:1 and icon tiles 3:1 in every theme (recomputed from ios.css)', () => {
  const low: string[] = [];
  for (const [theme, t] of Object.entries(THEMES)) {
    const c = (n: string) => colour(`var(${n})`, t);
    const dark = theme.includes('dark');
    const card = c('--bg-grouped-2');
    const surfaces: Record<string, RGBA> = dark
      ? { bg: c('--bg'), 'bg-grouped-2': card, 'bg-elevated-2': c('--bg-elevated-2'), 'fill-3/card': over(c('--fill-3'), card) }
      : { bg: c('--bg'), 'bg-grouped': c('--bg-grouped'), 'fill-3/card': over(c('--fill-3'), card), 'fill-3/page': over(c('--fill-3'), c('--bg-grouped')) };
    const text = ['--label', '--label-2', '--label-3', '--tint', ...COLOURS.map((k) => `--sys-${k}-ink`)];
    for (const n of text) {
      const fg = c(n);
      for (const [s, bg] of Object.entries(surfaces)) {
        const r = ratio(over(fg, bg), bg);
        if (r < 4.5) low.push(`${theme} ${n} on ${s}: ${r.toFixed(2)}`);
      }
    }
    for (const k of COLOURS) {
      const pill = over(c(`--sys-${k}-soft`), card);
      const r = ratio(c(`--sys-${k}-ink`), pill);
      if (r < 4.5) low.push(`${theme} --sys-${k}-ink on its pill: ${r.toFixed(2)}`);
      const glyph = c(k === 'yellow' ? '--on-tile-yellow' : '--on-tile');
      const rt = ratio(glyph, c(`--sys-${k}-tile`));
      if (rt < 3) low.push(`${theme} glyph on --sys-${k}-tile: ${rt.toFixed(2)}`);
    }
    // Field edges and HC separators are non-text UI: 3:1 against the card in high contrast.
    if (theme.startsWith('hc')) {
      const r = ratio(over(c('--field-edge'), card), card);
      if (r < 3) low.push(`${theme} --field-edge: ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(low, []);
});

// ── Ratchets: shared parsing ──────────────────────────────────────────────────────────────────────────────────

interface Decl { file: string; line: number; selector: string; prop: string; value: string; media: string }
/** Every declaration of a stylesheet with its selector, line and enclosing at-rule (comments blanked, lines kept). */
function decls(file: string): Decl[] {
  const src = read(file).replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out: Decl[] = [];
  const stack: string[] = [];
  let buf = '';
  let line = 1;
  let startLine = 1;
  for (const ch of src) {
    if (ch === '{') {
      stack.push(buf.trim().replace(/\s+/g, ' '));
      buf = '';
      startLine = line;
    } else if (ch === '}' || ch === ';') {
      const text = buf.trim();
      const colon = text.indexOf(':');
      const selector = [...stack].reverse().find((s) => !s.startsWith('@')) ?? '';
      if (colon > 0 && stack.length && !text.startsWith('@')) {
        out.push({ file, line: startLine, selector, prop: text.slice(0, colon).trim().toLowerCase(), value: text.slice(colon + 1).trim(), media: stack.filter((s) => s.startsWith('@')).join(' ') });
      }
      if (ch === '}') stack.pop();
      buf = '';
      startLine = line;
    } else {
      if (!buf.trim() && ch !== '\n' && ch !== ' ') startLine = line;
      buf += ch;
    }
    if (ch === '\n') line++;
  }
  return out;
}
const ALL_DECLS = CSS.flatMap(decls);
const UI_DECLS = ALL_DECLS.filter((d) => !TOKEN_FILES.has(d.file));
/** Lines of TSX code (comments blanked) for the inline-style checks. */
const tsxLines = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((t, i) => ({ file, line: i + 1, text: t.replace(/^\s*\/\/.*$/, '') }));
const ALL_TSX = TSX.flatMap(tsxLines);

/** `pkg` overrides the file's owner (route wrappers and page titles belong to PL in every page). */
interface Hit { file: string; line: number; what: string; pkg?: string }
const fromDecl = (d: Decl): Hit => ({ file: d.file, line: d.line, what: `${d.selector} { ${d.prop}: ${d.value} }` });

/** Owning package of a file / line (docs/prd/ios-ui.md section 3). Shared files go to the later package. */
const SURFACE = 'src/styles/surface.module.css';
const surfaceOwners = (() => {
  const marks: [number, string][] = [];
  read(SURFACE).split('\n').forEach((t, i) => {
    const m = /\(owner: (\w+)\)/.exec(t);
    if (m) marks.push([i + 1, m[1]]);
  });
  return marks;
})();
const OWNERS: [RegExp, string][] = [
  [/^src\/(index\.css|styles\/ios\.css|main\.tsx|hooks\/useTheme\.ts)$/, 'P0'],
  [/^src\/(components\/ui\/(Page|SplitView|PageHeader)\.tsx|styles\/page\.module\.css|components\/creator\/LivePreviewPane\.module\.css)$/, 'PL'],
  [/^src\/(layouts\/|components\/(companies|brand|demo)\/|components\/keys\/(nav|keys)\.module\.css)/, 'P1'],
  [/^src\/(styles\/controls\.module\.css|components\/ui\/(Typeahead|NumberInput|GstinInput|LanguageSwitch|Toggle)\b|pages\/(Settings|Transactions|Clients|Expenses)\.|components\/(settings|masters|clients)\/)/, 'P2'],
  [/^src\/(components\/ui\/(Modal|ConfirmDialog|Toast|useToast|Menu)\b|components\/(command|invoicing-ux|layout|help|preview|share|pwa)\/|components\/receivables\/StatementViewer\.)/, 'P3'],
  [/^src\/(pages\/Dashboard\.|components\/dashboard\/|components\/ui\/(StatCard|StatusBadge|EmptyState|Avatar|Skeleton)\b|styles\/charts\.module\.css|components\/receivables\/Charts\.|components\/books\/planning\/cashflow\.module\.css)/, 'P4'],
  [/^src\/(pages\/(Pos|Tables|InvoiceCreator|Gateway)\.|components\/(pos|pos-retail|pos-returns|restaurant|creator|gateway|voucher-types)\/|components\/keys\/[^/]*Sheet)/, 'P5a'],
  [/^src\/(pages|components)\//, 'P5b'],
];
function ownerOf(file: string, line: number): string {
  if (file === SURFACE) return [...surfaceOwners].reverse().find(([l]) => l <= line)?.[1] ?? 'P2';
  return OWNERS.find(([r]) => r.test(file))?.[1] ?? 'QA';
}

type Rule = 'colour' | 'radius' | 'border' | 'shadow' | 'zIndex' | 'motion' | 'media' | 'material' | 'frame' | 'weight';
const RULES: Rule[] = ['colour', 'radius', 'border', 'shadow', 'zIndex', 'motion', 'media', 'material', 'frame', 'weight'];
type Ceil = Record<Rule, number>;

// ── Ceilings: today's counts (30 Oct 2026, P0). Each package lowers ONLY its own const. ──────────────────────────
const P0: Ceil = { colour: 0, radius: 0, border: 0, shadow: 0, zIndex: 0, motion: 0, media: 0, material: 0, frame: 0, weight: 0 };
const PL: Ceil = { colour: 0, radius: 0, border: 0, shadow: 0, zIndex: 0, motion: 0, media: 0, material: 0, frame: 0, weight: 1 }; // weight: LoginPage h1 (full-screen route, outside the shell)
const P1: Ceil = { colour: 3, radius: 1, border: 0, shadow: 0, zIndex: 0, motion: 0, media: 0, material: 0, frame: 0, weight: 2 }; // all in the logo (brand/Logo.*: wordmark colours, tile, "INVOICE" lockup), kept as drawn
const P2: Ceil = { colour: 0, radius: 0, border: 0, shadow: 0, zIndex: 0, motion: 0, media: 0, material: 0, frame: 0, weight: 1 }; // weight: .inputMono keeps capitals (statutory identifiers as typed values)
const P3: Ceil = { colour: 1, radius: 0, border: 0, shadow: 0, zIndex: 0, motion: 0, media: 0, material: 0, frame: 0, weight: 1 };
const P4: Ceil = { colour: 0, radius: 0, border: 0, shadow: 0, zIndex: 0, motion: 0, media: 0, material: 0, frame: 0, weight: 0 };
const P5a: Ceil = { colour: 4, radius: 67, border: 69, shadow: 10, zIndex: 6, motion: 6, media: 17, material: 0, frame: 0, weight: 26 };
const P5b: Ceil = { colour: 13, radius: 248, border: 239, shadow: 18, zIndex: 4, motion: 17, media: 62, material: 0, frame: 0, weight: 82 };
const QA: Ceil = { colour: 0, radius: 0, border: 0, shadow: 0, zIndex: 0, motion: 0, media: 0, material: 0, frame: 0, weight: 0 };
const CEILINGS: Record<string, Ceil> = { P0, PL, P1, P2, P3, P4, P5a, P5b, QA };

// ── 3-12. Offender finders ────────────────────────────────────────────────────────────────────────────────────

const RAW_COLOUR = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?)\(/gi;
const tsxHits = (re: RegExp, what: string) =>
  ALL_TSX.flatMap((l) => [...l.text.matchAll(re)].map((m) => ({ file: l.file, line: l.line, what: `${what}: ${m[0]}` })));
const FIND: Record<Rule, () => Hit[]> = {
  // 3. Raw colour: none in CSS outside the token files; none in TSX (inline styles, colour props).
  colour: () => [
    ...UI_DECLS.flatMap((d) => [...d.value.matchAll(RAW_COLOUR)].map(() => fromDecl(d))),
    ...tsxHits(/['"`]#[0-9a-f]{3,8}['"`]|\b(rgba?|hsla?)\(/gi, 'raw colour'),
  ],
  // 4. Radii: only --r-* tokens, the rulebook's --b-*, 50%, 0, inherit.
  radius: () => [
    ...UI_DECLS.filter((d) => /^border(-[a-z]+)*-radius$/.test(d.prop))
      .filter((d) => d.value.split(/\s+(?![^(]*\))/).some((v) => !/^(var\(--(r|b)-[\w-]+\)|50%|0|inherit)$/.test(v)))
      .map(fromDecl),
    ...tsxHits(/\bborderRadius:\s*(?!['"]?var\(--r-)[^,}\n]+/g, 'inline radius'),
  ],
  // 5. Borders: widths only --hairline, 0, none, --card-edge; 2px / 3px only on focus / selected / alertBar selectors.
  border: () =>
    UI_DECLS.filter((d) => /^border(-(top|right|bottom|left|inline|block)(-(start|end))?)?(-width)?$/.test(d.prop))
      .filter((d) => {
        const v = d.value.replace(/var\(--(hairline|card-edge)\)/g, '');
        const widths = v.match(/(^|\s)(\d*\.?\d+(px|rem|em)|thin|medium|thick)(?=\s|$)/g) ?? [];
        const bad = widths.map((w) => w.trim()).filter((w) => !/^0(px|rem|em)?$/.test(w));
        if (!bad.length) return false;
        return !(bad.every((w) => w === '2px' || w === '3px') && /focus|selected|alertBar/i.test(d.selector));
      })
      .map(fromDecl),
  // 6. Shadows: only --elev-*, none, the focus ring; no shadow at all on a card / group / panel.
  shadow: () =>
    UI_DECLS.filter((d) => d.prop === 'box-shadow')
      .filter((d) => {
        const ok = /^(none|var\(--elev-\d\)|0 0 0 2px var\(--tint\))$/.test(d.value);
        const flat = /\.(card|group|panel)\b/i.test(d.selector) && !/^(none|var\(--elev-0\))$/.test(d.value);
        return !ok || flat;
      })
      .map(fromDecl),
  // 7. z-index: only --z-* layers, 0, 1, -1 (CSS and inline zIndex).
  zIndex: () => [
    ...UI_DECLS.filter((d) => d.prop === 'z-index' && !/^(var\(--z-[\w-]+\)|0|1|-1|auto|inherit)$/.test(d.value)).map(fromDecl),
    ...tsxHits(/\bzIndex:\s*(?!0\b|1\b|-1\b|['"]var\(--z-)[^,}\n]+/g, 'inline z-index'),
  ],
  // 8. Motion: durations only --dur-*, easings only the four tokens (linear allowed for spinners / shimmers).
  motion: () => [
    ...UI_DECLS.filter((d) => /^(transition|animation)(-(duration|timing-function|delay))?$/.test(d.prop))
      .filter((d) => /(^|[\s,])\d*\.?\d+m?s\b|(?<![-\w])(ease|ease-in|ease-out|ease-in-out|cubic-bezier|steps)\b|var\(--transition-/.test(d.value.replace(/\b0m?s\b/g, '')))
      .map(fromDecl),
    ...tsxHits(/\b(transition|animation):\s*['"`][^'"`]*\d+m?s[^'"`]*['"`]/g, 'inline motion'),
  ],
  // 9. Media: width queries only at the breakpoints, in em; no plain vh (dvh / svh / lvh only).
  media: () => {
    const hits: Hit[] = [];
    const seen = new Set<string>();
    for (const d of ALL_DECLS) {
      const key = `${d.file}:${d.media}`;
      if (!d.media || seen.has(key)) continue;
      seen.add(key);
      for (const m of d.media.matchAll(/(min|max)-width:\s*([\d.]+)(px|em|rem)?|width\s*[<>]=?\s*([\d.]+)(px|em|rem)/g)) {
        const n = parseFloat(m[2] ?? m[4]);
        const unit = m[3] ?? m[5];
        const ok = unit === 'em' && BREAKPOINTS_EM.some((b) => b === n || b - 0.0625 === n);
        if (!ok) hits.push({ file: d.file, line: d.line, what: `${d.media}` });
      }
    }
    for (const d of ALL_DECLS) for (const m of d.value.matchAll(/(^|[^\w.])\d*\.?\d+vh\b/g)) hits.push({ ...fromDecl(d), what: `vh: ${m[0].trim()} in ${d.prop}` });
    hits.push(...tsxHits(/['"`][^'"`]*\d+vh\b[^'"`]*['"`]/g, 'inline vh'));
    return hits;
  },
  // 10. Materials: backdrop-filter only in ios.css (.material) and buttons.css (glass).
  material: () => [
    ...UI_DECLS.filter((d) => /^(-webkit-)?backdrop-filter$/.test(d.prop) && d.value !== 'none').map(fromDecl),
    ...tsxHits(/\b(WebkitB|b)ackdropFilter:/g, 'inline backdrop-filter'),
  ],
  // 11. Page frame: routes render <Page>; no max-width above 35rem outside the frame / dialogs; no inline widths
  //     above 560 in pages; no side padding / margin-inline on a page root class.
  frame: () => {
    const hits: Hit[] = [];
    const ROUTE_EXEMPT = new Set(['LoginPage.tsx', 'ShareTarget.tsx']); // full-screen, outside the shell
    for (const f of TSX.filter((x) => /^src\/pages\/[^/]+\.tsx$/.test(x) && !ROUTE_EXEMPT.has(basename(x)))) {
      if (!/<Page[\s>]/.test(read(f))) hits.push({ file: f, line: 1, what: 'route does not render <Page>', pkg: 'PL' });
    }
    const px = (v: string) => {
      const m = /^([\d.]+)(px|rem|em)$/.exec(v.trim());
      return m ? parseFloat(m[1]) * (m[2] === 'px' ? 1 : 16) : 0;
    };
    hits.push(
      ...UI_DECLS.filter((d) => d.prop === 'max-width' && !/(^|\/)(page|Modal)\.module\.css$/.test(d.file) && px(d.value) > 560).map(fromDecl),
      ...UI_DECLS.filter(
        (d) => /^src\/pages\/[^/]+\.module\.css$/.test(d.file) && /^\.(page|root)$/.test(d.selector) &&
          (/^(padding|margin)-(left|right|inline)/.test(d.prop) || ((d.prop === 'padding' || d.prop === 'margin') && d.value.trim().split(/\s+/).length > 1)),
      ).map(fromDecl),
    );
    for (const l of ALL_TSX.filter((x) => x.file.startsWith('src/pages/'))) {
      for (const m of l.text.matchAll(/\b(maxWidth|width):\s*['"]?(\d+(?:\.\d+)?)(px|rem)?['"]?/g)) {
        const v = parseFloat(m[2]) * (m[3] === 'rem' ? 16 : 1);
        if (v > 560) hits.push({ file: l.file, line: l.line, what: `inline ${m[1]}: ${m[2]}${m[3] ?? ''}` });
      }
    }
    return hits;
  },
  // 12. Common weight: sentence case (no uppercase outside printed registers), no wide tracking, no ad hoc <h1>.
  weight: () => {
    const upper = UI_DECLS.filter((d) => d.prop === 'text-transform' && d.value === 'uppercase');
    const tracked = UI_DECLS.filter((d) => d.prop === 'letter-spacing' && /^0?\.\d+em$/.test(d.value) && parseFloat(d.value) > 0.02 && upper.some((u) => u.file === d.file && u.selector === d.selector));
    return [
      ...upper.map(fromDecl),
      ...tracked.map(fromDecl),
      ...tsxHits(/\btextTransform:\s*['"]uppercase['"]/g, 'inline uppercase'),
      ...ALL_TSX.filter((l) => !/^src\/components\/ui\/(Page|PageHeader)\.tsx$/.test(l.file) && /<h1[\s>]/.test(l.text)).map((l) => ({ file: l.file, line: l.line, what: 'page title outside <Page>', pkg: l.file.startsWith('src/pages/') ? 'PL' : undefined })),
    ];
  },
};

const COUNTS: Record<string, Ceil> = {};
const HITS: Record<string, Record<Rule, Hit[]>> = {};
for (const pkg of Object.keys(CEILINGS)) {
  COUNTS[pkg] = Object.fromEntries(RULES.map((r) => [r, 0])) as Ceil;
  HITS[pkg] = Object.fromEntries(RULES.map((r) => [r, []])) as unknown as Record<Rule, Hit[]>;
}
for (const r of RULES) {
  for (const h of FIND[r]()) {
    const pkg = h.pkg ?? ownerOf(h.file, h.line);
    COUNTS[pkg][r]++;
    HITS[pkg][r].push(h);
  }
}
if (process.env.IOS_UI_PRINT) {
  for (const [pkg, c] of Object.entries(COUNTS)) console.log(`const ${pkg}: Ceil = ${JSON.stringify(c).replace(/"(\w+)":/g, '$1: ').replace(/,/g, ', ')};`);
}

const TITLES: Record<Rule, string> = {
  colour: '3. raw colour', radius: '4. radii', border: '5. borders', shadow: '6. shadows', zIndex: '7. z-index', motion: '8. motion',
  media: '9. media queries and vh', material: '10. materials', frame: '11. page frame', weight: '12. common weight',
};
for (const r of RULES) {
  test(`${TITLES[r]}: no package goes above its ratchet`, () => {
    const over: string[] = [];
    for (const [pkg, ceil] of Object.entries(CEILINGS)) {
      if (COUNTS[pkg][r] > ceil[r]) {
        over.push(`${pkg}: ${COUNTS[pkg][r]} > ${ceil[r]}`, ...HITS[pkg][r].map((h) => `  ${h.file}:${h.line} ${h.what}`));
      }
    }
    assert.deepEqual(over, [], 'a ratchet rose (fix the new value, or use a token)');
  });
}

test('the token files themselves stay inside the rules they define', () => {
  // ios.css is the only home of backdrop-filter (besides the rulebook) and of the materials' fallback.
  assert.match(IOS, /\.material\s*\{/);
  assert.match(IOS, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
  assert.match(IOS, /html\.a11y-contrast \.material/);
  assert.match(IOS, /@supports \(corner-shape: squircle\)/);
  const main = read('src/main.tsx');
  const [a, b, c] = ["import './index.css'", "import './styles/ios.css'", "import './styles/buttons.css'"].map((s) => main.indexOf(s));
  assert.ok(a >= 0 && b > a && c > b, 'main.tsx imports index.css, then styles/ios.css, then styles/buttons.css');
  // index.css keeps the old names as aliases, pointing at ios.css tokens, never at raw colours.
  const idx = read('src/index.css');
  for (const n of ['--background', '--foreground', '--card', '--muted-foreground', '--border', '--primary', '--ring', '--profit', '--loss', '--warning', '--info']) {
    assert.match(idx, new RegExp(`\\n\\s*${n}: var\\(--`), `${n} is an alias`);
  }
  assert.doesNotMatch(idx, /border-radius: var\(--radius-xs\);\s*\}/, 'the focus ring follows the element (spec 1.11)');
  assert.match(idx, /:focus-visible \{\s*outline: 2px solid var\(--tint\)/);
});

// ── 13. Shell facts ───────────────────────────────────────────────────────────────────────────────────────────

test('13. viewport-fit=cover and one pair of theme colours equal to --bg-grouped', () => {
  const html = read('index.html');
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  const light = THEMES.light['--bg-grouped'].toLowerCase();
  const dark = THEMES.dark['--bg-grouped'].toLowerCase();
  const init = read('public/theme-init.js');
  assert.ok(init.includes(`dark ? '${dark}' : '${light}'`), `theme-init.js writes ${dark} / ${light}`);
  const hook = read('src/hooks/useTheme.ts');
  assert.ok(hook.includes(`light: '${light}'`) && hook.includes(`dark: '${dark}'`), `useTheme.ts writes ${light} / ${dark}`);
  assert.match(html, new RegExp(`<meta name="theme-color" content="${light}"`));
});

// ── PL. Page frame and shell (package PL) ─────────────────────────────────────────────────────────────────────

test('PL: one frame (title before tips, tiers by name), the shell in em with dvh and safe areas, density before paint', () => {
  // A one-time tip never sits above a page title: it is passed in the notices slot (or comes later in the body).
  for (const f of TSX.filter((x) => /^src\/pages\/[^/]+\.tsx$/.test(x))) {
    const s = read(f);
    const tip = s.indexOf('<ScreenTip');
    if (tip >= 0) assert.ok(s.indexOf('<Page') >= 0 && s.indexOf('<Page') < tip, `${f}: <ScreenTip> before <Page> (use notices=)`);
    for (const m of s.matchAll(/\btier=\{?['"](\w+)['"]/g)) assert.ok(['page', 'form', 'bleed'].includes(m[1]), `${f}: tier ${m[1]}`);
    assert.doesNotMatch(s, /<PageHeader[\s>]/, `${f}: the header is <Page title / head>, not <PageHeader>`);
  }
  const shell = read('src/layouts/DashboardLayout.module.css');
  assert.doesNotMatch(shell, /\d+px\)\s*\{|max-width:\s*1280px/, 'shell breakpoints in em, no 1280px frame');
  assert.match(shell, /\.content \{[^}]*max-width: var\(--page-max\)/, 'the frame is capped by --page-max');
  assert.match(shell, /\.content:has\(\[data-tier='bleed'\]\)/, 'bleed pages drop the cap');
  assert.match(shell, /height: 100dvh/);
  for (const side of ['safe-l', 'safe-r', 'safe-t', 'safe-b']) assert.ok(shell.includes(`var(--${side})`), `shell honours --${side}`);
  assert.match(read('src/layouts/DashboardLayout.tsx'), /PHONE_MEDIA = '\(width < 37\.5em\)/, 'phone shell under 37.5em only (D7)');
  assert.match(read('public/theme-init.js'), /classList\.add\('density-compact'\)/, 'density class set before first paint');
  assert.match(IOS, /html\.density-compact \{/);
});
