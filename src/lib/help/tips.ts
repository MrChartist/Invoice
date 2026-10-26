/**
 * R6-A6 one-time screen tips: one line per busy screen, shown once per device above the content (normal flow, never
 * an overlay). "Don't show tips" turns them all off. Device-local keys outside the company prefix (never backed up
 * or synced). Pure helpers take the stored strings (tests/help-tips.test.ts); `ScreenTip` does the storage.
 */

export type TipId = 'dashboard' | 'invoices' | 'editor' | 'pos' | 'clients' | 'expenses' | 'books' | 'gst' | 'gateway' | 'inventory' | 'tds' | 'payroll';

export interface Tip {
  id: TipId;
  /** The screen it belongs to (a route in App.tsx). */
  route: string;
  en: string;
  hi: string;
}

export const TIPS: readonly Tip[] = [
  { id: 'dashboard', route: '/', en: 'Tip: Ctrl+K (or /) finds any screen, client, document or GST tab.', hi: 'टिप: Ctrl+K (या /) से कोई भी स्क्रीन, ग्राहक, दस्तावेज़ या GST टैब खोजें।' },
  { id: 'invoices', route: '/transactions', en: 'Tip: search understands amounts and filters — try "> 5000" or "unpaid".', hi: 'टिप: खोज रकम और फ़िल्टर समझती है — "> 5000" या "unpaid" आज़माएँ।' },
  { id: 'editor', route: '/invoice', en: 'Tip: Alt+R repeats the last bill; the arrow on Save chooses what happens after saving.', hi: 'टिप: Alt+R पिछला बिल दोहराता है; Save के तीर से चुनें कि सेव के बाद क्या हो।' },
  { id: 'pos', route: '/pos', en: 'Tip: F9 saves the bill, F1 recalls held bills.', hi: 'टिप: F9 बिल सेव करता है, F1 रोके गए बिल वापस लाता है।' },
  { id: 'clients', route: '/clients', en: 'Tip: ₹ Received records a payment and Remind sends a reminder, right from the client row.', hi: 'टिप: ग्राहक की पंक्ति से ही ₹ प्राप्त से भुगतान दर्ज करें और याद दिलाएँ से रिमाइंडर भेजें।' },
  { id: 'expenses', route: '/expenses', en: 'Tip: Scan bill reads a photo or PDF of a supplier bill into a draft.', hi: 'टिप: बिल स्कैन, सप्लायर बिल की फ़ोटो या PDF से ड्राफ़्ट बनाता है।' },
  { id: 'books', route: '/books', en: 'Tip: Alt+F2 changes the period of every report; F12 opens its options.', hi: 'टिप: Alt+F2 हर रिपोर्ट की अवधि बदलता है; F12 विकल्प खोलता है।' },
  { id: 'gst', route: '/gst-reports', en: 'Tip: follow the filing strip — period, check, download, mark filed.', hi: 'टिप: फ़ाइलिंग पट्टी के क्रम में चलें — अवधि, जाँच, डाउनलोड, फ़ाइल चिह्नित।' },
  { id: 'gateway', route: '/gateway', en: 'Tip: Ctrl+/ lists every Gateway key.', hi: 'टिप: Ctrl+/ गेटवे की सभी कुंजियाँ दिखाता है।' },
  { id: 'inventory', route: '/inventory', en: 'Tip: stock groups and units keep a long item list tidy.', hi: 'टिप: स्टॉक ग्रुप और इकाइयाँ लंबी आइटम सूची को व्यवस्थित रखते हैं।' },
  { id: 'tds', route: '/tds', en: 'Tip: mark TDS on the supplier bill; it appears here with its due dates.', hi: 'टिप: सप्लायर बिल पर TDS चिह्नित करें; यह यहाँ देय तारीख़ों के साथ दिखेगा।' },
  { id: 'payroll', route: '/payroll', en: 'Tip: set pay heads and structures once; each month is attendance → run → pay.', hi: 'टिप: पे हेड और संरचना एक बार बनाएँ; हर महीने उपस्थिति → रन → भुगतान।' },
];

export const TIPS_SEEN_KEY = 'mrchartist_tips_seen';
export const TIPS_OFF_KEY = 'mrchartist_tips_off';

/** Parse the stored seen list (a JSON array of ids); anything else is empty. */
export function parseSeen(raw: string | null): TipId[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as TipId[]) : [];
  } catch {
    return [];
  }
}

export function shouldShowTip(id: TipId, seenRaw: string | null, offRaw: string | null): boolean {
  if (offRaw === '1') return false;
  return !parseSeen(seenRaw).includes(id);
}

/** The new stored seen list after dismissing `id`. */
export function markSeen(id: TipId, seenRaw: string | null): string {
  const seen = parseSeen(seenRaw);
  return JSON.stringify(seen.includes(id) ? seen : [...seen, id]);
}
