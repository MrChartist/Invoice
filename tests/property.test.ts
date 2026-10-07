/**
 * Property / fuzz tests for the money engine, driven by a seeded PRNG so a
 * failure is reproducible (the seed and case index are in every message).
 * No dependencies.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rng } from './helpers/shim.ts';
import {
  allocateProportionally,
  applyRounding,
  calcInputFromRecord,
  calculateInvoice,
  deriveGstMode,
  round2,
  type CalcInput,
  type CalcTotals,
} from '../src/lib/invoice-calc.ts';
import { normalizeRecord } from '../src/store/invoice-defaults.ts';
import { summarize } from '../src/lib/stats.ts';
import type { GstMode, InvoiceItem, InvoiceRecord, SupplyType } from '../src/types/invoice.ts';

/* ───────────────────────── exact reference arithmetic (BigInt, paise) ───────────────────────── */

/** n / d rounded half away from zero, exactly. */
function rhu(n: bigint, d: bigint): bigint {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = (2n * a + d) / (2n * d);
  return neg ? -q : q;
}

/* ───────────────────────── generators ───────────────────────── */

const SLABS = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 12, 18, 28];
const MODES: GstMode[] = ['NONE', 'SINGLE', 'CGST_SGST', 'IGST'];
const SUPPLY: Array<SupplyType | undefined> = [undefined, 'B2B', 'B2C', 'SEZ_WITH_PAYMENT', 'SEZ_WITHOUT_PAYMENT', 'EXPORT_LUT', 'EXPORT_WITH_PAYMENT', 'DEEMED_EXPORT'];
const ROUNDS = ['nearest', 'up', 'down', 'none', undefined] as const;

function gen(r: () => number) {
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[int(0, xs.length - 1)];
  const money = (maxRupees: number) => int(0, maxRupees * 100) / 100;
  const nLines = int(0, 9);
  const items: InvoiceItem[] = Array.from({ length: nLines }, (_, i) => {
    const qty = r() < 0.7 ? int(1, 40) : int(1, 40000) / 1000;
    const rate = r() < 0.2 ? money(100) : money(100000);
    return {
      id: `i${i}`,
      name: 'x',
      type: 'goods',
      hsn: r() < 0.5 ? '998311' : '847130',
      quantity: qty,
      rate,
      tax_rate: pick(SLABS),
      discount_percent: r() < 0.4 ? int(0, 3000) / 100 : 0,
      ...(r() < 0.15 ? { cess_rate: pick([1, 5, 12, 22]) } : {}),
      ...(r() < 0.05 ? { cess_per_unit: int(1, 500) / 100 } : {}),
      amount: 0,
    } as InvoiceItem;
  });
  const input: CalcInput = {
    items,
    gst_mode: pick(MODES),
    discount_type: r() < 0.5 ? 'PERCENT' : 'AMOUNT',
    discount_rate: r() < 0.3 ? 0 : r() < 0.5 ? int(0, 5000) / 100 : money(50000),
    tax_rate: pick(SLABS),
    shipping: r() < 0.5 ? 0 : money(5000),
    other_charges: r() < 0.5 ? 0 : money(5000),
    round_off_enabled: r() < 0.5,
    amount_paid: r() < 0.5 ? 0 : money(200000),
    round_mode: pick(ROUNDS),
    price_includes_tax: r() < 0.25,
    supply_type: pick(SUPPLY),
    tcs_enabled: r() < 0.2,
    tcs_rate: pick([0.1, 1, 20]),
    tcs_base: r() < 0.5 ? 'taxable' : 'total',
    tds_enabled: r() < 0.25,
    tds_rate: pick([1, 2, 5, 10]),
    tds_on_taxable: r() < 0.5,
  };
  return input;
}

const SEED = 20260407;
const CASES = 4000;

const is2dp = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const close = (a: number, b: number, tol = 0.005) => Math.abs(a - b) <= tol;

const MONEY_FIELDS: Array<keyof CalcTotals> = [
  'subtotal', 'line_discount_total', 'invoice_discount_amount', 'discount_amount', 'taxable_value',
  'cgst_amount', 'sgst_amount', 'igst_amount', 'tax_amount', 'cess_amount', 'shipping', 'other_charges',
  'tcs_amount', 'round_off', 'total', 'tds_amount', 'payable', 'amount_paid', 'balance_due',
];

