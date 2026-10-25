/**
 * Amount in words in Marathi, Gujarati and Tamil (8H), Indian system (hundred, thousand, lakh, crore).
 * Like the Hindi twin (`amount-in-words-hi.ts`), Marathi and Gujarati numbers 1–99 are irregular words
 * and come from tables; Tamil is built from its parts (with the joining forms நூற்று / ஆயிரத்து …).
 * Kept apart from the shell so only screens / messages in these languages carry the tables.
 * Bengali, Telugu and Kannada are not covered yet: `amountInWordsIn` returns '' and callers show English.
 */
import { round2 } from './invoice-calc';

export type WordsLang = 'mr' | 'gu' | 'ta';

const MR_0_99 = [
  'शून्य', 'एक', 'दोन', 'तीन', 'चार', 'पाच', 'सहा', 'सात', 'आठ', 'नऊ',
  'दहा', 'अकरा', 'बारा', 'तेरा', 'चौदा', 'पंधरा', 'सोळा', 'सतरा', 'अठरा', 'एकोणीस',
  'वीस', 'एकवीस', 'बावीस', 'तेवीस', 'चोवीस', 'पंचवीस', 'सव्वीस', 'सत्तावीस', 'अठ्ठावीस', 'एकोणतीस',
  'तीस', 'एकतीस', 'बत्तीस', 'तेहेतीस', 'चौतीस', 'पस्तीस', 'छत्तीस', 'सदतीस', 'अडतीस', 'एकोणचाळीस',
  'चाळीस', 'एक्केचाळीस', 'बेचाळीस', 'त्रेचाळीस', 'चव्वेचाळीस', 'पंचेचाळीस', 'सेहेचाळीस', 'सत्तेचाळीस', 'अठ्ठेचाळीस', 'एकोणपन्नास',
  'पन्नास', 'एक्कावन्न', 'बावन्न', 'त्रेपन्न', 'चोपन्न', 'पंचावन्न', 'छप्पन्न', 'सत्तावन्न', 'अठ्ठावन्न', 'एकोणसाठ',
  'साठ', 'एकसष्ट', 'बासष्ट', 'त्रेसष्ट', 'चौसष्ट', 'पासष्ट', 'सहासष्ट', 'सदुसष्ट', 'अडुसष्ट', 'एकोणसत्तर',
  'सत्तर', 'एक्काहत्तर', 'बाहत्तर', 'त्र्याहत्तर', 'चौऱ्याहत्तर', 'पंच्याहत्तर', 'शहात्तर', 'सत्याहत्तर', 'अठ्ठ्याहत्तर', 'एकोणऐंशी',
  'ऐंशी', 'एक्क्याऐंशी', 'ब्याऐंशी', 'त्र्याऐंशी', 'चौऱ्याऐंशी', 'पंच्याऐंशी', 'शहाऐंशी', 'सत्त्याऐंशी', 'अठ्ठ्याऐंशी', 'एकोणनव्वद',
  'नव्वद', 'एक्क्याण्णव', 'ब्याण्णव', 'त्र्याण्णव', 'चौऱ्याण्णव', 'पंच्याण्णव', 'शहाण्णव', 'सत्त्याण्णव', 'अठ्ठ्याण्णव', 'नव्व्याण्णव',
] as const;

