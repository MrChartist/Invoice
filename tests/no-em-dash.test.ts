/**
 * Lock-in for the writing rule of the type system (docs/theme/TYPE-SYSTEM.md section 5): no em dash (U+2014) in
 * visible text. Scans every string, template and JSX text token of src/**\/*.{ts,tsx} (UI strings in
 * src/i18n/areas in English and Hindi, help topics, What's new, templates and print documents, messages, CSV
 * headers ...) plus index.html and public/offline.html. Comments are free; regular-expression literals are code (a
 * reader may still match old stored text that holds an em dash).
 *
 * Sentences use a comma, a colon, a full stop or brackets; an empty cell is a plain hyphen "-".
 * Every exception below names its reason.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..');
const DASH = '\u2014';

/**
 * Stored identifiers, not text: ledgers created or found by name on first use (renaming one would open a second
 * ledger beside the user's existing one) and voucher classes that readers match exactly. `file` + exact text.
 */
const ALLOWED: readonly { file: string; text: string; reason: string }[] = [
  ...[
    'src/lib/agri/ag-cycle-post.ts', 'src/lib/agri/ag-members.ts',
  ].map((file) => ({ file, text: 'Share application money — members', reason: 'ledger found / created by name (AG cycles)' })),
  { file: 'src/lib/agri/ag-cycle-post.ts', text: 'Other deductions — farmers', reason: 'ledger found / created by name' },
  { file: 'src/lib/agri/ag-members.ts', text: 'Share capital — members', reason: 'ledger found / created by name' },
  { file: 'src/lib/agri/ag-patronage.ts', text: 'Dividend payable — members', reason: 'ledger found / created by name' },
  { file: 'src/lib/agri/ag-patronage.ts', text: 'Patronage bonus payable — members', reason: 'ledger found / created by name' },
  { file: 'src/lib/construction/cn-procurement80.ts', text: 'RCM — 80% procurement shortfall', reason: 'stored voucher class' },
  { file: 'src/lib/construction/cn-recoveries.ts', text: 'Material issued by client — recovery', reason: 'ledger found / created by name' },
  { file: 'src/lib/works/deductions.ts', text: 'Material issued by client — recovery', reason: 'ledger found / created by name' },
  { file: 'src/lib/construction/cn-subcon-bill.ts', text: 'Other recoveries — sub-contractors', reason: 'ledger found / created by name' },
  { file: 'src/lib/fuel/fu-shared.ts', text: 'Counter sales — fuel', reason: 'ledger created by name on first use (R21-B day close)' },
  { file: 'src/lib/fuel/fu-shared.ts', text: 'Normal loss — evaporation / handling', reason: 'stored voucher class' },
  { file: 'src/lib/gst-reports.ts', text: 'ITC reversal — Rule 42 / 43', reason: 'stored voucher class, matched by readers' },
  { file: 'src/lib/trust/recycle-bin.ts', text: 'ITC reversal — Rule 42 / 43', reason: 'stored voucher class, matched by readers' },
  { file: 'src/lib/institutions/r5c.ts', text: 'Donations — corpus fund', reason: 'ledger found / created by name' },
  { file: 'src/lib/marketplace/settlement-post.ts', text: 'GST on marketplace fees — awaiting invoice', reason: 'ledger found / created by name' },
  { file: 'src/lib/no-cash.ts', text: 'Sundry creditors — exchange', reason: 'ledger found / created by name (R9 exchange receipts)' },
  { file: 'src/lib/prof/ps-yearend.ts', text: 'Professional fees — unbilled', reason: 'ledger found / created by name each year end' },
  { file: 'src/lib/service-rules.ts', text: 'Referral fees — disallowable (Sec 37)', reason: 'ledger found / created by name' },
  { file: 'src/lib/works/ra-receivable.ts', text: 'Water & electricity — site', reason: 'ledger found / created by name' },
];

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
};

const TEXT_KINDS = new Set([
  ts.SyntaxKind.StringLiteral, ts.SyntaxKind.NoSubstitutionTemplateLiteral, ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle, ts.SyntaxKind.TemplateTail, ts.SyntaxKind.JsxText,
]);

/** Em dashes in the text tokens of one source file (comments and regex literals are not tokens of this kind). */
function dashTokens(file: string): { line: number; text: string }[] {
  const src = readFileSync(file, 'utf8');
  if (!src.includes(DASH)) return [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (TEXT_KINDS.has(node.kind)) {
      const raw = node.getText(sf);
      if (raw.includes(DASH)) {
        const text = node.kind === ts.SyntaxKind.JsxText ? raw : (node as ts.LiteralLikeNode).text;
        out.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

test('writing rule: no em dash in visible text in src (strings, templates, JSX text)', () => {
  const used = new Set<number>();
  const bad: string[] = [];
  for (const f of walk(join(ROOT, 'src'))) {
    const rel = relative(ROOT, f).split('\\').join('/');
    for (const { line, text } of dashTokens(f)) {
      const i = ALLOWED.findIndex((a) => a.file === rel && a.text === text);
      if (i >= 0) used.add(i);
      else bad.push(`${rel}:${line}: ${JSON.stringify(text.trim().slice(0, 100))}`);
    }
  }
  assert.deepEqual(bad, [], 'use a comma, a colon, a full stop or brackets; an empty cell is "-"');
  const stale = ALLOWED.filter((_, i) => !used.has(i)).map((a) => `${a.file}: ${a.text}`);
  assert.deepEqual(stale, [], 'allow-list entries that no longer match anything: remove them');
});

test('writing rule: every allow-list entry has a reason and really holds an em dash', () => {
  for (const a of ALLOWED) {
    assert.ok(a.reason.trim().length > 10, `${a.file}: give a reason`);
    assert.ok(a.text.includes(DASH), `${a.file}: ${a.text}`);
  }
});

test('writing rule: no em dash in index.html or public/offline.html (outside comments)', () => {
  for (const f of ['index.html', 'public/offline.html']) {
    const html = readFileSync(join(ROOT, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!html.includes(DASH) && !/&mdash;|&#8212;|&#x2014;/i.test(html), f);
  }
});

test('writing rule: no &mdash; entity in JSX', () => {
  const bad = walk(join(ROOT, 'src'))
    .filter((f) => f.endsWith('.tsx') && /&mdash;|&#8212;|&#x2014;/i.test(readFileSync(f, 'utf8')))
    .map((f) => relative(ROOT, f));
  assert.deepEqual(bad, []);
});
