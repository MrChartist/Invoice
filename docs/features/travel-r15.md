# Round 15 — travel, tour and event businesses (+ size recovery)

Spec: `docs/prd/round-15.md`. One section per package; each records its bundle numbers (gzip -9, KiB, the method of
`scripts/check-bundle-size.mjs`). Working papers — verify with your CA.

## §A — R15-A: size recovery and cross-cutting (A1–A4)

### A1 Initial-module chunk group

`vite.config.ts`: `build.rolldownOptions.output.codeSplitting.groups` = `vendor-react` (30), `vendor-ui` (30),
`app-initial` (`tags: ['$initial']`, 20). Rolldown folds `app-initial` into the entry chunk; no lazy module joins it
(first paint stays at 4 files). `check-bundle-size.mjs`: entry budget 100 kB, ≤ 5 initial files; initial 185 / total
3,500 unchanged. Pinned by `tests/bundle-config.test.ts`. Production e2e and `scripts/verify-offline.mjs` pass.

| Build | Chunks | Initial | Entry | Total | Initial files | Cross-chunk `import{…}from` |
|---|---|---|---|---|---|---|
| Baseline `d15cae9` (`manualChunks`) | 997 | 184.8 | 71.2 | 3,425.6 | 13 | 7,234 |
| A1 on `d15cae9` | 988 | 182.5 | 88.4 | 3,382.2 | 4 | 5,768 |
| Baseline after QA17 merge (`661604a`) | 997 | 184.8 | 71.2 | 3,426.0 | 13 | 7,236 |
| A1 on `661604a` | 988 | 182.4 | 88.4 | 3,383.2 (−42.8) | 4 | 5,770 |
| **R15-A complete (A1–A4)** | 990 | **182.6** | **88.6** | **3,388.7** | 4 | — |

A1 saving on the merged base: total −42.8 kB, initial −2.4 kB (above the 30 kB stop rule).

### A2 Audit-append coalescing (PERF-3, part)

`audit.record` appends to an in-memory working copy of the log; the table is written once per synchronous task (a
microtask), or earlier by `audit.flush()`, by a read of the log's key (`storage.onPendingKey`: `readRaw` of the key
flushes) or when the batch passes the row limit (so archive rollover is that of one-by-one appends). A raw write /
removal of the key by anyone else (restore, demo removal, erase) drops the batch — as before, when its rows were
written first and then overwritten. Hash chain, row shapes and the segment format are unchanged; vault sealing stays
inside `storage.ts`. Flush call sites: backup build, sync run, `pagehide` (`main.tsx`); the auditor pack reads through
`audit.fullRows()`, which flushes. Measured (`tests/perf.test.ts`, 5,000 invoices): one write for 16 events (was one
per event). Tests: `tests/audit-coalesce.test.ts`; four existing tests that read raw storage now call `audit.flush()`.
First paint: ≈ +0.14 kB (entry 88.4 → 88.6 with the preload-map entries of A3's lazy chunks).

### A3 Party netting

`src/lib/netting.ts` + `components/receivables/NettingDialog.tsx` (lazy). A customer who is also a supplier (same name
or GSTIN, or `Vendor.client_id` set on the supplier form) is offered **Netting** on its Receivables → Ageing row; the
supplier form has the link row and a Netting link; Ctrl+K "Netting". The user ticks open invoices and bills; the amount
is ≤ min(Σ receivable, Σ payable), split oldest first. Posting: one `localDb.payments.record` receipt per (invoice,
bill) pair with `method: 'netting'`, then `exchange_purchase_id` = the bill (the R9 / R12 no-cash marker — no new
marker, `no-cash.ts` untouched) and `netting_id`; the ledger posts Dr Sundry creditors / Cr Debtors (party). The bill
side: the shared roll-up `exchangeSettled` (now beside R9's URD sync in `rt-doc-hooks.ts`, re-exported by netting.ts)
and `syncNettedPaid` keep the bill's `amount_paid` / `exchange_paid`; bill-wise payables show the live netting rows as
dated adjustments (a receipt deleted elsewhere frees the bill there at once). All or nothing (`withTablesRollback`),
`books.edit`, period lock, one audit line each way. Refused: URD vouchers (R12 cycle bills are not offered), unpaid RCM
(the user confirms "RCM paid"), currency mismatch. Clerks: refused with "needs the owner's approval" (cap ₹0) — see
deviations. Reverse removes the receipts through the data layer (recycle bin).

Size (vs A1 on the merged base): NettingDialog chunk 3.97 kB (dialog + engine + strings), Receivables +0.33,
palette +0.14, rt-registry +0.15, billwise +0.12, help +0.04 ≈ **4.75 kB** against the 4 kB cap after cut 2 (printable
/ WhatsApp netting statement dropped) and string trimming.

### A4 2026 housekeeping

- `ita2025.ts`: `'206C1G-tour'` → `Sec 394(1) [Table: Sl. No. 8]` (`verified: true`, Finance Bill 2026 cl. 73(f);
  Memorandum ¶8, TV3). `actKey` maps a 206C(1G) / TCS / overseas code or label naming a tour to it; LRS keeps Sl. No. 7.
- `tds-rules.ts`: `MANPOWER_WORK_RULES` (from 2026-04-01, unverified, TV23) and `manpowerHint`; the bill / expense TDS
  panel shows the hint when the bill names manpower and a 194J limb is picked.
- Size ≈ 0.6 kB (tds strings, tds-rules, ita2025, the TDS panel in the Expenses chunk).

### Deviations

- A2: `beforeunload` → `pagehide` (fires on mobile and bfcache; the microtask flush already ran before any event).
  `sync-engine.ts` flushes though `audit_log` is not synced (harmless).
- A3: the "existing approval queue" is document-based (`approvals.ts` holds invoices); a clerk's netting is refused with
  "needs the owner's approval" instead of being queued. The netting receipts also write the normal per-receipt
  payment lines (localDb), besides the one netting line. The creditor sub-ledger line uses the client's name (the
  existing exchange posting), so a hand-linked vendor with another name nets in the client's name.
- A3 over its cap by ≈ 0.75 kB (see above).
- CA ids TV26 / TV27 are cited in code comments only; help / glossary cite no TV id until the lead copies §9 into
  `docs/CA_REVIEW.md` §15 (the CA-id regexes already accept `TV`).
