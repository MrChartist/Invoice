# Product Requirements Document (PRD)
**Project Name:** MrChartist Premium Invoice Creator
**Version:** 2.0 (Multi-Profile & Template Engine Edition)
**Status:** Production-Ready ✅

## 1. Product Overview
MrChartist Invoice Creator is an institutional-grade, zero-dependency, local-first web application designed for financial consultants, freelancers, and small businesses to generate pixel-perfect, compliant PDF invoices instantly without relying on a backend server or SaaS subscription.

## 2. Target Audience
- Independent Financial Consultants (like Rohit Singh)
- Freelancers needing high-fidelity PDFs
- Small agencies managing multiple brands/entities
- Indian businesses requiring GST-compliant invoices

## 3. Core Objectives
- **Absolute Data Privacy:** 100% of data must live on the user's hard drive. No telemetry, no cloud databases.
- **Institutional Aesthetics:** The generated PDFs must look indistinguishable from those created by top-tier financial institutions.
- **Historical Integrity:** Editing a business profile today must never alter an invoice generated 6 months ago.

## 4. Key Features & Requirements

### 4.1 Multi-Profile Management ✅
- Users can create, edit, and delete multiple "Sender Profiles".
- Each profile contains independent metadata: Company Name, Tagline, Logo, Signature, Address, Phone, Email, GSTIN, PAN, and Bank Details (Bank, A/C No, IFSC, UPI).
- Users can select which profile to issue an invoice under via a dropdown in the creation UI.

### 4.2 Invoice Snapshotting Architecture ✅
- **Requirement:** Invoices must be immutable once created.
- **Implementation:** Upon saving an invoice, the system takes a deep copy of the currently selected Sender Profile and embeds it into the `invoice.sender` JSON object. The PDF renderer strictly reads from this embedded snapshot.

### 4.3 Template Engine (20+ Variations) ✅
- The application includes a template registry with 20 distinct aesthetic variations.
- Templates are categorized (Professional, Minimal, Creative, Healthcare, Compliance, etc.).
- The system uses 4 structural layouts (`classic`, `corporate`, `minimal`, `centered`) combined with dynamic CSS variables (`accent` color, `fontFamily`) to render the 20 variations without code bloat.

### 4.4 Indian Financial Compliance ✅
- Auto-generated invoice numbers follow the Indian Financial Year (April 1 – March 31). Format: `INV/FY25-26/0001`.
- "Amount in Words" uses the Indian numbering system (Lakhs, Crores).
- GSTIN and PAN support for both sender and client.
- UPI QR code auto-generated on every invoice.

### 4.5 Local CRM & Data Persistence ✅
- Client details and Item catalog are saved to `localStorage` for auto-complete functionality.
- Direct-to-Disk Sync: Users can backup and restore their entire database directly to an OS folder using the Chrome File System Access API, bypassing browser cache wiping issues.

### 4.6 Authentication ✅
- PIN-based local authentication (4-6 digits).
- No server-side auth — everything stays in `localStorage`.

### 4.7 Dashboard & Analytics ✅
- Revenue tracking (total received, pending).
- Client count, invoice count.
- Recent activity feed.
- Quick action buttons.

### 4.8 Transaction Ledger ✅
- Full invoice listing with status management.
- Mark as Paid/Sent/Overdue.
- Duplicate and delete invoices.
- Preview and download from the ledger.

## 5. Technical Stack
- **Frontend:** React 19, Vite 8, TypeScript 6
- **State Management:** Zustand 5
- **Styling:** Vanilla CSS Modules with custom HSL properties. Strictly NO TailwindCSS.
- **PDF Engine:** `html-to-image` + `jsPDF`
- **QR Code:** `qrcode.react`
- **Icons:** Lucide React
- **Animations:** Framer Motion + CSS Keyframes
- **Routing:** React Router DOM 7
- **Storage:** `localStorage` wrapper (`localDb.ts`)
- **Fonts:** Inter, Outfit, Plus Jakarta Sans, Playfair Display, JetBrains Mono (Google Fonts)

## 6. Deployment
- **Domain:** https://invoice.mrchartist.in
- **Hosting:** Any static hosting (Vercel, Netlify, GitHub Pages)
- **PWA:** Manifest configured for standalone installability
- **SEO:** Full Open Graph, Twitter Cards, sitemap, robots.txt
