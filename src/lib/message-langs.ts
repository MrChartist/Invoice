/**
 * Messages to parties in their own language (8H, roadmap 8.121): payment reminders, party
 * (khata) reminders and the WhatsApp statement in Hindi (Devanagari), Marathi, Gujarati and Tamil,
 * next to the existing English / Hinglish texts.
 *
 * Each client may carry a `message_lang` (additive on Client); reminders and statements to that
 * party default to it, whatever the interface language is. Amounts and dates stay in Latin digits
 * with Indian grouping (they are compared with bank and UPI apps). Nothing is sent by the app: these
 * are the texts behind the `wa.me` / `mailto:` links the user taps.
 *
 * Pure (no storage, no React). Tested in tests/message-langs.test.ts.
 */
import type { DocumentType, InvoiceRecord } from '../types/invoice';
import { fillTemplate, reminderVars, buildReminder, type ReminderExtras, type ReminderLanguage, type ReminderMessage, type ReminderStage } from './reminders';
import { formatCurrency, formatDate } from './utils';

export type MessageLang = 'en' | 'hinglish' | 'hi' | 'mr' | 'gu' | 'ta';
export type RegionalLang = 'hi' | 'mr' | 'gu' | 'ta';

export const MESSAGE_LANGS: readonly { code: MessageLang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'hinglish', label: 'Hinglish' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'mr', label: 'मराठी' },
  { code: 'gu', label: 'ગુજરાતી' },
  { code: 'ta', label: 'தமிழ்' },
];

export function isMessageLang(v: unknown): v is MessageLang {
  return MESSAGE_LANGS.some((l) => l.code === v);
}

const isRegional = (v: MessageLang): v is RegionalLang => v === 'hi' || v === 'mr' || v === 'gu' || v === 'ta';

/** The party's message language, if set and known. */
export function messageLangOf(client: { message_lang?: string } | null | undefined): MessageLang | undefined {
  return isMessageLang(client?.message_lang) ? client!.message_lang as MessageLang : undefined;
}

/** A sensible default for a new message: the party's own language, else the interface language, else English. */
export function defaultMessageLang(client: { message_lang?: string } | null | undefined, uiLang?: string): MessageLang {
  return messageLangOf(client) ?? (isMessageLang(uiLang) ? uiLang : 'en');
}

interface Bits {
  docs: Partial<Record<DocumentType, string>>;
  today: string;
  inDays: string;
  overdueDays: string;
  upi: string;
  payLink: string;
  terms: string;
  termsAccrued: string;
  dueDate: string;
}

