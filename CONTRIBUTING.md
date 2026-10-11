# Contributing to Mr. Chartist Invoice

Thank you for your interest in contributing to **Mr. Chartist Invoice**!

This project is a **local-first, 100% client-side, offline-capable invoicing and light-accounting platform** built for Indian businesses and freelancers. We welcome community contributions, bug fixes, template additions, and enhancements that align with our core principles.

---

## 📜 Licensing Notice for Contributions

By submitting a Pull Request or contributing code to this repository, you agree that your contributions will be licensed under the project's **Mr. Chartist Non-Commercial Source License** (see [LICENSE](LICENSE)). The software is free for individuals and businesses to use internally, but commercial resale, sublicensing, or offering paid hosted SaaS versions of this software is strictly prohibited.

---

## 🏛️ Core Architecture Constraints (Non-Negotiable)

To maintain privacy, offline performance, and data safety for existing users, all contributions must respect the following core constraints:

1. **100% Client-Side & Zero-Backend**:
   - Everything runs in the browser.
   - Do **NOT** add backend servers, REST APIs, databases (PostgreSQL/MongoDB), Axios, or telemetry.
   - User data lives exclusively in the user's browser `localStorage` and IndexedDB.

2. **No TailwindCSS**:
   - Use **Vanilla CSS + CSS Modules** (`*.module.css`).
   - Use CSS custom properties (design tokens defined in `src/index.css` and `--pal-*`).
   - Do not hardcode raw hex values inside layout components.

3. **Additive Schema & Data Migration**:
   - Stored `localStorage` key names (`mrchartist_inv_*`) and document fields must remain backward-compatible.
   - Never rename or drop existing stored schema keys; all database evolution must be additive or gracefully migrate older records.

4. **Invoice Snapshotting**:
   - Invoices snapshot the sender's profile at the moment of creation.
   - Printable previews and PDFs must always read from `invoice.sender` first (falling back to global settings only for legacy records). Historical invoices must never change when a user edits their business profile later.

5. **Indian Financial Year Numbering**:
   - Invoice numbers default to Indian FY series (1 April – 31 March), format: `INV/FY25-26/0001`.
   - Never switch the series generator to calendar-year numbering.

6. **Self-Hosted & Offline-First**:
   - All fonts and assets are self-hosted under `/fonts/` and `public/`.
   - Never introduce dependencies on external CDNs or Google Fonts.

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js**: `v22.0.0` or newer (required for the built-in `node:test` runner).
- **npm**: `v10.0.0` or newer.

### Getting Started

```bash
# 1. Clone your fork
git clone https://github.com/MrChartist/Invoice.git
cd Invoice

# 2. Install dependencies
npm install

# 3. Start the Vite development server
npm run dev
```

Visit `http://localhost:5173/` in your browser.

---

## 🧪 Verification & Quality Checks

Before submitting any Pull Request, ensure that all four quality gates pass cleanly without warnings or errors:

```bash
# 1. Type check (TypeScript)
npm run typecheck

# 2. Code style & linting (ESLint)
npm run lint

# 3. Automated test suite (600+ node:test suites)
npm test

# 4. Production build & bundle verification
npm run build
```

---

## 🎨 How to Add a New Invoice Template

All invoice templates use our unified `TemplateEngine`:

1. Open `src/components/templates/registry.ts`.
2. Add a new template configuration:
   - Choose a layout: `'classic' | 'corporate' | 'minimal' | 'centered' | 'gst' | 'receipt' | 'letterhead'`.
   - Define the `accent` CSS color token and `fontFamily`.
   - Provide a human-readable name and descriptive tags.
3. Test your template in the **Design Studio** (`/design`) and verify print/PDF export on A4, A5, and 80mm thermal paper sizes.

---

## 🌿 Pull Request Guidelines

1. **Branch Naming**:
   - `feat/feature-name` for new capabilities.
   - `fix/bug-description` for bug fixes.
   - `docs/topic` for documentation updates.

2. **Commit Messages**:
   - Follow standard conventional commits: `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`, `test: ...`.

3. **Writing Tests**:
   - If you add or modify logic in `src/lib/` (calculations, taxes, period locks, importers, reports), add a corresponding unit test in `tests/`.

---

## 🛡️ Main Branch Protection

The `master` branch is the stable production branch. 
- All changes must go through tested Pull Requests.
- Direct pushes to `master` without passing quality checks are prohibited.
- Releases and version bumps are tagged from `master`.

---

*Thank you for helping make Mr. Chartist Invoice the best local-first business tool for India!*
