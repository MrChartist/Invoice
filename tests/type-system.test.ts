/**
 * Lock-in for the Mr. Chartist type system (docs/theme/TYPE-SYSTEM.md, step 10), scanning src + index.html:
 *  - only the three Chartist fonts (plus their size-matched fallbacks, the Devanagari script fallback and generic /
 *    system fallbacks) are named in a font-family / font shorthand / fontFamily;
 *  - no font size below 12px (rem counted at 16px, pt at 4/3 px), except the allow-listed printed-paper rules;
 *  - no weight above 600, except the allow-listed Devanagari font file.
 * Every exception below carries its reason.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|tsx|ts|html)$/.test(name)) out.push(p);
  }
  return out;
};
const FILES = [...walk(join(ROOT, 'src')), join(ROOT, 'index.html')].map((f) => {
  const src = readFileSync(f, 'utf8');
  // Comments may name anything (history, reasons); only code counts.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^\s*\/\/.*$/gm, '');
  // Template-literal stacks from src/lib/print-fonts.ts count as tokens (that file names the families itself).
  return { rel: relative(ROOT, f).split('\\').join('/'), src, code: code.replace(/\$\{PRINT_(?:HEADING_)?FONT(?:_FACE)?\}/g, 'var(--print-font)') };
});

const ALLOWED_FAMILIES = new Set([
  'Chartist Sans', 'Chartist Sans Flex', 'Chartist Serif', 'Chartist Sans Flex Fallback', 'Chartist Sans Fallback',
  // Script coverage, not a design face: Devanagari only (unicode-range), for Hindi UI and documents (5.4).
  'Noto Sans Devanagari',
  // Generic / system fallbacks after the Chartist fonts; the local() sources of the size-matched fallbacks.
  'system-ui', '-apple-system', 'sans-serif', 'serif', 'Georgia', 'inherit', 'Arial', 'ArialMT', 'Liberation Sans',
  'Arial Bold', 'Arial-BoldMT',
]);
/**
 * Generic `monospace` is kept only where text is laid out in fixed character columns: the thermal text-receipt and
 * KOT previews mirror what the printer prints in its own built-in font (32 / 48 columns padded with spaces).
 */
const MONOSPACE_OK = new Set(['src/lib/escpos.ts', 'src/lib/restaurant/kot-print.ts']);

