# Income-tax Act 2025 section and form labels (R5 §7 Q1)

Status: **done (labels, rule tables, exports)**. Every statutory value below is a working-paper reference, so verify it with your CA.

From **1 Apr 2026** (tax year 2026-27) the Income-tax Act 2025 replaces the Income-tax Act 1961. Under the new Act:
- salary TDS is in **Sec 392**;
- non-salary TDS is consolidated in the Tables of **Sec 393** (393(1) for residents, 393(2) for non-residents);
- TCS is in the Table of **Sec 394**;
- the Income-tax Rules 2026 renumber the forms (Form 26Q becomes Form 140, and so on).

The Act that governs a deduction is set by the **earlier of credit or payment** (CBDT FAQ, TDS compliance Q1). A March-2026 credit paid in April therefore stays under the 1961 Act.

## What the app does

- **Labels follow the document or transaction date.** Records dated up to 31 Mar 2026 show the 1961 code, as before
  ("194C-1", "Form 26Q"). Records dated from 1 Apr 2026 show the 2025-Act reference with the old code in brackets:
  `Sec 393(1) [Table: Sl. No. 6(i)] [old 194C]` and `Form 140 [old 26Q]`. A reference that no official source
  confirms also carries **"(verify with your CA)"**, for example `Sec 393(1) [Table: Sl. No. 6(iii)] [old 194J] (verify with your CA)`.
- **Stored data is untouched.** Invoice `tds_section`, bill / vendor / manual TDS codes (`194C-1`, `194I-A`, `195-R` …),
  return marks (`26Q:2026-Q1`), storage keys and the RPU section codes inside the working papers all keep their values.
  Only the screen labels and export headings change.
- **Rates and thresholds do not change**, because the 2025 Act keeps them (CBDT FAQ Q3). `tax-rules.ts` and `tds-rules.ts` keep their dated tables, and
  no rate entry was added. The Finance Act 2026 TCS changes do not touch any preset the app offers (see open items).
- **Which date each place uses:**

  | Place | Date | Change |
  |---|---|---|
  | TDS & TCS → Deductions | credited / paid on | Section column |
  | TDS & TCS → Returns (26Q / 27EQ paper) | first day of the quarter | Chip, CSV / text / XLSX heading, new "Section references" block / sheet, warning about RPU codes |
  | TDS & TCS → Form 16A data, Form 27Q | quarter start, credit date | Form name (131 / 144), section column |
  | Overview due list, GST compliance calendar, notification bell | period of the due item | "File Form 140 [old 26Q] for 2026-Q1" |
  | Manual deduction, bill / expense TDS pick-list | entry / bill date | Option label prefixed with the 2025-Act reference |
  | Invoice editor: TDS section, TCS preset, summary "Less TDS" | invoice date | Option label, result label |
  | Printed invoice footer "Less: TDS (…)" | invoice date | Reference and old code, **without** the CA caveat (customer copy) |
  | Receivables → TDS (customer deductions) | quarter start | Section column, Form 16A / 131 column |
  | 26AS / AIS / **Form 168** import | n/a | A section written as "393(1) [Table: Sl. No. 6(iii)]" is read back as 194J for matching (`sectionCode` → `oldCodeOf`) |
  | Payroll → Reports (24Q annexures, Form 16 Part B) | FY start | Form 138 / 130 headings, "Sec 392(1)" row, note that the other salary sections are 1961 numbers |
  | Tally XML and ledger receipt narration | invoice date | "TDS … withheld u/s Sec 393(1) …" |

- The TDS & TCS page shows a short note (`ita25T('note')`) for any FY that ends on or after 1 Apr 2026.

## Mapping (`src/lib/ita2025.ts`)

`ACT_REF_RULES` holds the sections and `FORM_REF_RULES` the forms. Both use the same `Versioned` / `ruleAt` shape as `tax-rules.ts` and
are **append-only**. `OLD_CODE_SHOWN_RULES` turns the "[old …]" bracket on from 1 Apr 2026. To drop the bracket after the
transition, append `{ from: '<day>', value: false }`. Do not edit the existing entries.

### Sections

