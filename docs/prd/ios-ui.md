# iOS-grade interface: audit and work plan

_30 Oct 2026. Docs only: nothing built. The spec builders follow is [`docs/theme/IOS-UI.md`](../theme/IOS-UI.md); this file
holds the evidence (audit with numbers) and the plan (packages, owned files, order, checks). Base: master `77b0596`._

## 1. Goal

The owner wants the interface raised to "iOS grade": Apple Human Interface Guidelines quality in buttons, borders, colour,
visuals and the use of space, with one common width and one common weight on every page. Buttons stay as
[`BUTTON-SYSTEM.md`](../theme/BUTTON-SYSTEM.md) says (decision D1 in the spec); type stays as
[`TYPE-SYSTEM.md`](../theme/TYPE-SYSTEM.md) says. Templates and printed paper are out of scope.

## 2. Audit (master `77b0596`)

Method: a static count over the 154 CSS files in `src/` (151 CSS modules, 22,168 lines; templates counted apart where
noted) and the production build opened in Chromium with the Demo company's sample data (26 invoices), screenshots at
375, 768, 844 × 390, 1024, 1280, 1440, 1920 and 2560px, light and dark, plus metrics of the page frame on 25 routes.

### 2.1 Numbers

| Area | Today | iOS-grade target |
|---|---|---|
| Raw hex in CSS outside `index.css` | 46 (16 in `invoice-paper.module.css`, 10 in `buttons.css`, 6 in `StatementDocument.module.css`; most are printed paper) | 0 outside `ios.css` / `buttons.css` / templates |
| Raw hex in TS / TSX outside templates | 33 (`Avatar.tsx:7-8` ten avatar colours, `useTheme.ts:26`, `design-prefs.ts` design swatches, print helpers) | Avatar and theme colour from tokens; design swatches and print helpers allow-listed |
| `color-mix()` tints written by hand | 174 | Through `--sys-*-soft` / `--tint-soft` |
| Distinct `border-radius` values | 27 (84 raw: 23 × `4px`, 14 × `999px`, 12 × `2px`, 8 × `3px` …; 396 via tokens) | 9 tokens (`--r-4` … `--r-full`, `--r-tile`) |
| Border widths | 451 × 1px, 36 × 2px, 17 × 3px, 6 × 1.5px, 4 × 4px+; 35 dashed; 385 × `1px solid var(--border)`; 0 hairlines outside buttons | `--hairline` (0.5px on 2x screens), cards frameless (D4) |
| Distinct `box-shadow` values | 35 (37 raw) | 3 elevations + focus |
| Distinct `z-index` values | 22, from -1 to 10000 (`9000` × 3, `9500` × 2, `10000` in `audit.module.css:382`, `8000`, `800`, `900` …) | 12 named layers |
| Easing curves | 9 (`ease` × 30, `linear` × 8, five different `cubic-bezier`s incl. `Modal.module.css:26`) | 4 curves, 4 durations |
| Spacing values (gap / padding / margin) | 2,495, of which 775 (31%) off the 4-pt grid (`0.875rem` × 141, `0.375rem` × 132, `0.625rem` × 128, `0.4rem` × 62 …); 72 distinct `gap`, 101 distinct padding values | 11 spacing tokens |
| Width media queries | 24 distinct (640px × 47, 560, 480, 520, 720, 760, 780, 860, 900, 960, 1000, 1080, 1100, 1280 …), all in px | 7 breakpoints in `em` |
| Container queries | 2 (`ItemsTable.module.css:163, 226`) | Every card-level component |
| `backdrop-filter` (materials) | 8 in 5 files, each its own blur (top bar `blur(10px)`, modal scrim `blur(4px)`, drawer scrim `blur(2px)`) | One `.material` class, 5 thicknesses, opaque fallback |
| Safe areas | 5 `env(safe-area-inset-*)` uses, all inert: `index.html` viewport has no `viewport-fit=cover` | Shell, bars and sheets honour all four insets |
| Viewport units | 17 plain `vh` vs 5 `dvh` (`Modal.module.css:22`, `CommandPalette.module.css:10, 17`, `LoginPage.module.css:10` …) | `dvh` / `svh` only |
| `text-transform: uppercase` | 70 rules (stat labels 0.06em, table heads 0.06em, badges 0.05em, sidebar group titles 0.1em) against TYPE-SYSTEM's sentence-case rule | Sentence case (D5) |
| Inline `style={{…}}` | 588 in 262 TSX files; 96 inline `maxWidth`s | Layout through tiers; inline only for computed values |
| Lucide sizes | 16 × 606, 14 × 514, 15 × 172, 18 × 64, 12 × 44, 13 × 25 (197 off-scale 13 / 15); no stroke rule outside buttons | Sizes 12 to 28 on a scale; stroke set in CSS |
| First-paint CSS | `index-*.css` 54.6 kB raw, 11.3 kB gzip (fonts, `index.css`, `buttons.css`, first-paint modules) | ≤ 15 kB gzip after all packages (section 6) |

