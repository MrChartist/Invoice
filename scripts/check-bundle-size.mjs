#!/usr/bin/env node
/**
 * Bundle budget check (gzip). Fails CI when budgets are exceeded.
 *  - initial: JS the browser must download before first paint (entry + modulepreloads
 *             listed in dist/index.html).
 *  - entry:   the entry chunk alone.
 *  - total:   R16-A4: the CORE precache = all JS in dist/assets minus the language packs listed in
 *             dist/lang-manifest.json (what every English device installs and updates).
 *  - Hindi pack / regional pack: the language packs, precached only on devices in that language.
 *  - initial files: how many JS files first paint fetches (entry + runtime + the three named groups).
 * Post-build invariants (R16-A1 / A2, read from build-meta/chunks.json written by scripts/vite-safe-groups.mjs):
 *  - Hindi leak: Devanagari string bytes left in English chunks (gz estimate: blank them and re-gzip) stay under
 *    the total cap, and under 1 kB per chunk unless the chunk holds an allow-listed bilingual module;
 *  - every module of an `f-*` chunk matches its family; every `lazy-leaves` / `lazy-leaves-ui` module imports only
 *    first-paint / vendor modules (and is no stylesheet), and each leaves chunk stays under its cap; `html-esc` / `day-math` never reach first paint.
 * Override with env BUDGET_INITIAL_GZ_KB, BUDGET_ENTRY_GZ_KB, BUDGET_TOTAL_GZ_KB, BUDGET_INITIAL_FILES,
 * BUDGET_LANG_HI_GZ_KB, BUDGET_LANG_REGIONAL_GZ_KB, BUDGET_HI_LEAK_GZ_KB.
 */
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const kb = (n) => n / 1024;
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;
const env = (k, d) => Number(process.env[k] ?? d);

const BUDGET_INITIAL = env('BUDGET_INITIAL_GZ_KB', 185);
// Raised from 90 to 100 in R15-A1: since `codeSplitting.groups` gained the `app-initial` ($initial) group, the
// entry chunk holds ALL first-paint app code (it was ten small shared chunks before). The initial budget (185 kB)
// above is the binding limit; this one only catches an entry that swallows vendor code.
const BUDGET_ENTRY = env('BUDGET_ENTRY_GZ_KB', 100);
// R15-A1: entry + rolldown runtime + vendor-react + vendor-ui (+ one spare). More means a first-paint module
// escaped the app-initial group.
const BUDGET_INITIAL_FILES = env('BUDGET_INITIAL_FILES', 5);
// Raised from 650 in Phase 3 (TDS register, compliance, purchases, FX): all of it is lazily loaded
// per page, so first paint (the initial budget above) is unchanged; this is the one-time offline
// precache download. Raised again to 900 in Phase 6 (ledger, orders, inventory tracking, cheques,
// cost centres, composition, companies, vault…): every feature is a lazy page/tab chunk, and the
// shell was trimmed at the same time (backup actions, Forgot-PIN erase loaded on demand), so first
// paint stays under the unchanged 185 kB initial budget.
// Raised to 1150 for 5.4 round 2 (Hindi strings live beside English in each lazy area chunk) and the
// Phase 7 Tally-parity modules (payroll, manufacturing, TDS, gateway, reports engine): all lazy, first
// paint unchanged; this is the one-time offline precache (~1 MB gz for the whole app).
// Raised to 1400 for the Tally-parity work packages WP-1…WP-9 (masters, returns, printing, banking, business
// extras, GST depth, migration / audit): every new screen is lazy, so first paint is unchanged.
// Raised to 1600 for 7M–7P (job work / ITC-04, branch books, GST & TDS follow-ups, payroll depth): all lazy.
// Raised to 2000 for Phase 8 (competitor parity: khata loop, phone & counter, bill capture, GST guards,
// distribution / pharma): every new screen is lazy and initial JS stays under its 185 kB budget.
// Raised to 2400 for rounds 2–3 (collections, sales documents, annual pack, restaurant, service billing, compliance
// desks): all lazy route / dialog chunks precached for offline; first paint keeps its 185 kB budget.
// Raised to 2600 for round 4 and the round-5 industry packs, then to 2800 for the round-7 hotel and round-8 trading
// packs, then to 2900 for the round-9 retail and round-10 service packs, then to 3000 for the
// round-11 construction packs (all pack screens lazy, loaded only when a pack is on): every screen is a lazy chunk loaded only by companies that turn the pack on; first paint keeps its 185 kB budget.
// Raised to 3200 for the rest of round 10 (clinics, memberships, workshops) and the round-12 agriculture packs:
// same rule, every pack screen lazy, first paint unchanged.
// Raised to 3400 so the round-12 screens trimmed for size (cold-storage statements, loan interest, FPO patronage,
// input-dealer checks) can ship: same rule, lazy pack chunks only; first paint unchanged.
// Raised to 3500 for the round-14 professional-firm packs: same rule, lazy pack chunks only; first paint unchanged.
// R16-A4: lowered to 3300 and now measures the CORE precache only (all JS minus the language packs): Hindi left the
// English chunks (A1, −279 kB) and the safe family / leaves groups merged small chunks (A2). ≈ 190 kB for Round 17.
const BUDGET_TOTAL = env('BUDGET_TOTAL_GZ_KB', 3300);
// R16-A4: the language packs have their own budgets (Hindi = lang-hi-* area chunks + hi.ts; regional = regional.ts).
const BUDGET_LANG_HI = env('BUDGET_LANG_HI_GZ_KB', 400);
const BUDGET_LANG_REGIONAL = env('BUDGET_LANG_REGIONAL_GZ_KB', 25);
// R16-A1: Devanagari left in English chunks (help glossary / topics, keymap, WhatsApp texts, bilingual prints).
const BUDGET_HI_LEAK = env('BUDGET_HI_LEAK_GZ_KB', 36);
const HI_LEAK_PER_CHUNK_KB = 1;
const LEAVES_MAX_KB = 20;
/**
 * Modules allowed to keep Hindi in an English chunk above the per-chunk cap, with the reason: text needed in every
 * UI language (WhatsApp messages, bilingual prints). PERF-6: help topics, glossary and tips left the list (their Hindi
 * moved to `lang-hi-help`, scripts/vite-hi-split.mjs `splitHelp`).
 */