const GU_0_99 = [
  'શૂન્ય', 'એક', 'બે', 'ત્રણ', 'ચાર', 'પાંચ', 'છ', 'સાત', 'આઠ', 'નવ',
  'દસ', 'અગિયાર', 'બાર', 'તેર', 'ચૌદ', 'પંદર', 'સોળ', 'સત્તર', 'અઢાર', 'ઓગણીસ',
  'વીસ', 'એકવીસ', 'બાવીસ', 'તેવીસ', 'ચોવીસ', 'પચ્ચીસ', 'છવ્વીસ', 'સત્તાવીસ', 'અઠ્ઠાવીસ', 'ઓગણત્રીસ',
  'ત્રીસ', 'એકત્રીસ', 'બત્રીસ', 'તેત્રીસ', 'ચોત્રીસ', 'પાંત્રીસ', 'છત્રીસ', 'સાડત્રીસ', 'આડત્રીસ', 'ઓગણચાલીસ',
  'ચાલીસ', 'એકતાલીસ', 'બેતાલીસ', 'તેતાલીસ', 'ચુંમાલીસ', 'પિસ્તાલીસ', 'છેતાલીસ', 'સુડતાલીસ', 'અડતાલીસ', 'ઓગણપચાસ',
  'પચાસ', 'એકાવન', 'બાવન', 'ત્રેપન', 'ચોપન', 'પંચાવન', 'છપ્પન', 'સત્તાવન', 'અઠ્ઠાવન', 'ઓગણસાઠ',
  'સાઠ', 'એકસઠ', 'બાસઠ', 'ત્રેસઠ', 'ચોસઠ', 'પાંસઠ', 'છાસઠ', 'સડસઠ', 'અડસઠ', 'અગણોસિત્તેર',
  'સિત્તેર', 'એકોતેર', 'બોતેર', 'તોતેર', 'ચુમોતેર', 'પંચોતેર', 'છોતેર', 'સિત્યોતેર', 'ઇઠ્યોતેર', 'ઓગણાએંસી',
  'એંસી', 'એક્યાસી', 'બ્યાસી', 'ત્યાસી', 'ચોર્યાસી', 'પંચાસી', 'છ્યાસી', 'સિત્યાસી', 'ઈઠ્યાસી', 'નેવ્યાસી',
  'નેવું', 'એકાણું', 'બાણું', 'ત્રાણું', 'ચોરાણું', 'પંચાણું', 'છન્નું', 'સત્તાણું', 'અઠ્ઠાણું', 'નવ્વાણું',
] as const;

const TA_ONES = ['பூஜ்ஜியம்', 'ஒன்று', 'இரண்டு', 'மூன்று', 'நான்கு', 'ஐந்து', 'ஆறு', 'ஏழு', 'எட்டு', 'ஒன்பது'] as const;
const TA_TEENS = ['பத்து', 'பதினொன்று', 'பன்னிரண்டு', 'பதின்மூன்று', 'பதினான்கு', 'பதினைந்து', 'பதினாறு', 'பதினேழு', 'பதினெட்டு', 'பத்தொன்பது'] as const;
/** Tens alone (20, 30 …) and their joining forms (21 = இருபத்து ஒன்று). */
const TA_TENS = ['', '', 'இருபது', 'முப்பது', 'நாற்பது', 'ஐம்பது', 'அறுபது', 'எழுபது', 'எண்பது', 'தொண்ணூறு'] as const;
const TA_TENS_J = ['', '', 'இருபத்து', 'முப்பத்து', 'நாற்பத்து', 'ஐம்பத்து', 'அறுபத்து', 'எழுபத்து', 'எண்பத்து', 'தொண்ணூற்று'] as const;
const TA_HUND = ['', 'நூறு', 'இருநூறு', 'முந்நூறு', 'நானூறு', 'ஐந்நூறு', 'அறுநூறு', 'எழுநூறு', 'எண்ணூறு', 'தொள்ளாயிரம்'] as const;
const TA_HUND_J = ['', 'நூற்று', 'இருநூற்று', 'முந்நூற்று', 'நானூற்று', 'ஐந்நூற்று', 'அறுநூற்று', 'எழுநூற்று', 'எண்ணூற்று', 'தொள்ளாயிரத்து'] as const;

