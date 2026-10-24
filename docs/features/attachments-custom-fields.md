# Attachments & custom fields (roadmap 6.12 / 6.23)

Two small, independent features that both add optional fields to existing records. Local-first, no new
dependencies, nothing printed or exported unless the user asks for it.

---

## 6.12 Attachments

Receipt photos and PDFs on **purchase bills**, **expenses** and **invoices** (any document type). Internal working
files: never printed on a template, never part of the client copy, PDF or share text.

### Where
- `src/components/attachments/AttachmentsPanel.tsx` — attach / preview / open / download / remove. Used by
  `BillModal`, `ExpenseModal` (label "Receipts & attachments") and the invoice editor (card "Internal attachments",
  inside the editor's fieldset, so a locked document is read-only here too). Expenses list shows a paperclip count.
- `src/lib/attachments.ts` — pure storage / validation / reference logic (Node-tested).
- `src/lib/attachment-upload.ts` — browser side: read the file, downscale photos, open / download a stored file.
- `src/lib/image.ts` → `compressPhoto()`.

### Storage
| key | value |
|---|---|
| `mrchartist_inv_att_<id>` | JSON `{id, mime, size, created_at, data}`; `data` = `data:<mime>;base64,…`. One key per file. |
| `purchases[].attachments`, `invoices[].attachments`, `draft.attachments` | `AttachmentRef[]` = `{id, name, mime, size, added_at}` (`src/types/attachments.ts`) |

- **Stored once, by content.** `id` = `hashContent(dataUrl)` from `assets.ts` (`~n` suffix on a collision, checked by
  full content), so the same receipt on two bills is one file. The record keeps its own display name.
- **Why one key per file, not one table.** Every data key lives in the IndexedDB-backed cache; a single
  `attachments` table would be re-serialised, re-parsed and re-committed whole (tens of MB) on each attach. One key per
  file keeps each write and each IndexedDB commit to the size of that file. The keys are under `mrchartist_inv_`, so
  backup, safety snapshot, Erase, forgot-PIN reset, cross-tab refresh and quota handling all apply unchanged.
  `listKeys(prefix)` was added to `storage.ts` to enumerate them (cache or localStorage).
- Without IndexedDB (localStorage fallback, ~5 MB) the quota is reached quickly; the usual "storage is full" error is
  shown and nothing half-saves.

### Validation and limits
- Accepted: JPEG, PNG, WebP, GIF images and PDF — decided by **magic bytes** (`sniffMime`); the declared MIME type and
  file name are ignored. SVG/HTML/anything else is refused.
- Photos are downscaled to 1600 px on the long side and re-encoded as JPEG q 0.82 on white (`compressPhoto`); a photo
  that needed no downscaling and is already smaller stays as it was. Input up to 20 MB; stored result ≤ 3 MB.
- PDFs are stored as they are, **up to 3 MB each**. Up to 10 files per record.
- Every read re-checks the stored payload (type in the data URL must match its magic bytes), and so does restore.

### Viewing (CSP)
Images render from their data URL (`img-src 'self' data: blob:` already allowed). "Open" builds a `Blob` from the
stored bytes **with the sniffed type** and opens a `blob:` URL in a new tab (top-level navigation is not restricted by
the page CSP); "Download" saves it under its original name. Data URLs are never `fetch`ed (`connect-src 'self'`).
**No CSP change.** No nested modal: the preview expands inline in the panel.

### Clean-up (no orphans forever)
- `localDb.invoices.save` / `purchasesDb.save` release files the record no longer lists; `…remove` releases the
  record's files. `releaseAttachments` deletes a file only when **no** invoice, purchase or the autosaved editor draft
  references it.
- Files picked in a form that is then cancelled: the panel releases the ids it touched ~2 s after it unmounts
  (time for the parent's save / the 500 ms draft autosave to land; release is reference-checked, so it is safe).
- Anything left over (e.g. a draft that was discarded) is listed in **Settings → Data & backup → Storage on this
  device** ("Attached files: N · M unused") with a **Clean up unused files** button (`cleanupUnusedAttachments`);
  storage health also raises an "N attached files are no longer used" finding.

### Backups
- Exported automatically (ordinary app keys). `MAX_BACKUP_BYTES` (200 MB) replaces the 25 MB CSV cap for the restore
  pickers because receipts travel inside the JSON as base64.
- `parseBackup` → `checkBackupAttachments`: a damaged / disallowed file (bad JSON, non-image/PDF type, magic bytes
  that disagree, id ≠ key) is **dropped** from the restore; **dangling references** (a record points at a file the
  backup lacks) are **counted, not refused** — attachments are supporting files, the records restore and show
  "File missing on this device". The restore dialogs say how many files the backup carries / misses / drops
  (`attachmentRestoreNote`).

### Decisions
- **Duplicating / converting does not copy attachments** (duplicate, convert, credit note, debit note, late-fee
  invoice all set `attachments: undefined`): the files document the original transaction (its signed copy, its
  proof of delivery). Recurring templates never carried them.
- Purchases contract: `attachments?` is additive on `PurchaseRecord`; report readers ignore it
  (`tests/purchase-contract.test.ts`). Saving attachments on a bill in a locked period is blocked like any other edit.
- Invoices: `attachments` is in `RECORD_KEYS` and kept by `normalizeRecord`.

---

## 6.23 Custom fields

User-defined fields on **documents** (invoices, quotations, …), **items** (catalogue → invoice lines) and **parties**
(clients and vendors), each optionally printable.

### Where
- Settings → **Custom fields** tab (`src/components/custom-fields/CustomFieldsPanel.tsx`, lazy): label, type
  (text / number / date), applies to, "Print on invoices"; edit, reorder, delete.
- Inputs: `CustomFieldInputs` in `ClientFormModal`, the vendor form (`VendorsTab`) and the catalogue item editor
  (`CatalogPanel`); `CustomFieldsCard` ("5 · More details") in the invoice editor for document + party fields.
- Templates: `src/components/templates/parts/CustomFieldsBlock.tsx` — a "Details" box after the parties on the
  standard layouts, extra cells in the GST (Tally-style) header grid, a compact list on the thermal receipt; printable
  item fields as a muted line under the item name. Styling uses `--tpl-accent` / `--tpl-soft` / `--tpl-muted` only.
- Logic: `src/lib/custom-fields.ts` (Node-tested).

### Data
| key / field | shape |
|---|---|
| `mrchartist_inv_custom_fields` | `CustomFieldDef[]` = `{id, label, type, applies_to: 'document'\|'item'\|'party', print, created_at, updated_at}` (in `RECORD_TABLES` + `ID_TABLES`) |
| `clients[].custom_fields`, `vendors[].custom_fields`, `items_catalog[].custom_fields` | `Record<fieldId, string>` |
| `invoices[].custom_values`, `invoices[].items[].custom_values` | `CustomFieldValue[]` = `{id, label, type, value, print, scope?: 'party'}` — a **snapshot** |

Master data stores plain values (the label shown is always the current definition's). Documents store label + value
+ print flag, so:

- **Snapshot rule (Critical Rule 3).** On the **first** save of a document, labels / types / print flags are taken from
  the current definitions (`finalizeValues(…, isNew=true)`); after that the document keeps what it was saved with.
  Renaming a field, switching its print flag or deleting it never changes a saved invoice's print. Values whose field
  was deleted stay visible (and editable / clearable) in the editor.
- **Party fields** come from the picked client (`clientToParty` carries the map, the store merges it into
  `custom_values` with `scope: 'party'` and drops the map from the invoice's client copy so a later CRM upsert can
  never wipe the master values). Picking another client replaces them; typing in the client fields does not.
- **Item fields** flow from the catalogue row onto the line when it is picked (`applyCatalogItem`), with today's labels.
  They are shown under the line in the editor (read-only) and printed if printable.
- Values are cleaned on save: numbers lose grouping (`1,250.50` → `1250.50`), dates must be a real local `YYYY-MM-DD`
  day (never parsed as UTC), text capped at 200 chars. Duplicating / converting a document **copies** its custom
  values like any other field.
- **Sales register CSV** gains one trailing column per custom field label used on the exported documents (none used →
  columns unchanged).
- Limits: 30 fields, 40-character labels, unique label per "applies to".

### Not done (kept modest)
- No custom fields on purchase bills / expenses, recurring templates, or the GSTR / Tally / e-Invoice outputs.
- Item fields are not editable per line in the editor (pick the catalogue item again, or edit the catalogue).
- The inventory "stock item" modal has no inputs for item fields (use Settings → Items & rates; values are kept).
- Party fields are not printed separately inside the Bill-to block; they appear in the same "Details" box after the
  document fields.

## Tests
- `tests/attachments.test.ts` — magic bytes, size caps, disguised files, stored-once, byte round-trip, tamper
  detection, release on edit / delete (shared files and draft references kept), sweep, backup round-trip, dangling and
  doctored backups, Erase + forgot-PIN reset, storage health, IndexedDB cache.
- `tests/custom-fields.test.ts` — value cleaning (local days), definitions, snapshot on first save vs. later saves,
  rename / delete never changes history, catalogue → line and client → document flows, client master never wiped,
  printable ordering, templates use the accent variable, sales register columns, backup round-trip.
- `tests/purchase-contract.test.ts`, `tests/invoice-store.test.ts` extended; e2e: attach a receipt to an expense and
  see it after a reload and after a restore; define a printable field and see it in the invoice preview.
