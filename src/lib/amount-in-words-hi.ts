/**
 * Amount in words in Hindi (5.4), Indian system: सौ, हज़ार, लाख, करोड़.
 *   12,34,56,789.05 → "रुपये बारह करोड़ चौंतीस लाख छप्पन हज़ार सात सौ नवासी और पाँच पैसे मात्र"
 * Hindi numbers 1–99 are irregular words, so they come from a table, not from tens + ones.
 * Every currency uses the Indian grouping in Hindi (as Hindi speakers say amounts).
 * Kept apart from amount-in-words.ts so English-only screens do not carry the table.
 */
import { round2 } from './invoice-calc';

const HI_0_99 = [
  'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ',
  'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस',
  'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास',
  'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर',
  'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उन्यासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी',
  'नब्बे', 'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पंचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे',
] as const;

interface HiCurrency {
  major: string;
  minor: string;
}

const HI_CURRENCY: Record<string, HiCurrency> = {
  INR: { major: 'रुपये', minor: 'पैसे' },
  USD: { major: 'अमेरिकी डॉलर', minor: 'सेंट' },
  EUR: { major: 'यूरो', minor: 'सेंट' },
  GBP: { major: 'पाउंड', minor: 'पेंस' },
  AED: { major: 'दिरहम', minor: 'फ़िल्स' },
  SGD: { major: 'सिंगापुर डॉलर', minor: 'सेंट' },
  AUD: { major: 'ऑस्ट्रेलियाई डॉलर', minor: 'सेंट' },
  CAD: { major: 'कनाडाई डॉलर', minor: 'सेंट' },
  JPY: { major: 'येन', minor: 'सेन' },
};

/** 0 < n < 1000 */
function hundreds(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${HI_0_99[h]} सौ`);
  if (rest) parts.push(HI_0_99[rest]);
  return parts.join(' ');
}

/** Whole number in Hindi words, Indian grouping; crores above 99 recurse ("एक सौ बीस करोड़"). */
export function hindiNumberWords(n: number): string {
  const whole = Math.floor(Math.abs(n));
  if (whole === 0) return HI_0_99[0];
  const crore = Math.floor(whole / 10_000_000);
  const lakh = Math.floor((whole % 10_000_000) / 100_000);
  const thousand = Math.floor((whole % 100_000) / 1000);
  const rest = whole % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${hindiNumberWords(crore)} करोड़`);
  if (lakh) parts.push(`${HI_0_99[lakh]} लाख`);
  if (thousand) parts.push(`${HI_0_99[thousand]} हज़ार`);
  if (rest) parts.push(hundreds(rest));
  return parts.join(' ');
}

/**
 * "रुपये … [और … पैसे] मात्र" — the Hindi twin of amountInWords().
 * Rounds to paise first, so 19.999 reads बीस, never "उन्नीस और सौ पैसे".
 */
export function amountInWordsHi(amount: number, currency: string = 'INR'): string {
  if (!Number.isFinite(amount)) return HI_0_99[0];
  const abs = round2(Math.abs(amount));
  if (abs === 0) return HI_0_99[0];
  const whole = Math.floor(abs);
  const minorUnits = Math.round((abs - whole) * 100);
  const code = (currency || 'INR').toUpperCase();
  const { major, minor } = HI_CURRENCY[code] ?? { major: code, minor: 'सेंट' };
  const sign = amount < 0 ? 'ऋण ' : '';
  const minorPart = minorUnits > 0 ? ` और ${HI_0_99[minorUnits]} ${minor}` : '';
  return `${sign}${major} ${hindiNumberWords(whole)}${minorPart} मात्र`;
}
