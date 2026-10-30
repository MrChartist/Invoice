/**
 * R6-A4: release notes bundled with the build, newest first. Each round's lead adds one entry at merge; the build
 * fails when the newest entry's `version` is not the `package.json` version (`scripts/check-whats-new.mjs`, run by
 * `postbuild`). Help → "What's new" lists every entry; the Dashboard card shows the newest one once after an upgrade.
 *
 * Pure data + pure helpers (tests/whats-new.test.ts). Text is English with a Hindi title per item.
 */

export interface WhatsNewItem {
  title: string;
  hi: string;
  text?: string;
  /** A screen inside the app (a route in App.tsx, with an optional query). */
  href?: string;
}

export interface WhatsNewEntry {
  version: string;
  /** `YYYY-MM-DD`. */
  date: string;
  label: string;
  items: readonly WhatsNewItem[];
}

export const WHATS_NEW: readonly WhatsNewEntry[] = [
  {
    version: '3.2.0',
    date: '2026-10-30',
    label: 'New look',
    items: [
      { title: 'New look: calmer screens', hi: 'नया रूप: शांत स्क्रीन', text: 'Soft grey pages with clean white cards (near black in dark mode), thin lines, one blue for links and selection, and colours that mean something: green paid, orange due, red overdue.', href: '/' },
      { title: 'Every page in the same frame', hi: 'हर पेज एक ही ढाँचे में', text: 'Titles sit in the same place on every screen. On a big display the extra room becomes columns and panes, not empty margins.', href: '/transactions' },
      { title: 'Easier lists and forms', hi: 'आसान सूचियाँ और फ़ॉर्म', text: 'Tables keep the important columns and fold the rest into a second line on smaller screens. Fields are filled, labels are in normal case, settings switch with toggles.', href: '/settings' },
      { title: 'A tablet sidebar and readable contrast', hi: 'टैबलेट साइडबार और साफ़ पढ़ने लायक रंग', text: 'An iPad in portrait gets a sidebar instead of the phone layout. Text reads clearly in light, dark and high contrast.' },
    ],
  },
  {
    version: '3.1.0',
    date: '2026-10-26',
    label: 'Round 6: help and first steps',
    items: [
      { title: 'Help knows your screen', hi: 'मदद अब आपकी स्क्रीन जानती है', text: 'Help (?) or F1 opens "On this screen": what the tab is for, when to use it and where to go next.', href: '/gst-reports?tab=b2cl' },
      { title: 'Tap a GST or TDS term', hi: 'GST या TDS शब्द पर टैप करें', text: 'Codes such as B2CL, 4(B)(1) and 26AS explain themselves. Each GST, TDS and payroll tab has a one-line "About this tab".', href: '/gst-reports?tab=gstr3b' },
      { title: 'A setup checklist for your kind of business', hi: 'आपके कारोबार के हिसाब से सेटअप सूची', text: 'A kirana sees "make a POS bill", a transporter "make an LR". Steps can be skipped and the card hidden.', href: '/' },
      { title: 'Report a problem, suggest an idea', hi: 'समस्या बताएँ, सुझाव दें', text: 'Type what you did and what happened, then share by WhatsApp, e-mail or the share sheet. Nothing is sent until you tap Share.' },
      { title: 'Beta guide and screen tips inside the app', hi: 'ऐप में बीटा गाइड और स्क्रीन टिप्स', text: 'Help → Beta guide lists what to test first and the known limits.' },
    ],
  },
  {
    version: '3.0.3',
    date: '2026-10-26',
    label: 'Round 5: industry packs',
    items: [
      { title: 'Marketplace seller pack', hi: 'मार्केटप्लेस विक्रेता पैक', text: 'Channels, order import, settlements, GST TCS and returns.', href: '/receivables?tab=marketplace' },
      { title: 'Transport and works contracts', hi: 'ट्रांसपोर्ट और वर्क्स कॉन्ट्रैक्ट', text: 'LR / bilty, trips and vehicles; BOQ, RA bills and retention.', href: '/distribution?tab=transport' },
      { title: 'Fees, donations and leases', hi: 'फ़ीस, दान और लीज़', text: 'Fee plans, 80G receipts with Form 10BD, funds, rent with escalation and deposits.', href: '/recurring?tab=fees' },
    ],
  },
  {
    version: '3.0.2',
    date: '2026-10-26',
    label: 'Income-tax Act 2025 labels',
    items: [
      { title: 'TDS / TCS sections by date', hi: 'तारीख़ के अनुसार TDS / TCS धाराएँ', text: 'From 1 Apr 2026 screens and exports show the 2025 Act section and form names; stored codes are unchanged.', href: '/tds' },
    ],
  },
  {
    version: '3.0.1',
    date: '2026-10-26',
    label: 'Round 4: production, stores, trade desk',
    items: [
      { title: 'Production orders, QC and recalls', hi: 'प्रोडक्शन ऑर्डर, QC और रिकॉल', href: '/manufacturing?tab=orders' },
      { title: 'Gift vouchers, store prices and transfer requests', hi: 'गिफ़्ट वाउचर, स्टोर कीमतें और ट्रांसफ़र अनुरोध', href: '/pos' },
      { title: 'Export desk, LUT register and the recycle bin', hi: 'एक्सपोर्ट डेस्क, LUT रजिस्टर और रीसायकल बिन', href: '/gst-reports?tab=export-desk' },
    ],
  },
];

/** Numeric compare of dotted versions (`3.10.0` > `3.9.1`); non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * The Dashboard card shows only after an upgrade: a stored (dismissed) version older than the running one. A fresh
 * install (nothing stored) never shows it, unless the company already has data from before this version
 * (`hadData`: a device that ran an older build before the seen-key existed).
 */
export function shouldShowCard(stored: string | null | undefined, current: string, hadData = false): boolean {
  if (!stored) return hadData;
  return compareVersions(stored, current) < 0;
}

/** Device-local: the last version whose card was dismissed (or seen on a fresh install). */
export const WHATS_NEW_SEEN_KEY = 'mrchartist_whats_new_seen';

export const newestEntry = (): WhatsNewEntry => WHATS_NEW[0];