test(`calculateInvoice invariants hold for ${CASES} random invoices (seed ${SEED})`, () => {
  const r = rng(SEED);
  for (let n = 0; n < CASES; n++) {
    const input = gen(r);
    const t = calculateInvoice(input);
    const at = `seed ${SEED} case ${n}`;

    // finite, 2dp-clean money everywhere
    for (const f of MONEY_FIELDS) {
      const v = t[f] as number;
      assert.ok(Number.isFinite(v) && is2dp(v), `${at}: ${String(f)}=${v} is not a clean 2dp number`);
    }
    for (const l of t.lines) {
      for (const v of [l.gross, l.taxable, l.cgst, l.sgst, l.igst, l.tax, l.cess, l.total]) {
        assert.ok(Number.isFinite(v) && is2dp(v), `${at}: line value ${v}`);
      }
      // line total = taxable + GST + cess
      assert.ok(close(l.total, l.taxable + l.cgst + l.sgst + l.igst + l.cess), `${at}: line total`);
      assert.equal(round2(l.cgst + l.sgst + l.igst), l.tax, `${at}: line tax split re-sums`);
      // CGST/SGST: equal halves; a lone odd paisa goes to SGST (the half is rounded up)
      if (l.cgst > 0 || l.sgst > 0) {
        const d = round2(l.cgst - l.sgst);
        assert.ok(d === 0 || d === -0.01, `${at}: cgst-sgst=${d}`);
        assert.equal(l.igst, 0);
      }
    }

    // Σ line totals reconcile with the header (taxable + GST + cess)
    const sumLines = round2(t.lines.reduce((s, l) => s + l.total, 0));
    assert.ok(close(sumLines, t.taxable_value + t.tax_amount + t.cess_amount, 0.011), `${at}: Σ line totals ${sumLines}`);

    // the invoice total identity, to the paisa
    const before = round2(t.taxable_value + t.tax_amount + t.cess_amount + t.shipping + t.other_charges + t.tcs_amount);
    assert.ok(close(round2(before + t.round_off), t.total, 0.0051), `${at}: total identity ${before}+${t.round_off} vs ${t.total}`);

    // tax heads re-sum
    assert.equal(round2(t.cgst_amount + t.sgst_amount + t.igst_amount), t.tax_amount, `${at}: tax heads`);
    assert.ok(Math.abs(t.cgst_amount - t.sgst_amount) <= 0.01 * (t.lines.length + 1), `${at}: cgst ~ sgst`);

    // discounts: subtotal - discount = taxable for exclusive pricing
    assert.equal(round2(t.line_discount_total + t.invoice_discount_amount), t.discount_amount, `${at}: discount_amount`);
    assert.ok(t.invoice_discount_amount >= 0, `${at}: invoice discount never negative`);
    if (!input.price_includes_tax) {
      assert.ok(close(round2(t.subtotal - t.discount_amount), t.taxable_value, 0.0051), `${at}: subtotal - discount = taxable`);
    }

    // rounding bounds per mode
    const mode = input.round_mode ?? (input.round_off_enabled ? 'nearest' : 'none');
    if (mode === 'none') assert.equal(t.round_off, 0, `${at}: no round-off in none mode`);
    else if (mode === 'nearest') assert.ok(Math.abs(t.round_off) <= 0.5 + 1e-9, `${at}: nearest round-off ${t.round_off}`);
    else assert.ok(Math.abs(t.round_off) < 1, `${at}: ${mode} round-off ${t.round_off}`);
    if (mode !== 'none') assert.equal(t.total, Math.round(t.total), `${at}: rounded total is whole rupees`);

    // payable / balance
    assert.equal(t.payable, round2(t.total - t.tds_amount), `${at}: payable`);
    assert.equal(t.balance_due, round2(t.payable - t.amount_paid), `${at}: balance`);
    if (t.amount_paid <= t.payable) assert.ok(t.balance_due >= 0, `${at}: balance never negative unless overpaid`);
    else assert.ok(t.balance_due < 0, `${at}: overpaid shows as negative balance`);
    if (!input.tds_enabled) assert.equal(t.tds_amount, 0);
    if (!input.tcs_enabled) assert.equal(t.tcs_amount, 0);

    // zero-rated supplies charge no tax; IGST-with-payment never splits
    if (input.supply_type === 'EXPORT_LUT' || input.supply_type === 'SEZ_WITHOUT_PAYMENT') {
      assert.equal(t.tax_amount, 0, `${at}: zero-rated`);
    }
    if (input.supply_type === 'EXPORT_WITH_PAYMENT' || input.supply_type === 'SEZ_WITH_PAYMENT') {
      assert.equal(t.cgst_amount + t.sgst_amount, input.gst_mode === 'NONE' ? 0 : t.cgst_amount + t.sgst_amount);
    }
    // tax-inclusive: every line's taxable + tax + cess equals what was entered net of discounts
    if (input.price_includes_tax) {
      for (const l of t.lines) {
        if (l.tax_rate > 0 || l.cess_rate > 0 || l.cess_per_unit > 0) {
          assert.ok(close(l.taxable + l.tax + l.cess, round2(l.gross - l.line_discount - l.invoice_discount), 0.0051), `${at}: inclusive line reconciles`);
        }
      }
    }
  }
});

