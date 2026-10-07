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
| `src/components/import/ImportWizard.tsx` (+ `.module.css`) | 4-step modal. |
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
- `.xlsx` cannot be parsed without a dependency; the UI tells users to Save As "CSV UTF-8". Paste-from-clipboard (tab separated, straight from Excel) is supported.
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
