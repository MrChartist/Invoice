<p align="center">
  <img src="https://img.shields.io/badge/MrChartist-Invoice%20Creator-f07020?style=for-the-badge&logo=receipt&logoColor=white" alt="MrChartist Invoice Creator" />
</p>

<h1 align="center">MrChartist — Premium Invoice Creator (v2.0)</h1>

<p align="center">
  <strong>Institutional-grade, offline-first invoice generation tool built for speed, precision, and professional aesthetics.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" />
  <img src="https://img.shields.io/badge/TypeScript-6-3178C6?style=flat-square&logo=typescript" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite" />
  <img src="https://img.shields.io/badge/Architecture-Local%20First-green?style=flat-square" />
  <img src="https://img.shields.io/badge/PDF-jsPDF-red?style=flat-square" />
  <img src="https://img.shields.io/badge/Storage-localStorage-orange?style=flat-square" />
</p>

---

## 🏷 Overview

MrChartist Invoice Creator is a **zero-backend, privacy-first** web application that generates pixel-perfect, GST-ready PDF invoices entirely in the browser. No servers, no sign-ups, no data leaving your machine — ever.

Built for financial consultants, freelancers, and small businesses across India who need institutional-quality invoices without the overhead of SaaS subscriptions.

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| **20+ Premium Templates** | Choose from Classic, Corporate, Minimal, Creative, Healthcare, Compliance, and more — each powered by dynamic layout engines |
| **Multi-Profile Architecture** | Issue invoices from multiple entities (e.g., "Rohit Singh", "MrChartist Global") with independent bank details, logos, and signatures |
| **Invoice Snapshotting** | Each invoice embeds a permanent snapshot of the sender profile at creation time — editing your profile later never alters historical invoices |
| **GST/Indian Compliance** | Auto-generated invoice numbers following the Indian Financial Year (April–March). Format: `INV/FY25-26/0001`. Amount in words uses Indian numbering (Lakhs, Crores) |
| **UPI QR Code** | Every invoice includes a scannable UPI QR code for instant payment |
| **Local CRM** | Client directory with search, auto-complete, and auto-save when creating invoices |
| **Item Catalog** | Services and products are auto-saved to a local catalog for quick reuse |
| **Direct-to-Disk Sync** | Backup and restore your entire database directly to a local folder using Chrome's File System Access API — immune to browser cache wipes |
| **PIN-Protected Access** | Simple 4-digit PIN lock to protect your invoice data on shared computers |
| **Dark Mode Ready** | Full dark/light mode support via CSS custom properties |
| **Pixel-Perfect PDF Export** | A4 PDFs generated client-side using `html-to-image` + `jsPDF` at 3x resolution |

---

## 🖥 Screenshots

> The application features a professional dashboard with revenue tracking, a split-pane invoice creator with real-time preview, a template gallery with 20+ designs, and a full client CRM — all running 100% offline.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 18.x (recommended: 20.x or later)
- **npm** ≥ 9.x (comes with Node.js)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/MrChartist/Invoice.git
cd Invoice

# 2. Install dependencies
npm install

# 3. Start the development server
npm run dev
```

The app will be available at **http://localhost:5173** (or the next available port).

### Production Build

```bash
# Build optimized production bundle
npm run build