function ta99(n: number): string {
  if (n < 10) return TA_ONES[n];
  if (n < 20) return TA_TEENS[n - 10];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TA_TENS_J[t]} ${TA_ONES[o]}` : TA_TENS[t];
}

function ta999(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (!h) return ta99(rest);
  return rest ? `${TA_HUND_J[h]} ${ta99(rest)}` : TA_HUND[h];
}

/** A Tamil group (thousand / lakh / crore): "ஒரு" for one, joining form when more follows. */
function taGroup(count: number, word: string, joined: string, more: boolean): string {
  const lead = count === 1 ? 'ஒரு' : count < 1000 ? ta999(count) : taNumber(count);
  return `${lead} ${more ? joined : word}`;
}

function taNumber(whole: number): string {
  if (whole === 0) return TA_ONES[0];
  const crore = Math.floor(whole / 10_000_000);
  const lakh = Math.floor((whole % 10_000_000) / 100_000);
  const thousand = Math.floor((whole % 100_000) / 1000);
  const rest = whole % 1000;
  const parts: string[] = [];
  if (crore) parts.push(taGroup(crore, 'கோடி', 'கோடியே', !!(lakh || thousand || rest)));
  if (lakh) parts.push(taGroup(lakh, 'இலட்சம்', 'இலட்சத்து', !!(thousand || rest)));
  if (thousand) parts.push(taGroup(thousand, 'ஆயிரம்', 'ஆயிரத்து', !!rest));
  if (rest) parts.push(ta999(rest));
  return parts.join(' ');
}

interface Table {
  w: readonly string[];
  hundred: (h: number, more: boolean) => string;
  thousand: string;
  lakh: string;
  crore: string;
}

const TABLES: Record<'mr' | 'gu', Table> = {
  mr: { w: MR_0_99, hundred: (h, more) => (h === 1 ? (more ? 'एकशे' : 'शंभर') : `${MR_0_99[h]}शे`), thousand: 'हजार', lakh: 'लाख', crore: 'कोटी' },
  gu: { w: GU_0_99, hundred: (h) => `${GU_0_99[h]} સો`, thousand: 'હજાર', lakh: 'લાખ', crore: 'કરોડ' },
};

function tableNumber(tb: Table, whole: number): string {
  if (whole === 0) return tb.w[0];
  const crore = Math.floor(whole / 10_000_000);
  const lakh = Math.floor((whole % 10_000_000) / 100_000);
  const thousand = Math.floor((whole % 100_000) / 1000);
  const rest = whole % 1000;
  const parts: string[] = [];
  if (crore) parts.push(`${tableNumber(tb, crore)} ${tb.crore}`);
  if (lakh) parts.push(`${tb.w[lakh]} ${tb.lakh}`);
  if (thousand) parts.push(`${tb.w[thousand]} ${tb.thousand}`);
  if (rest) {
    const h = Math.floor(rest / 100);
    const r = rest % 100;
    if (h) parts.push(tb.hundred(h, r > 0));
    if (r) parts.push(tb.w[r]);
  }
  return parts.join(' ');
}

/** Whole number in words (Indian grouping). */
export function numberWordsIn(lang: WordsLang, n: number): string {
  const whole = Math.floor(Math.abs(n));
  return lang === 'ta' ? taNumber(whole) : tableNumber(TABLES[lang], whole);
}

const MONEY: Record<WordsLang, { inr: [string, string]; and: string; only: string; neg: string }> = {
  mr: { inr: ['रुपये', 'पैसे'], and: 'आणि', only: 'फक्त', neg: 'ऋण' },
  gu: { inr: ['રૂપિયા', 'પૈસા'], and: 'અને', only: 'પૂરા', neg: 'ઋણ' },
  ta: { inr: ['ரூபாய்', 'பைசா'], and: 'மற்றும்', only: 'மட்டும்', neg: 'கழித்தல்' },
};

export function isWordsLang(v: unknown): v is WordsLang {
  return v === 'mr' || v === 'gu' || v === 'ta';
}

/**
 * "रुपये … आणि … पैसे फक्त" / "રૂપિયા … અને … પૈસા પૂરા" / "ரூபாய் … மற்றும் … பைசா மட்டும்".
 * Rounds to paise first. Other currencies keep their ISO code as the unit name. '' for an unsupported language.
 */
export function amountInWordsIn(lang: string, amount: number, currency = 'INR'): string {
  if (!isWordsLang(lang)) return '';
  const m = MONEY[lang];
  if (!Number.isFinite(amount)) return numberWordsIn(lang, 0);
  const abs = round2(Math.abs(amount));
  if (abs === 0) return numberWordsIn(lang, 0);
  const whole = Math.floor(abs);
  const minorUnits = Math.round((abs - whole) * 100);
  const code = (currency || 'INR').toUpperCase();
  const [major, minor] = code === 'INR' ? m.inr : [code, '¢'];
  const sign = amount < 0 ? `${m.neg} ` : '';
  const minorPart = minorUnits > 0 ? ` ${m.and} ${numberWordsIn(lang, minorUnits)} ${minor}` : '';
  return `${sign}${major} ${numberWordsIn(lang, whole)}${minorPart} ${m.only}`;
}