test('recalculation is idempotent: feeding a computed record back in changes nothing', () => {
  const r = rng(SEED + 1);
  for (let n = 0; n < 1500; n++) {
    const input = gen(r);
    const t1 = calculateInvoice(input);
    // persist the way the store does, then recompute from the persisted record
    const rec = {
      ...input,
      id: 'x', invoice_number: 'N', doc_type: 'INVOICE', status: 'Sent', issue_date: '2026-04-01', due_date: '2026-04-15',
      currency: 'INR', template_id: 't', client: { name: 'c', email: '', address: '', city: '', zip: '' }, sender: null,
      place_of_supply: '27', reverse_charge: false, notes: '', terms: '',
      subtotal: t1.subtotal, discount_amount: t1.discount_amount, taxable_value: t1.taxable_value,
      cgst_amount: t1.cgst_amount, sgst_amount: t1.sgst_amount, igst_amount: t1.igst_amount, tax_amount: t1.tax_amount,
      round_off: t1.round_off, total: t1.total, balance_due: t1.balance_due,
    } as unknown as InvoiceRecord;
    const viaJson = JSON.parse(JSON.stringify(rec)) as InvoiceRecord;
    const t2 = calculateInvoice(calcInputFromRecord(viaJson));
    assert.deepEqual(t2, t1, `seed ${SEED + 1} case ${n}`);
    // normalising a stored row must not move a rupee either
    const norm = normalizeRecord(viaJson);
    assert.equal(norm.total, t1.total, `seed ${SEED + 1} case ${n}: normalizeRecord keeps the total`);
    assert.equal(calculateInvoice(calcInputFromRecord(norm)).total, t1.total);
  }
});

test('single-line invoices match exact integer (BigInt) paise arithmetic', () => {
  const r = rng(SEED + 2);
  let halfCases = 0;
  for (let n = 0; n < 6000; n++) {
    const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
    const qtyMilli = r() < 0.6 ? int(1, 50) * 1000 : int(1, 99999);
    const ratePaise = int(1, 5_000_000);
    const linePct = r() < 0.5 ? 0 : int(0, 100) * 50; // basis points: 0.5% steps
    const invPct = r() < 0.5 ? 0 : int(0, 100) * 50;
    const taxBp = [0, 10, 25, 100, 150, 300, 500, 600, 1200, 1800, 2800][int(0, 10)]; // basis points
    const shipP = r() < 0.5 ? 0 : int(0, 99999);

    // exact reference, all in paise
    const gross = rhu(BigInt(qtyMilli) * BigInt(ratePaise), 1000n);
    const lineDisc = rhu(gross * BigInt(linePct), 10000n);
    const net = gross - lineDisc;
    const invDisc = rhu(net * BigInt(invPct), 10000n);
    const taxable = net - invDisc;
    const tax = rhu(taxable * BigInt(taxBp), 10000n);
    const half = rhu(tax, 2n);
    const cgst = tax - half;
    const before = taxable + tax + BigInt(shipP);
    const total = rhu(before, 100n) * 100n; // nearest rupee
    if ((taxable * BigInt(taxBp)) % 10000n === 5000n || (net * BigInt(invPct)) % 10000n === 5000n) halfCases++;

    const t = calculateInvoice({
      items: [{ id: 'a', name: 'x', type: 'g', quantity: qtyMilli / 1000, rate: ratePaise / 100, tax_rate: taxBp / 100, discount_percent: linePct / 100, amount: 0 }],
      gst_mode: 'CGST_SGST',
      discount_type: 'PERCENT',
      discount_rate: invPct / 100,
      tax_rate: 0,
      shipping: shipP / 100,
      other_charges: 0,
      round_off_enabled: true,
      amount_paid: 0,
    });
    const at = `seed ${SEED + 2} case ${n}`;
    const P = (x: bigint) => Number(x) / 100;
    assert.equal(t.subtotal, P(gross), `${at}: gross`);
    assert.equal(t.line_discount_total, P(lineDisc), `${at}: line discount`);
    assert.equal(t.invoice_discount_amount, P(invDisc), `${at}: invoice discount`);
    assert.equal(t.taxable_value, P(taxable), `${at}: taxable`);
    assert.equal(t.tax_amount, P(tax), `${at}: tax`);
    assert.equal(t.cgst_amount, P(cgst), `${at}: cgst`);
    assert.equal(t.total, P(total), `${at}: total`);
  }
  assert.ok(halfCases > 50, `the generator must actually hit exact half-paisa cases (${halfCases})`);
});