const BITS: Record<RegionalLang, Bits> = {
  hi: {
    docs: { INVOICE: 'इनवॉइस', TAX_INVOICE: 'टैक्स इनवॉइस', PROFORMA: 'प्रोफ़ॉर्मा इनवॉइस', BILL_OF_SUPPLY: 'बिल ऑफ़ सप्लाई', DEBIT_NOTE: 'डेबिट नोट' },
    today: 'आज',
    inDays: '{n} दिन में',
    overdueDays: '{n} दिन से बकाया',
    upi: 'UPI से भुगतान करें: {upi}',
    payLink: 'भुगतान लिंक: {link}',
    terms: 'इनवॉइस की शर्तों के अनुसार देर से भुगतान पर शुल्क लग सकता है।',
    termsAccrued: 'इनवॉइस की शर्तों के अनुसार {date} तक {amount} देर-भुगतान ब्याज बना है। ऊपर की राशि में यह शामिल नहीं है।',
    dueDate: 'देय तारीख',
  },
  mr: {
    docs: { INVOICE: 'इनव्हॉइस', TAX_INVOICE: 'टॅक्स इनव्हॉइस', PROFORMA: 'प्रोफॉर्मा इनव्हॉइस', BILL_OF_SUPPLY: 'बिल ऑफ सप्लाय', DEBIT_NOTE: 'डेबिट नोट' },
    today: 'आज',
    inDays: '{n} दिवसांत',
    overdueDays: '{n} दिवस थकीत',
    upi: 'UPI ने पेमेंट करा: {upi}',
    payLink: 'पेमेंट लिंक: {link}',
    terms: 'इनव्हॉइसच्या अटींनुसार उशिरा पेमेंटवर शुल्क लागू शकते.',
    termsAccrued: 'इनव्हॉइसच्या अटींनुसार {date} पर्यंत {amount} उशिरा-पेमेंट व्याज झाले आहे. वरील रकमेत ते समाविष्ट नाही.',
    dueDate: 'देय तारीख',
  },
  gu: {
    docs: { INVOICE: 'ઇન્વૉઇસ', TAX_INVOICE: 'ટેક્સ ઇન્વૉઇસ', PROFORMA: 'પ્રોફોર્મા ઇન્વૉઇસ', BILL_OF_SUPPLY: 'બિલ ઑફ સપ્લાય', DEBIT_NOTE: 'ડેબિટ નોટ' },
    today: 'આજે',
    inDays: '{n} દિવસમાં',
    overdueDays: '{n} દિવસથી બાકી',
    upi: 'UPI થી ચુકવણી કરો: {upi}',
    payLink: 'ચુકવણી લિંક: {link}',
    terms: 'ઇન્વૉઇસની શરતો મુજબ મોડી ચુકવણી પર ચાર્જ લાગી શકે છે.',
    termsAccrued: 'ઇન્વૉઇસની શરતો મુજબ {date} સુધી {amount} મોડી-ચુકવણીનું વ્યાજ થયું છે. ઉપરની રકમમાં તે સામેલ નથી.',
    dueDate: 'ચુકવણીની તારીખ',
  },
  ta: {
    docs: { INVOICE: 'இன்வாய்ஸ்', TAX_INVOICE: 'வரி இன்வாய்ஸ்', PROFORMA: 'புரோஃபார்மா இன்வாய்ஸ்', BILL_OF_SUPPLY: 'பில் ஆஃப் சப்ளை', DEBIT_NOTE: 'டெபிட் நோட்' },
    today: 'இன்று',
    inDays: '{n} நாட்களில்',
    overdueDays: '{n} நாட்கள் தாமதம்',
    upi: 'UPI மூலம் செலுத்தவும்: {upi}',
    payLink: 'பணம் செலுத்தும் இணைப்பு: {link}',
    terms: 'இன்வாய்ஸ் நிபந்தனைகளின்படி தாமதக் கட்டணம் விதிக்கப்படலாம்.',
    termsAccrued: 'இன்வாய்ஸ் நிபந்தனைகளின்படி {date} வரை {amount} தாமத வட்டி சேர்ந்துள்ளது. மேலே உள்ள தொகையில் அது சேர்க்கப்படவில்லை.',
    dueDate: 'செலுத்த வேண்டிய தேதி',
  },
};

type StageText = { subject: string; body: string };

