# Changelog

All notable changes to this project will be documented in this file.

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