### 2.2 Where screens fall short (with file:line)

Surfaces and borders

1. Every card is framed and shadowed: `surface.module.css:49-54` (`.card`: 1px `--border` + `--shadow-card`), so a page of
   eight cards draws sixteen grey frames; dark `--card #0e0e10` on `--background #000` (`index.css:137-140`) gives almost no
   level difference, so dark relies on the 1px `#26262b` frame alone.
2. Panels inside cards are another frame: `.panel` (`surface.module.css:89-95`) is a third grey with its own 1px border.
3. Tables: full-width 1px rules under every cell (`surface.module.css:196-213`), capital heads with 0.06em tracking
   (`:203-206`), `min-width: 640px` (`:197`) so every phone table scrolls; identifiers break mid-token
   ("DEMO/FY26-" / "27/0025" on Invoices at 1280px) and Clients names wrap to four lines at 768 to 1024px (rows about
   230px tall), pushing the balance column off-screen.
4. Badges are capitals at 0.05em (`surface.module.css:166-180`) with colour-only meaning (no dot or glyph).

Colour

5. Flat grey everywhere: 476 uses of `--muted-foreground`, 388 of `--border`; meaning colours limited to four
   (`--profit`, `--loss`, `--warning`, `--info`); no category colours, so Books, GST, Inventory and Payroll look alike.
6. Dark mode switches the app accent to gold (`index.css:131-150`): links, focus ring, active nav, selection all turn gold,
   which reads as "warning" next to orange-amber status text.
7. Avatars use ten raw Tailwind-like hexes (`Avatar.tsx:7-8`) and read "L(" for "Lotus Clinics Pvt Ltd (demo)".
8. `meta theme-color` differs between first paint and a theme toggle: `theme-init.js` writes `#000000` / `#f6f6f7`,
   `useTheme.ts:26` writes `#06080a` / `#f4f5f0`.

Shape, depth, motion

9. 27 radius values; nested corners repeat the outer radius (cards `--radius-lg` holding panels `--radius-md` holding
   fields `--radius-sm`, never computed from the inset).
10. Modals: raw scrim `rgba(10, 12, 18, 0.6)` with `blur(4px)` (`Modal.module.css:5-6`), z-index 9000, their own spring
    (`:26`); on phones a centred card with 12px margins, no grabber, no detents (`Modal.module.css:104`), while
    `invoicing-ux/ux.module.css:44-53` keeps a second, separate bottom-sheet implementation.
11. Every page fades up 12px on arrival (`surface.module.css:12`), which native apps do not do.
12. `:focus-visible` forces `border-radius: var(--radius-xs)` on whatever is focused (`index.css:248-252`), so a focused
    16px card shows a 6px-cornered ring.

Shell

13. Top bar: `blur(10px)` over 88% background with a 60% border (`DashboardLayout.module.css:217-229`), close to a material
    but hand-made; the phone top bar is an opaque card with a 1px border (`:291-301`).
14. Phone tab bar: opaque `--card` + 1px border + `--shadow-md` (`DashboardLayout.module.css:347-358`): iOS bars are a
    translucent material with a hairline and no shadow.
15. Sidebar: a white card column with a 1px right border (`:12-21`), capital group titles at 0.1em (`:103-111`), a 3px
    brand bar for the active item (`:142-151`); 768 to 900px tablets get the phone drawer and tab bar (`:286`).
