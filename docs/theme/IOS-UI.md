# Mr Chartist Invoice: iOS-grade interface

_30 Oct 2026. The design-system spec for raising the app's interface to Apple Human Interface Guidelines quality:
colour, surfaces, borders, depth, shape, motion, components, and the use of space on every device. Written as
instructions: builders follow it as it stands. The work plan (packages, owned files, order, checks) is in
[`docs/prd/ios-ui.md`](../prd/ios-ui.md); the audit numbers behind every rule are in its section 2._

Binding and older than this spec, so this spec never overrides them:

- [`TYPE-SYSTEM.md`](TYPE-SYSTEM.md): the three Chartist fonts, the 12px floor, weight 600 at most, 4.5:1 text,
  Indian comma grouping, no em dashes in visible text (`tests/type-system.test.ts`, `tests/no-em-dash.test.ts`).
- [`BUTTON-SYSTEM.md`](BUTTON-SYSTEM.md): every pressable thing is `.btn` / `.join` / `.seg` / `.chip` / `.lk` from
  `src/styles/buttons.css`; buttons are pure black / white with iOS glass; destructive is `danger`; no tinted
  buttons (`tests/button-system.test.ts`).
- `AGENTS.md`: CSS Modules only (no Tailwind), CSS variables instead of raw hex in components, the logo and the Ember
  template keep orange, every lucide icon lands in first paint (reuse names, never add new ones), templates and printed
  paper are out of scope.

## The prompt

> The app should feel like a first-party iPad and Mac app that happens to run in a browser. Surfaces are calm: a grouped
> grey page, white (or near-black) inset cards with no frame, hairline separators inset from the leading edge, one tint for
> links, selection and focus, and the iOS system colours used for meaning (status, categories, charts, icon tiles), never
> for buttons. Bars float on a translucent material. Corners are continuous and follow one scale. Depth is rare and soft.
> Motion is a short spring that settles; reduced motion makes it instant. Every page sits in the same frame: the same
> width, gutter, title position and spacing, from a 320px phone to a 2560px display, and the extra room on a big screen
> becomes columns and panes, never empty margins or stretched lines. Colour is never the only signal, and every text
> colour reads at 4.5:1 in light, dark and high contrast.

## Decisions the owner may want to overturn

