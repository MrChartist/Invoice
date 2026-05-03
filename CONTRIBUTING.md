# Contributing to MrChartist Invoice Creator

## Architecture Rules

Before making any changes, **read `.cursorrules`** in the project root. These rules are non-negotiable.

### Core Constraints

1. **No Backend** — This is a 100% client-side application. Do not add servers, APIs, or databases.
2. **No Tailwind** — Use CSS Modules (`.module.css`) and CSS Custom Properties defined in `src/index.css`.
3. **No External Dependencies** — Keep the bundle size minimal. Discuss before adding any new npm package.
4. **Snapshot Integrity** — The PDF preview must always read from `invoice.sender` (embedded snapshot), never directly from global settings.

### Development Setup

```bash
npm install
npm run dev
```

### Before Committing

```bash
npm run build    # Verifies TypeScript + production bundle
npm run lint     # Checks ESLint rules
```

### File Organization

| Directory | Purpose |
|-----------|---------|
| `src/components/` | Reusable UI components (templates, modals, primitives) |
| `src/pages/` | Route-level page components |
| `src/layouts/` | Layout shells (sidebar, header) |
| `src/lib/` | Utility functions, localStorage wrapper, auth |
| `src/store/` | Zustand store and React Context |
| `src/types/` | TypeScript interface definitions |

### Styling Guidelines

- Use CSS Modules for all component styling
- Use CSS Custom Properties from `index.css` for colors, fonts, radii, and shadows
- Inline styles are acceptable only for dynamic template rendering (accent colors, etc.)
- Follow the existing design system — do not introduce new color palettes without updating tokens

### Template Engine

To add a new template:

1. Add an entry to `src/components/templates/registry.ts`
2. Choose one of the 4 existing layouts: `classic`, `corporate`, `minimal`, `centered`
3. Define the accent color and font family
4. The `TemplateEngine.tsx` will automatically render it — no new component code needed

---

*Private repository — MrChartist Ecosystem. All rights reserved.*
