/**
 * Lock-in for the Mr Chartist button system (docs/theme/BUTTON-SYSTEM.md, src/styles/buttons.css).
 *  - every rule for a pressable kind lives in src/styles/buttons.css, loaded at first paint after index.css;
 *  - the app's CSS-module button classes (controls.btnPrimary …) only compose those kinds, never paint a button;
 *  - a module class that composes a kind never adds its own background / border / radius / shadow / colour;
 *  - no button, chip, tab or toggle is filled with the blue / gold palette or a tint of it (no wine, gold or tint), nor
 *    with the app tint (`--tint`, `--tint-soft`) or a system colour (`--sys-*`), except a selected item's selection fill;
 *  - the legacy hand-styled button rules do not grow (a ratchet: convert one, lower the number).
 * Invoice templates and printed documents are out of scope (they are not interactive UI).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const SHARED = 'src/styles/buttons.css';

const walk = (d: string, ext: RegExp): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p, ext) : ext.test(n) ? [p] : [];
  });
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');
/** Printed / exported documents are not interactive UI. */
const OUT_OF_SCOPE = /^src\/components\/templates\//;
const cssFiles = walk(SRC, /\.css$/).map(rel).filter((f) => !OUT_OF_SCOPE.test(f));

interface Rule { file: string; selector: string; body: string }
function rules(file: string): Rule[] {
  const css = readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Rule[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim().replace(/\s+/g, ' ');
    if (selector.startsWith('@')) continue;
    out.push({ file, selector, body: m[2] });
  }
  return out;
}
const all = cssFiles.flatMap(rules);

const PAINT = /(^|;|\s)(background(-color|-image)?|border(-radius|-color|-top|-bottom|-left|-right)?|box-shadow)\s*:/;
const KINDS = /\b(btn|chip|seg-item|seg|join|lk)\b/;

test('the shared stylesheet holds every kind and loads at first paint after index.css', () => {
  const css = readFileSync(join(ROOT, SHARED), 'utf8');
  for (const k of ['.btn', '.join', '.seg', '.chip', '.lk', '.btn.icon', '.btn.round']) assert.ok(css.includes(k), `${k} missing`);
  for (const i of ['primary', 'quiet', 'glass', 'buy', 'sell', 'danger']) assert.ok(css.includes(`.btn.${i}`), `intent ${i} missing`);
  for (const s of ['xs', 'sm', 'lg', 'xl', 'stack', 'full', 'rect']) assert.ok(css.includes(`.btn.${s}`), `size / shape ${s} missing`);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /a11y-motion-reduce/);
  assert.match(css, /data-motion='still'/);
  assert.match(css, /outline-offset: -4px/, 'focus ring drawn inside the shape');
  const main = readFileSync(join(SRC, 'main.tsx'), 'utf8');
  const a = main.indexOf("import './index.css'");
  const b = main.indexOf("import './styles/buttons.css'");
  assert.ok(a >= 0 && b > a, 'main.tsx imports styles/buttons.css right after index.css');
});

