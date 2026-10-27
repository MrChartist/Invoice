/** R6-A3 glossary: every term used in src/ exists, every term has English and Hindi, and no value is promised. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GLOSSARY } from '../src/lib/help/glossary.ts';

const srcDir = join(import.meta.dirname, '../src');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });

test('at least 30 terms, each with English and Hindi definition and "in this app"', () => {
  const ids = Object.keys(GLOSSARY);
  assert.ok(ids.length >= 30, `${ids.length} terms`);
  for (const [id, g] of Object.entries(GLOSSARY)) {
    assert.ok(g.term.trim(), `${id}: term`);
    for (const lang of ['en', 'hi'] as const) {
      assert.ok(g[lang].def.trim() && g[lang].app.trim(), `${id}: ${lang} text`);
    }
    assert.match(g.hi.def, /[ऀ-ॿ]/, `${id}: Hindi definition is in Devanagari`);
  }
  for (const id of ['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp', 'nil', 'hsn', 'uqc', 'itc', 'rcm', 'ims', 'gstr2b', 'gstr3b-31', 'gstr3b-4a', 'gstr3b-4b1', 'gstr3b-4b2', 'gstr3b-4c', 'setoff', 'pmt06', 'rule86b', 'iff', 'aato', 'irn', 'eway-b', 'lut', 'isd', 'tds', 'tcs', '26as', 'form16a', '206aa', '43bh', 'udyam', 'sec393']) {
    assert.ok(id in GLOSSARY, `PRD term ${id} missing`);
  }
});

test('every <Term id="…"> in src/ names a glossary term', () => {
  let used = 0;
  for (const file of walk(srcDir)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/<Term id="([a-z0-9-]+)"/g)) {
      used++;
      assert.ok(m[1] in GLOSSARY, `${file}: unknown term ${m[1]}`);
    }
  }
  assert.ok(used >= 0);
  // Typed maps (TAB_TERM in GstReports, termOf in Gstr3bView) are checked by the compiler (GlossaryId).
  for (const file of ['pages/GstReports.tsx', 'components/gst-reports/Gstr3bView.tsx']) {
    for (const m of readFileSync(join(srcDir, file), 'utf8').matchAll(/'(gstr3b-[a-z0-9]+|eway-b)'/g)) assert.ok(m[1] in GLOSSARY, `${file}: ${m[1]}`);
  }
});

test('no glossary text states a percentage or rupee amount unless "as the app applies it"', () => {
  for (const [id, g] of Object.entries(GLOSSARY)) {
    const text = `${g.en.def} ${g.en.app}`;
    if (/₹\s?\d|\d\s?%/.test(text)) assert.match(text, /as the app applies/, `${id}: value without "as the app applies it"`);
    const hi = `${g.hi.def} ${g.hi.app}`;
    assert.ok(!/₹\s?\d|\d\s?%/.test(hi) || /जैसी ऐप|जैसा ऐप/.test(hi), `${id}: Hindi value without the qualifier`);
  }
});

test('CA ids cited by terms exist in docs/CA_REVIEW.md', () => {
  const ids = new Set([...readFileSync(join(import.meta.dirname, '../docs/CA_REVIEW.md'), 'utf8').matchAll(/^\| ((?:G|TR|T|P|AC|I|X|HT|RT|CN|SV)\d+)\b/gm)].map((m) => m[1])); // R9: RT ids; R11: CN ids; R10: SV ids
  for (const [id, g] of Object.entries(GLOSSARY)) for (const c of (g as { caItems?: readonly string[] }).caItems ?? []) assert.ok(ids.has(c), `${id}: ${c}`);
});
