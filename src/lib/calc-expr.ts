/**
 * Calculator in number fields (roadmap 8.25): "120*3+40", "2.5 x 4", "(80+20)/2", "1,250 + 18%".
 *
 * A tiny recursive-descent parser — never `eval` / `Function` (the CSP forbids them anyway, and a
 * typed field must not run code). Grammar:
 *
 *   expr    = term (("+" | "-") term)*
 *   term    = factor (("*" | "x" | "×" | "/" | "÷") factor)*
 *   factor  = ("+" | "-") factor | atom ["%"]
 *   atom    = number | "(" expr ")"
 *
 * Percent, as on a shop calculator: `a + b%` / `a - b%` add / take off b % of a (1000 + 18% = 1180);
 * elsewhere `b%` is b / 100 (200 * 10% = 20). Thousands separators (commas, spaces) are ignored.
 * Results are rounded to 6 decimals so 0.1 + 0.2 reads 0.3. Pure; no DOM.
 */

const MAX_LENGTH = 120;
const MAX_DEPTH = 20;

/** True when the text is more than a plain number (has an operator or brackets after the first character). */
export function isExpression(text: string): boolean {
  const t = text.replace(/[\s,]/g, '');
  return /[+\-*/x×÷()%]/i.test(t.slice(1)) || /^[(*/x×÷%]/i.test(t);
}

/** Characters a calculator field accepts while typing. */
export const EXPRESSION_CHARS = /[^0-9.+\-*/xX×÷()% ,]/g;

/** The value of `text`, or null when it is empty, incomplete or not a valid expression. */
export function evalExpression(text: string): number | null {
  const src = String(text ?? '').replace(/[\s,]/g, '').toLowerCase();
  if (!src || src.length > MAX_LENGTH) return null;
  let pos = 0;
  let depth = 0;

  const peek = () => src[pos];
  const fail = (): never => {
    throw new SyntaxError('bad expression');
  };

  const number = (): number => {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(pos));
    if (!m) return fail();
    pos += m[0].length;
    return Number(m[0]);
  };

  /** A factor plus whether it carried a trailing `%`. */
  const factor = (): { v: number; pct: boolean } => {
    const c = peek();
    if (c === '+' || c === '-') {
      pos++;
      const f = factor();
      return { v: c === '-' ? -f.v : f.v, pct: f.pct };
    }
    let v: number;
    if (c === '(') {
      if (++depth > MAX_DEPTH) fail();
      pos++;
      v = expr();
      if (peek() !== ')') fail();
      pos++;
      depth--;
    } else {
      v = number();
    }
    if (peek() === '%') {
      pos++;
      return { v, pct: true };
    }
    return { v, pct: false };
  };

  const term = (): { v: number; pct: boolean } => {
    let left = factor();
    for (;;) {
      const c = peek();
      if (c !== '*' && c !== 'x' && c !== '×' && c !== '/' && c !== '÷') return left;
      pos++;
      const right = factor();
      const a = left.pct ? left.v / 100 : left.v;
      const b = right.pct ? right.v / 100 : right.v;
      if ((c === '/' || c === '÷') && b === 0) fail();
      left = { v: c === '/' || c === '÷' ? a / b : a * b, pct: false };
    }
  };

  function expr(): number {
    const first = term();
    let acc = first.pct ? first.v / 100 : first.v;
    for (;;) {
      const c = peek();
      if (c !== '+' && c !== '-') return acc;
      pos++;
      const right = term();
      // "a + b%" adds b % of a (shop-calculator percent).
      const b = right.pct ? (acc * right.v) / 100 : right.v;
      acc = c === '+' ? acc + b : acc - b;
    }
  }

  try {
    const v = expr();
    if (pos !== src.length || !Number.isFinite(v)) return null;
    const r = Math.round(v * 1e6) / 1e6;
    return Object.is(r, -0) ? 0 : r;
  } catch {
    return null;
  }
}