/** Invoice reminders per stage. Same placeholders as the English templates in reminders.ts. */
export const REMINDER_TEMPLATES: Record<RegionalLang, Record<ReminderStage, StageText>> = {
  hi: {
    upcoming: { subject: 'याद दिलाना: {document} {number} {due} को देय है', body: 'नमस्ते {client} जी,\n\nबस याद दिलाना था कि {document} {number} ({balance}) {due} को देय है ({days})।\n{upi_line}\nकोई दिक़्क़त हो तो बताइए।\n\nधन्यवाद,\n{business}\n{phone}' },
    due_today: { subject: '{document} {number} आज देय है', body: 'नमस्ते {client} जी,\n\n{document} {number} के {balance} आज ({due}) देय हैं।\n{upi_line}\nकृपया जल्द भुगतान कर दें।\n\nधन्यवाद,\n{business}\n{phone}' },
    overdue_polite: { subject: 'याद दिलाना: {document} {number} {due} को देय था', body: 'नमस्ते {client} जी,\n\nहमारे रिकॉर्ड के अनुसार {document} {number} ({balance}) {due} को देय था ({days})। अगर भुगतान हो चुका है तो कृपया रेफ़रेंस भेज दें।\n{upi_line}\nधन्यवाद,\n{business}\n{phone}' },
    overdue_firm: { subject: 'बकाया: {document} {number} - {balance} बाकी', body: '{client} जी,\n\n{document} {number} के {balance} {due} को देय थे और अब {days}। कृपया अगले 3 कार्य-दिवसों में भुगतान करें, या बताएँ कि भुगतान कब तक मिलेगा।\n{upi_line}\nधन्यवाद,\n{business}\n{phone}' },
    overdue_final: { subject: 'अंतिम सूचना: {document} {number} - {balance} बकाया', body: '{client} जी,\n\nपिछले रिमाइंडर के बाद भी {document} {number} के {balance} बाकी हैं ({due}, {days})।\n{terms_line}कृपया तुरंत भुगतान करें या आज ही बात करके तारीख तय कर लें।\n{upi_line}\nधन्यवाद,\n{business}\n{phone}' },
    thank_you: { subject: 'भुगतान मिल गया: {document} {number}। धन्यवाद!', body: 'नमस्ते {client} जी,\n\nधन्यवाद! {document} {number} का भुगतान मिल गया। आपके साथ काम करके अच्छा लगा।\n\nसादर,\n{business}\n{phone}' },
  },
  mr: {
    upcoming: { subject: 'आठवण: {document} {number} {due} रोजी देय आहे', body: 'नमस्कार {client},\n\nफक्त आठवण करून देत आहे की {document} {number} ({balance}) {due} रोजी देय आहे ({days}).\n{upi_line}\nकाही अडचण असल्यास कळवा.\n\nधन्यवाद,\n{business}\n{phone}' },
    due_today: { subject: '{document} {number} आज देय आहे', body: 'नमस्कार {client},\n\n{document} {number} चे {balance} आज ({due}) देय आहेत.\n{upi_line}\nकृपया लवकरात लवकर पेमेंट करा.\n\nधन्यवाद,\n{business}\n{phone}' },
    overdue_polite: { subject: 'आठवण: {document} {number} {due} रोजी देय होते', body: 'नमस्कार {client},\n\nआमच्या नोंदीनुसार {document} {number} ({balance}) {due} रोजी देय होते ({days}). पेमेंट झाले असल्यास कृपया संदर्भ क्रमांक पाठवा.\n{upi_line}\nधन्यवाद,\n{business}\n{phone}' },
    overdue_firm: { subject: 'थकबाकी: {document} {number} - {balance} बाकी', body: '{client},\n\n{document} {number} चे {balance} {due} रोजी देय होते आणि आता {days}. कृपया पुढील 3 कामकाजाच्या दिवसांत पेमेंट करा, किंवा पेमेंट केव्हा मिळेल ते कळवा.\n{upi_line}\nधन्यवाद,\n{business}\n{phone}' },
    overdue_final: { subject: 'अंतिम सूचना: {document} {number} - {balance} थकीत', body: '{client},\n\nआधीच्या आठवणींनंतरही {document} {number} चे {balance} बाकी आहेत ({due}, {days}).\n{terms_line}कृपया त्वरित पेमेंट करा किंवा आजच बोलून तारीख ठरवा.\n{upi_line}\nधन्यवाद,\n{business}\n{phone}' },
    thank_you: { subject: 'पेमेंट मिळाले: {document} {number}. धन्यवाद!', body: 'नमस्कार {client},\n\nधन्यवाद! {document} {number} चे पेमेंट मिळाले. आपल्यासोबत काम करून आनंद झाला.\n\nआपला,\n{business}\n{phone}' },
  },
  gu: {
    upcoming: { subject: 'યાદ: {document} {number} {due} ના રોજ ચૂકવવાનું છે', body: 'નમસ્તે {client},\n\nફક્ત યાદ અપાવવા માટે કે {document} {number} ({balance}) {due} ના રોજ ચૂકવવાનું છે ({days}).\n{upi_line}\nકોઈ તકલીફ હોય તો જણાવશો.\n\nઆભાર,\n{business}\n{phone}' },
    due_today: { subject: '{document} {number} આજે ચૂકવવાનું છે', body: 'નમસ્તે {client},\n\n{document} {number} ના {balance} આજે ({due}) ચૂકવવાના છે.\n{upi_line}\nકૃપા કરી વહેલી તકે ચુકવણી કરશો.\n\nઆભાર,\n{business}\n{phone}' },
    overdue_polite: { subject: 'યાદ: {document} {number} {due} ના રોજ ચૂકવવાનું હતું', body: 'નમસ્તે {client},\n\nઅમારા રેકોર્ડ મુજબ {document} {number} ({balance}) {due} ના રોજ ચૂકવવાનું હતું ({days}). ચુકવણી થઈ ગઈ હોય તો કૃપા કરી રેફરન્સ મોકલશો.\n{upi_line}\nઆભાર,\n{business}\n{phone}' },
    overdue_firm: { subject: 'બાકી: {document} {number} - {balance} બાકી', body: '{client},\n\n{document} {number} ના {balance} {due} ના રોજ ચૂકવવાના હતા અને હવે {days}. કૃપા કરી આવતા 3 કામકાજના દિવસોમાં ચુકવણી કરશો, અથવા ચુકવણી ક્યારે મળશે તે જણાવશો.\n{upi_line}\nઆભાર,\n{business}\n{phone}' },
    overdue_final: { subject: 'અંતિમ સૂચના: {document} {number} - {balance} બાકી', body: '{client},\n\nઅગાઉના રિમાઇન્ડર પછી પણ {document} {number} ના {balance} બાકી છે ({due}, {days}).\n{terms_line}કૃપા કરી તરત ચુકવણી કરશો અથવા આજે જ વાત કરીને તારીખ નક્કી કરશો.\n{upi_line}\nઆભાર,\n{business}\n{phone}' },
    thank_you: { subject: 'ચુકવણી મળી: {document} {number}. આભાર!', body: 'નમસ્તે {client},\n\nઆભાર! {document} {number} ની ચુકવણી મળી ગઈ. આપની સાથે કામ કરીને આનંદ થયો.\n\nઆપનો,\n{business}\n{phone}' },
  },
  ta: {
    upcoming: { subject: 'நினைவூட்டல்: {document} {number} {due} அன்று செலுத்த வேண்டும்', body: 'வணக்கம் {client},\n\n{document} {number} ({balance}) {due} அன்று செலுத்த வேண்டியது ({days}) என்பதை நினைவூட்டுகிறோம்.\n{upi_line}\nஏதேனும் தேவை இருந்தால் தெரிவிக்கவும்.\n\nநன்றி,\n{business}\n{phone}' },
    due_today: { subject: '{document} {number} இன்று செலுத்த வேண்டும்', body: 'வணக்கம் {client},\n\n{document} {number} இன் {balance} இன்று ({due}) செலுத்த வேண்டும்.\n{upi_line}\nதயவுசெய்து விரைவில் செலுத்தவும்.\n\nநன்றி,\n{business}\n{phone}' },
    overdue_polite: { subject: 'நினைவூட்டல்: {document} {number} {due} அன்று செலுத்த வேண்டியது', body: 'வணக்கம் {client},\n\nஎங்கள் பதிவுகளின்படி {document} {number} ({balance}) {due} அன்று செலுத்த வேண்டியது ({days}). ஏற்கனவே செலுத்தியிருந்தால் குறிப்பு எண்ணை அனுப்பவும்.\n{upi_line}\nநன்றி,\n{business}\n{phone}' },
    overdue_firm: { subject: 'நிலுவை: {document} {number} - {balance} பாக்கி', body: '{client},\n\n{document} {number} இன் {balance} {due} அன்று செலுத்த வேண்டியது, இப்போது {days}. அடுத்த 3 வேலை நாட்களுக்குள் செலுத்தவும், அல்லது எப்போது செலுத்துவீர்கள் என்று தெரிவிக்கவும்.\n{upi_line}\nநன்றி,\n{business}\n{phone}' },
    overdue_final: { subject: 'இறுதி அறிவிப்பு: {document} {number} - {balance} நிலுவை', body: '{client},\n\nமுந்தைய நினைவூட்டல்களுக்குப் பிறகும் {document} {number} இன் {balance} பாக்கி உள்ளது ({due}, {days}).\n{terms_line}உடனே செலுத்தவும் அல்லது இன்றே பேசி ஒரு தேதியை முடிவு செய்யவும்.\n{upi_line}\nநன்றி,\n{business}\n{phone}' },
    thank_you: { subject: 'பணம் பெறப்பட்டது: {document} {number}. நன்றி!', body: 'வணக்கம் {client},\n\nநன்றி! {document} {number} க்கான பணம் பெறப்பட்டது. உங்களுடன் பணியாற்றியதில் மகிழ்ச்சி.\n\nஅன்புடன்,\n{business}\n{phone}' },
  },
};