const HI_LEAK_ALLOW = [
  /message-langs\./, // WhatsApp / SMS texts in Hindi, sent from an English interface too
  /keymap\./, // the bilingual shortcut sheet
  /amount-in-words-hi\./, // bilingual amount in words on printed invoices
  /construction-r11-paper\.|works-text\./, // the bilingual works paper (HI_INLINE)
  /gateway\./, // the bilingual Gateway menu (HI_INLINE)
  /einvoice-print\./, // bilingual e-invoice print
  /whats-new\./, // What's new (title + hi per row)
];

const meta = (() => {
  const f = fileURLToPath(new URL('../build-meta/chunks.json', import.meta.url));
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
})();
const langs = existsSync(join(dist, 'lang-manifest.json')) ? JSON.parse(readFileSync(join(dist, 'lang-manifest.json'), 'utf8')) : { hi: [], regional: [] };
const packOf = new Map([...langs.hi.map((f) => [f, 'hi']), ...langs.regional.map((f) => [f, 'regional'])]);

const html = readFileSync(join(dist, 'index.html'), 'utf8');
// De-duplicated: with an import cycle Vite emits the entry both as the script and as a modulepreload.
const initial = [...new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]))];
const entry = html.match(/<script[^>]+src="\/(assets\/[^"]+\.js)"/)?.[1];
const all = readdirSync(join(dist, 'assets')).filter((f) => f.endsWith('.js'));

const initialGz = initial.reduce((s, f) => s + gz(join(dist, f)), 0);
const entryGz = entry ? gz(join(dist, entry)) : 0;
const sizes = new Map(all.map((f) => [`assets/${f}`, gz(join(dist, 'assets', f))]));
const sum = (pred) => [...sizes].filter(([f]) => pred(f)).reduce((s, [, n]) => s + n, 0);
const coreGz = sum((f) => !packOf.has(f));
const hiGz = sum((f) => packOf.get(f) === 'hi');
const regionalGz = sum((f) => packOf.get(f) === 'regional');

