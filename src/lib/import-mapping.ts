/**
 * Import field schemas, header synonyms, automatic column guessing and saved
 * presets for popular accounting tools. Pure — no browser APIs.
 */

export type ImportKind = 'clients' | 'items' | 'invoices';

export type FieldType = 'text' | 'number' | 'percent' | 'date' | 'gstin' | 'state' | 'email' | 'status';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  hint?: string;
  /** Header spellings seen in the wild. Matching is case/punctuation-insensitive. */
  synonyms: string[];
  /** Sample cell used in the downloadable template. */
  example: [string, string];
}

export const KIND_LABELS: Record<ImportKind, string> = {
  clients: 'Clients / Parties',
  items: 'Items (catalogue)',
  invoices: 'Opening invoices',
};

export const IMPORT_SCHEMAS: Record<ImportKind, FieldDef[]> = {
  clients: [
    {
      key: 'name', label: 'Name', type: 'text', required: true,
      synonyms: ['Name', 'Party Name', 'Customer Name', 'Display Name', 'Ledger Name', 'Client Name', 'Client', 'Customer', 'Party', 'Account Name', 'Particulars', 'Contact Name', 'Billing Name', 'Name of the Party', 'Buyer Name'],
      example: ['Acme Traders Pvt Ltd', 'Sharma & Sons'],
    },
    {
      key: 'company', label: 'Company', type: 'text',
      synonyms: ['Company', 'Company Name', 'Business Name', 'Organisation', 'Organization', 'Firm Name', 'Trade Name', 'Legal Name', 'Print Name'],
      example: ['Acme Traders Pvt Ltd', ''],
    },
    {
      key: 'gstin', label: 'GSTIN', type: 'gstin',
      synonyms: ['GSTIN', 'GSTIN/UIN', 'GST No', 'GST Number', 'GST No.', 'GST Identification Number (GSTIN)', 'GST Identification Number', 'GSTIN Number', 'GST Registration No', 'Tax ID', 'GST', 'Party GSTIN', 'Customer GSTIN', 'GSTIN of Recipient', 'UIN'],
      example: ['27AAPFU0939F1ZV', ''],
    },
    {
      key: 'email', label: 'Email', type: 'email',
      synonyms: ['Email', 'Email ID', 'EmailID', 'E-mail', 'Email Address', 'Mail', 'Contact Email', 'Email Id'],
      example: ['accounts@acme.in', ''],
    },
    {
      key: 'phone', label: 'Phone', type: 'text',
      synonyms: ['Phone', 'Phone No', 'Phone No.', 'Phone Number', 'Mobile', 'Mobile No', 'Mobile Number', 'MobilePhone', 'Contact No', 'Contact No.', 'Contact Number', 'Telephone', 'Tel', 'WhatsApp'],
      example: ['9820012345', '022-24561234'],
    },
    {
      key: 'address', label: 'Address', type: 'text',
      synonyms: ['Address', 'Billing Address', 'Address Line 1', 'Address1', 'Address 1', 'Street', 'Street Address', 'Addr', 'Mailing Address', 'Billing Street'],
      example: ['12, MG Road', 'Shop 4, Lal Bazaar'],
    },
    {
      key: 'address2', label: 'Address line 2', type: 'text',
      synonyms: ['Address 2', 'Address Line 2', 'Address2', 'Street 2', 'Billing Address 2', 'Area', 'Locality', 'Landmark'],
      example: ['Andheri East', ''],
    },
    {
      key: 'city', label: 'City', type: 'text',
      synonyms: ['City', 'Town', 'Billing City', 'District', 'City/Town'],
      example: ['Mumbai', 'Kolkata'],
    },
    {
      key: 'state', label: 'State', type: 'state',
      hint: 'Name, 2-digit GST code or abbreviation (MH). Falls back to the GSTIN.',
      synonyms: ['State', 'State Name', 'Billing State', 'State/UT', 'Place of Supply', 'Province', 'State Code', 'Billing State Code'],
      example: ['Maharashtra', 'West Bengal'],
    },
    {
      key: 'zip', label: 'PIN code', type: 'text',
      synonyms: ['PIN', 'PIN Code', 'Pincode', 'Zip', 'Zip Code', 'Postal Code', 'Billing Code', 'Post Code'],
      example: ['400069', '700001'],
    },
    {
      key: 'notes', label: 'Notes', type: 'text',
      synonyms: ['Notes', 'Remarks', 'Note', 'Comments', 'Narration', 'Description'],
      example: ['', 'Pays on the 10th'],
    },
  ],

  items: [
    {
      key: 'name', label: 'Item name', type: 'text', required: true,
      synonyms: ['Item Name', 'Name', 'Item', 'Product Name', 'Product', 'Service', 'Service Name', 'Stock Item Name', 'Stock Item', 'Particulars', 'Item Description', 'Goods/Service', 'Product/Service Name'],
      example: ['Website design', 'A4 paper ream'],
    },
    {
      key: 'description', label: 'Description', type: 'text',
      synonyms: ['Description', 'Item Desc', 'Details', 'Item Details', 'Long Description', 'Narration'],
      example: ['5-page responsive site', ''],
    },
    {
      key: 'hsn', label: 'HSN / SAC', type: 'text',
      synonyms: ['HSN/SAC', 'HSN', 'SAC', 'HSN Code', 'SAC Code', 'HSN/SAC Code', 'HSN SAC', 'HSN Number', 'Tariff Code'],
      example: ['998314', '48025610'],
    },
    {
      key: 'unit', label: 'Unit', type: 'text',
      synonyms: ['Unit', 'UOM', 'Units', 'Usage Unit', 'Base Units', 'Unit of Measure', 'Primary Unit', 'Measurement'],
      example: ['NOS', 'PCS'],
    },
    {
      key: 'rate', label: 'Rate', type: 'number',
      synonyms: ['Rate', 'Selling Price', 'Sales Price', 'Sale Price', 'Price', 'Unit Price', 'S.Price', 'MRP', 'Item Price', 'Sales Rate', 'Selling Rate', 'Amount', 'Sales Rate (Rs)'],
      example: ['25000', '320.50'],
    },
    {
      key: 'tax_rate', label: 'GST %', type: 'percent',
      synonyms: ['GST %', 'GST Rate', 'Tax %', 'Tax Rate', 'Tax Percentage', 'GST', 'Item Tax %', 'Intra State Tax Rate', 'IGST %', 'Rate of GST', 'Tax', 'Tax Category', 'GST Percent'],
      example: ['18', '12'],
    },
    {
      key: 'type', label: 'Type', type: 'text',
      hint: 'Goods / Product or Service. Guessed from the HSN/SAC when blank.',
      synonyms: ['Type', 'Item Type', 'Product Type', 'Goods/Services', 'Category'],
      example: ['Service', 'Product'],
    },
  ],

  invoices: [
    {
      key: 'invoice_number', label: 'Invoice number', type: 'text', required: true,
      synonyms: ['Invoice Number', 'Invoice No', 'Invoice No.', 'Invoice #', 'Inv No', 'Inv. No.', 'Bill No', 'Bill No.', 'Voucher No', 'Voucher No.', 'Voucher Number', 'Vch/Bill No', 'Doc No', 'Document Number', 'Reference No', 'Number', 'Invoice ID', 'Vch No'],
      example: ['INV/FY24-25/0042', 'INV/FY24-25/0043'],
    },
    {
      key: 'issue_date', label: 'Invoice date', type: 'date', required: true,
      synonyms: ['Invoice Date', 'Date', 'Bill Date', 'Voucher Date', 'Issue Date', 'Doc Date', 'Transaction Date', 'Dated', 'Inv Date', 'Created Date'],
      example: ['15-03-2025', '2025-03-28'],
    },
    {
      key: 'due_date', label: 'Due date', type: 'date',
      synonyms: ['Due Date', 'Payment Due Date', 'Pay By', 'Due On', 'Payment Date'],
      example: ['14-04-2025', ''],
    },
    {
      key: 'client_name', label: 'Client name', type: 'text', required: true,
      synonyms: ['Customer Name', 'Party Name', 'Client Name', 'Client', 'Customer', 'Party', 'Particulars', 'Bill To', 'Billed To', 'Name', 'Account Name', 'Ledger Name', 'Buyer', 'Billing Name'],
      example: ['Acme Traders Pvt Ltd', 'Sharma & Sons'],
    },
    {
      key: 'client_gstin', label: 'Client GSTIN', type: 'gstin',
      synonyms: ['GSTIN', 'GSTIN/UIN', 'Party GSTIN', 'Customer GSTIN', 'GST Identification Number (GSTIN)', 'GST No', 'GST Number', 'GSTIN of Recipient', 'Client GSTIN', 'Buyer GSTIN'],
      example: ['27AAPFU0939F1ZV', ''],
    },
    {
      key: 'place_of_supply', label: 'Place of supply', type: 'state',
      hint: 'State name or 2-digit code. Falls back to the client GSTIN, then your own state.',
      synonyms: ['Place of Supply', 'POS', 'Supply State', 'State', 'State Name', 'Billing State', 'Shipping State', 'Place Of Supply (State)'],
      example: ['Maharashtra', '19'],
    },
    {
      key: 'taxable_value', label: 'Taxable value', type: 'number',
      synonyms: ['Taxable Value', 'Taxable Amount', 'Sub Total', 'Subtotal', 'Net Amount', 'Value', 'Amount Before Tax', 'Basic Amount', 'Basic Value', 'Taxable', 'Sub Total (BCY)'],
      example: ['50000', '12000'],
    },
    { key: 'cgst', label: 'CGST', type: 'number', synonyms: ['CGST', 'CGST Amount', 'Central Tax', 'CGST Amt', 'Central GST'], example: ['', '1080'] },
    { key: 'sgst', label: 'SGST', type: 'number', synonyms: ['SGST', 'SGST Amount', 'State Tax', 'SGST/UTGST', 'SGST Amt', 'State GST', 'UTGST'], example: ['', '1080'] },
    { key: 'igst', label: 'IGST', type: 'number', synonyms: ['IGST', 'IGST Amount', 'Integrated Tax', 'IGST Amt', 'Integrated GST'], example: ['9000', ''] },
    {
      key: 'tax_amount', label: 'Total tax', type: 'number',
      synonyms: ['Total Tax', 'Tax Amount', 'GST Amount', 'Tax', 'Total GST', 'Total Tax Amount', 'Tax Total', 'GST Total'],
      example: ['', ''],
    },
    {
      key: 'tax_rate', label: 'GST %', type: 'percent',
      synonyms: ['GST %', 'GST Rate', 'Tax %', 'Tax Rate', 'Tax Percentage', 'GST Percent'],
      example: ['', ''],
    },
    {
      key: 'total', label: 'Invoice total', type: 'number',
      synonyms: ['Total', 'Invoice Total', 'Grand Total', 'Total Amount', 'Gross Total', 'Bill Amount', 'Invoice Amount', 'Amount', 'Net Total', 'Total (INR)', 'Total Invoice Value', 'Invoice Value', 'Debit'],
      example: ['59000', '14160'],
    },
    {
      key: 'amount_paid', label: 'Amount received', type: 'number',
      synonyms: ['Amount Received', 'Received', 'Paid', 'Amount Paid', 'Received Amount', 'Paid Amount', 'Payment Received', 'Received/Paid', 'Credit'],
      example: ['0', '14160'],
    },
    {
      key: 'balance_due', label: 'Balance due', type: 'number',
      synonyms: ['Balance', 'Balance Due', 'Outstanding', 'Pending', 'Pending Amount', 'Due Amount', 'Amount Due', 'Balance Amount', 'Outstanding Amount', 'Closing Balance'],
      example: ['59000', '0'],
    },
    {
      key: 'status', label: 'Status', type: 'status',
      synonyms: ['Status', 'Invoice Status', 'Payment Status', 'Paid Status'],
      example: ['Unpaid', 'Paid'],
    },
    {
      key: 'po_number', label: 'PO number', type: 'text',
      synonyms: ['PO Number', 'PO No', 'PO No.', 'Purchase Order', 'Order No', 'Order Number', 'Reference'],
      example: ['', 'PO-7781'],
    },
    {
      key: 'notes', label: 'Notes', type: 'text',
      synonyms: ['Notes', 'Remarks', 'Narration', 'Customer Notes', 'Comments'],
      example: ['Opening balance import', ''],
    },
    {
      key: 'item_name', label: 'Line item name', type: 'text',
      hint: 'Optional. Rows sharing an invoice number are merged into one invoice with several lines.',
      synonyms: ['Item Name', 'Item', 'Product Name', 'Product', 'Item Description', 'Stock Item Name', 'Line Item'],
      example: ['', ''],
    },
    { key: 'item_qty', label: 'Line quantity', type: 'number', synonyms: ['Quantity', 'Qty', 'Item Quantity', 'Billed Qty', 'Qty.'], example: ['', ''] },
    { key: 'item_rate', label: 'Line rate', type: 'number', synonyms: ['Item Price', 'Unit Price', 'Rate', 'Item Rate', 'Price', 'Item Rate (Rs)'], example: ['', ''] },
    { key: 'item_hsn', label: 'Line HSN / SAC', type: 'text', synonyms: ['HSN/SAC', 'HSN', 'SAC', 'HSN Code', 'Item HSN'], example: ['', ''] },
    { key: 'item_tax_rate', label: 'Line GST %', type: 'percent', synonyms: ['Item Tax %', 'Item GST %', 'Line Tax %', 'Item Tax Rate'], example: ['', ''] },
    { key: 'item_unit', label: 'Line unit', type: 'text', synonyms: ['Usage unit', 'Item Unit', 'UOM', 'Unit'], example: ['', ''] },
  ],
};