function tidy(s: string): string {
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const DAY = 86_400_000;
function daysToDue(due: string | undefined, today: Date): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(due ?? '');
  if (!m) return NaN;
  const d = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d - t) / DAY);
}

/**
 * A payment reminder in any message language. English and Hinglish come from reminders.ts unchanged;
 * Hindi, Marathi, Gujarati and Tamil reuse the same facts (amounts, dates, UPI pay link) with
 * their own wording.
 */
export function buildReminderIn(
  invoice: InvoiceRecord,
  stage: ReminderStage,
  lang: MessageLang = 'en',
  today: Date = new Date(),
  extras: ReminderExtras = {},
): ReminderMessage {
  if (!isRegional(lang)) return buildReminder(invoice, stage, lang as ReminderLanguage, today, extras);
  const b = BITS[lang];
  const base = reminderVars(invoice, stage, 'en', today, extras);
  const d = daysToDue(invoice.due_date, today);
  const n = Math.abs(d);
  const days = !Number.isFinite(d) ? '' : d === 0 ? b.today : fillTemplate(d > 0 ? b.inDays : b.overdueDays, { n: String(n) });
  const link = /\nPay link: (.+)\n/.exec(base.upi_line)?.[1];
  const upiLine = base.upi
    ? stage === 'thank_you'
      ? ''
      : `${fillTemplate(b.upi, { upi: base.upi })}\n${link ? `${fillTemplate(b.payLink, { link })}\n` : ''}`
    : '';
  const accrued = extras.interestAccrued;
  const termsLine = base.terms_line
    ? accrued !== undefined && Number.isFinite(accrued) && accrued > 0
      ? `${fillTemplate(b.termsAccrued, { amount: formatCurrency(accrued, invoice.currency || 'INR'), date: formatDate(today) })}\n`
      : `${b.terms}\n`
    : '';
  const vars: Record<string, string> = {
    ...base,
    client: invoice.client?.name?.trim() || '',
    document: b.docs[invoice.doc_type] ?? base.document,
    due: invoice.due_date ? base.due : b.dueDate,
    days,
    upi_line: upiLine,
    terms_line: termsLine,
  };
  const t = REMINDER_TEMPLATES[lang][stage];
  return { subject: tidy(fillTemplate(t.subject, vars)), body: tidy(fillTemplate(t.body, vars)) };
}

