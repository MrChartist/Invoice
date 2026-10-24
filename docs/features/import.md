# Import wizard (Excel / Vyapar / Zoho Books / Tally / Busy)

Migrate clients, catalogue items and opening invoices from a CSV export. Fully offline; data is written to the same localStorage tables the rest of the app uses.

## Route / nav

No dedicated route: the wizard is a modal. Suggested entry points (lead wires them):

- Settings -> "Data" card: button **Import data** (icon `FileUp`).
- Clients page header: **Import** (opens with `kind="clients"`).
- Optional nav/command-palette item: label **Import data**, icon `FileUp` or `FileSpreadsheet`.

## Files

| File | Purpose |
| --- | --- |
| `src/lib/csv.ts` | RFC-4180 reader/writer. `parseCsv`, `parseCsvDetailed`, `parseTable` (finds header row, pads ragged rows), `detectDelimiter` (`, ; \t \|`), `unwrapExcelText` (`="0123"`), `writeCsv`. BOM/CRLF/CR/embedded newlines handled. |
| `src/lib/import-mapping.ts` | `IMPORT_SCHEMAS` (field + synonyms per kind), `guessMapping(kind, headers, sampleRows, presetId?)` -> `{mapping, confidence, presetId}`, `IMPORT_PRESETS` (generic, vyapar, zoho, tally, busy), `detectPreset`, `missingRequired`, `invoiceAmountMapped`, `templateRows`, `templateFileName`. |
| `src/lib/importers.ts` | `parseNumber`, `parseDate`, `resolveStateText`, `buildPreview`, `dryRunReport`, `applyImport` (chunked, async), `createLocalSink`, `errorRowsCsv`, `reportErrorsCsv`. |
| `src/components/import/ImportWizard.tsx` (+ `.module.css`) | 4-step modal shell: footer, step list, file loading and the import run. |
| `src/components/import/wizard-state.ts` | Pure reducer holding all wizard state (tested in `tests/import-wizard-state.test.ts`). |
| `src/components/import/steps/*.tsx` | `ChooseFileStep`, `MapColumnsStep`, `ReviewStep` (+ row editor), `ImportStep`. |
| `tests/csv.test.ts`, `tests/importers.test.ts` | 41 tests incl. messy real-world fixtures. |

## Component

```tsx
import { ImportWizard } from '../components/import/ImportWizard';

<ImportWizard
  open={importOpen}
  onClose={() => setImportOpen(false)}
  kind="clients"                       // optional: 'clients' | 'items' | 'invoices'
  onDone={(report, kind) => reload()}  // report = {created, updated, skipped, errors[]}
/>
```

The component unmounts its state when `open` is false, so every open starts clean. Closing is blocked while a write is running.

## Tables used

Reads and writes only existing tables via `getTable`/`setTable` from `src/lib/storage.ts`: `clients` (`KEYS.clients`), `items_catalog` (`KEYS.items`), `invoices` (`KEYS.invoices`). No new tables, no new persisted fields. Reads `localDb.settings` (active sender, due-days default) and `localDb.template`.

## Behaviour notes for the lead

- **Clients**: duplicate = same GSTIN, else same case-insensitive name. Mode "update" merges only non-empty imported fields and keeps the existing name/id; mode "skip" leaves it. Invalid GSTIN checksum is a row error (toggle "import anyway" makes it a warning). State resolved from name / code / abbreviation / GSTIN prefix.
- **Items**: duplicate = same name + HSN (a blank HSN on either side matches by name). Type guessed from column or HSN (99xxxx = Service).
- **Opening invoices**: invoice number and total are kept exactly. Built through `normalizeRecord` + `calculateInvoice`; if the file total differs from the computed total, the difference goes to `other_charges` (round-off off) with a warning so `total` always equals the file. Existing invoice numbers are never overwritten (the row is reported as an error). Rows sharing an invoice number are merged into one multi-line invoice when line-item columns (Zoho style) are mapped. GST mode: from CGST/SGST/IGST columns if present, else sender state vs place of supply. `sender` snapshot = active profile. Status derived from status text, received and balance columns. Missing clients are created.
- **Performance**: the local sink does one read-modify-write of a table per chunk (250 rows) and yields to the UI between chunks, instead of calling `localDb.*.upsert/save` per row (which re-parses the whole table each time). Semantics mirror `localDb.clients.upsert`, `localDb.items.upsert`, `localDb.invoices.save`, except that importing invoices does not grow the item catalogue.
- **Excel `.xlsx`** is read without a dependency: `src/lib/xlsx.ts` (`readXlsx`, `readXlsxTable`, `xlsxToCsv`) on top of
  `src/lib/zip.ts` (central-directory ZIP reader, native `DecompressionStream('deflate-raw')`, CRC check). The wizard
  turns the first non-empty sheet into CSV text and runs the normal CSV path, so mapping/presets are unchanged.
  Shared / inline / rich / formula strings, numbers (float noise removed), booleans and date-formatted cells
  (1900 and 1904 systems → local `YYYY-MM-DD`) are handled; error cells become empty. Guards: 25 MB input
  (`MAX_IMPORT_BYTES`), 5,000 entries, 100 MB total inflated, inflation never past an entry's declared size,
  encrypted / ZIP64 / multi-disk archives refused. `.xls`, `.ods` and `.numbers` still need Save As CSV / .xlsx.
  The parser is a separate chunk loaded only when an .xlsx is chosen. Bank statements (`src/components/bank/ImportPanel.tsx`)
  accept .xlsx the same way. Paste-from-clipboard (tab separated, straight from Excel) is supported.
- **Writing .xlsx**: `writeXlsx(sheets)` / `downloadXlsx(name, sheets)` (inline strings, bold frozen header, text cells
  through the same `safeText` formula-injection guard as `csvCell`). Used by the invoice list ("Export .xlsx"), the GSTR-1
  section downloads and the GSTR-2B IMS worksheet. `writeZip` / `zipBlob` in `zip.ts` are available for other bundles
  (a "Download all PDFs (ZIP)" would need off-screen rendering of each invoice; not wired yet).
- Presets are best-effort header spellings of each tool's standard export; mapping is always editable.

## Wiring snippets (no shared file was edited)

Settings.tsx (or any page):

```tsx
import { ImportWizard } from '../components/import/ImportWizard';
import { FileUp } from 'lucide-react';
// state
const [importOpen, setImportOpen] = useState(false);
// button
<button onClick={() => setImportOpen(true)}><FileUp size={16} /> Import data</button>
// render
<ImportWizard open={importOpen} onClose={() => setImportOpen(false)} onDone={() => window.dispatchEvent(new Event('storage'))} />
```

Clients.tsx: same with `kind="clients"` and `onDone={reload}`.

Template CSV downloads for each kind are built into step 1 of the wizard.