test('no other stylesheet styles the global kinds', () => {
  const bad = all.filter((r) => r.file !== SHARED && (/:global\(\s*\.(btn|chip|seg|seg-item|join|lk)\b/.test(r.selector) || (!r.file.endsWith('.module.css') && KINDS.test(r.selector.replace(/[^.\w-]/g, ' ').split(' ').filter((x) => x.startsWith('.')).join(' ')))));
  assert.deepEqual(bad.map((r) => `${r.file} ${r.selector}`), []);
});

test('controls.module.css only maps the app classes onto the kinds', () => {
  const f = 'src/styles/controls.module.css';
  for (const r of rules(f)) {
    if (!/\.(btn|segment|link)\w*/.test(r.selector)) continue;
    const decl = r.body.split(';').map((d) => d.trim()).filter(Boolean);
    assert.ok(decl.every((d) => /^composes:\s*[\w\s-]+from global$/.test(d)), `${r.selector} must only compose from global: ${r.body.trim()}`);
  }
});

test('a class that composes a kind never paints its own button', () => {
  const bad: string[] = [];
  for (const file of cssFiles.filter((f) => f.endsWith('.module.css'))) {
    const rs = rules(file);
    const composing = new Set(
      rs.filter((r) => /composes:[^;]*\b(btn|chip|seg-item|seg|lk)\b[^;]*from global/.test(r.body)).map((r) => r.selector.replace(/^\./, '')),
    );
    for (const r of rs) {
      const classes = [...r.selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
      if (!classes.some((c) => composing.has(c))) continue;
      // A container (`.seg` / `.join`) may still lay itself out; nothing may repaint a kind.
      const body = r.body.replace(/composes:[^;]*;?/g, '');
      if (PAINT.test(body) || /(^|;|\s)color\s*:/.test(body)) bad.push(`${file} ${r.selector}`);
    }
  }
  assert.deepEqual(bad, []);
});

/** Pressable-looking selectors (buttons, chips, tabs, toggles, segments, calls to action). */
const PRESSABLE = /(btn|Btn|button|Button|chip|Chip|tab|Tab|seg|Seg|toggle|Toggle|cta|Cta)/;
/** The palette (blue / gold), its tints, or a raw colour. */
const PALETTE_FILL = /background(-color)?\s*:[^;]*(--primary|--brand|--pal-|--ring|--info|--warning|#[0-9a-f]{3,8}\b|rgba?\()/i;
/**
 * Allowed coloured pressables, with the reason. Keys are `file selector`.
 */
const COLOUR_ALLOW: Record<string, string> = {
  'src/components/interest/interest.module.css .chip': 'interest note badge (span), not pressable',
  'src/components/inventory/inventory.module.css .chipLow': 'stock status badge (span, StockChip), not pressable',
  'src/components/inventory/inventory.module.css .serialChip': 'serial-number tag (span), not pressable',
  'src/components/pos/pos.module.css .chip': 'POS status badge (span), not pressable',
  'src/components/services-r10/services.module.css .chip': 'appointment card on the front-desk board, coloured by its status',
};

test('no button, chip, tab or toggle is filled with the palette or a tint (no gold, blue, wine or tint)', () => {
  const hits = all
    .filter((r) => r.file !== SHARED && PRESSABLE.test(r.selector) && PALETTE_FILL.test(r.body))
    .map((r) => `${r.file} ${r.selector}`);
  const stale = Object.keys(COLOUR_ALLOW).filter((k) => !hits.includes(k));
  assert.deepEqual(stale, [], 'remove allow-list entries that no longer match');
  const bad = hits.filter((k) => !COLOUR_ALLOW[k]);
  assert.deepEqual(bad, [], 'use a kind from src/styles/buttons.css (primary = ink, danger = loss red) instead');
});

/** The app tint and the system colours (`--tint`, `--tint-soft`, `--sys-*`) never fill a pressable either. */
const TINT_FILL = /background(-color)?\s*:[^;]*(--tint|--sys-)/i;
/** `tab` but not `table` (a table row is not a pressable kind). */
const PRESSABLE_NOT_TABLE = /(btn|Btn|button|Button|chip|Chip|tab(?!le)|Tab(?!le)|seg|Seg|toggle|Toggle|cta|Cta)/;
/**
 * Spec-allowed tint: the 2px selected bar drawn by a pseudo-element, and the `--tint-soft` selection fill of a selected
 * item in a side list (IOS-UI.md: "selected = --tint-soft fill", sidebar and wide-frame section lists).
 */
const SELECTION = /\[aria-(selected|current|checked|pressed)(='true')?\]|Active\b|Selected\b/;
const isIndicator = (r: Rule) => /::(after|before)$/.test(r.selector);
const isSelectionFill = (r: Rule) =>
  SELECTION.test(r.selector) && [...r.body.matchAll(/background(-color)?\s*:\s*([^;]+)/g)].every((m) => m[2].trim() === 'var(--tint-soft)');
const TINT_ALLOW: Record<string, string> = {
  'src/components/ui/Toggle.module.css .toggle:checked': 'switch on state is system green (spec controls): a switch track, not a button fill',
  'src/components/inventory/inventory.module.css .chipOk': 'stock status badge (span, StockChip), not pressable',
  'src/components/inventory/inventory.module.css .chipOut': 'stock status badge (span, StockChip), not pressable',
  'src/components/inventory/inventory.module.css .chipNegative': 'stock status badge (span, StockChip), not pressable',
};

test('no button, chip, tab or toggle is filled with the tint or a system colour (tinted buttons)', () => {
  const hits = all
    .filter((r) => r.file !== SHARED && PRESSABLE_NOT_TABLE.test(r.selector) && TINT_FILL.test(r.body))
    .filter((r) => !isIndicator(r) && !isSelectionFill(r))
    .map((r) => `${r.file} ${r.selector}`);
  const stale = Object.keys(TINT_ALLOW).filter((k) => !hits.includes(k));
  assert.deepEqual(stale, [], 'remove allow-list entries that no longer match');
  const bad = hits.filter((k) => !TINT_ALLOW[k]);
  assert.deepEqual(bad, [], 'buttons are ink / quiet / glass / danger (src/styles/buttons.css), never tinted');
});

test('no inline coloured fill on a button in TSX', () => {
  const ALLOW = new Set(['src/components/design/DesignLabels.tsx', 'src/components/design/DesignPanel.tsx']); // colour swatches
  const bad: string[] = [];
  for (const p of walk(SRC, /\.tsx$/)) {
    const f = rel(p);
    if (OUT_OF_SCOPE.test(f) || ALLOW.has(f)) continue;
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/<button\b[^>]*?style=\{\{([^}]*)\}\}/g)) {
      if (/background(Color)?:\s*'(?!none|transparent)/.test(m[1]) || /color:\s*'var\(--(destructive|loss|primary|brand)/.test(m[1])) bad.push(f);
    }
    for (const m of src.matchAll(/btn\w*\}?`?\}?\s*style=\{\{([^}]*)\}\}/g)) {
      if (/background|[^-]color:|borderRadius|boxShadow/.test(m[1])) bad.push(f);
    }
  }
  assert.deepEqual(bad, []);
});

/**
 * Ratchet: legacy module classes that still hand-paint a button (selector names a button and the rule sets a background,
 * radius or shadow). They predate the system; convert them to a kind and lower the number — never raise it.
 */
const LEGACY_HAND_STYLED_MAX = 34;

test('legacy hand-styled buttons only go down', () => {
  const legacy = all.filter(
    (r) => r.file !== SHARED && r.file !== 'src/styles/controls.module.css' && /(btn|Btn|button|Button)/.test(r.selector) && /(^|;|\s)(background(-color)?|border-radius|box-shadow)\s*:/.test(r.body),
  );
  assert.ok(legacy.length <= LEGACY_HAND_STYLED_MAX, `${legacy.length} hand-styled button rules (max ${LEGACY_HAND_STYLED_MAX}); use src/styles/buttons.css:\n${legacy.map((r) => `${r.file} ${r.selector}`).join('\n')}`);
});