const families = (value: string): string[] =>
  value
    .replace(/\$\{[^}]*\}/g, '')
    .replace(/!important/g, '')
    .split(',')
    .map((x) => x.trim().replace(/^['"\\]+|['"\\)]+$/g, '').trim())
    .filter((x) => x && !x.startsWith('var(') && !/^[)'"`]/.test(x));

test('type system: only the three Chartist fonts (and fallbacks) are named', () => {
  const bad: string[] = [];
  for (const { rel, code } of FILES) {
    const hits = [
      ...[...code.matchAll(/font-family\s*:\s*([^;}{<]+)/g)].map((m) => m[1]),
      ...[...code.matchAll(/fontFamily\s*:\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]),
      ...[...code.matchAll(/font-family="([^"]+)"/g)].map((m) => m[1]),
      // font shorthand: the families follow the size (and optional /line-height)
      ...[...code.matchAll(/(?<![-\w])font\s*:\s*(?:[0-9]{3}\s+)?[0-9.]+(?:px|pt|rem|em)(?:\/[0-9.]+)?\s+([^;}{"]+)/g)].map((m) => m[1]),
    ];
    for (const h of hits) {
      for (const fam of families(h)) {
        if (ALLOWED_FAMILIES.has(fam)) continue;
        if (fam === 'monospace' && MONOSPACE_OK.has(rel)) continue;
        bad.push(`${rel}: ${fam}`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('type system: no other font files and no font CDN', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(html), 'fonts are self-hosted');
  const preloads = [...html.matchAll(/rel="preload" href="([^"]+)" as="font"/g)].map((m) => m[1]);
  assert.deepEqual(preloads, ['/fonts/chartist-sans-flex/chartist-sans-flex.woff2', '/fonts/chartist-sans/chartist-sans.woff2']);
  const dir = join(ROOT, 'public/fonts');
  const woff = (readdirSync(dir, { recursive: true }) as string[])
    .map((f) => String(f).split('\\').join('/'))
    .filter((f) => /\.(woff2?|ttf|otf)$/.test(f))
    .sort();
  assert.deepEqual(woff, [
    'chartist-sans-flex/chartist-sans-flex.woff2',
    'chartist-sans/chartist-sans.woff2',
    'chartist-serif/chartist-serif-italic.woff2',
    'noto-sans-devanagari-normal-400-devanagari.woff2',
    'noto-sans-devanagari-normal-700-devanagari.woff2',
  ]);
  for (const dir of ['chartist-sans-flex', 'chartist-sans', 'chartist-serif']) {
    assert.match(readFileSync(join(ROOT, 'public/fonts', dir, 'OFL.txt'), 'utf8'), /SIL Open Font License, Version 1\.1/);
  }
});

/**
 * Printed paper may keep a rule below 12px only when that line says why with a `type-floor-exempt: <reason>` comment.
 * The invoice paper is 794 px wide and scaled to A4 (1 px prints as 0.75 pt) and paginates by height: its multi-column
 * tables, running blocks, fixed slots (QR caption, IRN hash), A5 / 80 mm overrides and the GST grid were sized for
 * one page, and at 12px a short invoice ran onto a second page. Only these files may use the marker.
 */
const PAPER = /^src\/components\/templates\/(invoice-paper|parts\/[\w-]+)\.module\.css$/;
/** 58 mm thermal roll: the 32-character text receipt fits the roll only at 11px. */
const SMALL_FILE_OK = new Set(['src/lib/escpos.ts']);

test('type system: nothing set below 12px', () => {
  const px = (v: number, u: string) => (u === 'rem' ? v * 16 : u === 'pt' ? (v * 4) / 3 : v);
  const re = /font-size\s*:\s*([0-9.]+)(px|rem|pt)\b|fontSize\s*:\s*['"`]?([0-9.]+)(px|rem|pt)?['"`]?|(?<![-\w])font\s*:\s*(?:[0-9]{3}\s+)?([0-9.]+)(px|rem|pt)[\s/]|--text-[\w-]+\s*:\s*([0-9.]+)(rem|px)/g;
  const bad: string[] = [];
  let exempt = 0;
  for (const { rel, src, code } of FILES) {
    if (SMALL_FILE_OK.has(rel)) continue;
    const raw = src.split('\n');
    code.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        const v = Number(m[1] ?? m[3] ?? m[5] ?? m[7]);
        const u = m[2] ?? m[4] ?? m[6] ?? m[8] ?? 'px';
        if (px(v, u) >= 12) continue;
        if (PAPER.test(rel) && /type-floor-exempt: \S/.test(raw[i])) exempt++;
        else bad.push(`${rel}:${i + 1}: ${m[0]}`);
      }
    });
  }
  assert.deepEqual(bad, []);
  assert.ok(exempt > 0 && exempt < 80, `printed-paper exceptions stay a short, reasoned list (${exempt})`);
});

test('type system: nothing heavier than 600', () => {
  const bad: string[] = [];
  for (const { rel, code } of FILES) {
    const re = /font-weight\s*:\s*(\d{3}|bold(?:er)?)\b|fontWeight\s*:\s*['"]?(\d{3}|bold(?:er)?)|(?<![-\w])font\s*:\s*(\d{3}|bold)\s/g;
    for (const m of code.matchAll(re)) {
      const w = m[1] ?? m[2] ?? m[3];
      if (/^bold/.test(w) || Number(w) > 600) bad.push(`${rel}: ${m[0]}`);
    }
  }
  // The one exception: the Noto Sans Devanagari bold file is a 700 cut (Hindi bold text resolves to it), declared
  // for the app and for standalone print documents.
  assert.deepEqual(bad, ['src/fonts.css: font-weight: 700', 'src/lib/print-fonts.ts: font-weight:700']);
});

test('type system: the Chartist faces cap their weights at 600', () => {
  const css = readFileSync(join(ROOT, 'src/fonts.css'), 'utf8');
  assert.match(css, /font-family: 'Chartist Sans Flex';[^}]*font-weight: 300 600;/);
  assert.match(css, /font-family: 'Chartist Sans';[^}]*font-weight: 600;/);
  assert.match(css, /font-family: 'Chartist Serif';[^}]*font-weight: 400;[^}]*font-style: italic;/);
  assert.match(css, /font-synthesis-weight: none/);
});
