<p align="center">
  <img src="https://img.shields.io/badge/MrChartist-Invoice%20Creator-f07020?style=for-the-badge&logo=receipt&logoColor=white" alt="MrChartist Invoice Creator" />
</p>

<h1 align="center">MrChartist — Premium Invoice Creator</h1>

<p align="center">
  <strong>Institutional-grade, offline-first invoice generation tool built for speed, precision, and professional aesthetics.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite" />
  <img src="https://img.shields.io/badge/Zustand-State-orange?style=flat-square" />
  <img src="https://img.shields.io/badge/Storage-localStorage-green?style=flat-square" />
  <img src="https://img.shields.io/badge/PDF-jsPDF-red?style=flat-square" />
</p>

---

## ✨ Features

### 📄 Invoice Creation
- **Real-time Invoice Builder** — Split-column layout with instant calculations for subtotal, discount, tax, and grand total
- **Pixel-Perfect PDF Export** — High-fidelity A4 preview rendered via `html-to-image` + `jsPDF` at 3× pixel ratio
- **GST Compliance** — Supports IGST (inter-state) and CGST+SGST (intra-state) tax modes
- **Multi-Currency** — INR (₹) and USD ($) support with proper locale formatting

### 📊 Dashboard & Analytics
- **Revenue Overview** — Real-time stat cards tracking Total Revenue, Pending Balances, and Total Invoices
- **Recent Activity Feed** — Quick view of your most recent invoices with status badges
- **Transactions Ledger** — Comprehensive table view of all invoices with filtering by status

### 🗂️ Local CRM & Service Catalog
- **Client Directory** — Automatically saves client details when invoices are generated. Search and auto-fill returning clients instantly
- **Item Catalog** — Saved services and rates auto-populate via inline search. Never re-type your common line items
- **Zero Setup** — Everything persists in `localStorage`. No database, no server, no accounts

### 🎨 Design System
- **Universal Theme Plan** — Consistent with the MrChartist ecosystem using HSL-based CSS custom properties
- **Light & Dark Mode** — Full theme parity with smooth transitions
- **Premium Typography** — Inter, Outfit, JetBrains Mono, Playfair Display font stack
- **Glassmorphic UI** — Frosted cards, subtle shadows, and micro-animations throughout

---

## 🏗️ Architecture

```
src/
├── components/
│   ├── modals/          # ClientSearchModal, ItemSearchModal
│   ├── preview/         # InvoicePreviewModal (A4 PDF renderer)
│   └── ui/              # Toast, Button, Card, Input primitives
├── layouts/
│   └── DashboardLayout  # Sidebar + header shell
├── lib/
│   ├── localDb.ts       # localStorage CRUD API (invoices, clients, items)
│   └── utils.ts         # formatCurrency, formatDate, cn()
├── pages/
│   ├── Dashboard.tsx     # Analytics overview
│   ├── InvoiceCreator.tsx# Main invoice form
│   └── Transactions.tsx  # Invoice ledger
├── store/
│   └── useInvoiceStore.ts# Zustand store for active invoice state
├── types/
│   └── invoice.ts        # TypeScript interfaces
└── index.css             # Global design tokens
```

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/MrChartist/Invoice.git
cd Invoice

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

The app runs at `http://localhost:5173` with zero external dependencies — everything is local-first.

---

## 📋 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | React 18 + TypeScript |
| **Build** | Vite 8 |
| **State** | Zustand |
| **Routing** | React Router v7 |
| **Icons** | Lucide React |
| **PDF** | html-to-image + jsPDF |
| **Styling** | Vanilla CSS + CSS Modules |
| **Storage** | localStorage (offline-first) |

---

## 🎯 Workflow

1. **Create** → Navigate to Invoices → Fill in client details, add line items, set tax & discount
2. **Preview** → Click "Preview" for a pixel-perfect A4 render with your branding
3. **Export** → Click "Download PDF" for a publication-ready PDF at 3× resolution
4. **Save** → Click "Save Invoice & Close" to persist to the local database
5. **Track** → View all invoices in the Transactions Ledger with status tracking

---

## 🔧 Configuration

### Company Profile
Edit the default company profile in `src/store/InvoiceContext.tsx`:
```typescript
{
  name: 'Rohit Singh',
  tagline: 'Premium Financial Research & Analytics',
  address: 'Mumbai, Maharashtra, India',
  email: 'rohit@mrchartist.com',
  website: 'mrchartist.com',
  invoicePrefix: 'MRC'
}
```

### Invoice Numbering
Auto-generated sequential numbers in format: `INV-{YEAR}-{XXXX}` (e.g., `INV-2026-0001`)

---

## 📄 License

Private — MrChartist Ecosystem. All rights reserved.

---

<p align="center">
  <sub>Built with precision by <strong>Rohit Singh</strong> for the MrChartist ecosystem.</sub>
</p>