| # | Decision | Why | To overturn |
|---|---|---|---|
| D1 | Buttons keep the button rulebook (ink / paper glass, `danger` red). The iOS system colours are used for meaning and visuals only, never to fill a button. iOS's own blue-filled buttons are not adopted. | The button rulebook is newer and specific to pressable controls. | Add a `tint` intent to `buttons.css` and the rulebook; nothing else in this spec changes. |
| D2 | One app tint: brand blue in both themes (`--tint`: `#1a4d94` light, `#7fb0ff` dark). Gold leaves interactive roles in dark (focus ring, selection, active nav, links) and stays a brand accent (`--brand-gold`): the logo area, the Gateway menu cursor, gold-coded data. | iOS apps have one tint across themes; gold on near-black reads as "warning". | Set `--tint` back to `var(--pal-gold)` in `.dark`; contrast still passes (7.4:1 on `--bg-grouped-2`). |
| D3 | Secondary and tertiary label colours are opaque and darker than Apple's (`#5c5c63` / `#636366` light, `#aeaeb2` / `#a1a1a6` dark). | Apple's 60% alpha secondaryLabel measures 3.4:1 on white and 3.1:1 on the grouped grey: it fails the 4.5:1 rule. | None advised (the 4.5:1 rule is the owner's). |
| D4 | Cards on the grouped page lose their 1px border and their shadow (iOS inset-grouped look). High contrast puts a 1px opaque separator back. | 385 `1px solid var(--border)` declarations make every screen look framed and heavy. | Set `--card-edge` to `1px solid var(--sep)` in `:root`: one line. |
| D5 | Capitals with wide tracking (table heads, stat labels, badges, sidebar group titles: 70 rules) become sentence case at 500, per TYPE-SYSTEM section 2. | iOS and the type system both use sentence case; capitals at 0.06 to 0.1em are the loudest thing on many screens. | Keep capitals but cap tracking at 0.02em (type-system rule). |
| D6 | One page frame for every route, leading-aligned under the title, up to `--page-max` (1920px) wide; forms cap at `--form-max` inside it, left-aligned; POS and the editor with live preview may bleed. | "Common width for all pages" and "use the whole display": the frame never jumps, the room on a big screen becomes columns and panes. | Lower `--page-max` (one token). |
| D7 | Tablet portrait (768 to 1023px) gets a collapsible icon sidebar instead of today's phone drawer and tab bar. | iPadOS pattern; today a 1024px-wide iPad in portrait gets the phone shell. | Raise `--bp-sidebar` back to 901px. |
| D8 | Continuous corners use `corner-shape: squircle` where the browser has it (progressive), a plain radius elsewhere. | CSS has no other true continuous corner. | Remove the one `@supports` block in `ios.css`. |

## Status (QA, 30 Oct 2026)

Shipped in 3.2.0 ("New look" in What's new):

| PR | Package | What it brought |
|---|---|---|
| #130 | spec | This document and the work plan (`docs/prd/ios-ui.md`). |
| #131 | P0 | `src/styles/ios.css`: every token in four themes, aliases in `index.css`, the lock-in test `tests/ios-ui.test.ts`. |
| #132 | P3 | One `Modal` (sheet / dialog / alert, phone bottom sheet with detents), `Menu` (popover, context menu, action sheet), toasts, the command palette, preview and share on tokens. |
| #133 | PL | One page frame (`<Page>`, tiers `page` / `form` / `bleed`), `SplitView`, column priorities (`data-priority`), the shell in em with `dvh` and safe areas, density before paint. |
| #134 | P4 | Meaning colours (`surface.sys*`), KPI cards with icon tiles, charts on `--chart-*`, badges with a dot, empty states, skeletons, avatars. |
| #135 | P1 | iPadOS sidebar, material bars, phone tab bar, demo banner and company switcher as grouped rows. |
| #136 | P5b | The feature-screen sweep, part B (Books, Reports, GST, Inventory, Receivables, Reconcile and every pack). |
| #137 | P2 | Frameless cards, the table look, grouped lists, filled fields, `Toggle`, the underline tab strip (`styles/tabs.module.css`). |
| #138 | P5a | POS, retail POS and returns, restaurant tables / KOT, the editor chrome, Gateway on tokens. |
| this | QA | Ratchets at 0 with an explicit allow-list; tinted-button rule; laptop fit for Invoices and Clients; underline tabs on Payroll, Manufacturing, Recurring, Distribution, Time. |

Decisions as shipped: D1 buttons keep the rulebook (no tinted buttons; `tests/button-system.test.ts` now also rejects
`--tint` / `--tint-soft` / `--sys-*` fills on pressables, except a selected item's `--tint-soft` fill and the switch's
green track); D2 one blue tint in both themes, gold only as a brand accent; D3 opaque labels; D4 frameless cards (HC puts
an edge back); D5 sentence case everywhere outside printed paper and the logo; D6 one frame up to `--page-max`,
leading-aligned (an open `SplitView` detail widens it by the inspector); D7 the tablet sidebar from 37.5em; D8 squircle
corners where the browser has them.

Ratchets (`tests/ios-ui.test.ts`): every package at 0 for all ten rules. The legitimate leftovers sit in `ALLOW` with
their reason (a stale entry fails): printed paper (BRS and bank-document rules, job-card paper colours, cheque crossing
lines, the preview's white paper, h1s of printed documents), the brand logo (tile and wordmark colours, tile radius,
"INVOICE" lockup), full-screen gates (PIN lock, error boundary, vault unlock, the 404 empty state) and `.inputMono`
capitals for GSTIN / PAN / IFSC values.

Known gaps: the pack desks' inner view switchers (`.seg` with `role="tablist"`, about 25 components) still wrap on a
phone; Books / Reports / Reconcile / Receivables keep their own copies of the tab-strip CSS instead of
`styles/tabs.module.css`; no right-click row menus yet (the `Menu` `at` prop is ready); phone large-title collapse into
the bar and collapsible sidebar groups not built; date inputs and selects are being replaced by native-feel pickers in a
separate package.

## 1. Tokens

All tokens live in ONE new first-paint stylesheet, `src/styles/ios.css`, imported in `src/main.tsx` right after
`index.css` and before `buttons.css`. `index.css` keeps its existing names as **aliases** (section 1.13) so no module
breaks on day one. Values below are light / dark / high-contrast light / high-contrast dark. High contrast is the
existing `html.a11y-contrast` class (`public/theme-init.js`); dark is `.dark`.

### 1.1 System colours

Three variants per colour, because one value cannot serve both a fill and text at 4.5:1:

- `--sys-<c>`: Apple's system colour. For fills, chart marks, dots, progress, glyphs **next to a text label**. Never text.
- `--sys-<c>-ink`: a text-safe variant. Reaches 4.5:1 on `--bg`, `--bg-grouped`, `--fill-3` and on its own soft tint
  (measured, section 1.12). The only variant allowed as `color:` of text.
- `--sys-<c>-tile`: the icon-tile fill, the same in both themes (like iOS Settings), white glyph at 3:1 or more
  (yellow takes a black glyph). `--sys-<c>-soft`: `color-mix(in srgb, var(--sys-<c>) 14%, transparent)` light,
  20% dark: the background of a status pill or a tinted row.

| Colour | `--sys-*` L / D | `--sys-*-ink` L / D | HC ink L / D | `--sys-*-tile` |
|---|---|---|---|---|
| blue | `#007aff` / `#0a84ff` | `#0a5fd1` / `#5aa9ff` | `#0040dd` / `#8cc4ff` | `#007aff` |
| green | `#34c759` / `#30d158` | `#1a6f2f` / `#30d158` | `#145a26` / `#5ef08a` | `#248a3d` |
| indigo | `#5856d6` / `#5e5ce6` | `#4b49c4` / `#9d9bff` | `#3634a3` / `#b8b6ff` | `#5856d6` |
| orange | `#ff9500` / `#ff9f0a` | `#a84300` / `#ff9f0a` | `#8f3900` / `#ffc266` | `#c45500` |
| pink | `#ff2d55` / `#ff375f` | `#c2183f` / `#ff7a93` | `#a3002f` / `#ff9fb2` | `#e0294f` |
| purple | `#af52de` / `#bf5af2` | `#8231b0` / `#da8fff` | `#6c2a91` / `#e6b0ff` | `#af52de` |
| red | `#ff3b30` / `#ff453a` | `#c4161c` / `#ff7b73` | `#a50010` / `#ff9c96` | `#e0302a` |
| teal | `#30b0c7` / `#40c8e0` | `#006b78` / `#40c8e0` | `#005866` / `#7ce8ff` | `#00829a` |
| mint | `#00c7be` / `#63e6e2` | `#00706b` / `#63e6e2` | `#005a56` / `#8ff0ec` | `#0a7d78` |
| cyan | `#32ade6` / `#64d2ff` | `#00668f` / `#64d2ff` | `#00516f` / `#92e0ff` | `#0071a4` |
| yellow | `#ffcc00` / `#ffd60a` | `#855600` / `#ffd60a` | `#6e4700` / `#ffe066` | `#ffcc00` (black glyph) |
| brown | `#a2845e` / `#ac8e68` | `#7a5a36` / `#c4a47c` | `#5e4529` / `#dcc09a` | `#8a6a45` |
| gray | `#8e8e93` / `#8e8e93` | `#636366` / `#a1a1a6` | `#48484a` / `#c7c7cc` | `#6c6c70` |

Grays (fills and lines only, never text except through `--sys-gray-ink`):

| Token | Light | Dark |
|---|---|---|
| `--sys-gray2` | `#aeaeb2` | `#636366` |
| `--sys-gray3` | `#c7c7cc` | `#48484a` |
| `--sys-gray4` | `#d1d1d6` | `#3a3a3c` |
| `--sys-gray5` | `#e5e5ea` | `#2c2c2e` |
| `--sys-gray6` | `#f2f2f7` | `#1c1c1e` |

**Meaning map** (one colour per meaning, app-wide; always with an icon or a word as well):

| Meaning | Colour | Replaces |
|---|---|---|
| Paid, received, gain, success, in stock | green | `--profit` |
| Overdue, loss, error, destructive, out of stock | red | `--loss`, `--destructive` |
| Due soon, partial, warning, needs review, low stock | orange | `--warning` |
| Sent, info, linked, in progress | blue | `--info` |
| Draft, cancelled, archived, inactive | gray | `--muted` badges |
| Credit / debit notes, returns | purple | ad hoc |
| GST, tax, compliance ("verify with your CA") | indigo | ad hoc gold pills |
| Recurring, scheduled | teal | ad hoc |
| Stock, inventory, manufacturing | brown | ad hoc |
| Bank, payments, UPI | cyan | ad hoc |
| Payroll, people, clients | pink | ad hoc |
| Highlight (search hit, today) | yellow (fill only) | `--brand-soft` highlights |

Brand stays: `--pal-*`, `--brand-gold` (`#d5a25e`), logo orange (`MR_CHARTIST_ORANGE` in `design-prefs.ts`) and the
Ember template are untouched. Profit / loss figures in finance views keep the type system's rule: plain coloured text,
never a filled chip behind a price or change (BUTTON-SYSTEM section 11).

### 1.2 Tint

| Token | Light | Dark | HC light | HC dark | Use |
|---|---|---|---|---|---|
| `--tint` | `#1a4d94` | `#7fb0ff` | `#072b6b` | `#a9c9ff` | Links (`.lk`), selected row / nav item text and glyph, focus ring, toggles on, slider fill, selection, caret |
| `--tint-soft` | tint 12% | tint 20% | tint 18% | tint 26% | Selected row / sidebar item background, text selection |
| `--on-tint` | `#ffffff` | `#000000` | `#ffffff` | `#000000` | Glyph on a tint fill (toggle knob is always white) |

### 1.3 Labels (text)

| Token | Light | Dark | HC light | HC dark | Use |
|---|---|---|---|---|---|
| `--label` | `#000000` | `#ffffff` | `#000000` | `#ffffff` | Primary text, titles, values |
| `--label-2` | `#5c5c63` | `#aeaeb2` | `#3a3a3f` | `#d1d1d6` | Subtitles, row detail, table heads, captions |
| `--label-3` | `#636366` | `#a1a1a6` | `#48484a` | `#c7c7cc` | Placeholders, disabled-but-readable, timestamps |
| `--label-4` | `rgb(60 60 67 / 0.18)` | `rgb(235 235 245 / 0.16)` | `rgb(60 60 67 / 0.4)` | `rgb(235 235 245 / 0.4)` | Never text: chevrons, disabled glyph strokes, drag handles |

`--label-2` and `--label-3` are deliberately close: Apple separates them by alpha, which fails 4.5:1 (D3). Hierarchy
comes from size and weight first, colour second.

### 1.4 Backgrounds

Two families, as on iOS. **Plain** for content that fills the window (the editor, POS, Gateway, tables that bleed).
**Grouped** for every page made of cards and lists (Dashboard, Settings, lists, reports): this is the default page.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#ffffff` | `#000000` | Plain page |
| `--bg-2` | `#f2f2f7` | `#1c1c1e` | Plain: a panel inside a plain page, sidebar on plain pages |
| `--bg-3` | `#ffffff` | `#2c2c2e` | Plain: a third level (popover over a panel) |
| `--bg-grouped` | `#f2f2f7` | `#000000` | Grouped page (the app default `body`) |
| `--bg-grouped-2` | `#ffffff` | `#1c1c1e` | Cards, inset grouped lists, table cards, sheets |
| `--bg-grouped-3` | `#f2f2f7` | `#2c2c2e` | A well inside a card (code, totals strip, nested group) |
| `--bg-elevated` | `#ffffff` | `#1c1c1e` | Dialogs, menus, popovers in dark get the lighter level (iOS elevated) |
| `--bg-elevated-2` | `#f2f2f7` | `#2c2c2e` | Inside an elevated surface |

High contrast keeps the backgrounds and strengthens labels and separators.

### 1.5 Fills (behind controls, never a page)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--fill` | `rgb(120 120 128 / 0.20)` | `rgb(120 120 128 / 0.36)` | Slider track, toggle off, progress track |
| `--fill-2` | `rgb(120 120 128 / 0.16)` | `rgb(120 120 128 / 0.32)` | Pressed row, segmented-control track |
| `--fill-3` | `rgb(118 118 128 / 0.12)` | `rgb(118 118 128 / 0.24)` | Search field, filled text field, skeleton base |
| `--fill-4` | `rgb(116 116 128 / 0.08)` | `rgb(118 118 128 / 0.18)` | Hover on a row (pointer only), table zebra if ever needed |

Text on a fill uses `--label` / `--label-2` (both measured on `--fill-3` at 4.5:1 or more).

### 1.6 Separators and borders

| Token | Light | Dark | HC light | HC dark | Use |
|---|---|---|---|---|---|
| `--sep` | `rgb(60 60 67 / 0.29)` | `rgb(84 84 88 / 0.65)` | `rgb(60 60 67 / 0.6)` | `rgb(235 235 245 / 0.6)` | Row and section separators, table rules, bar edges |
| `--sep-opaque` | `#c6c6c8` | `#38383a` | `#8e8e93` | `#8e8e93` | Where translucency would double up (sticky heads over content, overlapping edges) |
| `--hairline` | `1px` | | | | Width of every separator; becomes `0.5px` under `@media (min-resolution: 2dppx)` |
| `--field-edge` | `rgb(60 60 67 / 0.29)` | `rgb(84 84 88 / 0.65)` | `#6c6c70` | `#aeaeb2` | Bordered text fields (3:1 non-text in HC) |
| `--card-edge` | `none` | `none` | `1px solid var(--sep-opaque)` | same | Card frame (D4) |

Rules: a separator is always `var(--hairline) solid var(--sep)`. Row separators are **inset** from the leading edge to the
text (`--row-inset`, 16px, or 60px when the row has an icon tile), as iOS draws them. Never 2px or 3px rules except the
three allowed accents: the focus ring (button rulebook), a selected underline tab (2px tint), and a left status bar on an
alert row (3px `--sys-<c>`). Dashed borders only for drop zones and "add" placeholders.

### 1.7 Materials (translucent bars and sheets)

| Token | Background light | Background dark | Blur |
|---|---|---|---|
| `--mat-ultrathin` | `rgb(255 255 255 / 0.48)` | `rgb(28 28 30 / 0.48)` | `blur(12px) saturate(180%)` |
| `--mat-thin` | `rgb(255 255 255 / 0.64)` | `rgb(28 28 30 / 0.64)` | `blur(20px) saturate(180%)` |
| `--mat-regular` | `rgb(246 246 248 / 0.78)` | `rgb(30 30 32 / 0.78)` | `blur(24px) saturate(180%)` |
| `--mat-thick` | `rgb(246 246 248 / 0.9)` | `rgb(30 30 32 / 0.9)` | `blur(30px) saturate(180%)` |
| `--mat-chrome` | `rgb(249 249 249 / 0.94)` | `rgb(18 18 18 / 0.94)` | `blur(20px) saturate(180%)` |

Each material is a pair: `--mat-<name>` (background) and `--mat-<name>-blur` (the `backdrop-filter` value). Use the
shared class `.material` with `data-mat="thin"` (in `ios.css`), never your own blur. Where it goes: top bar and phone tab
bar = `chrome`; sidebar on tablet overlay = `thick`; menus, popovers, the command palette = `regular`; toasts = `thin`;
the scrim under a sheet is NOT a material (section 1.9).

Fallback (required): `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))` and
`html.a11y-contrast` and `html.a11y-motion-reduce` (reduce transparency rides on the motion pref until a separate pref
exists) all switch every material to its opaque surface (`--bg-grouped-2` for bars, `--bg-elevated` for menus). Text on
a material is checked against the opaque fallback AND against the material over pure black and pure white content.

### 1.8 Radii and shape

| Token | Value | Use |
|---|---|---|
| `--r-4` | 4px | Checkbox, `kbd` key cap, chart bar top corners (small) |
| `--r-6` | 6px | Badges that are not capsules, inline code, tiny tiles (16px) |
| `--r-8` | 8px | Small fields (`sm`), menu items, list-row hover / selection inside a card, tile 29px (iOS Settings size) |
| `--r-10` | 10px | Text fields, selects, search fields, segmented track (rect), tooltips |
| `--r-12` | 12px | Inset grouped lists, table cards, popovers, menus, toasts, KPI cards on phone |
| `--r-16` | 16px | Cards, KPI cards, dialogs on desktop, empty-state tile |
| `--r-20` | 20px | Sheet top corners on phone, large media |
| `--r-28` | 28px | Desktop sheet / large dialog, POS tender panel |
| `--r-full` | 9999px | Capsules: badges, chips, buttons (rulebook), avatars, toggles |
| `--r-tile` | 22.5% | Icon tiles (percent keeps the continuous look at any size) |

Rules:

1. **Nested corners**: inner radius = outer radius minus the inset (card 16, 8px inset, inner 8). Never the same radius
   inside and out.
2. **Concentric bars**: a full-width bar touching the window edge has square corners on that edge (tab bar, top bar).
3. **Continuous corners** (D8): in `ios.css`, `@supports (corner-shape: squircle) { .continuous, .tile {
   corner-shape: squircle; } }`, with the radius multiplied by `--squircle-boost` (a squircle of the same radius looks
   tighter; P0 tuned the starting 1.6 to **1.8** in a Chromium side-by-side: a 16px round corner and a 28.8px squircle
   read the same size). CSS-module classes take part by `composes: continuous from global;` plus `--rc: var(--r-16)`
   (the radius token they would have used); `.tile` takes it built in. Buttons are excluded (the rulebook owns them).
4. No raw radius in a module: only tokens, `50%` for circles, `0`, `inherit`.

### 1.9 Elevation

iOS uses depth only where something floats. Cards on the grouped page have **no shadow** (D4).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--elev-0` | `none` | `none` | Cards, lists, tables, bars (bars use a hairline, not a shadow) |
| `--elev-1` | `0 1px 2px rgb(0 0 0 / 0.06), 0 1px 1px rgb(0 0 0 / 0.04)` | `0 1px 2px rgb(0 0 0 / 0.5)` | Segmented thumb, toggle knob, slider knob, a draggable card while dragged |
| `--elev-2` | `0 4px 16px rgb(0 0 0 / 0.08), 0 1px 4px rgb(0 0 0 / 0.04)` | `0 4px 16px rgb(0 0 0 / 0.55)` + `0 0 0 0.5px rgb(255 255 255 / 0.08)` | Menus, popovers, toasts, the command palette, typeahead lists |
| `--elev-3` | `0 16px 48px rgb(0 0 0 / 0.14), 0 4px 12px rgb(0 0 0 / 0.06)` | `0 16px 48px rgb(0 0 0 / 0.7)` + `0 0 0 0.5px rgb(255 255 255 / 0.1)` | Dialogs and sheets on desktop, the phone sidebar drawer |
| `--scrim` | `rgb(0 0 0 / 0.2)` | `rgb(0 0 0 / 0.48)` | Under sheets and dialogs (no blur on the scrim; the sheet carries the focus) |

In dark, elevation comes from the lighter surface (`--bg-elevated`) plus the 0.5px light rim, not from a darker shadow.

### 1.10 Spacing and layout margins

8-point grid with 4-point half steps; tokens in rem so the text-size pref and browser zoom scale them.

| Token | Value | Typical use |
|---|---|---|
| `--sp-0-5` | 0.125rem (2px) | Optical nudges only (icon baseline, badge inner) |
| `--sp-1` | 0.25rem (4px) | Icon-to-text in a dense chip, stacked caption gap |
| `--sp-2` | 0.5rem (8px) | Icon-to-label, gap in a control group |
| `--sp-3` | 0.75rem (12px) | Row vertical padding (pointer), gap between fields in a row |
| `--sp-4` | 1rem (16px) | Row horizontal padding, card padding (phone), page gutter (phone) |
| `--sp-5` | 1.25rem (20px) | Card padding (desktop), gutter (large phone / tablet) |
| `--sp-6` | 1.5rem (24px) | Gap between cards, section spacing inside a page |
| `--sp-8` | 2rem (32px) | Page gutter (desktop), space between page sections |
| `--sp-10` | 2.5rem (40px) | Header-to-content on desktop large titles |
| `--sp-12` | 3rem (48px) | Empty-state padding, page bottom |
| `--sp-16` | 4rem (64px) | Hero empty state |

Off-grid values (`0.375rem`, `0.625rem`, `0.875rem`, `0.4rem`, `0.35rem`, `6px`, `10px`, `14px` …) move to the nearest
step. Two exceptions keep their exact values: the button rulebook's internal sizes, and table cell padding tuned to the
type system's row heights (38px pointer / 44px touch).

Layout margins (`--gutter`, set by device class, section 3): 16px small phones and phones, 20px large phones and
landscape, 24px tablets, 32px laptops and up. `--row-inset` 16px (60px with a 29px tile). `--section-gap` = `--sp-6`
pointer, `--sp-5` touch.

### 1.11 Motion, z-index, focus

Motion:

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Fades, colour changes, scrims |
| `--ease-in-out` | `cubic-bezier(0.45, 0, 0.2, 1)` | Collapsing titles, accordion height |
| `--spring` | `cubic-bezier(0.3, 1.45, 0.55, 1)` (= `--btn-spring`) | Press release, toggle knob, segmented thumb |
| `--spring-soft` | `cubic-bezier(0.32, 1.15, 0.5, 1)` | Sheets and dialogs arriving, toasts, popovers |
| `--dur-1` | 100ms | Press settle, hover fades |
| `--dur-2` | 200ms | Colour / opacity, toggles, small popovers |
| `--dur-3` | 320ms | Sheets, dialogs, drawers, tab bar hide |
| `--dur-4` | 450ms | Large title collapse, page-level transitions (rare) |

Nothing lifts, slides or grows on hover (rulebook). Entrances: sheets rise from below (phone) or scale 0.96 to 1 with a
fade (desktop dialog); menus scale from their anchor 0.92 to 1; toasts rise 8px. Exits are 70% of the entrance time with
`--ease-out`. `prefers-reduced-motion` and `html.a11y-motion-reduce` make every transform instant and keep only opacity
fades of `--dur-2` or less (already enforced globally in `index.css`). The page-level `fadeInUp` on `.page`
(`surface.module.css:12`) goes: a page change is instant, as in native apps.

z-index layers (replacing 22 values from -1 to 10000):

| Token | Value | Holds |
|---|---|---|
| `--z-base` | 0 | Content |
| `--z-raised` | 1 | Sticky table heads, sticky totals, selected thumbs |
| `--z-sticky` | 10 | Page header when pinned, sticky toolbars, editor action bar |
| `--z-bar` | 20 | Top bar, phone tab bar, key bar |
| `--z-sidebar` | 30 | Sidebar (overlay mode) |
| `--z-dropdown` | 40 | Typeahead, menus, popovers anchored to content |
| `--z-scrim` | 50 | Scrims |
| `--z-sheet` | 60 | Sheets, dialogs, drawers, preview, statement viewer |
| `--z-palette` | 70 | Command palette, notification panel |
| `--z-toast` | 80 | Toasts, PWA install / update prompts |
| `--z-alert` | 90 | Confirm / alert dialogs (always on top of a sheet) |
| `--z-skip` | 100 | Skip link, cross-tab notice |

Stacking between two open sheets is handled by `modal-stack.ts` (DOM order inside `--z-sheet`), never by bigger numbers.

Focus: the button rulebook's inside ring for buttons; everything else gets `outline: 2px solid var(--tint);
outline-offset: 2px` with the element's own radius (no global `border-radius: var(--radius-xs)` on `:focus-visible`,
`index.css:251`, which squares off rounded cards). Fields show focus as a 2px tint ring outside the field edge
(`box-shadow: 0 0 0 2px var(--tint)` replacing `--primary-glow` at 3px, 9 uses).

### 1.12 Contrast proof

Every `--label*` and `--sys-*-ink` value above was measured (WCAG 2.x relative luminance) against `--bg`, `--bg-grouped`,
`--fill-3` (light) or `--bg`, `--bg-grouped-2`, `--bg-elevated-2` (dark), and against its own `--sys-<c>-soft` pill
background: every one is 4.5:1 or more in light, dark and both high-contrast sets (lowest: light blue ink in a pill
4.79, dark gray ink in a pill 4.62). Fills used as chart marks or tiles reach 3:1 against their surface or carry a text
label. `tests/ios-ui.test.ts` recomputes these from `ios.css` so a later edit cannot regress them.

### 1.13 Migration: old token to new

`index.css` keeps every old name and points it at the new token, so modules migrate one at a time. A builder replacing
uses in a module uses the right-hand column.

| Old token | New token | Note |
|---|---|---|
| `--background` | `--bg-grouped` | The body becomes the grouped grey; plain pages opt in to `--bg` |
| `--foreground`, `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--accent-foreground` | `--label` | |
| `--muted-foreground` (476 uses) | `--label-2` | `--label-3` only for placeholders / timestamps |
| `--card` | `--bg-grouped-2` | |
| `--card-inner` | `--bg-grouped-3` | |
| `--popover` | `--bg-elevated` | |
| `--muted`, `--secondary`, `--accent` (as fills) | `--fill-3` (fields, wells), `--fill-4` (hover) | Pick by role. The P0 alias is `--fill-3` composited over `--bg-grouped-2` (opaque), because sticky table heads paint `--muted` (`ImportWizard.module.css`) and must not turn see-through |
| `--border` | `--sep` | Width becomes `--hairline` |
| `--input-border` | `--field-edge` | |
| `--ring` | `--tint` | |
| `--primary` (as link / focus / selection colour) | `--tint` | `--primary` as a button fill no longer exists (rulebook) |
| `--primary-glow` | `--tint-soft` | Selection, focus halo |
| `--brand`, `--brand-text` | `--tint` (interactive) or `--brand-gold` (brand accent) | D2 |
| `--brand-soft` | `--tint-soft` | |
| `--profit` | `--sys-green-ink` (text) / `--sys-green` (marks) | Finance figures keep plain coloured text |
| `--loss`, `--destructive` | `--sys-red-ink` / `--sys-red` | `danger` buttons keep `--btn-loss` (rulebook) |
| `--warning` | `--sys-orange-ink` / `--sys-orange` | |
| `--info` | `--sys-blue-ink` / `--sys-blue` | |
| `--radius-xs` 6 / `--radius-sm` 8 / `--radius-md` 12 / `--radius-lg` 16 / `--radius-xl` 22 / `--radius-full` | `--r-6` / `--r-8` / `--r-12` / `--r-16` / `--r-20` / `--r-full` | Then pick by role (section 1.8): fields move 8 to 10 |
| `--shadow-xs`, `--shadow-sm`, `--shadow-card` | `--elev-0` (cards) or `--elev-1` (knobs) | |
| `--shadow-md`, `--shadow-lg` | `--elev-2` | |
| `--shadow-xl` | `--elev-3` | |
| `--shadow-glow` | focus rule (section 1.11) | |
| `--transition-fast` / `--transition-base` / `--transition-smooth` / `--transition-spring` | `--dur-1 var(--ease-out)` / `--dur-2 var(--ease-out)` / `--dur-3 var(--ease-in-out)` / `--dur-3 var(--spring-soft)` | |
| `--sidebar-width`, `--topbar-height` | `--sidebar-w`, `--bar-h` (section 3) | |
| `--pal-azurite`, `--pal-lapis`, `--pal-topaz`, `--pal-macaw`, `--pal-gold`, `--pal-clay`, `--pal-on-gold` | unchanged | Brand palette; `--tint` light = `--pal-topaz`, HC light = `--pal-lapis` |
| raw `rgba(…)` scrims (`Modal.module.css:5`, `DashboardLayout.module.css:334`) | `--scrim` | |
| Avatar's ten raw hex colours (`Avatar.tsx:7-8`) | `--sys-<c>-tile` in a fixed order (blue, green, indigo, orange, pink, purple, teal, red, brown, cyan) | |
| meta `theme-color` (`useTheme.ts:26` `#06080a` / `#f4f5f0` vs `theme-init.js` `#000000` / `#f6f6f7`) | `--bg-grouped` values in both files | Done in P0 (`#f2f2f7` / `#000000`, also `index.html`) |
| `--topbar-height` | `--bar-h` | P0 keeps 60px; PL moves the shell to `--bar-h`. `--tab-bar-h` stays the shell's runtime value (set by `DashboardLayout.tsx`, absent = 0), so the 49px iOS height is the token `--tab-bar-size` |

## 2. Components

Every component below is a shared class or React primitive, owned by one package (see the work plan). Feature screens
compose them; they never restyle them.

### 2.1 Cards and inset grouped lists

- **Card** (`surface.card`): `--bg-grouped-2`, `--r-16` (`--r-12` under 600px), `--card-edge`, `--elev-0`, padding
  `--sp-5` (`--sp-4` phone). A card head is a 15px / 600 title in `--label` with an optional `--label-2` caption; no rule
  under the head unless the body is a list or table.
- **Section header** above a group (iOS grouped list header): 13px / 500 `--label-2`, sentence case, `--sp-2` above the
  group, aligned with the row text (indent `--row-inset`). Footer under a group: 12px / 400 `--label-2`.
- **Inset grouped list** (`.group` + `.row`; new in `surface.module.css`): rows of min-height 44px (touch) / 38px
  (pointer), padding `--sp-3` `--sp-4`, separated by inset hairlines; the group has `--r-12`. Row anatomy, leading to
  trailing: optional icon tile (29px, `--r-tile`) · title (`--label`, ui size) with optional subtitle (`--label-2`) ·
  flexible space · value (`--label-2`, numbers tabular) · accessory (chevron `ChevronRight` 14px in `--label-4` for
  navigation, a toggle, a check `Check` in `--tint` for a choice, a badge, or a `quiet` `.btn sm`).
- A row that navigates is a `<button>` or `<Link>` with the row as its box; it highlights with `--fill-2` while pressed
  (touch) and `--fill-4` on hover (pointer), no movement. Destructive rows use `--sys-red-ink` text and sit in their own
  group at the bottom.
- Settings becomes grouped lists: sections as groups, each field a row with the label leading and the control trailing
  (switches, selects, values with a chevron opening a sheet). Long forms (business profile) stay stacked fields inside a
  card at `--form-max`.

### 2.2 Tables

- A table lives in a card, full width of the card (no inner padding), `border-collapse: separate; border-spacing: 0`.
- Head: sticky (`position: sticky; top: 0; z-index: var(--z-raised)`) on `--bg-grouped-2` with an opaque hairline
  (`--sep-opaque`) under it; 12.5px / 400 `--label-2`, sentence case (D5), the sort glyph `ArrowDown` / `ArrowUp` 12px.
- Rows: 44px min (touch) / 38px (pointer, `compact`), cells padded `--sp-3` `--sp-4`, hairline `--sep` between rows,
  inset at the first text column when the first cell is a checkbox or avatar. Last row: no rule. Hover `--fill-4`
  (pointer only); selected `--tint-soft`; the row cursor of Tally keys (`useDrillRows`) uses `--tint-soft` plus a 2px
  leading tint bar.
- Numbers: right-aligned, tabular, `--fw-num` 350, figures in the type system's `table` size; totals row in 600 with an
  opaque hairline above and sticky to the bottom of the scroller (`position: sticky; bottom: 0`).
- Identifiers (invoice numbers, GSTINs) never break mid-token: `white-space: nowrap` with an ellipsis and a `title`.
- **Column priority** (section 3.6): every table declares each column `p1` (always), `p2` (hidden under the card's
  container width of 720px, folded into the p1 cell as a second line), `p3` (hidden under 960px, reachable in the row's
  detail). Horizontal scroll is allowed only inside the table's own scroller, and only when even p1 columns do not fit.

### 2.3 Form fields

- Two looks, one per context, never mixed in a form:
  - **Filled** (default in sheets, cards and grouped lists): `--fill-3`, no edge, `--r-10`, 44px (touch) / 36px
    (pointer `compact`), text `--label`, placeholder `--label-3`.
  - **Bordered** (dense data entry: editor lines, Gateway vouchers, POS, tables in edit mode): `--bg-grouped-2`,
    hairline `--field-edge`, `--r-8`.
- Labels above the field: 13px / 500 `--label-2`, sentence case (no capitals; today `FROM`, `BILL TO`, `CLIENT NAME *` are
  capitals). Required = " (required)" in the label or the `*` plus `aria-required`; help text 12px `--label-2` under the
  field; error text `--sys-red-ink` with `AlertTriangle` 14px, and the field edge turns `--sys-red`.
- Focus: 2px `--tint` ring outside (section 1.11). Disabled: label and text `--label-3`, fill unchanged.
- **Search field**: filled, `--r-10` (capsule when it stands alone in a bar), `Search` glyph 16px `--label-2` leading,
  clear button `X` trailing when not empty, 36px pointer / 44px touch.
- Selects look like filled fields with `ChevronDown` 14px `--label-2`; on phones a select with more than 7 options opens a
  sheet list with search (existing Typeahead), not the native wheel, when it holds parties or items.
- Steppers (quantity): a `.join` of two `.btn icon sm` (`Minus` / `Plus`) around the number field: the rulebook already
  draws it.
- Sliders: track `--fill`, filled part `--tint`, 28px white knob with `--elev-1` (native `input[type=range]` styled via
  `accent-color: var(--tint)` first; custom only where needed).
- Toggles (switches): 51 × 31px (iOS), track `--fill` off / `--sys-green` on (iOS default; the knob carries the meaning
  with the label, so colour is not the only signal), white 27px knob `--elev-1`, `--spring` `--dur-2`. Built on
  `<input type="checkbox" role="switch">`. Checkboxes stay for multi-select in tables and lists; toggles are for settings
  that apply at once.

### 2.4 Segmented controls, chips, tabs

- `.seg` and `.chip` stay as the button rulebook draws them (ink thumb on a paper track). This spec only sets their
  placement: a `.seg` is the iOS segmented control for 2 to 5 views or filters; more than 5, or labels that would wrap,
  become an underline tab strip (below) or a `Select`.
- **Underline tab strip** (page tabs on Books, Reports, Reconcile, Receivables, GST): one line, horizontal scroll inside
  the strip with a fade mask at the overflowing edge (`mask-image`), selected = `--label` 600 with a 2px `--tint` bar,
  others `--label-2` 500, hairline under the strip. Never wraps (today Settings' 8-tab `.seg` wraps to two lines at
  1280px, `Settings.tsx:206`; Books' tabs are clipped at "Repo" with no fade).
- On phones a tab strip with more than 4 tabs gets a trailing "More" item that opens a sheet list.

### 2.5 Navigation

- **Top bar** (desktop / tablet): `--bar-h` 52px, `.material[data-mat=chrome]`, hairline `--sep` at the bottom only after
  the content scrolls under it (scroll-driven: `animation-timeline: scroll()` where supported, else a class set by an
  `IntersectionObserver` sentinel); holds search (filled capsule, max 420px), then trailing icon buttons.
- **Large title**: the page title is 26px / 600 (type `title-2`) in the content (desktop) and 30px / 600 on phones
  (`title-1` phone size). On phones, as the page scrolls past the title, the bar shows the title inline at 17px / 600,
  centred, fading in over `--dur-2` (scroll-driven, same fallback). Desktop keeps the large title in the content (macOS
  style) and does not collapse.
- **Sidebar** (iPadOS): `--sidebar-w` 248px (240 to 280 by class, section 3), background `--bg-grouped` (the same grey as
  the page in light, `#1c1c1e` in dark: the sidebar is a column of the window, not a card), no right border in light
  (hairline in dark / HC). Items 36px pointer / 44px touch, `--r-8`, glyph 18px `--label-2`, label 15px `--label`;
  selected = `--tint-soft` fill with `--tint` glyph and `--label` 600 text (no 3px bar). Group titles 13px / 500
  `--label-2`, sentence case, collapsible with a `ChevronDown`. The company switcher and the user card become
  inset-grouped rows.
- **Phone tab bar**: 49px + `env(safe-area-inset-bottom)`, `.material[data-mat=chrome]`, hairline top, no shadow
  (today `--shadow-md` on an opaque card). Items: glyph 22px + label 12px / 500; selected `--tint`, others `--label-2`.
  The centre "New" stays the rulebook's ink round button. Hides on scroll down and returns on scroll up only in long
  documents (editor, reports), with `--dur-3`; never on lists.
- **Back**: a page reached from a list shows a leading `ChevronLeft` + parent title link (`.lk`) above the large title on
  phones (iOS back button), and a breadcrumb on desktop.

### 2.6 Sheets, dialogs, alerts, menus, toasts

- **Sheet (phone, under 600px)**: rises from the bottom, `--bg-elevated`, top corners `--r-20`, a grabber (36 × 5px,
  `--r-full`, `--label-4`, 6px from the top) that drags to dismiss; detents `medium` (50dvh) and `large` (100dvh minus
  the top safe area minus 12px). A sheet with a form opens at `large`; pickers and short choices at `medium`.
  Header: 17px / 600 centred title, `Cancel` (quiet) leading and the primary action (ink) trailing, or a close
  `.btn icon round` trailing. Footer actions sit in a sticky bar above the home indicator. Today a phone dialog is a
  centred card with 12px margins (`Modal.module.css:104`), and `ux.module.css:44-53` keeps a second, separate sheet
  implementation: both become this one.
- **Dialog (600px and up)**: centred card, `--bg-elevated`, `--r-16` (`--r-28` for `xl`), `--elev-3`, widths `sm` 420 /
  `md` 560 / `lg` 760 / `xl` min(1040px, 90vw) (unchanged tokens), max-height `calc(100dvh - 2 * var(--sp-8))`; head
  without a rule (title 17px / 600 leading), body scrolls, footer with a hairline only when the body scrolls.
- **Form sheet on tablet**: `md` and `lg` dialogs on 600 to 1023px open as a centred sheet of 90vw with `large` height.
- **Alert / confirm** (`ConfirmDialog`): 300px wide (320 phone), centred, title 17px / 600 centred, message 13px
  `--label`, actions stacked full-width when there are 3 or the labels are long, side by side otherwise; the destructive
  action uses `danger` and is never the default focused one. Uses `--z-alert`.
- **Action sheet** (phone): a sheet of full-width rows (grouped list look) plus a separate `Cancel` group; on desktop the
  same actions open as a menu anchored to the button.
- **Menu / popover / context menu**: `.material[data-mat=regular]`, `--r-12`, `--elev-2`, 6px padding; items 32px
  pointer / 44px touch, `--r-8`, glyph 16px leading, `kbd` hint trailing in `--label-2`, separators are full-width
  hairlines with 6px spacing; destructive item `--sys-red-ink` at the end. Right-click on table rows opens the row's
  existing actions as a context menu (P2).
- **Toast**: top-centre on desktop, above the tab bar on phones; `.material[data-mat=thin]`, `--r-full` up to two lines
  (`--r-12` beyond), `--elev-2`; glyph in the meaning colour (`CheckCircle` green, `AlertTriangle` red, `Info` blue) plus
  the text in `--label`, so colour is never alone; the Undo action is a `quiet` `.btn sm`. One toast at a time; a new one
  replaces the old with a cross-fade.
- **Scrim**: `--scrim`, fade `--dur-2`, no blur.

### 2.7 Badges and status pills

- Status pill (`StatusBadge`): capsule, 22px high, 12px / 500, sentence case (D5), `--sys-<c>-soft` background,
  `--sys-<c>-ink` text, and a leading 6px dot or 12px glyph in `--sys-<c>`, so the state reads without colour. Map from
  section 1.1: Draft gray, Sent blue, Partial orange, Paid green, Overdue red, Cancelled gray with strike-through.
- Count badge (bell, tabs): `--sys-red` capsule, white 12px / 600 text, min 18px; on the bell only.
- Tag (category, pack): `--fill-3` capsule, `--label-2` text, optional 8px colour dot. Never a filled colour block behind
  a figure (rulebook).
- "Verify with your CA" pill: indigo soft + `ShieldCheck`/`Info` glyph (replaces today's gold capitals pill).

### 2.8 KPI and stat cards

- Card per section 2.1. Top row: icon tile 29px (`--sys-<c>-tile`, white glyph 16px) leading, label 13px / 500
  `--label-2` sentence case. Figure: type system `num-hero` scaled down for app cards (28px desktop / 22px phone, 350,
  tabular, `--label`; a meaning colour only when the figure itself is a gain / loss / overdue). Hint 12px `--label-2`.
- Delta: `ArrowUp` / `ArrowDown` 12px + percentage, plain coloured text (`--sys-green-ink` / `--sys-red-ink`).
- Optional sparkline 24px high, `--sys-<c>` 1.5px stroke, no axes.
- Grid: `repeat(auto-fit, minmax(min(100%, 14rem), 1fr))` by container query: 1 column under 360px container width, 2
  to 600, 4 from 900, 6 from 1400 (never a lone orphan: 3 tiles on a 2-column phone grid make the third span both).

### 2.9 Charts (Swift Charts look)

- Bars: `--r-4` top corners (`--r-6` when bars are 16px or wider), 2px gap between stacked segments, bar width at most
  32px; series colours in this order: `--chart-1` blue, `--chart-2` green, `--chart-3` orange, `--chart-4` purple,
  `--chart-5` teal, `--chart-6` pink, `--chart-7` indigo, `--chart-8` brown. Light uses the `-tile` values for green,
  orange and teal so every mark reaches 3:1 on white; dark uses the `--sys-*` values.
- Gridlines: horizontal only, `--hairline` `--sep` dashed 2 4, no vertical grid, no chart border; axis labels 12px
  `--label-2`; the zero line solid `--sep-opaque`.
- Lines: 2px, round caps and joins; area fill = series colour 12% to 0% vertical gradient.
- Selection: a vertical rule `--label-3` 1px plus a callout (popover look, section 2.6) with the value; legends are
  rows of 8px dots + labels, never colour alone (series also differ by order and the legend names them, and tooltips
  name the series).
- Profit / loss charts may use green / red; every other chart uses the series order.

### 2.10 Empty states, skeletons, loading

- Empty state: centred in the card or page frame, icon tile 56px (`--r-tile`, `--sys-<c>-tile` of the page's meaning,
  white 28px glyph), title 17px / 600, text 15px `--label-2` capped at 32ch, one ink primary `.btn` and an optional `.lk`.
  Today's tile is a brand-soft square with brand text (`surface.module.css:252-260`).
- Skeleton: blocks of `--fill-3` with the real element's radius and size (rows 14px tall at the text's x-height, figures
  the figure's width); a shimmer of `--fill-4` sweeping at 1.4s linear, off under reduced motion. Show after 300ms
  only, so a quick load never flashes.
- Spinner: iOS activity indicator look (12 short spokes, `--label-2`), 20px; used inside a button only via the
  rulebook's loading state.

### 2.11 Icons and icon tiles

- lucide stays; **no new icon names** (first paint). Sizes snap to 12, 14, 16, 18, 20, 22, 28 (today 13 and 15 are used
  197 times): 16 in rows and fields, 18 in the sidebar, 22 in the tab bar, 14 in pills and menus, 28 in empty states.
- Stroke: `2` at 16px and above, `2.1` at 14px and below in controls (the rulebook's value), set once in CSS
  (`svg.lucide { stroke-width: … }` by context), never per `strokeWidth` prop.
- Alignment: icons sit on the text's cap height (`vertical-align: -0.125em` or flex centre with `--sp-0-5` nudge), never
  scaled by `transform`.
- **Icon tile** (`.tile`, iOS Settings): 29px square (`sm` 24, `lg` 40, `xl` 56), `--r-tile`, `--sys-<c>-tile`, white
  glyph at 62% of the tile (18px in 29px), `--elev-0`. Used in Settings rows, the sidebar on tablet compact mode, KPI
  cards, empty states, quick-create sheet, Help topics, notification rows. Each page / module has one fixed colour
  (the meaning map), so the same module looks the same everywhere.
- Avatars: circle, `--sys-<c>-tile` chosen by a stable hash, white initials 600; initials take letters only (today
  "Lotus Clinics Pvt Ltd (demo)" shows "L(" because the bracket is read as an initial).

### 2.12 Pressed and feedback states (haptics-like)

- Buttons: the rulebook's press (settle and spring back).
- Rows, tiles and cards that navigate: `--fill-2` overlay while pressed, no scale (rulebook: cards never move).
- Toggles: the knob springs (`--spring`); the track colour cross-fades `--dur-2`.
- A successful save: the toast plus the button's own checkmark state for `--dur-4`; a failed action shakes nothing
  (no shake animations): it shows an inline error.
- `navigator.vibrate` is not used.

## 3. Layout and space

The owner's rule: use the space perfectly on every device, and keep one common width and one common weight on every
page.

### 3.1 Device classes

Breakpoints are tokens (`--bp-*`, read by media queries as plain numbers since CSS cannot use variables in `@media`;
`ios.css` documents them and `tests/ios-ui.test.ts` allows only these values in `@media` width queries).

| Class | Width | Shell | Gutter | Notes |
|---|---|---|---|---|
| Small phone | 320 to 374 | Single column, top bar + tab bar | 16 | iPhone SE 1st gen, small Android. Stat grid 1 column; actions collapse to a "More" menu |
| Phone | 375 to 430 | Single column, top bar + tab bar | 16 | Most phones. Sheets with detents |
| Large phone / foldable folded | 431 to 599 | Single column, top bar + tab bar | 20 | Two-column stat grid; dialogs still sheets |
| Phone landscape (short) | any width, height under 500 | Tab bar becomes a compact 40px bar; top bar 44px; large title off | 20 + safe areas | Chrome today takes 120 of 390px (31%) |
| Small tablet / foldable open | 600 to 833 | Collapsible icon sidebar (72px rail, labels on hover / long-press, expands as overlay) + content; no tab bar | 24 | Dialogs become centred form sheets |
| Tablet / iPad | 834 to 1194 | Sidebar 248px, collapsible to the 72px rail (toggle in the top bar, remembered); master-detail where listed (3.4) | 24 | Portrait 834 to 1024, landscape 1112 to 1194, split view 507 to 981 and slide over 320 to 375 fall into the classes by width |
| Laptop | 1195 to 1439 | Sidebar + content (+ inspector when asked) | 32 | 1280 and 1366 screens |
| Desktop | 1440 to 1919 | Sidebar + content + optional inspector (3.4) | 32 | |
| Wide / ultrawide | 1920 and up (2560+) | Sidebar + frame (max `--page-max`) + inspector by default on pages that have one | 32 | Never stretched forms or text lines |

Input and environment, independent of width:

- `(pointer: coarse)`: 44px targets, comfortable density, no hover-only affordances (anything revealed on hover is
  always visible). `(pointer: fine) and (hover: hover)`: compact density allowed (3.5), hover states on rows.
- Safe areas: add `viewport-fit=cover` to the viewport meta (`index.html`: today it is missing, so the 5 existing
  `env(safe-area-inset-*)` uses always read 0 on iPhone). Then: the top bar pads `env(safe-area-inset-top)`, the tab bar
  and sheet footers pad `env(safe-area-inset-bottom)`, and landscape pads `env(safe-area-inset-left / right)` on the
  shell. Tokens `--safe-t / --safe-b / --safe-l / --safe-r` wrap them with `0px` fallbacks.
- Viewport height: `100dvh` for the shell and sheets (`svh` for anything that must not jump while the phone browser bar
  moves, such as the sheet `large` detent); no plain `vh` in the app (17 uses today, `Modal.module.css:22`,
  `CommandPalette.module.css:10` …).
- Zoom and text size: at 200% browser zoom a 1280px laptop behaves as a 640px "large phone" and must work as one (single
  column, sheets); the app's text-size pref (90 to 130%) scales rem, so breakpoints in `em` units follow the text size:
  **write width media queries in `em`** (`48em` = 768px at 100%), so a 130% text size switches layouts earlier and
  nothing is crushed.

### 3.2 One page frame (common width for all pages)

Every route renders inside one page component, `<Page>` (new, `src/components/ui/Page.tsx`, with
`src/styles/page.module.css`), replacing today's mix of `surface.page`, per-page `.page` classes and inline widths:

```tsx
<Page title="Invoices" subtitle="…" actions={…} tier="page" inspector={…}>
  …
</Page>
```

- **Frame**: `width: 100%; max-width: var(--page-max); margin-inline: auto; padding: var(--sp-8) var(--gutter)
  var(--sp-12)` (phones: `var(--sp-4) var(--gutter) calc(var(--sp-12) + var(--tab-bar-h) + var(--safe-b))`). The frame
  owns the gutter; no page adds side padding of its own.
- **Width tiers** (tokens in `ios.css`):

| Tier | Token | Value | Used by |
|---|---|---|---|
| Page (default) | `--page-max` | 120rem (1920px) | Every page: Dashboard, lists, Clients, Books, reports, GST, Inventory, pack desks, Settings shell |
| Form | `--form-max` | 45rem (720px) | A single form inside the frame (business profile, quick expense page, import mapping, wizards in a page): left-aligned at the frame's leading edge; the space beside it holds the inspector / help aside or stays empty on purpose |
| Text | `--measure` | 70ch | Paragraphs: help articles, notes, descriptions, empty-state text (32ch) |
| Bleed | `--page-max: none` | full width minus gutter | POS counter, the invoice editor with live preview open, Gateway report display, wide registers when the user picks "Full width" |

  Because the frame's leading edge, gutter and title position are the same for every tier, moving between pages never
  moves the title or the left edge at any width up to 1920 + sidebar; only bleed pages differ, and only on screens wider
  than about 2170px.
- **Header slot order** (fixed): back link (phone, when nested) · large title + subtitle + actions (one row; actions wrap
  under the title on phones as a single scrollable `.join` / overflow menu, never as two rows of capsules) · page tabs ·
  **notices slot** (demo banner, one-time tips, "About this tab" strips, period-lock notices) · content. Today the
  one-time `ScreenTip` renders above `PageHeader` (`Transactions.tsx:396`, `Pos.tsx:866` and others), so the title sits at
  y = 95px on some pages and 165 to 173px on others; Gateway's title is 22px at y = 233px against 24px elsewhere.
- **Section spacing**: `--section-gap` between blocks; never margins on the blocks themselves.
- Pages may not set `max-width`, side `padding` or `margin-inline` on their root, and may not set a width on any
  element above 560px except through the tiers (lock-in, work plan section 5).

### 3.3 Common visual weight

Every page has the same weights, so none looks heavier or lighter than another:

| Role | Spec |
|---|---|
| Page title | 26px / 600 Chartist Sans (`title-2`); phone large title 30px / 600 |
| Section / card title | 15px / 600 (`--text-lg` at 600) |
| Group header | 13px / 500 `--label-2`, sentence case |
| Row text | ui size / 400 `--label` |
| Labels | 13px / 500 `--label-2` |
| Numbers | 350, tabular; totals 600 |
| Table head | 12.5px / 400 `--label-2` |
| Separators | `--hairline` `--sep` everywhere; cards `--card-edge` |
| Icons | stroke and sizes per 2.11 |
| Elevation | cards `--elev-0` on every page; floating things only per 1.9 |

Capitals with tracking (70 rules) and per-page title sizes go. The lock-in test checks font-weight values per selector
role and forbids `text-transform: uppercase` outside the allow-list.

### 3.4 Layout patterns per class

- **Phone**: single column; bottom tab bar (Home, Invoices, New, Clients, More); everything else through More or the
  sidebar drawer; dialogs are sheets with detents; lists are full-width inset grouped lists with 16px gutters; tables
  become row cards (p1 columns as title / value, p2 as the second line) under 600px container width; the editor shows the
  summary as a sticky bottom bar (existing `mobileBar`) and the preview as a `large` sheet.
- **Tablet (600 to 1194)**: sidebar (rail or full) + content. Master-detail panes where they help, each pane its own
  scroller:
  - Invoices: list (min 22rem) + selected invoice preview / actions;
  - Clients: list + client detail (ledger, statement, contacts);
  - Reports / Books: report list or report + drill-down (ledger of the clicked line);
  - Settings: section list + section (iPad Settings).
  In portrait under 834px the detail opens as a pushed page (phone behaviour) instead.
- **Laptop / desktop**: sidebar + frame; the editor shows form + summary (two columns, today `1fr 360px`) and, when live
  preview is on, form + preview as a resizable split (`minmax(32rem, 1fr) minmax(24rem, 0.8fr)`), the summary moving into
  the form column's sticky footer; dashboards use a container-query grid (2.8) of 12 tracks.
- **Wide / ultrawide (1920+)**: the frame reaches `--page-max`; pages with an inspector show it by default
  (`--inspector-w: clamp(22rem, 24vw, 30rem)`), so a 2560px screen shows sidebar + list + detail instead of today's 1,032px
  of empty margin around a 1,280px column. Forms stay at `--form-max` with the help / summary aside; text stays at
  `--measure`; tables use the full frame and gain p2 / p3 columns back.

Container queries over media queries: every card-level component (stat grid, tables, the editor's line table, report
headers, desk views) responds to `container-type: inline-size` on its card or pane, so it works the same in a pane, a
sheet or a full page. Today there are 2 `@container` rules in the whole app (`ItemsTable.module.css:163, 226`) against
24 different `@media` widths (640px alone 47 times).

### 3.5 Density

- `comfortable` (default on touch): rows 44px, fields 44px, card padding 20 / 16px.
- `compact` (pointer + hover devices, default at 1195px and up; a Settings → Display option overrides): rows 36 to 38px,
  fields 36px, card padding 16px, table cell padding 8 / 12px. Buttons keep the rulebook's sizes and 44px hit areas.
- Density is a class on `<html>` (`density-compact`) set by `theme-init.js` from the pointer media query and the stored
  pref, so first paint is already right. Tokens `--row-h`, `--field-h`, `--card-pad`, `--cell-py`, `--cell-px` switch on it.

### 3.6 Tables on narrow screens

- Column priority p1 / p2 / p3 (2.2) for every shared table; feature tables declare it with `data-priority` on `th`.
- Under 600px container width a table becomes a list of rows: p1 left (identifier + party), p1 right (amount + status
  pill), p2 as a second line in `--label-2`; tapping opens the detail.
- Sticky head and sticky totals inside the table scroller; the page itself never scrolls sideways (lock-in: e2e check of
  `documentElement.scrollWidth <= innerWidth` on the main routes at 320, 375, 768 and 1280).

### 3.7 Wasted space today (measured, sample data, Chromium)

| Width | Main column | Content frame | Empty | Notes |
|---|---|---|---|---|
| 375 | 375 | 343 | 0 | Header actions wrap to 2 rows (Invoices: Export CSV, Export .xlsx, New invoice); 3 stat tiles leave an orphan; the filter `.seg` wraps to 2 lines |
| 768 (iPad portrait) | 768 | 736 | 0 | Phone shell (drawer + tab bar) on a tablet; Clients table rows about 230px tall (name wraps to 4 lines), balance column off-screen |
| 844 × 390 (landscape) | 844 | 812 | 0 | Top bar 60 + tab bar 60 = 120 of 390px (31%) is chrome |
| 1024 × 768 | 776 | 776 | 0 | Clients name wraps to 4 lines; invoice number breaks mid-token |
| 1280 | 1032 | 1032 | 0 | Settings tabs wrap to 2 lines; Books tabs clipped |
| 1440 | 1192 | 1192 | 0 | |
| 1920 | 1672 | 1280 | 392 (23%) | Editor and POS capped at 1280 while 392px stays empty |
| 2560 | 2312 | 1280 | 1,032 (45%) | Half the main column empty on every page |

Screenshots: `before/` set listed in the work plan (section 7).

## 4. Before you ship (every package)

1. No raw hex, radius, shadow, z-index, duration or easing in the files you touched (tokens only, or an allow-list line
   with a reason).
2. Text colours from `--label*`, `--sys-*-ink` or `--tint` only; meaning never by colour alone.
3. Light, dark, high contrast light, high contrast dark, at 375 and 1280 (plus your package's extra widths), with reduced
   motion on once.
4. No page scrolls sideways; the title does not move between pages.
5. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; the button, type and em-dash tests stay green.

---

Reference: Apple Human Interface Guidelines (colour, materials, layout, typography, motion), as public documentation.
System colour values are Apple's published sRGB values; `-ink`, `-tile` and label values are this app's own, chosen to
meet 4.5:1 and 3:1.
