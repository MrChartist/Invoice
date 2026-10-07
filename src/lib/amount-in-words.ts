/**
 * Amount in words for invoice footers.
 * INR uses the Indian numbering system (Crore / Lakh); every other currency
 * uses the international system (Billion / Million).
 */
import { round2 } from './invoice-calc';

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

interface CurrencyWords {
  major: string;
  minor: string;
}

const CURRENCY_WORDS: Record<string, CurrencyWords> = {
  INR: { major: 'Rupees', minor: 'Paise' },
  USD: { major: 'Dollars', minor: 'Cents' },
  EUR: { major: 'Euros', minor: 'Cents' },
  GBP: { major: 'Pounds', minor: 'Pence' },
  AED: { major: 'Dirhams', minor: 'Fils' },
  SGD: { major: 'Singapore Dollars', minor: 'Cents' },
  AUD: { major: 'Australian Dollars', minor: 'Cents' },
  CAD: { major: 'Canadian Dollars', minor: 'Cents' },
  JPY: { major: 'Yen', minor: 'Sen' },
};

function twoDigit(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
}

function threeDigit(n: number): string {
  if (n === 0) return '';
  if (n < 100) return twoDigit(n);
  return ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoDigit(n % 100) : '');
}

/** 1234567 -> "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven" */
function indianWords(n: number): string {
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;

  let words = '';
  if (crore) words += threeDigit(crore) + ' Crore ';
  if (lakh) words += twoDigit(lakh) + ' Lakh ';
  if (thousand) words += twoDigit(thousand) + ' Thousand ';
  if (rest) words += threeDigit(rest);
  return words.trim();
}

/** 1234567 -> "One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven" */
function internationalWords(n: number): string {
  const billion = Math.floor(n / 1000000000);
  const million = Math.floor((n % 1000000000) / 1000000);
  const thousand = Math.floor((n % 1000000) / 1000);
  const rest = n % 1000;

  let words = '';
  if (billion) words += threeDigit(billion) + ' Billion ';
  if (million) words += threeDigit(million) + ' Million ';
  if (thousand) words += threeDigit(thousand) + ' Thousand ';
  if (rest) words += threeDigit(rest);
  return words.trim();
}

export function amountInWords(amount: number, currency: string = 'INR'): string {
  if (!Number.isFinite(amount)) return 'Zero';

  // Round to paise FIRST: 19.999 must read "Twenty", not "Nineteen and undefined Paise"
  // (the fractional part used to round to 100 and index past the end of the word table).
  const abs = round2(Math.abs(amount));
  if (abs === 0) return 'Zero';
  const whole = Math.floor(abs);
  const minorUnits = Math.round((abs - whole) * 100);
  const code = (currency || 'INR').toUpperCase();
  const { major, minor } = CURRENCY_WORDS[code] ?? { major: code, minor: 'Cents' };

  const body = whole === 0 ? 'Zero' : code === 'INR' ? indianWords(whole) : internationalWords(whole);
  const sign = amount < 0 ? 'Minus ' : '';
  const minorPart = minorUnits > 0 ? ` and ${twoDigit(minorUnits)} ${minor}` : '';

  return `${sign}${major} ${body}${minorPart} Only`.replace(/\s+/g, ' ');
}