16. Phone landscape (844 × 390): top bar 60 + tab bar 60 = 120px, 31% of the height.

Space and frame

17. One frame already, but capped at 1280px (`DashboardLayout.module.css:273-278`): at 1920px 392px of the main column is
    empty (23%), at 2560px 1,032px (45%), on every page including the editor and POS, while the editor's live preview
    and POS's tender panel are squeezed inside the 1280px.
18. Title position jumps: the one-time `ScreenTip` renders above `PageHeader` on Invoices, Clients, Expenses, Inventory,
    Books, Reports and POS (`Transactions.tsx:396`, `Pos.tsx:866` …), so the title sits at y = 165 to 173px there and
    95px elsewhere (1440px, first visit); Gateway's own header (`GatewayMenu.tsx:176`) is 22px at y = 233px against
    24px elsewhere.
19. Header actions wrap into two rows of capsules on phones (Invoices: Export CSV, Export .xlsx, New invoice); the
    three-tile stat grid leaves an orphan (`surface.module.css:310-314`); Settings' eight-tab `.seg` wraps to two lines at
    1280px (`Settings.tsx:206` sets `flexWrap: 'wrap'`); Books' tab strip is clipped at "Repo" with no fade.
20. Editor: `1fr 360px` (`InvoiceCreator.module.css:17-21`) collapses to one column under 1100px, so a 1024px iPad
    landscape loses the summary column; live preview has no split of its own.
21. The demo banner (dashed border, `--brand-soft`), the setup checklist and tips sit between the header and the
    figures on the Dashboard: on a 375px phone the first figure is below the fold.

Common weight

22. Title sizes: 24px on 24 routes, 22px on Gateway, 20px on phones; card titles 15px / 600 in `surface`, 17px in
    `Modal`, 16pt in printed views; weights of labels vary between 500 and 600 for the same role (sidebar group 600,
    stat label 600, field label 500 to 600).

### 2.3 Before screenshots

Folder: `/tmp/claude-0/-home-user-Invoice/c401a5ec-398d-5b90-84fd-5f6b9cfff692/scratchpad/ios/before/` (session scratchpad;
the QA package re-shoots with `scripts/ui-shots.mjs`). Names are `<screen>-<theme>-<w>x<h>.png`:

- Light and dark at 375 × 812 and 1280 × 900: `dashboard`, `editor`, `transactions`, `clients`, `settings`, `books`,
  `gst`, `inventory`, `pos`, `receivables`, `empty-loans` (empty state).
- Light at 768 × 1024, 1024 × 768, 1440 × 900, 1920 × 1080, 2560 × 1440 and 844 × 390: `dashboard`, `editor`,
  `transactions`, `clients`, `settings`, `books`, `pos`.
- Overlays, light and dark: `overlay-cmdk-*-1280` (command palette), `overlay-modal-*-1280` and `-375` (Add client),
  `overlay-help-*-1280` and `-375`, `overlay-drawer-*-375` (sidebar drawer), `overlay-create-sheet-*-375` (phone "+").
- Metrics: `metrics.json`, `frame-metrics.json` (frame width, gutter, title position and size per route and width).

## 3. Packages

Order: **P0** (tokens) → **PL** (layout primitives and page frame) → **P1 … P5 in parallel** → **QA**. P0 and PL are
sequential because everything else consumes them; P1 to P5 own disjoint files.

### P0: tokens and base surfaces (first, alone)

Owns: new `src/styles/ios.css`; `src/index.css` (token block and aliases, `:focus-visible`, body background, scrollbar,
reset, display-pref overrides); `src/main.tsx` (one import line, after `index.css`, before `buttons.css`); `index.html`
(viewport `viewport-fit=cover`, `theme-color`); `public/theme-init.js` (theme colour only); `src/hooks/useTheme.ts`
(theme colour only); new `tests/ios-ui.test.ts`; new `scripts/ui-shots.mjs` (the screenshot and frame-metrics script used
for the audit, made a repo script); `docs/theme/IOS-UI.md` updates.

Does:

1. Every token family of spec section 1 in `:root`, `.dark`, `html.a11y-contrast`, `html.dark.a11y-contrast`.
2. Old names in `index.css` become aliases (spec 1.13), so the app keeps rendering; then the base surfaces switch: body
   `--bg-grouped`, `--card` → `--bg-grouped-2`, `--border` → `--sep` at `--hairline`, the dark accent per D2, the
   focus rule per 1.11, `.material` and the `@supports` fallback, the continuous-corner block (D8).
3. The `--sys-*` / `--tint` / label contrast check and the ratchets in `tests/ios-ui.test.ts` (section 5), with today's
   numbers as the starting ceilings.

Acceptance: every existing screen still renders (no class removed); before / after at 375 and 1280 light, dark and
high contrast for Dashboard, Invoices and Settings; first-paint CSS ≤ +3 kB gzip; all existing lock-in tests green.

### PL: layout and space (second, alone)

Owns: `src/layouts/DashboardLayout.tsx` and `DashboardLayout.module.css` (structure only: shell grid, breakpoints,
sidebar rail / collapse state, safe areas, `dvh`, tab-bar visibility rules); new `src/components/ui/Page.tsx`,
`src/styles/page.module.css`, `src/components/ui/SplitView.tsx` (master-detail and inspector panes, resizable on
pointer devices, stacked / pushed on phones), `src/components/ui/PageHeader.tsx` (becomes `Page`'s header; kept as a
wrapper for old imports); the "Page scaffolding" section of `src/styles/surface.module.css` (`.page`, `.pageHead`,
`.pageTitle`, `.pageSubtitle`, `.pageActions`); `public/theme-init.js` (density class only, after P0); the root wrapper
and header lines of every file in `src/pages/*.tsx` (switching to `<Page>`, moving `ScreenTip` / `AboutStrip` / demo
notices into the notices slot); `src/pages/InvoiceCreator.module.css` `.layout` / `.side` grid (editor + summary +
live-preview split); `src/pages/Dashboard.module.css` grid rules; `src/components/creator/LivePreviewPane.module.css`.

Does: spec section 3 in full: device classes in `em`, one page frame and the width tiers, header slot order, common
weight roles for page-level text, density classes, the tablet rail (D7), master-detail on Invoices, Clients, Books /
Reports and Settings through `SplitView`, the inspector on wide screens, the editor split, the dashboard container grid,
the column-priority mechanism (`data-priority` on `th`, the container-query rules in `page.module.css` that P2's table
styles hook into), safe areas.

Acceptance: `scripts/ui-shots.mjs` at 320, 375, 768, 844 × 390, 1024, 1280, 1440, 1920 and 2560 for the 25 routes of the
frame metrics: the title's x, y and size identical on every route at each width (bleed routes excepted only for x above
2170px); no route scrolls sideways at any width; at 1920 and 2560 the empty share of the main column under 10% on pages
with an inspector; phone landscape chrome ≤ 84px; text-size pref 130% and browser zoom 200% at 1280 still usable.

### P1: app shell visuals

Owns (after PL hands them over): `src/layouts/DashboardLayout.module.css` (visual rules: materials, sidebar look, items,
group titles, user card, top bar, phone tab bar), `src/components/companies/*` (switcher look), `src/components/keys/
nav.module.css` and `keys.module.css` (key bar), `src/components/brand/*` (spacing only; the logo stays orange),
`src/components/demo/*` notices (look of the demo banner).

Does: spec 2.5 (top bar material + hairline-on-scroll, large title collapse on phones, sidebar iPadOS look, selection
fill, sentence-case groups, tab bar material, back link), 2.11 for shell icons (sidebar 18px, tab bar 22px).

Acceptance: shell at 375, 768, 1280, 1920 in light, dark, HC; materials fall back to opaque with `backdrop-filter`
disabled (devtools) and with reduced motion on; tab bar clears the home indicator in an iPhone viewport with insets
(Playwright `screen` + `safe-area` emulation via CSS `env` override in a test page).

### P2: lists, tables, grouped rows, forms