export function fieldsFor(kind: ImportKind): FieldDef[] {
  return IMPORT_SCHEMAS[kind];
}

/** field key → source column index. Absent / -1 means "not mapped". */
export type ColumnMapping = Partial<Record<string, number>>;

export interface MappingGuess {
  mapping: ColumnMapping;
  /** 0..1 per mapped field. */
  confidence: Record<string, number>;
  presetId?: string;
}

/** Lower-case, drop everything that is not a letter/digit/% so "GST No." == "gst no". */
export function normalizeHeader(h: string): string {
  return (h ?? '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/%/g, ' pct ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(h: string): string[] {
  return normalizeHeader(h).split(' ').filter(Boolean);
}

export function scoreHeader(header: string, synonyms: string[]): number {
  const nh = normalizeHeader(header);
  if (!nh) return 0;
  const compact = nh.replace(/ /g, '');
  const ht = new Set(tokens(header));
  let best = 0;
  synonyms.forEach((syn, idx) => {
    const ns = normalizeHeader(syn);
    const sc = ns.replace(/ /g, '');
    // Earlier synonyms are the canonical ones; give them a hair more weight.
    const rank = Math.max(0, 0.04 - idx * 0.002);
    if (!ns) return;
    let s = 0;
    if (nh === ns || compact === sc) s = 0.92 + rank;
    else if (sc.length >= 5 && compact.length >= 5 && (compact.includes(sc) || sc.includes(compact))) {
      const ratio = Math.min(sc.length, compact.length) / Math.max(sc.length, compact.length);
      s = 0.5 + 0.3 * ratio;
    } else {
      const st = tokens(syn);
      const inter = st.filter((t) => ht.has(t)).length;
      const union = new Set([...st, ...ht]).size;
      if (inter > 0 && st.length > 1) s = 0.55 * (inter / union);
    }
    if (s > best) best = s;
  });
  return Math.min(best, 1);
}

const GSTIN_LOOSE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/i;
const DATE_LOOSE = /^(\d{1,2}[-/.\s][A-Za-z0-9]{1,9}[-/.\s,]+\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})/;

/** Nudge a score using what the column actually contains. */
function contentBoost(type: FieldType, samples: string[]): number {
  const vals = samples.filter((s) => s !== '');
  if (vals.length === 0) return 0;
  const share = (re: RegExp) => vals.filter((v) => re.test(v.trim())).length / vals.length;
  if (type === 'gstin') return share(GSTIN_LOOSE) > 0.5 ? 0.3 : -0.15;
  if (type === 'date') return share(DATE_LOOSE) > 0.5 ? 0.15 : -0.1;
  if (type === 'email') return share(/^[^@\s]+@[^@\s]+$/) > 0.5 ? 0.25 : -0.1;
  if (type === 'number') return share(/^[-+(₹\s]*(rs\.?\s*)?[\d,]+(\.\d+)?\)?\s*(cr|dr)?$/i) > 0.6 ? 0.04 : -0.2;
  return 0;
}

export interface ImportPreset {
  id: string;
  label: string;
  description: string;
  /** Exact header spellings the source tool uses, per kind and field. */
  headers: Partial<Record<ImportKind, Record<string, string[]>>>;
}

export const IMPORT_PRESETS: ImportPreset[] = [
  {
    id: 'generic',
    label: 'Generic / Excel',
    description: 'Any spreadsheet with a header row. Columns are matched by name.',
    headers: {},
  },
  {
    id: 'vyapar',
    label: 'Vyapar',
    description: 'Party, Item and Sale reports exported from Vyapar as Excel / CSV.',
    headers: {
      clients: {
        name: ['Party Name'], phone: ['Phone No.', 'Contact No.'], email: ['Email Id', 'Email'],
        address: ['Billing Address'], gstin: ['GSTIN'], state: ['State'],
      },
      items: {
        name: ['Item name'], hsn: ['HSN'], rate: ['Sale price'], unit: ['Unit', 'Base Unit'],
        tax_rate: ['Tax Rate', 'Tax rate'], description: ['Description'], type: ['Type'],
      },
      invoices: {
        invoice_number: ['Invoice No.', 'Invoice No'], issue_date: ['Date'], client_name: ['Party Name'],
        client_gstin: ['Party GSTIN', 'GSTIN'], total: ['Total'], amount_paid: ['Received', 'Received/Paid'],
        balance_due: ['Balance'], place_of_supply: ['Place of Supply', 'State Of Supply'],
      },
    },
  },
  {
    id: 'zoho',
    label: 'Zoho Books',
    description: 'Contacts, Items and Invoices export from Zoho Books (line items are merged per invoice).',
    headers: {
      clients: {
        name: ['Display Name'], company: ['Company Name'], email: ['EmailID'], phone: ['Phone', 'MobilePhone'],
        gstin: ['GST Identification Number (GSTIN)'], state: ['Billing State', 'Place of Supply'],
        address: ['Billing Address'], city: ['Billing City'], zip: ['Billing Code'],
      },
      items: {
        name: ['Item Name'], description: ['Description'], rate: ['Rate'], hsn: ['HSN/SAC'],
        unit: ['Usage unit'], tax_rate: ['Intra State Tax Rate', 'Tax Percentage'], type: ['Product Type'],
      },
      invoices: {
        invoice_number: ['Invoice Number'], issue_date: ['Invoice Date'], due_date: ['Due Date'],
        client_name: ['Customer Name'], client_gstin: ['GST Identification Number (GSTIN)'],
        place_of_supply: ['Place of Supply'], status: ['Invoice Status'], total: ['Total'],
        balance_due: ['Balance'], taxable_value: ['Sub Total'], item_name: ['Item Name'], item_qty: ['Quantity'],
        item_rate: ['Item Price'], item_hsn: ['HSN/SAC'], item_tax_rate: ['Item Tax %'], item_unit: ['Usage unit'],
        po_number: ['PurchaseOrder'],
      },
    },
  },
  {
    id: 'tally',
    label: 'Tally Prime / ERP 9',
    description: 'Ledger master, Stock Item and Sales Register CSV exports from Tally.',
    headers: {
      clients: {
        name: ['Ledger Name', 'Name', 'Particulars'], gstin: ['GSTIN/UIN', 'GST Registration Number'],
        state: ['State Name', 'State'], address: ['Address', 'Mailing Address'], zip: ['Pincode', 'PIN Code'],
        email: ['E-Mail', 'Email'], phone: ['Phone No.', 'Mobile No.'],
      },
      items: {
        name: ['Name', 'Stock Item Name'], hsn: ['HSN/SAC', 'HSN Code'], unit: ['Units', 'Base Units'],
        rate: ['Rate', 'Standard Selling Price'], tax_rate: ['GST Rate', 'Rate of Duty'],
      },
      invoices: {
        invoice_number: ['Voucher No.', 'Voucher No'], issue_date: ['Date'], client_name: ['Particulars'],
        client_gstin: ['GSTIN/UIN'], taxable_value: ['Value', 'Taxable Value'], total: ['Gross Total', 'Debit'],
        cgst: ['Central Tax', 'CGST'], sgst: ['State Tax', 'SGST/UTGST'], igst: ['Integrated Tax', 'IGST'],
      },
    },
  },
  {
    id: 'busy',
    label: 'Busy Accounting',
    description: 'Account, Item and Sales Bill list exports from BUSY.',
    headers: {
      clients: {
        name: ['Name', 'Account Name'], company: ['Print Name'], gstin: ['GSTIN', 'GST No'], address: ['Address1'],
        address2: ['Address2'], city: ['City'], state: ['State'], zip: ['Pincode'], phone: ['Mobile', 'Phone'],
        email: ['Email'],
      },
      items: {
        name: ['Item Name'], hsn: ['HSN Code', 'HSN'], unit: ['Unit', 'Main Unit'], rate: ['S.Price', 'Sale Price'],
        tax_rate: ['GST %', 'Tax Category'],
      },
      invoices: {
        invoice_number: ['Vch/Bill No', 'Bill No'], issue_date: ['Date'], client_name: ['Party', 'Party Name'],
        client_gstin: ['GSTIN'], taxable_value: ['Net Amount', 'Taxable Amount'], total: ['Bill Amount', 'Net Total'],
      },
    },
  },
];

export function presetById(id: string): ImportPreset | undefined {
  return IMPORT_PRESETS.find((p) => p.id === id);
}

/** Which preset's exact header spellings best fit these headers (>= 3 hits)? */
export function detectPreset(kind: ImportKind, headers: string[]): string | undefined {
  const norm = new Set(headers.map(normalizeHeader));
  let best: { id: string; hits: number } | undefined;
  for (const p of IMPORT_PRESETS) {
    const spec = p.headers[kind];
    if (!spec) continue;
    let hits = 0;
    for (const names of Object.values(spec)) {
      if (names.some((n) => norm.has(normalizeHeader(n)))) hits++;
    }
    // Generic-looking names are shared between tools, so demand a clear lead.
    if (hits >= 3 && (!best || hits > best.hits)) best = { id: p.id, hits };
  }
  return best?.id;
}

/**
 * Guess header → field. Every column is used at most once; the strongest
 * (field, column) pairs are assigned first. When `presetId` is given its exact
 * header spellings outrank the generic synonym list.
 */
export function guessMapping(
  kind: ImportKind,
  headers: string[],
  sampleRows: string[][] = [],
  presetId?: string,
): MappingGuess {
  const schema = IMPORT_SCHEMAS[kind];
  const preset = presetId ? presetById(presetId) : undefined;
  const presetHeaders = preset?.headers[kind] ?? {};
  const samples = sampleRows.slice(0, 25);

  const pairs: { field: FieldDef; col: number; score: number }[] = [];
  for (const field of schema) {
    const presetNames = presetHeaders[field.key] ?? [];
    headers.forEach((header, col) => {
      let score = scoreHeader(header, field.synonyms);
      if (presetNames.length) {
        const nh = normalizeHeader(header);
        if (presetNames.some((n) => normalizeHeader(n) === nh)) score = Math.max(score, 1);
      }
      if (score <= 0.3) return;
      score += contentBoost(field.type, samples.map((r) => r[col] ?? ''));
      score = Math.max(0, Math.min(score, 1));
      if (score >= 0.45) pairs.push({ field, col, score });
    });
  }
  // Required fields win ties so "Name" does not get stolen by an optional field.
  pairs.sort((a, b) => b.score - a.score || Number(!!b.field.required) - Number(!!a.field.required));

  const mapping: ColumnMapping = {};
  const confidence: Record<string, number> = {};
  const usedCols = new Set<number>();
  for (const p of pairs) {
    if (mapping[p.field.key] !== undefined || usedCols.has(p.col)) continue;
    mapping[p.field.key] = p.col;
    confidence[p.field.key] = Math.round(p.score * 100) / 100;
    usedCols.add(p.col);
  }
  return { mapping, confidence, presetId: presetId ?? detectPreset(kind, headers) };
}

/** Required fields still without a column. */
export function missingRequired(kind: ImportKind, mapping: ColumnMapping): FieldDef[] {
  return IMPORT_SCHEMAS[kind].filter((f) => {
    if (!f.required) return false;
    const c = mapping[f.key];
    return c === undefined || c < 0;
  });
}

/** Invoices need an amount from somewhere: a total, a taxable value or line items. */
export function invoiceAmountMapped(mapping: ColumnMapping): boolean {
  const has = (k: string) => (mapping[k] ?? -1) >= 0;
  return has('total') || has('taxable_value') || (has('item_name') && has('item_rate'));
}

/** Template headers + two sample rows for a blank-to-fill CSV. */
export function templateRows(kind: ImportKind): string[][] {
  const fields = IMPORT_SCHEMAS[kind].filter((f) => !f.key.startsWith('item_') || kind !== 'invoices');
  return [
    fields.map((f) => f.label),
    fields.map((f) => f.example[0]),
    fields.map((f) => f.example[1]),
  ];
}

export function templateFileName(kind: ImportKind): string {
  return `mrchartist-import-template-${kind}.csv`;
}