| App code(s) | 1961 | 2025 Act (from 1 Apr 2026) | Confirmed |
|---|---|---|---|
| `192` (payroll) | 192 | Sec 392(1) | **official** (CBDT FAQ Q20) |
| `194C-1`, `194C-2` | 194C | Sec 393(1) [Table: Sl. No. 6(i)] | **official** (CBDT FAQ Q2) |
| `194J`, `194J-T` | 194J | Sec 393(1) [Table: Sl. No. 6(iii)] | verify |
| `194I-A`, `194I-B` | 194-I | Sec 393(1) [Table: Sl. No. 2(ii)] ((a) plant 2%, (b) land / building 10%) | verify |
| `194H` | 194H | Sec 393(1) [Table: Sl. No. 1(ii)] | verify |
| (194D) | 194D | Sec 393(1) [Table: Sl. No. 1(i)] | verify |
| `194Q` | 194Q | Sec 393(1) [Table: Sl. No. 8(ii)] | verify |
| `194A` | 194A | Sec 393(1) [Table: Sl. No. 5(iii)] | verify |
| `194O` | 194-O | Sec 393(1) [Table: Sl. No. 8(v)] | verify |
| `194R` | 194R | Sec 393(1) [Table: Sl. No. 8(iv)] | verify |
| `194S` | 194S | Sec 393(1) [Table: Sl. No. 8(vi)] | verify (one of the Form 141 items) |
| (194-IA / 194-IB / 194M) | 194-IA / 194-IB / 194M | 3(i) / 2(i) / 6(ii) | verify (the set is official: Form 141) |
| `195-R`, `195-F`, `195-I`, `195-O` | 195 | Sec 393(2) [Table: Sl. No. 17] | verify |
| TCS preset `206C(1G)` | 206C(1G) | Sec 394(1) [Table: Sl. No. 7] | Sec 394 official (FAQ Q18), item verify |
| TCS `206C(1H)` | 206C(1H) | — (omitted from 1 Apr 2025) | keeps its 1961 label |

### Forms

| 1961 Rules | 2026 Rules | Confirmed |
|---|---|---|
| 24Q | Form 138 | **official** (e-Filing user manual) |
| 26Q | Form 140 | **official** (e-Filing user manual) |
| 27Q | Form 144 | **official** (e-Filing user manual) |
| 27EQ | Form 143 | verify (official page title seen in search only) |
| 16 / 16A / 27D | Form 130 / 131 / 133 | verify (official page title "Form No. 130_131_132_133 (Earlier Form No. 16/16A/16B/16C/16D/16E/27D)", seen in search only) |
| 26AS (TDS credit view) | Form 168 (AIS for the tax year) | **official** (CBDT FAQ Q24–25) |
| 10BD / 10BE | Form 113 / 114 (Sec 354(1), 354(1)(g)) | **official** (form mapping guide) |
| 15G / 15H | Form 121 (Sec 393(6)) | **official** |
| 26QB / 26QC / 26QD / 26QE | Form 141 | **official** (FAQ Q9) |

A return or correction for a period up to Mar 2026 stays on the old form (FAQ Q12). The app picks the form from the
period's first day, which gives this result automatically: Q4 FY 2025-26 shows Form 26Q and Q1 FY 2026-27 shows Form 140.

## Sources

- CBDT FAQ, TDS compliance under the Income-tax Act 2025:
  https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tds-compliance
- Form mapping guide, ITA 1961 to ITA 2025 (e-Filing):
  https://www.incometax.gov.in/iec/foportal/sites/default/files/2026-03/Guide%20to%20IT%20Act%202025%20forms.pdf
- Form 138 / 140 / 144 user manuals: https://www.incometax.gov.in/iec/foportal/newformpage/forms/form138-um (and `form140-um`,
  `form144-um`)
- Form 143 / 130–133 pages (titles only): https://www.incometaxindia.gov.in/documents/d/guest/fn-143,
  https://www.incometaxindia.gov.in/documents/d/guest/fn-130-131-132-133
