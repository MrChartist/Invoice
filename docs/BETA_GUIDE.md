# Private beta: tester guide

Thank you for testing **Mr. Chartist Invoice**. This page covers what the app is, how to set it up safely,
what to test first, what is known to be missing, and how to report a problem.

## 1. What the app is

- An invoicing and light accounting app for Indian businesses: GST invoices and other sales documents, payments
  and receivables, purchases and expenses (with ITC and TDS), inventory and manufacturing, books (day book,
  ledgers, P&L, balance sheet), GST working papers (GSTR-1, GSTR-3B and more), e-Invoice / e-Way JSON, Tally
  XML, payroll, and a Tally-style keyboard Gateway.
- **Local-first and private.** There is no server and no account. Everything you type stays in this browser on
  this device (IndexedDB). Nothing is uploaded, and the app makes no network calls of its own.
- That also means **we cannot see your data or recover it**. Your backups are the only copy we cannot lose for
  you (see section 4).
- The **Beta** badge next to the logo marks this build as a private test build.

## 2. Install it as an app (PWA)

The app runs in any modern browser. Installing it gives it its own window and icon, and keeps it working offline.

| Device | How |
|---|---|
| Chrome / Edge (Windows, macOS, Linux, ChromeOS) | Open the app, then the install icon in the address bar, or menu → *Install Mr. Chartist Invoice*. |
| Android (Chrome) | Menu (⋮) → *Install app* / *Add to Home screen*. |
| iPhone / iPad (Safari) | Share → *Add to Home Screen*. Use Safari: other iOS browsers cannot install it. |

After an update is published, the app shows a *New version ready* notice. Choose *Reload* to switch to the new
version. Your data is not touched by an update.

## 3. Offline behaviour

- After the first visit, every screen works without a connection, including screens you have never opened. The
  app caches its own files only.
- Saving, PDFs, reports and backups all work offline. Only things that are online by nature need a connection:
  opening a WhatsApp / e-mail share, or a link to a government portal.
- On iPhone / iPad, Safari can clear site data that has not been used for a few weeks. Install the app to the
  Home Screen and keep backups.
- **Settings → Data & backup** shows a storage health meter (space used, whether the browser promised to keep
  the data, the last backup).

## 4. Before you start: back up, or use a test company

1. **Back up first.** If you already have real data in the app, open *Settings → Data & backup* → *Download
   backup* (or an encrypted backup) and keep the file. A restore brings everything back exactly.
2. **Better: test in a separate company.** Use the company switcher at the top of the sidebar to add a company
   such as "Beta test". Each company is a separate data store on the device, so testing never touches your real
   books. Switch back at any time.
3. **Sample data.** *Try with sample data* (Dashboard or *Settings → Data & backup*) opens a separate **Demo
   company** with a business like yours (shop counter, services, trading, transport or works contract) and today's
   dates. A banner says "Sample company — nothing here is real", with *Switch to my company* and *Reset samples*.
   Sample data never goes into your own company.
4. Optional: turn on automatic backups to a folder (Chrome / Edge) in the same panel.

## 5. Roles on a shared device

The owner can add local users in *Settings → Security*:

| Role | Can |
|---|---|
| Owner | Everything, including settings, users, backups, restore, erase, period-lock overrides and payroll. |
| Clerk | Create and edit documents, record payments, edit masters and books. Cannot delete issued documents, change settings or take full backups. |
| Viewer | Read screens, print / download PDFs and export reports. |

Roles are a convenience lock on a shared computer, not security: anyone with the device and browser developer
tools can read the stored data. Please test each role and tell us about anything a role can do that it should
not (or cannot do that it should).

## 6. Interface languages

Switch the interface language in *Settings* → *Language / भाषा*, or on the PIN screen. The choice is kept on
this device only. The app offers eight languages:

| Language | Coverage |
|---|---|
| English | Everything. |
| हिन्दी (Hindi) | The shell, Dashboard, invoice editor, payment dialog and most screens. |
| मराठी (Marathi) | Core screens (shell, Dashboard, editor, payments, khata). |
| ગુજરાતી (Gujarati), தமிழ் (Tamil), বাংলা (Bengali), తెలుగు (Telugu), ಕನ್ನಡ (Kannada) | Partial: the core screens through a phrase glossary; other text shows in English (roadmap 5.4 / 8.130). |

Statutory wording that is not certain stays in English ("verify with your CA"). Please report untranslated text,
awkward wording and any layout that breaks with longer text.

## 7. What to test first

Work through these flows end to end. After each step, check the numbers on the next screen.

### A. Invoice → payment → GST papers
1. Create a client with a GSTIN (in-state and out-of-state) and a few items with HSN codes and GST rates.
2. New invoice: add lines, a discount, shipping; try tax-inclusive prices and a reverse-charge or export invoice.
   Save, preview, download the PDF, try another template in Design Studio.
3. Record a part payment, then the rest. Check the invoice status, *Receivables* (ageing, statement) and the
   receipt.
4. Issue a credit note against the invoice.
5. *GST reports*: GSTR-1 (B2B / B2C / credit notes / HSN summary) and GSTR-3B for that month. Download the
   JSON / Excel working papers.

### B. Purchase → TDS
1. Add a vendor and enter a purchase bill with ITC; try an expense and a purchase return.
2. Record a payment that deducts TDS (for example 194C / 194J).
3. Check *TDS & TCS* (payables, challans, returns), the vendor ledger in *Books*, and ITC in GSTR-3B.