# Preview the production build locally
npm run preview
```

The production build outputs to the `dist/` directory, ready for deployment to any static hosting service (Vercel, Netlify, GitHub Pages, etc.).

---

## 🎯 Usage Workflow

1. **Create Account** → On first visit, enter your name and a 4-digit PIN. All data stays on your device.

2. **Setup Profiles** → Go to **Settings**. Add your company name, logo, signature, PAN, GSTIN, and bank details (A/C No, IFSC, UPI ID). You can create multiple sender profiles for different business entities.

3. **Create Invoice** → Navigate to **Invoices**. Select which profile is issuing the invoice from the top dropdown. Fill in the client details and add line items with quantities and rates.

4. **Choose Template** → Use the **Template Gallery** on the right panel to select from 20+ professional designs. Each template automatically applies the correct accent color, font, and layout structure.

5. **Preview & Export** → Click **Preview** to see a pixel-perfect A4 rendering. Use **Download PDF** to save the invoice as a high-resolution PDF.

6. **Track & Manage** → All saved invoices appear in the **Transactions** ledger. Mark invoices as Paid/Sent/Overdue, duplicate them, or delete them.

7. **Backup Your Data** → Go to **Settings → Data Management** and use **Save to Disk** to export your entire database as a JSON file directly to your filesystem. Use **Load from Disk** to restore.

---

## 🏗 Architecture

```
d:\AG\Invoice\
├── public/                     # Static assets (favicon, manifest, OG image)
│   ├── favicon.svg             # App favicon
│   ├── manifest.json           # PWA manifest
│   ├── og-image.png            # Social media preview image
│   ├── robots.txt              # Search engine crawler rules
│   ├── sitemap.xml             # SEO sitemap
│   └── .htaccess               # Apache SPA fallback rules
│
├── src/
│   ├── components/
│   │   ├── form/               # InvoiceForm (line-item editor)
│   │   ├── layout/             # AppHeader, SplitLayout
│   │   ├── modals/             # ClientSearchModal, ItemSearchModal
│   │   ├── preview/            # InvoicePreview (PDF render boundary)
│   │   ├── templates/          # TemplateEngine + registry (20+ styles)
│   │   └── ui/                 # Primitives: Button, Card, Input, Toast
│   │
│   ├── layouts/
│   │   └── DashboardLayout     # Sidebar + header + content shell
│   │
│   ├── lib/
│   │   ├── auth.ts             # PIN-based local authentication
│   │   ├── localDb.ts          # localStorage CRUD wrapper (invoices, clients, items)
│   │   └── utils.ts            # formatCurrency, formatDate, amountInWords (Indian system)
│   │
│   ├── pages/
│   │   ├── Dashboard.tsx       # Revenue stats, quick actions, recent invoices
│   │   ├── InvoiceCreator.tsx  # Main invoice generation UI
│   │   ├── Transactions.tsx    # Invoice ledger with status management
│   │   ├── Clients.tsx         # Client CRM with add/edit/delete
│   │   ├── Settings.tsx        # Multi-profile manager + backup/restore
│   │   └── LoginPage.tsx       # PIN-based login/registration
│   │
│   ├── store/
│   │   ├── useInvoiceStore.ts  # Zustand store for active invoice state
│   │   └── InvoiceContext.tsx   # React Context provider (app-wide state)
│   │
│   ├── types/
│   │   └── invoice.ts          # TypeScript interfaces (CompanyProfile, Client, Invoice, etc.)
│   │
│   ├── App.tsx                 # Root component with React Router routes
│   ├── main.tsx                # Application entry point
│   └── index.css               # Global CSS design tokens (colors, fonts, radii, shadows)
│
├── .cursorrules                # AI assistant guidelines (Cursor/Windsurf/Copilot)
├── .gitignore                  # Git ignore rules
├── index.html                  # HTML entry point with SEO meta tags
├── package.json                # Dependencies and scripts
├── PRD.md                      # Product Requirements Document
├── tsconfig.json               # TypeScript root config
├── tsconfig.app.json           # TypeScript app config
├── tsconfig.node.json          # TypeScript node config
└── vite.config.ts              # Vite build configuration with chunk splitting
```

### Design Decisions

| Decision | Rationale |
|----------|-----------|
| **localStorage over IndexedDB** | Simpler API, sufficient for invoice-scale data, easier to export/import as JSON |
| **Zustand over Redux** | Minimal boilerplate, perfect for single-store invoice state management |
| **html-to-image + jsPDF over @react-pdf/renderer** | Allows exact visual fidelity — the PDF looks identical to the browser preview |
| **CSS Modules + Custom Properties over Tailwind** | Full control over the design system, no utility class bloat, themes via CSS variables |
| **4-Layout Template Engine** | 20 templates derived from just 4 structural layouts (`classic`, `corporate`, `minimal`, `centered`) + dynamic accent colors — zero code duplication |
| **Invoice Snapshotting** | Immutable historical records — changing your profile never retroactively alters old invoices |

---

## 📦 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 19 + TypeScript 6 |
| **Build Tool** | Vite 8 |
| **State Management** | Zustand 5 |
| **Routing** | React Router DOM 7 |
| **PDF Generation** | html-to-image + jsPDF |
| **QR Code** | qrcode.react |
| **Animations** | Framer Motion + CSS Keyframes |
| **Icons** | Lucide React |
| **Styling** | Vanilla CSS Modules + CSS Custom Properties |
| **Storage** | Browser localStorage + Chrome File System Access API |
| **Fonts** | Inter, Outfit, Plus Jakarta Sans, Playfair Display, JetBrains Mono (Google Fonts) |

---

## 🎨 Template Engine

The template system uses a **registry pattern** where each template is defined as metadata:

```typescript
{
  id: 'classic_orange',
  name: 'Classic Orange',
  category: 'Professional',
  layout: 'classic',          // One of: classic | corporate | minimal | centered
  accent: '#f07020',          // Dynamic accent color
  fontFamily: 'var(--font-display)',
  description: 'Versatile template for consultants & agencies',
  icon: '📋'
}
```

The `TemplateEngine.tsx` component renders the invoice using the selected layout structure and dynamically injects the accent color and font — meaning 20+ distinct visual styles are achieved with **zero template code duplication**.

### Available Templates (20+)

| Template | Category | Layout | Best For |
|----------|----------|--------|----------|
| Classic Orange | Professional | Classic | Consultants & agencies |
| Corporate Navy | Professional | Corporate | Formal corporate invoicing |
| Minimal Clean | Minimal | Minimal | Solo professionals |
| Swiss Grid | Minimal | Classic | Precision-focused businesses |
| Modern Teal | Creative | Minimal | Creative teams |
| Freelancer Light | Freelancer | Centered | Independent contractors |
| Tech Startup | Tech | Classic | SaaS & IT companies |
| Creative Studio | Creative | Corporate | Design & media studios |
| Medical Clean | Healthcare | Classic | Clinics & labs |
| Construction Bold | Trade | Corporate | Contractors & tradespeople |
| Real Estate | Professional | Classic | Property & brokerage firms |
| Photography | Creative | Minimal | Visual artists |
| Retail Receipt | Retail | Centered | Shops & retail stores |
| Architect Line | Design | Minimal | Architects & engineers |
| Marketing Pop | Creative | Corporate | Marketing & ad agencies |
| Accounting Ledger | Finance | Classic | CAs & accountants |
| Luxury Gold | Premium | Centered | Luxury brands & jewellers |
| Envelope Format | Minimal | Minimal | Formal correspondence |
| Indian GST | Compliance | Classic | GST-compliant Indian businesses |
| Two-Column Split | Modern | Corporate | Tech & service companies |

---

## 🇮🇳 Indian Financial Compliance

- **Invoice Numbering**: Follows the Indian Financial Year (April 1 – March 31).
  - Format: `INV/FY25-26/0001`
  - Auto-increments per financial year
- **Amount in Words**: Uses the Indian numbering system — Lakhs and Crores (not Millions/Billions)
  - Example: "Rupees Fifty Thousand Only"
- **GSTIN Support**: Both sender and client GSTIN fields with uppercase enforcement
- **PAN Display**: Sender PAN number rendered on invoices
- **UPI QR Code**: Auto-generated scannable QR code from UPI ID for instant payments

---

## 💾 Data Persistence

All data is stored in `localStorage` under the `mrchartist_inv_` prefix:

| Key | Contents |
|-----|----------|
| `mrchartist_inv_settings` | Sender profiles array, active profile ID, defaults |
| `mrchartist_inv_invoices` | All saved invoices with embedded sender snapshots |
| `mrchartist_inv_clients` | Client directory |
| `mrchartist_inv_items_catalog` | Saved service/item templates |
| `mrchartist_inv_transactions` | Payment records |
| `mrchartist_inv_auth` | User name and PIN (local only) |
| `mrchartist_inv_template` | Last selected template ID |

### Backup & Restore

1. **JSON Export/Import**: Download all `mrchartist_inv_*` keys as a single JSON file
2. **Direct Disk Sync** (Chrome only): Use the File System Access API to save/load directly to a folder on your filesystem — survives browser cache clearing

---

## 🔒 Security & Privacy

- **Zero Backend**: No servers, no APIs, no telemetry, no analytics
- **Zero Cloud Storage**: All data lives exclusively in your browser's `localStorage`
- **PIN Protection**: Simple 4-digit PIN prevents unauthorized access on shared machines
- **No External Requests**: The app makes zero network calls (except Google Fonts CDN for typography)
- **Open Source**: Full source code available for audit

---

## 🛠 Development

### Available Scripts

```bash
npm run dev        # Start Vite dev server (HMR enabled)
npm run build      # TypeScript check + production build
npm run preview    # Preview production build locally
npm run lint       # Run ESLint
```

### Code Quality

- TypeScript strict mode with `noUnusedLocals` and `noUnusedParameters`
- ESLint with React Hooks and React Refresh plugins
- CSS Modules for scoped styling (zero class name collisions)
- Chunk splitting for optimized loading (React, PDF engine, UI libraries separated)

### AI Assistant Rules

If you're using an AI coding assistant (Cursor, Windsurf, Copilot), read the `.cursorrules` file first. Key rules:

1. **No Tailwind** — use CSS Modules and custom properties only
2. **No backend** — everything runs in the browser
3. **No `@react-pdf/renderer`** — use the existing `html-to-image` + `jsPDF` pipeline
4. **Respect snapshotting** — never read directly from global settings in the preview; always use `invoice.sender`
5. **Indian FY numbering** — do not change to calendar year

---

## 📄 License

Private — MrChartist Ecosystem. All rights reserved.

<p align="center">
  <sub>Built with precision by <strong>Rohit Singh</strong> for the MrChartist ecosystem.</sub>
</p>
