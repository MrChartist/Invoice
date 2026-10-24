import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClientCopyHtml, sanitizePaper } from '../src/lib/client-copy.ts';

const base = { title: 'Invoice INV/1', paperHtml: '<div class="paper">Hi</div>', css: '.paper{color:red}', business: 'A & B', generatedOn: '24 Oct 2026' };

test('a static page: strict CSP meta, no scripts, escaped text', () => {
  const html = buildClientCopyHtml({ ...base, title: '<b>x</b>' });
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.ok(!/<script/i.test(html));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('A &amp; B'));
  assert.ok(html.includes('.paper{color:red}'));
});

test('pay panel only carries a real upi:// link and image data URL', () => {
  const ok = buildClientCopyHtml({ ...base, pay: { amountText: '₹1,180.00', upiLink: 'upi://pay?pa=a@okhdfc&am=1180.00&cu=INR', upiId: 'a@okhdfc', qrDataUrl: 'data:image/png;base64,iVBORw0KGgo=' } });
  assert.ok(ok.includes('href="upi://pay?pa=a@okhdfc&amp;am=1180.00&amp;cu=INR"'));
  assert.ok(ok.includes('src="data:image/png;base64,iVBORw0KGgo="'));
  const bad = buildClientCopyHtml({ ...base, pay: { amountText: '1', upiLink: 'javascript:alert(1)', qrDataUrl: 'https://evil/x.png' } });
  assert.ok(!bad.includes('javascript:'));
  assert.ok(!bad.includes('evil'));
  assert.ok(!bad.includes('cc-btn" href'), 'no button without a valid link');
});

test('sanitizePaper drops scripts, inline handlers and javascript: URLs', () => {
  const s = sanitizePaper('<div onclick="x()"><script>alert(1)</script><a href="javascript:alert(2)">l</a><img src=x onerror=y></div>');
  assert.ok(!/script|onclick|onerror|javascript:/i.test(s));
});

test('a closing style tag inside CSS cannot break out', () => {
  const html = buildClientCopyHtml({ ...base, css: 'a{}</style><script>alert(1)</script>' });
  assert.ok(!html.includes('</style><script>'));
});