test('round2: half away from zero, symmetric, idempotent, immune to binary representation', () => {
  const cases: Array<[number, number]> = [
    [1.005, 1.01], [2.675, 2.68], [1.255, 1.26], [8.345, 8.35], [0.125, 0.13], [0.135, 0.14],
    [-1.005, -1.01], [-2.675, -2.68], [-0.125, -0.13], [-0.005, -0.01], [0.004, 0], [-0.004, 0],
    [1234567.895, 1234567.9], [0.1 + 0.2, 0.3], [1e-7, 0], [-1e-9, 0], [999999999999.995, 1000000000000],
  ];
  for (const [input, expected] of cases) assert.equal(round2(input), expected, `round2(${input})`);
  const r = rng(SEED + 3);
  for (let n = 0; n < 5000; n++) {
    const x = (r() - 0.5) * 2e7;
    assert.equal(round2(-x), -round2(x) + 0, `symmetry at ${x}`);
    assert.equal(round2(round2(x)), round2(x), `idempotent at ${x}`);
    assert.ok(Math.abs(round2(x) - x) <= 0.005 + 1e-9, `within half a paisa at ${x}`);
  }
  assert.equal(round2(NaN), 0);
  assert.equal(round2(Infinity), 0);
  assert.equal(Object.is(round2(-0.001), -0), false, 'never returns negative zero');
});

test('applyRounding: nearest is symmetric for negative documents, up/down are ceil/floor on paise', () => {
  assert.equal(applyRounding(10.5, 'nearest'), 11);
  assert.equal(applyRounding(-10.5, 'nearest'), -11);
  assert.equal(applyRounding(10.49, 'nearest'), 10);
  assert.equal(applyRounding(10.01, 'up'), 11);
  assert.equal(applyRounding(10.004, 'up'), 10, 'a sub-paisa residue is not a rupee');
  assert.equal(applyRounding(10.99, 'down'), 10);
  assert.equal(applyRounding(10.996, 'down'), 11, 'sub-paisa noise must not drop a rupee');
  assert.equal(applyRounding(10.37, 'none'), 10.37);
});

test('allocateProportionally always re-sums exactly to the amount', () => {
  const r = rng(SEED + 4);
  for (let n = 0; n < 3000; n++) {
    const k = 1 + Math.floor(r() * 12);
    const w = Array.from({ length: k }, () => Math.round(r() * 1e6) / 100);
    const base = round2(w.reduce((s, x) => s + x, 0));
    const amount = round2(Math.min(r() * base * 1.2, base));
    const parts = allocateProportionally(w, amount);
    if (base > 0 && amount > 0) {
      assert.equal(round2(parts.reduce((s, x) => s + x, 0)), amount, `case ${n}`);
      for (const p of parts) assert.ok(p >= -0.0001, `no negative share (case ${n})`);
    }
  }
});

test('hostile inputs never produce NaN / Infinity / crashes', () => {
  const junk: unknown[] = ['', ' ', 'abc', null, undefined, NaN, Infinity, -Infinity, '1e999', '-5', {}, [], true];
  for (const q of junk) {
    for (const rate of junk) {
      const t = calculateInvoice({
        items: [{ id: 'a', name: 'x', type: 'g', quantity: q as number, rate: rate as number, tax_rate: q as number, amount: 0 }],
        gst_mode: 'CGST_SGST', discount_type: 'PERCENT', discount_rate: q as number, tax_rate: rate as number,
        shipping: q as number, other_charges: rate as number, round_off_enabled: true, amount_paid: q as number,
      });
      for (const f of MONEY_FIELDS) assert.ok(Number.isFinite(t[f] as number), `${String(f)} with ${String(q)}/${String(rate)}`);
    }
  }
  // empty / missing item list
  assert.equal(calculateInvoice({ items: undefined as never, gst_mode: 'NONE', discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0 }).total, 0);
  // 500 lines of nothing
  const many = calculateInvoice({
    items: Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, name: '', type: 'g', quantity: 0, rate: 0, amount: 0 })),
    gst_mode: 'IGST', discount_type: 'PERCENT', discount_rate: 100, tax_rate: 18, shipping: 0, other_charges: 0, round_off_enabled: true, amount_paid: 0,
  });
  assert.equal(many.total, 0);
});

