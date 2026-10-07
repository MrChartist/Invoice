# Design Studio (templates-studio)

Invoice design customisation, paper formats and six new templates.

- **Route**: `/design` (suggested)
- **Nav label / icon**: "Design Studio" / lucide `Palette`
- **Table**: `design_prefs` (via `getTable`/`setTable`), one row per sender profile id plus a global row with `profile_id = '__global__'`. Resolution is defaults <- global <- profile.

## Exported symbols

`src/lib/design-prefs.ts` (pure, tested in `tests/design-prefs.test.ts`):
`DesignPrefs`, `DEFAULT_DESIGN`, `GLOBAL_PROFILE_ID`, `resolve(profileId)`, `resolveDesignFrom(rows, id)`, `loadDesign`, `saveDesign`, `resetDesign`, `sanitizeDesign`, `sanitizeHex`, `presets`, `applyPreset`, `paperSize(design)`, `pageSlices(contentHeight, design)`, `printPageCss(design)`, `formatNumberPref`, `formatDatePref`, `contrastText`, `stampFor`, `FONT_OPTIONS`, `BRAND_SWATCHES`, `MR_CHARTIST_ORANGE`.

Components: `TemplateEngine` (`src/components/templates`), `DesignPanel`, `DesignStudio` (page), `buildSampleInvoice`/`buildLongInvoice` (`src/components/design`).

## TemplateEngine

`<TemplateEngine invoice sender totals templateId design? pageRule? />`. Omit `design` and output is the native A4 look (verified pixel-identical against the previous engine for all 20 existing templates, except one bug fix: legacy `SINGLE` tax mode no longer prints both an "IGST" and a "Tax" row). "Show" flags mean "print when data exists"; `false` always hides. `logo_position: 'auto'` keeps each template's native logo placement. Watermark: `none`, `auto-status` (PAID green / OVERDUE / CANCELLED / DRAFT from `effectiveStatus`), or custom text. `paper: thermal80` forces the receipt layout for any template.

New template ids: `mrchartist_ink`, `mrchartist_ember`, `gst_tax_invoice` (Tally-style grid + HSN summary + tax in words), `bilingual_hindi`, `compact_receipt`, `statement_letterhead`.

## Wiring the lead must add

Route and nav:
```tsx
import { DesignStudio } from './components/design/DesignStudio';
<Route path="/design" element={<DesignStudio />} />
// nav: { to: '/design', label: 'Design Studio', icon: Palette }
```

Preview / PDF (src/components/preview/InvoicePreview.tsx):
```tsx
import { resolve, paperSize, pageSlices, printPageCss } from '../../lib/design-prefs';
const design = useMemo(() => resolve(sender?.id), [sender?.id, isOpen]);
const size = paperSize(design);
<TemplateEngine invoice={invoice} sender={sender} totals={invoice.totals} templateId={templateId} design={design} pageRule />
// PDF: capture previewRef with toPng, then for each slice of
// pageSlices(previewRef.current.offsetHeight, design) draw the cropped canvas on its own jsPDF page:
// new jsPDF({ unit: 'px', format: [size.width, size.autoHeight ? previewRef.current.offsetHeight : size.height], hotfixes: ['px_scaling'] })
```
Existing callers without `design` keep working. Print: `window.print()` honours `pageRule` (`@page` size); table headers repeat, rows and the totals/signature block do not split.

Cross-link: a "Customise design" link to `/design` from the preview toolbar and Settings profile card.

## Notes
- No new dependencies, no network. Fonts degrade to system fonts when DM Serif Display / Noto Devanagari are not installed.
- Thermal height is content-driven (`paperSize().autoHeight`); measure the element for the PDF.
