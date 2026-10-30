/**
 * R6-C6: the documents tell the truth about what exists — every feature doc the roadmap names is present, and every
 * CA item id cited by the in-app help (R6-A2, `src/lib/help/*`, guarded until it is merged) exists in CA_REVIEW.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(p, 'utf8');

// R15: TV ids (travel and cross-cutting). TV sits before T so "TV1" is never read as "T" + junk (a digit must follow).
// R17: MP ids (manpower); MP sits before P so "MP1" is never read as "P1".
// R18: HS ids (housing societies); no id is a bare S, so "HS1" is never read as "S1".
// R19: LG ids (logistics). LG ends in G and CA_LIST_RE has no leading \b, so LG sits before G: "LG1" is never read as "G1".
// R21: FU ids (fuel). FU ends in U and no prefix is U or F, so "FU1" is never read as a shorter id.
// R22: SO ids (solar). SO ends in O and no prefix is O; S is in neither pattern, so "SO1" is never read as a shorter id.
const CITED_RE = /CA_REVIEW[^\n]*?\b((?:MF|MP|HS|LG|FU|SO|AG|G|TV|T|PS|PF|P|AC|I|X|CN|SV)\d{1,2})\b/g;
const CA_LIST_RE = /(?:MF|MP|HS|CN|SV|AG|LG|FU|SO|G|TV|T|PS|PF|P|AC|I|X)\d{1,2}/g;

test('every docs/features/*.md path named in the roadmap exists', () => {
  const roadmap = read('docs/ROADMAP.md');
  const named = [...new Set(roadmap.match(/docs\/features\/[a-z0-9-]+\.md/g) ?? [])];
  assert.ok(named.length > 40, 'the roadmap names its feature docs');
  const missing = named.filter((p) => !existsSync(p));
  assert.deepEqual(missing, []);
});

test('CA_REVIEW ids are unique, and every id the help cites exists there', () => {
  const full = read('docs/CA_REVIEW.md');
  // The R6-C notes section only cites ids; every other section defines them (Rounds 7–8 append HT / TR sections).
  const notesAt = full.indexOf('## Round 6 (R6-C)');
  const notesEnd = notesAt < 0 ? -1 : full.indexOf('\n## ', notesAt + 1);
  const ca = notesAt < 0 ? full : full.slice(0, notesAt) + (notesEnd < 0 ? '' : full.slice(notesEnd));
  const rows = [...ca.matchAll(/^\| ([A-Z]{1,2}\d+)(?: ★)? \|/gm)].map((m) => m[1]);
  const total = Number(/^\| \*\*Total\*\* \| \| \*\*(\d+)\*\* \|/m.exec(full)?.[1]);
  assert.ok(rows.length >= 160, 'the pack keeps at least its 160 Round 2–5 items');
  assert.equal(rows.length, total, 'the summary table total matches the id rows');
  assert.equal(new Set(rows).size, rows.length, 'no id twice');
  const ids = new Set(rows);
  const helpDir = 'src/lib/help';
  if (!existsSync(helpDir)) return; // R6-A2 not merged on this branch yet
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|json)$/.test(f)) files.push(p);
    }
  };
  walk(helpDir);
  const cited = new Set<string>();
  for (const f of files) for (const m of read(f).matchAll(CITED_RE)) cited.add(m[1]);
  for (const f of files) for (const m of read(f).matchAll(/\bca:\s*\[([^\]]*)\]/g)) for (const id of m[1].match(CA_LIST_RE) ?? []) cited.add(id);
  assert.deepEqual([...cited].filter((id) => !ids.has(id)), []);
});

test('feature docs that hand statutory points to a CA point at the consolidated pack', () => {
  for (const doc of ['collections-r2', 'sales-r2', 'docs-compliance-r3', 'production-r4', 'marketplace-r5', 'transport-works-r5', 'institutions-property-r5']) {
    assert.match(read(`docs/features/${doc}.md`), /Consolidated in `docs\/CA_REVIEW\.md` \(ids /, doc);
  }
});

test('R15: CA-id patterns read TV ids whole and never confuse them with T ids', () => {
  assert.deepEqual([...'see CA_REVIEW TV1 and CA_REVIEW T12'.matchAll(CITED_RE)].map((m) => m[1]), ['TV1', 'T12']);
  assert.deepEqual("ca: ['TV1', 'T3', 'TV26']".match(CA_LIST_RE), ['TV1', 'T3', 'TV26']);
  assert.equal('TVQ1'.match(CA_LIST_RE), null);
});

test('R16: CA-id patterns read PF ids whole and never confuse them with P ids', () => {
  assert.deepEqual([...'see CA_REVIEW PF1 and CA_REVIEW P1'.matchAll(CITED_RE)].map((m) => m[1]), ['PF1', 'P1']);
  assert.deepEqual("ca: ['PF1', 'P1', 'PF18']".match(CA_LIST_RE), ['PF1', 'P1', 'PF18']);
  const row = /^\| ((?:G|TR|TV|T|PS|PF|P|AC|I|X|HT|RT|CN|SV|AG|MF)\d+)\b/gm;
  assert.deepEqual([...'| PF1 ★ | x |\n| P1 | y |'.matchAll(row)].map((m) => m[1]), ['PF1', 'P1']);
});

test('R17: CA-id patterns read MP ids whole and never confuse them with P ids', () => {
  assert.deepEqual([...'see CA_REVIEW MP1 and CA_REVIEW P1'.matchAll(CITED_RE)].map((m) => m[1]), ['MP1', 'P1']);
  assert.deepEqual("ca: ['MP1', 'P1', 'MP32']".match(CA_LIST_RE), ['MP1', 'P1', 'MP32']);
  const row = /^\| ((?:G|TR|TV|T|PS|PF|P|AC|I|X|HT|RT|CN|SV|AG|MF|MP)\d+)\b/gm;
  assert.deepEqual([...'| MP1 ★ | x |\n| P1 | y |'.matchAll(row)].map((m) => m[1]), ['MP1', 'P1']);
});

test('R18: CA-id patterns read HS ids whole and never as S / H ids', () => {
  assert.deepEqual([...'see CA_REVIEW HS1 and CA_REVIEW SV1'.matchAll(CITED_RE)].map((m) => m[1]), ['HS1', 'SV1']);
  assert.deepEqual("ca: ['HS1', 'S3', 'HS44']".match(CA_LIST_RE), ['HS1', 'HS44']);
  const row = /^\| ((?:G|TR|TV|T|PS|PF|P|AC|I|X|HT|RT|CN|SV|AG|MF|MP|HS)\d+)\b/gm;
  assert.deepEqual([...'| HS1 ★ | x |\n| HT1 | y |\n| S1 | z |'.matchAll(row)].map((m) => m[1]), ['HS1', 'HT1']);
  assert.ok(!'xHS1'.match(/\b(?:HS)\d/), 'a digit and a word boundary bound the id');
});

test('R19: CA-id patterns read LG ids whole and never as G ids; G alone still reads as G', () => {
  assert.deepEqual([...'see CA_REVIEW LG1 and CA_REVIEW G1'.matchAll(CITED_RE)].map((m) => m[1]), ['LG1', 'G1']);
  assert.deepEqual("ca: ['LG1', 'G1', 'LG44', 'AG3']".match(CA_LIST_RE), ['LG1', 'G1', 'LG44', 'AG3']);
  assert.deepEqual("ca: ['LG1']".match(CA_LIST_RE), ['LG1'], 'LG1 is never read as G1');
  const row = /^\| ((?:G|TR|TV|T|PS|PF|P|AC|I|X|HT|RT|CN|SV|AG|MF|MP|HS|LG)\d+)\b/gm;
  assert.deepEqual([...'| LG1 ★ | x |\n| G1 | y |\n| AG1 | z |'.matchAll(row)].map((m) => m[1]), ['LG1', 'G1', 'AG1']);
});

test('R21: CA-id patterns read FU ids whole', () => {
  assert.deepEqual("ca: ['FU1', 'P1', 'FU30']".match(CA_LIST_RE), ['FU1', 'P1', 'FU30']);
  assert.equal('FUZ1'.match(CA_LIST_RE), null, 'FU needs a digit');
  assert.deepEqual('FUX1'.match(CA_LIST_RE), ['X1'], 'never an FU id without its digit');
  assert.deepEqual([...'see CA_REVIEW FU12 and CA_REVIEW P1'.matchAll(CITED_RE)].map((m) => m[1]), ['FU12', 'P1']);
  const row = /^\| ((?:G|TR|TV|T|PS|PF|P|AC|I|X|HT|RT|CN|SV|AG|MF|MP|HS|LG|FU)\d+)\b/gm;
  assert.deepEqual([...'| FU1 ★ | x |\n| P1 | y |\n| FU30 | z |'.matchAll(row)].map((m) => m[1]), ['FU1', 'P1', 'FU30']);
});

test('R22: CA-id patterns read SO ids whole', () => {
  assert.deepEqual("ca: ['SO1', 'P1', 'SO36']".match(CA_LIST_RE), ['SO1', 'P1', 'SO36']);
  assert.equal('SOZ1'.match(CA_LIST_RE), null, 'SO needs a digit');
  assert.deepEqual('SOX1'.match(CA_LIST_RE), ['X1'], 'never an SO id without its digit');
  assert.equal('Sl. 66'.match(CA_LIST_RE), null, 'a notification serial is not an id');
  assert.deepEqual([...'see CA_REVIEW SO11 and CA_REVIEW P1'.matchAll(CITED_RE)].map((m) => m[1]), ['SO11', 'P1']);
  const full = readFileSync('docs/CA_REVIEW.md', 'utf8');
  const so = [...full.matchAll(/^\| (SO\d+)(?: ★)? \|/gm)].map((m) => m[1]);
  assert.deepEqual(so, Array.from({ length: 36 }, (_, i) => `SO${i + 1}`), 'SO1–SO36 listed once, in order');
});