/** Party (khata) reminder texts for Marathi, Gujarati and Tamil — same shape as khata.ts `PARTY_T`. */
export const PARTY_TEMPLATES: Record<'mr' | 'gu' | 'ta', { overdue: string; balance: string; upi: string; upiId: string; there: string }> = {
  mr: {
    overdue: 'नमस्कार {client},\n\n{business} कडून आठवण: आपल्या खात्यावर {amount} थकीत आहे (सर्वात जुने बिल {oldest_ref}, {oldest_date}, {days} दिवस थकीत).\nएकूण बाकी: {net}\n{upi_line}\nपेमेंट झाले असल्यास कृपया संदर्भ पाठवा. धन्यवाद!\n{phone}',
    balance: 'नमस्कार {client},\n\n{date} रोजी {business} कडे आपली बाकी {net} आहे.\n{upi_line}\nधन्यवाद!\n{phone}',
    upi: 'UPI ने पेमेंट: {link}',
    upiId: 'UPI ID: {id}',
    there: '',
  },
  gu: {
    overdue: 'નમસ્તે {client},\n\n{business} તરફથી યાદ: આપના ખાતામાં {amount} બાકી છે (સૌથી જૂનું બિલ {oldest_ref}, {oldest_date}, {days} દિવસથી બાકી).\nકુલ બાકી: {net}\n{upi_line}\nચુકવણી થઈ ગઈ હોય તો કૃપા કરી રેફરન્સ મોકલશો. આભાર!\n{phone}',
    balance: 'નમસ્તે {client},\n\n{date} ના રોજ {business} સાથે આપની બાકી રકમ {net} છે.\n{upi_line}\nઆભાર!\n{phone}',
    upi: 'UPI થી ચુકવણી: {link}',
    upiId: 'UPI ID: {id}',
    there: '',
  },
  ta: {
    overdue: 'வணக்கம் {client},\n\n{business} நினைவூட்டல்: உங்கள் கணக்கில் {amount} நிலுவையில் உள்ளது (பழைய பில் {oldest_ref}, {oldest_date}, {days} நாட்கள் தாமதம்).\nமொத்த நிலுவை: {net}\n{upi_line}\nஏற்கனவே செலுத்தியிருந்தால் குறிப்பு எண்ணை அனுப்பவும். நன்றி!\n{phone}',
    balance: 'வணக்கம் {client},\n\n{date} நிலவரப்படி {business} உடன் உங்கள் நிலுவை {net}.\n{upi_line}\nநன்றி!\n{phone}',
    upi: 'UPI மூலம் செலுத்த: {link}',
    upiId: 'UPI ID: {id}',
    there: '',
  },
};