Owns: the "Cards" and "Tables" sections of `src/styles/surface.module.css` plus a new "Groups" section (`.group`,
`.row`, `.rowValue`, `.chevron`, `.groupHeader`, `.groupFooter`, `.tile`); `src/styles/controls.module.css` (fields,
selects, search, field labels, toggles: never the button classes, which the rulebook owns); `src/components/ui/
Typeahead.*`, `NumberInput.tsx`, `GstinInput.tsx`, `LanguageSwitch.*`, new `src/components/ui/Toggle.tsx`; Settings:
`src/pages/Settings.tsx` (below PL's header lines) and `src/components/settings/*`; `src/components/masters/*`;
the list screens' table markup: `src/pages/Transactions.*`, `src/pages/Clients.*`, `src/pages/Expenses.*`,
`src/components/clients/*`.

Does: spec 2.1 to 2.4 and 3.6: frameless cards, inset grouped lists, the table look (sticky head and totals, hairlines,
number columns, no mid-token breaks, column priority and row cards under 600px), filled vs bordered fields, labels in
sentence case, toggles for instant settings, underline tab strips that scroll with a fade (Settings' tabs become the
iPad section list through PL's `SplitView` on tablets and a grouped list on phones).

Acceptance: Settings, Invoices, Clients, Expenses at 375, 768, 1280, 1920 light / dark / HC; a table with 8 columns
shows no page-level horizontal scroll at 375; keyboard focus visible on every row and field.

### P3: sheets, dialogs, alerts, toasts, menus, popovers

Owns: `src/components/ui/Modal.*`, `ConfirmDialog.tsx`, `Toast.tsx`, `useToast.tsx`, `src/lib/modal-stack.ts` (no
behaviour change, only the layer token), `src/components/command/*` (command palette, notification bell panel),
`src/components/invoicing-ux/*` (its sheet becomes `Modal` sheet mode), `src/components/layout/*` (Help, quick-create
sheet, report-a-problem, not-found), `src/components/help/*`, `src/components/preview/*` (preview overlay chrome),
`src/components/receivables/StatementViewer.*`, `src/components/share/*`, `src/components/pwa/*`, new
`src/components/ui/Menu.tsx` (menu / context menu / action sheet).

Does: spec 2.6 (phone sheets with grabber and detents, desktop dialogs, tablet form sheets, alerts, action sheets,
menus and context menus, toasts, scrim), the z-index layers, motion tokens for every overlay.

Acceptance: every overlay at 375 and 1280 light / dark / HC; drag-to-dismiss and Escape both close a sheet; the top of
`modal-stack` alone handles Escape and Tab (QA7 G3 unchanged); focus returns to the opener; reduced motion makes
arrivals instant.

### P4: dashboard, KPI cards, charts, badges, empty states, skeletons

Owns: `src/pages/Dashboard.tsx` (below PL's header lines) and `Dashboard.module.css` (non-grid rules),
`src/components/dashboard/*`, the "Stat tiles", "Badges" and "Empty state" sections of `src/styles/surface.module.css`,
`src/components/ui/StatCard.tsx`, `StatusBadge.tsx`, `EmptyState.tsx`, `Avatar.tsx`, new `src/components/ui/
Skeleton.tsx`, new `src/styles/charts.module.css` (chart primitives: bars, grid, axes, legend, callout),
`src/components/receivables/Charts.*`, `src/components/books/planning/cashflow.module.css`.

Does: spec 2.7 to 2.11 (status pills with dot / glyph, KPI cards with tiles, Swift-Charts look, empty states, skeletons,
icon tiles and the module colour map, avatars), the meaning map of spec 1.1 applied to every status the app shows.

Acceptance: Dashboard and Receivables at 375, 1280, 1920 light / dark / HC; every pill and chart legend readable in
grayscale (screenshot with `filter: grayscale(1)`); skeletons absent under 300ms loads.

### P5: feature screens sweep (two halves that can run at once)

P5a owns: `src/pages/Pos.tsx`, `src/components/pos/*`, `src/components/pos-retail/*`, `src/components/pos-returns/*`,
`src/components/restaurant/*`, `src/pages/Tables.tsx`, `src/pages/InvoiceCreator.tsx` (below PL's lines) and
`src/components/creator/*` except `LivePreviewPane.module.css`, `src/components/gateway/*`, `src/pages/Gateway.tsx`,
`src/components/voucher-types/*`, `src/components/keys/*Sheet*`.

P5b owns: `src/pages/{Books,Reports,GstReports,Inventory,Receivables,Recurring,Reconcile,Time,Payroll,Exports,Tds,
Cheques,Loans,Manufacturing,Distribution,Practice,OrderPad}.*` (below PL's lines), `src/components/{books,reports,
gst-reports,inventory,receivables (except Charts and StatementViewer),recurring,bank,cheques,payroll,time,exports,tds,
production,manufacturing,mfg,practice,year-end}/*` and every pack desk directory (`agri`, `construction`, `fuel`,
`hotel`, `institutions`, `logistics`, `manpower`, `marketplace`, `nonprofit`, `prof`, `property`, `retail`,
`retail-r9`, `services-r10`, `society`, `trade`, `transport`, `travel`, `works` and the rest of `src/components/*` not
owned above).

Does: replace hand-made surfaces, raw values and local widths with the shared primitives from P0 to P4 (tokens, `Page`,
`SplitView`, `.group` / `.row`, table priority, fields, `Modal` / `Menu`, pills, tiles, charts, empty states); give each
module its tile colour; Books / Reports / Reconcile / Receivables underline tabs per spec 2.4; POS and the editor bleed
per spec 3.2. No behaviour changes.

Acceptance: the ratchets of section 5 reach their final values for the owned files; POS, editor, Gateway, Books,
GST, Inventory and two pack desks screenshot at 375, 1024, 1280, 1920 light / dark / HC.

### QA pass (last)

Re-shoot the full `before/` set as `after/` with `scripts/ui-shots.mjs`; compare frame metrics (title position and
size identical across routes, empty share at 1920 / 2560, no sideways scroll); contrast spot checks with the test's
calculator on real screenshots (pill text, chart labels, materials over photos and over dense tables); set every
ratchet in `tests/ios-ui.test.ts` to its final value; e2e smoke and key matrix green; bundle budgets green; update
`docs/PROGRESS.md`.

## 4. Shared-file protocol

- `src/styles/ios.css` and the token block of `src/index.css`: P0 only. A later package needing a token asks for it in
  its PR description and adds it in a separate first commit touching only `ios.css`, so two packages adding tokens
  merge cleanly (append at the end of the family, never reorder).
- `src/styles/surface.module.css`: split by its existing section banners; each package edits only its sections (PL page
  scaffolding, P2 cards / tables / groups, P4 stat tiles / badges / empty state). P0 adds the banners for the new
  sections before anyone starts.
- `src/layouts/DashboardLayout.module.css`: PL first (structure), then P1 (visuals). PL marks structural rules with a
  `/* layout */` comment; P1 does not change those.
- `src/pages/*.tsx`: PL owns the root wrapper and header lines (the `<Page …>` element and the notices slot) of every
  page; the page's other lines belong to the package listed above. Rebase on PL before starting.
- `src/styles/buttons.css`, `src/components/ui/Button.tsx`, `docs/theme/BUTTON-SYSTEM.md`: nobody (rulebook; D1).
- `src/components/templates/*` and print helpers: nobody.
- `tests/ios-ui.test.ts`: P0 writes it; every package lowers only its own ratchet numbers, in its own allow-list
  section (one `const` per package), so edits do not collide.
- `src/i18n/*`: a new visible string (sheet "Cancel", "More", tab names) goes through `t()` with a literal Hindi
  object, per `AGENTS.md`; each package adds its keys in its own area file.

## 5. Lock-in test: `tests/ios-ui.test.ts`

Node `node:test`, no extra dependencies, same walker as `tests/button-system.test.ts`. Scope: `src/**/*.css` and
`src/**/*.tsx`, excluding `src/components/templates/` and print documents (allow-listed by file with a reason).

1. **Tokens exist** in all four theme blocks of `ios.css`: every name in spec section 1 (a fixed list in the test).
2. **Contrast**: parse `--label`, `--label-2`, `--label-3`, `--tint`, every `--sys-*-ink` from each theme block and
   compute WCAG ratios against that block's `--bg`, `--bg-grouped` / `--bg-grouped-2`, `--fill-3` (composited) and the
   `-soft` pill (composited over `--bg-grouped-2`): each ≥ 4.5. `--sys-*-tile` against white (black for yellow) ≥ 3.
3. **No raw colour** (hex, `rgb()`, `rgba()`, `hsl()`) in CSS outside `ios.css`, `index.css` aliases, `buttons.css`;
   none in TSX `style` props; allow-list: templates, print helpers, `design-prefs.ts` swatches, the logo.
4. **Radii**: `border-radius` only `var(--r-*)`, `var(--b-*)` (rulebook internals), `50%`, `0`, `inherit`.
5. **Borders**: widths only `var(--hairline)`, `0`, `none`, or the three allowed accents (spec 1.6) by selector name
   (`focus`, `selected`, `alertBar`).
6. **Shadows**: only `var(--elev-*)`, `none`, the focus rule; no `box-shadow` on a class named `card`, `group`, `panel`.
7. **z-index**: only `var(--z-*)`, `0`, `1`, `-1`.
8. **Motion**: `transition` / `animation` durations only `var(--dur-*)`, easings only the four tokens or `linear` for
   spinners and shimmers.
9. **Media**: width queries only at the spec's breakpoints and in `em`; no plain `vh` (`dvh` / `svh` / `lvh` only).
10. **Materials**: `backdrop-filter` only in `ios.css` (`.material`) and `buttons.css` (glass).
11. **Page frame**: every `src/pages/*.tsx` route component renders `<Page` (allow-list: `LoginPage`, `ShareTarget`,
    `Gateway` display mode); no CSS `max-width` above 35rem / 560px outside `page.module.css`, `Modal.module.css` and
    the allow-list; no side `padding` / `margin-inline` on a page root class; no inline `maxWidth` / `width` above 560 in
    pages.
12. **Common weight**: `text-transform: uppercase` only in the allow-list (printed-style registers that copy a statutory
    form); `letter-spacing` at most `0.02em` on capitals; page titles only through `Page`.
13. **Shell facts**: `index.html` viewport contains `viewport-fit=cover`; `theme-init.js` and `useTheme.ts` write the
    same two theme colours, equal to `--bg-grouped` light / dark.

Every rule starts as a **ratchet** (today's count as the ceiling, printed with the offending file:line when it rises),
each package lowers its numbers, and QA sets them to their final values (0 except the reasoned allow-list). To prove a
rule bites, the PR shows it failing once on a deliberate raw value.

## 6. Size note

CSS is outside the JS budgets (first paint 185 kB, core 3,300 kB, `scripts/check-bundle-size.mjs`), but first-paint
CSS blocks rendering. Today the entry stylesheet is 54.6 kB raw / 11.3 kB gzip.

- `ios.css` (four theme blocks of tokens plus `.material`, `.tile`, the corner and fallback blocks): target ≤ 3 kB gzip.
- Removing hand-made tints, shadows and duplicated rules should pay most of it back; the sum of all packages may add
  **at most 4 kB gzip** to first-paint CSS (≤ 15.3 kB) and must not grow any lazy route's CSS by more than 10%.
- `Page.tsx`, `SplitView.tsx`, `Toggle.tsx`, `Skeleton.tsx` are first-paint JS (Dashboard uses them): together ≤ 2 kB
  gzip; `Menu.tsx` lazy where possible. No new dependency, no new lucide icon name.
- Each package's PR states first-paint CSS and JS before / after (`npm run build` output and
  `scripts/check-bundle-size.mjs`).

## 7. Done when

- All packages merged in order; `tests/ios-ui.test.ts` at final values; button, type and em-dash tests green.
- The `after/` screenshots show: grouped grey pages with frameless cards; hairlines; one tint; status colour with a dot
  or glyph; translucent bars; phone sheets with grabbers; the same title position and width on every route; columns
  and panes instead of empty margins at 1920 and 2560.
- The owner has seen D1 to D8 and either kept them or asked for the one-token change each lists.
