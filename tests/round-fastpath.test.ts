/**
 * round2 / mulRound2 / pctOf / backOutPct take a float fast path away from a half-paisa boundary
 * (perf). These are the original string / BigInt implementations: the fast path must return the
 * very same number (Object.is, so -0 vs 0 counts) for every input.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backOutPct, mulRound2, pctOf, round2 } from '../src/lib/invoice-calc.ts';
import { rng } from './helpers/shim.ts';

function refRound2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const abs = Math.abs(n);
  const s = String(abs);
  const scaledN = s.includes('e') ? abs * 100 : Number(`${s}e2`);
  const r = Number(`${Math.round(scaledN)}e-2`);
  return n < 0 && r !== 0 ? -r : r;
}

function refScaled(x: number): { n: bigint; s: number } | null {
  if (!Number.isFinite(x)) return null;
  const str = String(x);
  if (str.includes('e') || str.includes('E')) return null;
  const neg = str.startsWith('-');
  const body = neg ? str.slice(1) : str;
  const dot = body.indexOf('.');
  const n = BigInt(dot < 0 ? body : body.slice(0, dot) + body.slice(dot + 1));
  return { n: neg ? -n : n, s: dot < 0 ? 0 : body.length - dot - 1 };
}

function refDiv(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const q = (2n * (neg ? -n : n) + d) / (2n * d);
  return neg ? -q : q;
}

function refMul(a: number, b: number, divisor = 1): number {
  const A = refScaled(a);
  const B = refScaled(b);
  if (!A || !B) return refRound2((a * b) / divisor);
  return Number(refDiv(A.n * B.n * 100n, 10n ** BigInt(A.s + B.s) * BigInt(divisor))) / 100;
}

function refBack(amount: number, ratePct: number): number {
  const A = refScaled(amount);
  const R = refScaled(Number(ratePct.toFixed(6)));
  if (!A || !R) return refRound2(amount / (1 + ratePct / 100));
  const scale = 10n ** BigInt(R.s);
  return Number(refDiv(A.n * 100n * 100n * scale, 10n ** BigInt(A.s) * (100n * scale + R.n))) / 100;
}

const same = (got: number, want: number, what: string) => assert.ok(Object.is(got, want), `${what}: got ${got}, want ${want}`);

test('round2 fast path equals the string-exact rounding', () => {
  const r = rng(2026);
  const fixed = [0, -0, 1.005, 2.345, -2.345, 0.285, 1.255, 0.125, 1e-7, 1.5e21, 1e13, 9.995, 10.005, 0.5, 0.005, -0.005, 123456789.125, 4.35, 8.675, NaN, Infinity, -Infinity];
  for (const v of fixed) same(round2(v), refRound2(v), `round2(${v})`);
  for (let i = 0; i < 60000; i++) {
    const k = i % 5;
    const v =
      k === 0 ? Math.round(r() * 1e7) / 1000
      : k === 1 ? (Math.round(r() * 1e6) + 0.5) / 100
      : k === 2 ? r() * 1e6 - 5e5
      : k === 3 ? (Math.round(r() * 2e5) / 100) * (Math.round(r() * 3000) / 100)
      : r() * 10 ** Math.floor(r() * 16);
    same(round2(v), refRound2(v), `round2(${v})`);
  }
});

test('mulRound2 / pctOf / backOutPct fast paths equal the exact BigInt results', () => {
  const r = rng(46);
  const rates = [0, 5, 12, 18, 28, 0.1, 2, 7.5, 0.25, 3, 1.5, 40, 0.075, 12.5];
  for (const [a, b] of [[11, 0.015], [1e-7, 1e9], [0.333, 3], [-0, 5], [1.5e21, 2], [NaN, 1], [3, -0]]) {
    for (const d of [1, 100]) same(mulRound2(a, b, d), refMul(a, b, d), `mulRound2(${a}, ${b}, ${d})`);
  }
  for (const [a, p] of [[118, 18], [105, 5], [0, 18], [-0, 5], [1e-7, 18], [NaN, 5], [100, 1 / 3], [112.5, 12.5], [1.5e21, 18]]) {
    same(backOutPct(a, p), refBack(a, p), `backOutPct(${a}, ${p})`);
  }
  for (let i = 0; i < 40000; i++) {
    const a = (i % 3 ? Math.round(r() * 1e7) / 100 : Math.round(r() * 1e4) / 1000) * (i % 7 === 0 ? -1 : 1);
    const b = i % 2 ? rates[i % rates.length] : Math.round(r() * 1e5) / 100;
    same(mulRound2(a, b), refMul(a, b), `mulRound2(${a}, ${b})`);
    same(pctOf(a, b), refMul(a, b, 100), `pctOf(${a}, ${b})`);
    same(backOutPct(a, b % 60), refBack(a, b % 60), `backOutPct(${a}, ${b % 60})`);
  }
});