/** Labels of the WhatsApp statement (khata.ts `buildWhatsAppStatement`). */
export interface StatementLabels {
  statement: string;
  accountStatement: string;
  asOf: string;
  openBills: string;
  daysOverdue: string;
  due: string;
  moreBills: string;
  lessCredits: string;
  netDue: string;
  overdue: string;
  payByUpi: string;
  kindly: string;
  advance: string;
  noBalance: string;
}

export const STATEMENT_LABELS: Record<'en' | RegionalLang, StatementLabels> = {
  en: { statement: 'Statement', accountStatement: 'Account statement', asOf: 'as of {date}', openBills: 'Open bills:', daysOverdue: '{n} days overdue', due: 'due {date}', moreBills: '{n} more bill(s)', lessCredits: 'Less credits / advances', netDue: 'Net due', overdue: 'overdue', payByUpi: 'Pay by UPI', kindly: 'Kindly arrange the payment. Thank you!', advance: 'Advance with us: {amount}* – nothing to pay. Thank you!', noBalance: 'No balance due.* Thank you!' },
  hi: { statement: 'खाता विवरण', accountStatement: 'खाता विवरण', asOf: '{date} तक', openBills: 'बकाया बिल:', daysOverdue: '{n} दिन से बकाया', due: 'देय {date}', moreBills: '{n} और बिल', lessCredits: 'घटाएँ: क्रेडिट / अग्रिम', netDue: 'कुल देय', overdue: 'बकाया', payByUpi: 'UPI से भुगतान', kindly: 'कृपया भुगतान कर दें। धन्यवाद!', advance: 'हमारे पास अग्रिम: {amount}* – कुछ देना नहीं है। धन्यवाद!', noBalance: 'कोई बकाया नहीं।* धन्यवाद!' },
  mr: { statement: 'खाते उतारा', accountStatement: 'खाते उतारा', asOf: '{date} रोजी', openBills: 'बाकी बिले:', daysOverdue: '{n} दिवस थकीत', due: 'देय {date}', moreBills: 'आणखी {n} बिले', lessCredits: 'वजा: क्रेडिट / आगाऊ', netDue: 'एकूण देय', overdue: 'थकीत', payByUpi: 'UPI ने पेमेंट', kindly: 'कृपया पेमेंट करा. धन्यवाद!', advance: 'आमच्याकडे आगाऊ: {amount}* – काहीही देणे नाही. धन्यवाद!', noBalance: 'काहीही बाकी नाही.* धन्यवाद!' },
  gu: { statement: 'ખાતાનું સ્ટેટમેન્ટ', accountStatement: 'ખાતાનું સ્ટેટમેન્ટ', asOf: '{date} સુધી', openBills: 'બાકી બિલ:', daysOverdue: '{n} દિવસથી બાકી', due: 'ચૂકવણી {date}', moreBills: 'બીજાં {n} બિલ', lessCredits: 'બાદ: ક્રેડિટ / એડવાન્સ', netDue: 'કુલ બાકી', overdue: 'મુદત વીતી', payByUpi: 'UPI થી ચુકવણી', kindly: 'કૃપા કરી ચુકવણી કરશો. આભાર!', advance: 'અમારી પાસે એડવાન્સ: {amount}* – કંઈ ચૂકવવાનું નથી. આભાર!', noBalance: 'કંઈ બાકી નથી.* આભાર!' },
  ta: { statement: 'கணக்கு அறிக்கை', accountStatement: 'கணக்கு அறிக்கை', asOf: '{date} நிலவரப்படி', openBills: 'நிலுவை பில்கள்:', daysOverdue: '{n} நாட்கள் தாமதம்', due: 'செலுத்த வேண்டியது {date}', moreBills: 'மேலும் {n} பில்கள்', lessCredits: 'கழிவு: கிரெடிட் / முன்பணம்', netDue: 'மொத்த நிலுவை', overdue: 'தாமதம்', payByUpi: 'UPI மூலம் செலுத்த', kindly: 'தயவுசெய்து பணம் செலுத்தவும். நன்றி!', advance: 'எங்களிடம் முன்பணம்: {amount}* – செலுத்த எதுவும் இல்லை. நன்றி!', noBalance: 'நிலுவை இல்லை.* நன்றி!' },
};

/** Statement labels for a message language (Hinglish uses English labels). */
export function statementLabels(lang: MessageLang | undefined): StatementLabels {
  return lang && isRegional(lang) ? STATEMENT_LABELS[lang] : STATEMENT_LABELS.en;
}