- Sec 393 / 394 Tables, Income-tax Bill 2025 as introduced:
  https://prsindia.org/files/bills_acts/bills_parliament/2025/The_Income-tax_Bill,_2025.pdf. The enacted, amended text is
  https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf; it could not be opened from here, so check the table items against it.
- Budget 2026-27 TCS changes: https://static.pib.gov.in/WriteReadData/specificdocs/documents/2026/feb/doc202621776101.pdf,
  https://www.indiabudget.gov.in/doc/budget_speech.pdf (paras 103–104)

## Open items (verify with your CA)

1. **Table items other than 194C and 192** come from the Bill's Tables and from secondary sources that agree with them. Check them against the
   enacted Act as amended by the Finance Act 2026 before relying on them, then set `verified: true` in a **new dated
   entry** (do not edit the existing one).
2. **RPU / payment section codes for Forms 140 / 143 / 144.** Blogs disagree (for example 1023/1024 or 1018/1019 for 6(i)). The
   working papers keep the 1961 RPU codes (`94C`, `4JB`, `6CQ` …) and add a "Section references" block and a warning.
   Map the codes in the RPU, and add the new codes to `tds-rules.ts` once the Protean RPU file format is confirmed.
3. **Form 143 (TCS) due dates.** The Form 143 guide reads 31 Jul / Oct / Jan / May, but the Jan 2026 TCS guide reads the 15th. `TDS_DUE_RULES`
   keeps the 15th (the earlier, conservative date) until this is confirmed.
4. **Forms 130 / 131 / 133 / 143** numbering was seen only in official page titles via a search index.
5. **TCS rates, Finance Act 2026 (Budget proposals):**
   - overseas tour package: flat 2%;
   - LRS for education / medical: 2%;
   - liquor, scrap and minerals: 2%;
   - tendu leaves: 2%.

   The app's only current TCS preset is LRS at 20%, which is unchanged. If a tour-package or education preset is added, add it as a new entry in `TCS_PRESET_RULES`.
6. **Other 1961 references not mapped:**
   - salary computation sections in payroll (17, 10, 16, 80C…, 87A, 89, 115BAC), where the Form 16 Part B paper adds a
     note;
   - 201(1A) interest (Sec 398);
   - 206AA / 206AB;
   - 40(a)(ia) (Sec 35(b));
   - 80G / 35(1) / 11 / 12AB / 115BBC for trusts. 80G approval is now Sec 133(1)(b)(ii) and the donee statement is Sec 354(1) (Form 113), but the app has no 80G screens yet.
7. **R4-C (trade / trust)** export working papers and the auditor pack carry no TDS / TCS section or form labels, so nothing was mapped there.

## Rows for the lead (ROADMAP / PRD §7 Q1)

| # | Item | Status |
|---|---|---|
| 23 | Income-tax Act 2025 section / form labels across TDS, TCS, receivables, payroll, editor and exports (date-keyed, append-only, `src/lib/ita2025.ts`) | ✅ done: labels only, stored codes unchanged |
| 23a | Confirm the Sec 393 / 394 table items against the enacted Act and flip `verified` with new dated entries | ⏳ verify with your CA |
| 23b | 2025-Act RPU section codes for Forms 140 / 143 / 144 | ⏳ open, waiting for the RPU file format |
| 23c | Form 143 due dates (15th vs 31st) | ⏳ open |
| 23d | Finance Act 2026 TCS rates (tour package / LRS education 2%), for when such presets are offered | ⏳ open |

## Tests

`tests/ita2025.test.ts` covers:
- every app code is mapped;
- for each code, 31 Mar 2026 gives the 1961 reference and 1 Apr 2026 the 2025-Act reference with "[old …]" and, when unconfirmed, the CA caveat;
- the forms by period;
- the tables are append-only;
- AIS / Form 168 section text maps back to the 1961 family;
- the 26Q / 16A / 27EQ / 27Q exports carry the 1961 name for Q4 FY 2025-26 and the 2025 name for Q1 FY 2026-27 with section references;
- stored codes are unchanged.

## Bundle

`ita2025.ts` and the `ita2025` i18n area load only with the TDS, receivables, payroll, editor, template, books and
export chunks. Nothing is in first paint (`npm run check:size`).