### C. Books and the Gateway
1. *Books*: day book, cash / bank book, ledgers, trial balance, P&L and balance sheet for the financial year.
   Every invoice, receipt, bill and payment should appear once.
2. *Gateway* (the keyboard screen): enter vouchers with the Tally-style keys (F4 contra, F5 payment, F6 receipt,
   F7 journal …), alter one, and check it in the day book.

### D. Inventory and manufacturing
1. *Inventory*: stock items with opening stock, godowns, batches / serials if you use them.
2. Sell and buy tracked items and watch the stock position and the "only N in stock" warning in the editor.
3. Manufacturing: a bill of materials, a manufacturing journal, a stock journal, a physical stock count.
   Check the stock summary and the closing-stock value.

### E. Payroll
1. *Payroll* (owner only): employees, salary structures, a monthly payroll run with EPF / ESI / PT / TDS.
2. Pay the run, check the payslips and the payroll postings in *Books*.

### F. Industry pack
1. In a test company, pick one pack in *Settings → Defaults → Shop mode* (marketplace seller, transporter, works
   contractor, school / clinic, non-profit or landlord).
2. Work through its screens (for example: import a marketplace sales file and its settlement; or an LR, a freight
   bill and a trip; or a BOQ and an RA bill with retention).
3. Check where the figures land: *Receivables*, *Books*, GSTR-1 / 3B and the TDS screens. Switch the pack off and
   check that its tabs and bell notices go away and nothing else changes.

### G. Bring your openings over
1. In a test company, *Settings → Data & backup → Import data*: import your supplier list (Vyapar / Busy / Marg /
   Tally / QuickBooks / Xero / Zoho exports, or any Excel sheet), then your 31 March trial balance (*Ledgers & opening
   balances*, preset "Trial balance") and the unpaid bills of that day (*Opening bills*).
2. Read the dry run: the difference in opening balances (it goes to "Opening balance difference"), the groups the app
   mapped for you, and the suppliers it matched instead of adding twice.
3. Check *Books → Opening trial balance*, *Receivables* ageing and *Books → Tally → Bill-wise payables*. An import can
   be undone in one step from the undo copy (*Settings → Data & backup*).

Also useful: install / offline (section 2–3), backup and restore into a new company, two tabs open at once,
and a phone-sized screen.

## 8. Known limitations

- **Statutory outputs are working papers.** GSTR-1 / 3B / 9, e-Invoice and e-Way JSON, TDS returns, Tally XML
  and payroll statutory figures follow the published rules as we understand them, but they are not validated
  against the GST portal, NIC, TRACES or EPFO tools. **Verify them with your CA before you file or pay.**
- No server means no cloud sync between devices, apart from the optional encrypted folder sync (*Settings →
  Data & backup*) through a folder you already sync (Google Drive, OneDrive, Dropbox …).
- The 4–6 digit PIN is a lock screen; to encrypt the data at rest, turn on vault mode in *Settings → Security*.
- Hindi is partial (section 6).
- Open roadmap items are listed in [`docs/ROADMAP.md`](ROADMAP.md), rows marked ⏳ or 🟡. The ten most likely to
  affect your testing (please do not report these as bugs, but do tell us if one blocks you):
  1. More languages and screens are still partly English (5.4, 8.130).
  2. Gateway voucher entry has no bill-wise references or voucher classes (7.19).
  3. Tally import brings no inventory quantities; no TDS challans in the Tally export (7.49).
  4. Form 15CA / 15CB, 27Q extras, ISD postings, GSTR-6 amendments and some GSTR-9 tables are not built (7.131).
  5. The TDS receivable register: credit notes do not reduce the TDS expected (`receivables.md`, CA item T12).
  6. The cash-flow forecast ignores GST, TDS, loans and salaries (`cash-planning.md`).
  7. A refund paid in a later marketplace settlement shows the customer in credit on *Receivables* (R5-A7).
  8. A cancelled RA bill's number is issued again (R5-B7).
  9. Custom fields are not on bills, expenses or recurring documents (`attachments-custom-fields.md`).
  10. Editing a supplier bill below the quantity already returned is not blocked (`purchase-returns.md`).

## 9. How to report a problem

1. Open **Help & about** (the **?** button in the bar at the top right, F1 outside the POS, or *More → Help & about*
   on a phone) and choose **Report a problem**.
2. Pick the **kind** — Problem, Idea or Question — and the **area** (the screen you were on is filled in). For a
   problem, write what you did, what you expected and what happened instead, and how bad it is (Blocks me /
   Annoying / Cosmetic).
3. The app adds a short diagnostic block built on your device: app version and build, your browser, the screens you
   visited (record ids masked), the last errors and a storage summary. Numbers, amounts, GSTINs and e-mail addresses
   — also in what you type — are masked. **It contains no business data. Do not type customer names.** Read it
   before you share it.
4. **Nothing is sent until you tap Share.** Share opens your device's share sheet; *WhatsApp* and *E-mail* (when this
   build has the beta channel set) open a message to the beta WhatsApp group or the e-mail address you were given;
   *Copy* puts the report on the clipboard. Add a screenshot or recording if you can (check it for real customer
   data first). An unsent draft stays on this device until you send or clear it.
5. If the app does not open at all, tell us the browser and device and what the screen shows.

Never send a backup file or screenshots of real customer data unless we ask and you are comfortable with it.
A copy of the sample-data company that shows the problem is the best evidence.
