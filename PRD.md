# Product Requirements & Architecture Document (PRD)

**Project Name:** Mr. Chartist Invoice
**Version:** 3.1.0 (Full Accounting & GST Edition)
**Status:** Production-Ready ✅
**Official Site:** [https://mrchartist.com](https://mrchartist.com)

---

## 1. Product Overview

Mr. Chartist Invoice is a professional, institutional-grade, zero-dependency, local-first web application designed for financial consultants, Indian traders, businesses, and freelancers to generate pixel-perfect, GST-compliant invoices and manage everyday business accounts without relying on a backend server or recurring SaaS subscription.

---

## 2. Core Pillars

1. **Absolute Data Privacy & Security**: 100% of data lives locally on the user's device (`localStorage` / IndexedDB). Zero telemetry, zero cloud databases, and zero tracking.
2. **Institutional Aesthetics**: 26 handcrafted templates with a dedicated Design Studio, supporting A4, A5, and 80mm thermal paper sizes with crisp typography and UPI QR codes.
3. **Historical Integrity (Snapshotting)**: Editing a business profile or bank details today never alters invoices generated in the past.
4. **Complete Offline-First PWA**: Self-hosted fonts, offline service worker precaching, and direct-to-folder disk backups via Chrome/Edge File System Access API.
5. **Full GST & Accounting Workflow**: CGST/SGST/IGST, cess, TCS, TDS, GSTR-1 / GSTR-3B working papers, BRS (Bank Reconciliation), Day Book, Cash & Bank Book, P&L, Inventory, and Tally Prime XML export.

---

## 3. Key Feature Modules

### 3.1 Sales & Document Management
- **Document Types**: Tax Invoices, Quotations, Proforma Invoices, Credit Notes, and Delivery Challans with one-click conversion between types.
- **Series Numbering**: Indian Financial Year auto-incrementing series (`INV/FY25-26/0001`, resets 1 April) with Rule 46 duplicate series validation and gap detection.
- **Tally-Style Fast Entry**: Enter to add lines, Ctrl/⌘+Enter to save, and instant keyboard shortcuts.
- **WhatsApp & Email Reminders**: Scored payment reminder templates in English and Hinglish with UPI payment links.

### 3.2 GST & Compliance Engine
- **Intra-state vs. Inter-state Tax**: Automatic CGST + SGST vs. IGST split based on place of supply and client GSTIN state code.
- **Advanced Tax Handling**: Cess, TCS, TDS, reverse charge, SEZ/Export/LUT supply classifications, and exact Indian paise rounding.
- **e-Invoice & e-Way**: Signed IRN, Ack No, and e-Invoice QR code embedding on printouts with offline JSON generator.
- **GST Reports**: GSTR-1 & GSTR-3B offline tool-compatible JSON and CSV generation with aggregate turnover support.

### 3.3 Accounts, Books & Banking
- **Receivables Ledger**: Aging analysis (0-30, 31-60, 61-90, 90+ days), Days Sales Outstanding (DSO), and printable client statements.
- **Purchases & Payables**: Vendor bill recording, expense categorization, and Input Tax Credit (ITC) tracking.
- **Books of Accounts**: Day Book, Cash Book, Bank Book, Profit & Loss (accrual and cash basis), and indicative balance sheets.
- **Bank Reconciliation (BRS)**: Import CSV statements from major Indian banks (HDFC, ICICI, SBI, Axis, Kotak), scored match suggestions, and printable BRS reports.
- **Inventory Management**: FIFO and Weighted-Average costing methods, real-time stock positions, and shortage alerts during invoice drafting.

### 3.4 Data Portability & Accountant Handoff
- **Tally Prime XML Export**: Direct XML import vouchers for Tally Prime.
- **CSV Registers**: Zoho Books, Vyapar, and Busy-compatible CSV registers.
- **Backup & Encryption**: One-click JSON export/import, Chrome/Edge folder sync, and AES-GCM passphrase encryption.
- **Total Local Data Erasure**: Double-confirmed factory data wipe directly in Settings.

---

## 4. Technical Architecture

- **Frontend Core**: React 19 + TypeScript 6 + Vite 8 (Rolldown bundler).
- **State Management**: Zustand (single source of truth in `src/store/useInvoiceStore.ts`).
- **Styling**: Vanilla CSS + CSS Modules (`*.module.css`) with tokens in `src/index.css`. Zero Tailwind dependencies.
- **PDF Stack**: `html-to-image` + `jspdf` (multi-page, client-side, JPEG-compressed).
- **QR Code**: `qrcode.react` (offline vector rendering).
- **Icons**: `lucide-react`.

---

## 5. Non-Commercial Licensing

Released under the **Mr. Chartist Non-Commercial Source License**. Free for individuals and businesses to use internally; commercial resale, white-labeling, or hosting as a paid commercial SaaS product is strictly prohibited.