const rows = [
  ['initial JS (gz)', kb(initialGz), BUDGET_INITIAL],
  ['entry chunk (gz)', kb(entryGz), BUDGET_ENTRY],
  ['core precache (gz)', kb(coreGz), BUDGET_TOTAL],
  ['Hindi pack (gz)', kb(hiGz), BUDGET_LANG_HI],
  ['regional pack (gz)', kb(regionalGz), BUDGET_LANG_REGIONAL],
];
let bad = false;
const fail = (msg) => {
  bad = true;
  console.log(`FAIL ${msg}`);
};
if (initial.length > BUDGET_INITIAL_FILES) bad = true;
console.log(`${initial.length <= BUDGET_INITIAL_FILES ? 'ok  ' : 'FAIL'} ${'initial files'.padEnd(18)} ${String(initial.length).padStart(7)}    / budget ${BUDGET_INITIAL_FILES}`);
for (const [name, v, b] of rows) {
  const ok = v <= b;
  if (!ok) bad = true;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(18)} ${v.toFixed(1).padStart(7)} kB / budget ${b} kB`);
}
console.log(`initial files: ${initial.join(', ')}`);
console.log(`all JS ${kb(coreGz + hiGz + regionalGz).toFixed(1)} kB in ${all.length} files (core ${all.length - packOf.size}, packs ${packOf.size})`);

// ── R16-A1: language packs exist; no lang-* chunk outside the manifest ─────────────────────────────
if (!langs.hi.length || !langs.regional.length) fail('lang-manifest.json lists no Hindi or no regional pack (is scripts/vite-hi-split.mjs in vite.config.ts?)');
for (const f of all) if (/^lang-/.test(f) && !packOf.has(`assets/${f}`)) fail(`assets/${f} looks like a language pack but is not in lang-manifest.json`);
for (const f of initial) if (packOf.has(f)) fail(`${f} is a language pack loaded at first paint`);

// ── R16-A1: Hindi leak check ─────────────────────────────────────────────────────────────────────────
/** gz estimate of a file's Devanagari text: gzip size minus the gzip size with every Devanagari run blanked. */
const DEVANAGARI_RUN = /[\u0900-\u097F](?:[^`'"\n\\]*[\u0900-\u097F])?/g;
function hindiGz(file) {
  const src = readFileSync(join(dist, file), 'utf8');
  if (!/[\u0900-\u097F]/.test(src)) return 0;
  const z = (t) => gzipSync(Buffer.from(t), { level: 9 }).length;
  return Math.max(0, z(src) - z(src.replace(DEVANAGARI_RUN, '')));
}
const chunkMeta = meta?.chunks ?? {};
const allowed = (file) => (chunkMeta[file]?.modules ?? []).some((m) => HI_LEAK_ALLOW.some((re) => re.test(m)));
let leak = 0;
const leaks = [];
for (const f of sizes.keys()) {
  if (packOf.has(f)) continue;
  const n = hindiGz(f);
  if (!n) continue;
  leak += n;
  if (kb(n) > HI_LEAK_PER_CHUNK_KB && !allowed(f)) leaks.push([f, n]);
}
console.log(`${kb(leak) <= BUDGET_HI_LEAK ? 'ok  ' : 'FAIL'} ${'Hindi in core (gz)'.padEnd(18)} ${kb(leak).toFixed(1).padStart(7)} kB / budget ${BUDGET_HI_LEAK} kB`);
if (kb(leak) > BUDGET_HI_LEAK) bad = true;
for (const [f, n] of leaks) {
  const mods = (chunkMeta[f]?.modules ?? []).filter((m) => !/node_modules/.test(m)).slice(0, 3).join(', ') || '(no build-meta)';
  fail(`Hindi strings re-entered English chunks: ${f} (${kb(n).toFixed(1)} kB) from ${mods}; use \`defineArea\` or add the module to \`HI_INLINE\` / the allow-list with a reason`);
}

// ── R16-A2: group invariants; R16-A3: shared helpers stay lazy ──────────────────────────────────────
if (!meta) {
  fail('build-meta/chunks.json missing: run `vite build` (scripts/vite-safe-groups.mjs writes it)');
} else {
  const families = Object.fromEntries(Object.entries(meta.families ?? {}).map(([n, src]) => [n, new RegExp(src)]));
  for (const [file, c] of Object.entries(meta.chunks)) {
    const fam = Object.keys(families).find((n) => c.name === n);
    if (fam) {
      const stray = c.modules.filter((m) => !families[fam].test('/' + m));
      if (stray.length) fail(`${file} (${fam}) holds modules outside its family: ${stray.slice(0, 5).join(', ')}`);
    }
    // PERF-5: `lazy-leaves-ui` (small leaves of src/components, store, hooks, i18n areas) has the same rules and cap.
    if (c.name === 'lazy-leaves' || c.name === 'lazy-leaves-ui') {
      for (const m of c.modules) {
        const bad = (meta.imports[m] ?? []).filter((d) => !d.fixed);
        if (bad.length) fail(`${file} (${c.name}): ${m} imports lazy code ${bad.map((d) => d.id).slice(0, 3).join(', ')}`);
        if (/\.css$/.test(m)) fail(`${file} (${c.name}): ${m} is a stylesheet (its styles would load with the group)`);
      }
      const n = kb(sizes.get(file) ?? 0);
      console.log(`${n <= LEAVES_MAX_KB ? 'ok  ' : 'FAIL'} ${`${c.name} (gz)`.padEnd(18)} ${n.toFixed(1).padStart(7)} kB / budget ${LEAVES_MAX_KB} kB`);
      if (n > LEAVES_MAX_KB) bad = true;
    }
  }
  if (!Object.keys(families).length) fail('no f-* family group recorded in build-meta/chunks.json');
  for (const f of initial) {
    const shared = (meta.chunks[f]?.modules ?? []).filter((m) => /src\/lib\/(html-esc|day-math)\.ts$/.test(m));
    if (shared.length) fail(`${shared.join(', ')} reached first paint (${f}); the shared helpers must stay lazy`);
  }
}
process.exit(bad ? 1 : 0);