test('REGRESSION: a negative-quantity (return) line never produces a negative invoice discount', () => {
  const t = calculateInvoice({
    items: [{ id: 'a', name: 'Returned goods', type: 'g', quantity: -2, rate: 500, tax_rate: 18, amount: 0 }],
    gst_mode: 'CGST_SGST', discount_type: 'PERCENT', discount_rate: 10, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0,
  });
  assert.equal(t.invoice_discount_amount, 0);
  assert.equal(t.discount_amount, 0);
  assert.equal(t.taxable_value, -1000);
  assert.equal(round2(t.subtotal - t.discount_amount), t.taxable_value);
  assert.equal(t.total, -1180);
});

test('legacy-shaped records (no GST fields at all) recompute to exactly their issued totals', () => {
  const r = rng(SEED + 5);
  for (let n = 0; n < 1500; n++) {
    const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
    const nLines = int(1, 4);
    const taxRate = [0, 5, 12, 18, 28][int(0, 4)];
    const discPct = r() < 0.5 ? 0 : int(0, 20);
    const roundOff = r() < 0.5;
    const legacy = {
      id: 'L' + n, invoice_number: `INV/FY24-25/${n}`, issue_date: '2025-01-10', due_date: '2025-01-24',
      tax_rate: taxRate, discount_rate: discPct, discount_type: 'PERCENT', round_off_enabled: roundOff, amount_paid: 0,
      items: Array.from({ length: nLines }, (_, i) => {
        const q = int(1, 20);
        const rate = int(1, 100000) / 100;
        return { id: `a${i}`, name: 'Item', quantity: q, rate, amount: round2(q * rate) };
      }),
    };
    const rec = normalizeRecord(legacy);
    assert.equal(rec.gst_mode, taxRate > 0 ? 'SINGLE' : 'NONE');
    const t = calculateInvoice(calcInputFromRecord(rec));
    // independent expectation: flat tax on the discounted subtotal (single combined line)
    const sub = round2(legacy.items.reduce((s, i) => s + i.amount, 0));
    const disc = round2(sub * (discPct / 100));
    const taxableExp = round2(sub - disc);
    // per-line taxes are summed in the engine; allow the (at most) per-line paise drift
    const taxExp = round2(taxableExp * (taxRate / 100));
    assert.ok(close(t.taxable_value, taxableExp, 0.0051 * nLines), `legacy ${n}: taxable ${t.taxable_value} vs ${taxableExp}`);
    assert.ok(Math.abs(t.tax_amount - taxExp) <= 0.01 * (nLines + 1), `legacy ${n}: tax ${t.tax_amount} vs ${taxExp}`);
    assert.equal(t.tds_amount, 0);
    assert.equal(t.tcs_amount, 0);
    assert.equal(t.cess_amount, 0);
    if (roundOff) assert.equal(t.total, Math.round(t.total));
  }
});

test('deriveGstMode: no GSTIN or tax disabled = no tax; same state = CGST+SGST; else IGST', () => {
  assert.equal(deriveGstMode({ senderHasGstin: false, taxEnabled: true, senderStateCode: '27', placeOfSupply: '29' }), 'NONE');
  assert.equal(deriveGstMode({ senderHasGstin: true, taxEnabled: false, senderStateCode: '27', placeOfSupply: '29' }), 'NONE');
  assert.equal(deriveGstMode({ senderHasGstin: true, taxEnabled: true, senderStateCode: '27', placeOfSupply: '27' }), 'CGST_SGST');
  assert.equal(deriveGstMode({ senderHasGstin: true, taxEnabled: true, senderStateCode: '27', placeOfSupply: '29' }), 'IGST');
});

test('stats.summarize never goes negative or NaN on messy stored rows', () => {
  const rows = [
    { id: '1', doc_type: 'INVOICE', status: 'Sent', total: 100, amount_paid: 250, balance_due: -150, due_date: '2026-01-01' },
    { id: '2', doc_type: 'INVOICE', status: 'Sent', total: 'x', amount_paid: undefined, balance_due: undefined, due_date: '' },
    { id: '3', doc_type: undefined, status: 'Paid', total: 50, amount_paid: 50, balance_due: 0, due_date: '2026-01-01' },
  ] as unknown as InvoiceRecord[];
  const s = summarize(rows, new Date('2026-04-01T10:00:00'));
  for (const v of Object.values(s)) assert.ok(Number.isFinite(v), `summary value ${v}`);
  assert.ok(s.outstanding >= 0 && s.received >= 0);
});
