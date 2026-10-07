import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone, whatsappLink, mailtoLink, smsLink, telLink, upiLink, isValidUpiId,
  truncateForUrl, MAX_URL_LENGTH, formatPhoneDisplay,
} from '../src/lib/share.ts';

test('normalizePhone: 10-digit gets +91', () => {
  assert.equal(normalizePhone('9876543210'), '919876543210');
});
test('normalizePhone: spaces, dashes, brackets', () => {
  assert.equal(normalizePhone('98765 43210'), '919876543210');
  assert.equal(normalizePhone('(98765) 43-210'), '919876543210');
});
test('normalizePhone: +91 and 91 prefixes', () => {
  assert.equal(normalizePhone('+91 98765-43210'), '919876543210');
  assert.equal(normalizePhone('919876543210'), '919876543210');
});
test('normalizePhone: 0-prefixed and 00-prefixed', () => {
  assert.equal(normalizePhone('09876543210'), '919876543210');
  assert.equal(normalizePhone('0091 98765 43210'), '919876543210');
});
test('normalizePhone: other countries kept', () => {
  assert.equal(normalizePhone('+1 415 555 0100'), '14155550100');
  assert.equal(normalizePhone('+971501234567'), '971501234567');
});
test('normalizePhone: junk and too short', () => {
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(undefined), null);
  assert.equal(normalizePhone('abc'), null);
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('1'.repeat(20)), null);
});
test('normalizePhone: custom default country', () => {
  assert.equal(normalizePhone('5551234567', '1'), '15551234567');
});
test('formatPhoneDisplay', () => {
  assert.equal(formatPhoneDisplay('9876543210'), '+91 98765 43210');
});

test('whatsappLink encodes rupee, newlines and spaces', () => {
  const url = whatsappLink('98765 43210', 'Pay ₹1,200\nThanks & bye');
  assert.equal(url, 'https://wa.me/919876543210?text=Pay%20%E2%82%B91%2C200%0AThanks%20%26%20bye');
});
test('whatsappLink without phone uses the contact picker form', () => {
  assert.ok(whatsappLink('', 'hi').startsWith('https://wa.me/?text='));
});
test('whatsappLink is length-safe and never splits emoji', () => {
  const url = whatsappLink('9876543210', 'word 😀 '.repeat(2000));
  assert.ok(url.length <= MAX_URL_LENGTH);
  const text = decodeURIComponent(url.split('?text=')[1]);
  assert.ok(text.endsWith('…'));
});
test('truncateForUrl leaves short text alone', () => {
  assert.equal(truncateForUrl('short', 100), 'short');
});

test('mailtoLink: subject, body CRLF, cc', () => {
  const url = mailtoLink({
    to: 'a@b.com', cc: ['c@d.com', 'bad', 'e@f.com'], subject: 'Invoice ₹100', body: 'Line1\nLine2',
  });
  assert.ok(url.startsWith('mailto:a@b.com?'));
  assert.ok(url.includes('cc=c%40d.com,e%40f.com'));
  assert.ok(url.includes('subject=Invoice%20%E2%82%B9100'));
  assert.ok(url.includes('body=Line1%0D%0ALine2'));
});
test('mailtoLink: no recipient still valid', () => {
  assert.equal(mailtoLink({ subject: 'x' }), 'mailto:?subject=x');
});
test('mailtoLink: long body stays within budget', () => {
  assert.ok(mailtoLink({ to: 'a@b.com', body: 'line\n'.repeat(1000) }).length < 2100);
});

test('smsLink and telLink', () => {
  assert.equal(smsLink('9876543210', 'Hi\nthere'), 'sms:+919876543210?body=Hi%0Athere');
  assert.equal(telLink('09876543210'), 'tel:+919876543210');
  assert.equal(telLink('x'), null);
});

test('upiLink builds a spec-shaped link', () => {
  const url = upiLink({ pa: 'rohit@okaxis', pn: 'Mr Chartist & Co', amount: 1234.5, note: 'Payment for INV/FY25-26/0001' });
  assert.equal(
    url,
    'upi://pay?pa=rohit@okaxis&pn=Mr%20Chartist%20%26%20Co&am=1234.50&cu=INR&tn=Payment%20for%20INV%2FFY25-26%2F0001',
  );
});
test('upiLink rejects invalid VPA and omits bad amounts', () => {
  assert.equal(upiLink({ pa: 'nope' }), null);
  assert.ok(!upiLink({ pa: 'a.b@upi', amount: -5 })!.includes('am='));
  assert.ok(!upiLink({ pa: 'a.b@upi', amount: NaN })!.includes('am='));
  assert.equal(isValidUpiId('9876543210@ybl'), true);
});
