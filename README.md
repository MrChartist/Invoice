<p align="center">
  <img src="https://img.shields.io/badge/MrChartist-Invoice%20Creator-f07020?style=for-the-badge&logo=receipt&logoColor=white" alt="MrChartist Invoice Creator" />
</p>

<h1 align="center">MrChartist — Premium Invoice Creator (v2.0)</h1>

<p align="center">
  <strong>Institutional-grade, offline-first invoice generation tool built for speed, precision, and professional aesthetics.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite" />
  <img src="https://img.shields.io/badge/Architecture-Local%20First-green?style=flat-square" />
  <img src="https://img.shields.io/badge/PDF-jsPDF-red?style=flat-square" />
</p>

---

## ✨ What's New in v2.0

- **Multi-Profile Architecture:** Issue invoices from multiple entities (e.g., "Rohit Singh", "MrChartist Global") with independent bank details, logos, and signatures.
- **20+ Dynamic Templates:** A new Template Engine featuring 20 distinct visual styles (Classic, Corporate, Minimal, Creative) powered by dynamic layout wrappers.
- **Historical Snapshotting:** When an invoice is created, it embeds a permanent "snapshot" of the sender profile. If you change your business address tomorrow, your past invoices remain untouched and legally accurate.
- **Direct-to-Disk Sync:** Backup and restore your database directly to a Windows/Mac folder using the native Chrome File System Access API.

---

## 🏗️ Architecture & AI Guide

This repository follows strict architectural rules. If you are an AI assistant (Cursor, Windsurf), **read `.cursorrules` before modifying code.**

```text
src/
├── components/
│   ├── templates/       # Template Engine (20+ styles, 4 core layouts)
│   ├── preview/         # PDF rendering boundary
│   └── ui/              # Primitives
├── lib/
│   ├── localDb.ts       # localStorage CRUD API wrapper
│   └── utils.ts         # Math, currency, and date formatters
├── pages/
│   ├── InvoiceCreator   # The main generation UI
│   └── Settings         # Multi-profile manager + Disk Sync
├── store/
│   └── useInvoiceStore  # Zustand global state (handles snapshotting)
└── index.css            # Global CSS Variables (NO Tailwind)
```

## 🚀 Quick Start

Zero external dependencies, zero backend.

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

## 🎯 Workflow

1. **Setup Profiles** → Go to Settings. Add your logo, signature, PAN, and Bank Details.
2. **Create Invoice** → Select which profile is issuing the invoice from the top-left dropdown. Add clients and items.
3. **Choose Template** → Click Preview, and use the Template Selector in the toolbar to cycle through 20+ professional designs.
4. **Export** → Download the pixel-perfect A4 PDF.
5. **Backup** → Periodically go to Settings -> "Save to Disk" to export your `localStorage` data safely.

---

## 📄 License

Private — MrChartist Ecosystem. All rights reserved.

<p align="center">
  <sub>Built with precision by <strong>Rohit Singh</strong> for the MrChartist ecosystem.</sub>
</p>
