/**
 * PENDING 49 (8.111): POS signature pad. The counter offers "Get signature" for the bill just saved; it reuses the
 * editor's R3-C2 dialog (canvas `SignaturePad`, no new dependency) as a lazy chunk, and the signature is stored as the
 * document's `delivery_proof` through `setDeliveryProof`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proofIssues } from '../src/lib/doc-evidence.ts';

const SIG = 'data:image/png;base64,iVBORw0KGgo=';

test('POS screen: lazy signature dialog for the last saved, unsigned bill', () => {
  const src = readFileSync('src/pages/Pos.tsx', 'utf8');
  assert.match(src, /lazy\(\(\) => import\('\.\.\/components\/creator\/DeliveryProofDialog'\)\)/);
  assert.ok(src.includes('data-pos-signature'));
  assert.ok(/posSignable\(lastBill\)/.test(src));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
  assert.ok(!Object.keys(pkg.dependencies).some((d) => /signature/i.test(d)), 'no new dependency');
});

test('a POS tax invoice / bill of supply takes a signature; a draft does not', () => {
  const input = { receiver: 'Asha', signature: SIG };
  assert.deepEqual(proofIssues({ doc_type: 'TAX_INVOICE', status: 'Paid' }, input), []);
  assert.deepEqual(proofIssues({ doc_type: 'BILL_OF_SUPPLY', status: 'Paid' }, input), []);
  assert.deepEqual(proofIssues({ doc_type: 'TAX_INVOICE', status: 'Draft' }, input), ['draft']);
});
