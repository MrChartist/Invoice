/**
 * R6-A6: the beta tester guide inside the app (Help → Beta guide), a TypeScript copy of `docs/BETA_GUIDE.md`.
 * The `##` headings stay in step with the Markdown file (tests/help-tips.test.ts): when the guide changes, change
 * both. English text with Hindi headings and lines where the wording is settled. Lazy chunk.
 */

export interface GuideLink {
  label: string;
  href: string;
}

export interface GuideSection {
  /** Exactly the `## ` heading of docs/BETA_GUIDE.md. */
  heading: string;
  hiHeading: string;
  lines: readonly string[];
  /** Flows A–E: one "Open" link each. */
  links?: readonly GuideLink[];
  /** The "how to report" section opens the report dialog. */
  report?: boolean;
}

export const BETA_GUIDE: readonly GuideSection[] = [
  {
    heading: '1. What the app is', hiHeading: '1. यह ऐप क्या है',
    lines: [
      'Invoicing and light accounting for Indian businesses: sales documents, payments, purchases with ITC and TDS, inventory, books, GST working papers, e-Invoice / e-Way JSON, Tally XML and payroll.',
      'Local-first and private: no server and no account. Your data stays in this browser on this device, so we cannot see it or recover it: your backups are the only copy.',
    ],
  },
  {
    heading: '2. Install it as an app (PWA)', hiHeading: '2. इसे ऐप की तरह इंस्टॉल करें (PWA)',
    lines: [
      'Chrome / Edge: the install icon in the address bar. Android: menu → Install app. iPhone / iPad (Safari): Share → Add to Home Screen.',
      'After an update, choose Reload on the "New version ready" notice. Your data is not touched by an update.',
    ],
  },
  {
    heading: '3. Offline behaviour', hiHeading: '3. ऑफ़लाइन व्यवहार',
    lines: [
      'After the first visit every screen works without a connection. Only WhatsApp / e-mail sharing and portal links need the internet.',
      'On iPhone / iPad, install to the Home Screen and keep backups: Safari can clear unused site data.',
    ],
  },
  {
    heading: '4. Before you start: back up, or use a test company', hiHeading: '4. शुरू करने से पहले: बैकअप लें या टेस्ट कंपनी इस्तेमाल करें',
    lines: [
      'Back up first: Settings → Data & backup → Download backup.',
      'Better: add a separate company such as "Beta test" from the company switcher. Testing there never touches your real books.',
      'Sample data fills a company with demo documents that can be removed again.',
    ],
  },
  {
    heading: '5. Roles on a shared device', hiHeading: '5. साझा डिवाइस पर भूमिकाएँ',
    lines: [
      'Owner: everything. Clerk: documents, payments, masters and books, but no settings, deletes of issued documents or full backups. Viewer: read, print and export.',
      'Roles are a convenience lock, not security. Tell us if a role can do something it should not.',
    ],
  },
  {
    heading: '6. Interface languages', hiHeading: '6. इंटरफ़ेस की भाषाएँ',
    lines: ['Switch the language in Settings → Language / भाषा or on the PIN screen: English, हिन्दी, मराठी, ગુજરાતી, தமிழ், বাংলা, తెలుగు, ಕನ್ನಡ. Hindi and Marathi cover most screens; the others are partial. Please report untranslated or awkward text.'],
  },
  {
    heading: '7. What to test first', hiHeading: '7. पहले क्या टेस्ट करें',
    lines: [
      'A. Invoice → payment → GST papers: client with GSTIN, invoice, part payment, credit note, then GSTR-1 and 3B for the month.',
      'B. Purchase → TDS: supplier bill with ITC, a payment that deducts TDS, then TDS & TCS and GSTR-3B ITC.',
      'C. Books and the Gateway: day book, ledgers, trial balance, P&L; vouchers with F4–F9 on the Gateway.',
      'D. Inventory and manufacturing: stock items, sales and bills of tracked items, a BOM and a manufacturing journal.',
      'E. Payroll: employees, structures, a monthly run, payment and the postings in Books.',
      'F. Industry pack: turn on one pack in a test company and follow its figures to Receivables, Books and GST.',
      'G. Bring your openings over: import suppliers, the 31 March trial balance and unpaid bills; check the dry-run difference.',
    ],
    links: [
      { label: 'A · New invoice', href: '/invoice' },
      { label: 'B · Bills', href: '/expenses?tab=bills' },
      { label: 'C · Books', href: '/books' },
      { label: 'D · Inventory', href: '/inventory' },
      { label: 'E · Payroll', href: '/payroll' },
      { label: 'G · Import openings', href: '/settings?tab=data&import=ledgers' },
    ],
  },
  {
    heading: '8. Known limitations', hiHeading: '8. ज्ञात सीमाएँ',
    lines: [
      'Statutory outputs (GSTR-1 / 3B / 9, e-Invoice / e-Way JSON, TDS returns, Tally XML, payroll) are working papers, not validated against the portals. Verify with your CA before you file or pay.',
      'No cloud sync apart from the optional encrypted folder sync. The PIN is a lock screen; vault mode encrypts the data.',
      'Open roadmap items are listed in the roadmap; please do not report them as bugs, but tell us if one blocks you.',
    ],
  },
  {
    heading: '9. How to report a problem', hiHeading: '9. समस्या कैसे बताएँ',
    lines: [
      'Help (?) or F1 → Report a problem. Type what you did, what you expected and what happened, then Share, WhatsApp or E-mail. Nothing is sent until you tap Share.',
      'The report adds masked diagnostics (version, browser, screen, recent errors, storage health) and no business data.',
    ],
    report: true,
  },
];
