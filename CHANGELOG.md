# Changelog

All notable changes to this project will be documented in this file.

## [3.0.0] — 2026-10-07

### Brand & design
- Adopted the official Mr. Chartist symbol, wordmark, favicon and social image from mrchartist.com, and rebuilt the design tokens on the site's paper / void palette with the brand-orange primary.
- Rebuilt every screen on shared primitives: Login, Dashboard, invoice editor, invoice list, Clients and Settings. Responsive to 390 px, with a working light/dark toggle.
- Grouped sidebar, Ctrl/⌘+K command palette, notification centre and shortcuts overlay.

### Added
- **Documents**: quotation → proforma → invoice → challan conversion, partial credit notes, cancel / reinstate with a document timeline.
- **GST & tax**: cess, TCS, TDS, tax-inclusive pricing, SEZ / export / LUT supplies, rounding modes, e-Invoice (IRP v1.1) and e-Way Bill JSON, GSTR-1 / GSTR-3B working papers.
- **Accounts**: purchases & expenses with ITC, receivables aging and client statements, inventory (weighted-average / FIFO), day book, cash & bank book, P&L and an indicative balance sheet.
- **Workflow**: recurring invoices, payment reminders and WhatsApp / email / SMS sharing, CSV import wizard, Tally Prime XML and accountant-friendly CSV exports.
- **Design Studio** with six new templates, A5 and 80 mm thermal paper, status stamps and per-profile preferences.
- **Resilience**: installable PWA with an offline service worker, folder auto-backup, backup nudges, passphrase-encrypted backups, hashed PIN with lockout and idle auto-lock, an error boundary.

### Changed
- PDF export is multi-page, lazy-loaded, and JPEG-compressed (a one-page invoice is ~170 KB instead of ~17 MB).
- `logout()` now only locks the app and keeps the PIN; previously it deleted the credential. Existing users see the PIN screen once after upgrading.
- Backup restore only accepts `mrchartist_inv_*` keys and never restores or exports the PIN session.
- Public references now point to https://mrchartist.com.

### Fixed
- A pending autosave could resurrect a stale "unsaved draft" after saving.
- GSTR input-tax-credit ignored the purchases module's real field names and reported zero ITC.
- A bare `YYYY-MM-DD` was parsed as UTC, filing 1 April documents under the previous financial year west of UTC.
- Removed the external avatar service (network call) and hardcoded personal bank details from the bundle.

## [2.0.0] — 2026-05-03

### Added
- **Multi-Profile Architecture**: Issue invoices from multiple business entities with independent bank details, logos, and signatures.
- **20+ Dynamic Templates**: Template Engine featuring 20 distinct visual styles across 4 structural layouts (Classic, Corporate, Minimal, Centered).
- **Invoice Snapshotting**: When an invoice is created, it embeds a permanent deep copy of the sender profile. Editing your profile later never alters historical invoices.
- **Direct-to-Disk Sync**: Backup and restore your database directly to a local folder using Chrome's File System Access API — immune to browser cache clearing.
- **UPI QR Code Integration**: Every invoice includes a scannable UPI QR code for instant payment.
- **PIN-Protected Access**: Simple 4-digit PIN lock to protect invoice data on shared computers.
- **Client CRM**: Full client directory with search, add, edit, and delete functionality.
- **Item Catalog**: Services and products are auto-saved to a local catalog for quick reuse across invoices.
- **Transaction Ledger**: Track all invoices with status management (Draft, Sent, Paid, Overdue), duplication, and deletion.
- **Dashboard**: Revenue tracking, pending payments, quick actions, and recent invoice activity.
- **Indian Financial Year Numbering**: Invoice numbers follow `INV/FY25-26/0001` format with auto-increment per FY.
- **Amount in Words**: Indian numbering system (Lakhs, Crores) with automatic conversion.
- **Dark Mode Support**: Full light/dark mode via CSS custom properties.
- **SEO Optimization**: Open Graph, Twitter Cards, sitemap, robots.txt, canonical URLs.
- **PWA Manifest**: Installable as a standalone Progressive Web App.
- **Production Chunk Splitting**: React, PDF engine, and UI libraries separated for optimized loading.

### Architecture
- React 19 + TypeScript 6 + Vite 8
- Zustand 5 for state management
- Vanilla CSS Modules with CSS Custom Properties (no Tailwind)
- `html-to-image` + `jsPDF` for PDF generation
- `qrcode.react` for UPI QR codes
- Framer Motion for animations
- Lucide React for icons

## [1.0.0] — 2026-04-15

### Added
- Initial release with single-profile invoice creation.
- Basic PDF export.
- localStorage persistence.
