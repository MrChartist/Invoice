/**
 * Packing list (R2-C4): packages (type, L×B×H, tare, count, marks & numbers) for an invoice or delivery
 * challan, with line quantities assigned to packages, net weight from the item masters × quantity
 * (alternate units through `lineFactor`), gross = net + packaging + tare, and CBM.
 *
 * The packing list stores its own snapshot of the document lines; the invoice snapshot is never touched
 * (Critical Rule 3). Numbered `PKL/FY<yy-yy>/<seq>` through `series-counters.ts`.
 * Tables: `packing_lists` (numbered, dated) and `package_types` (master).
 */

import type { InvoiceItem, InvoiceRecord } from '../types/invoice';
import type { PackageType, PackingLine, PackingList, PackingPackage, WeightUnit } from '../types/books-r2';
import type { StockItem } from './inventory';
import { requireAccess } from './access';
import { audit } from './audit';
import { isoDay } from './dates';
import { round2 } from './invoice-calc';
import { nextSeriesNumberFor, numberFitsFy, recordSeries } from './series-counters';
import { generateId, getTable, setTable } from './storage';
import { lineFactor } from './units';

export const PACKING_TABLE = 'packing_lists';
export const PACKAGE_TYPES_TABLE = 'package_types';
export const PACKING_PREFIX = 'PKL';

/** Documents a packing list can be made from. */
export const PACKABLE_TYPES = new Set(['INVOICE', 'TAX_INVOICE', 'BILL_OF_SUPPLY', 'DELIVERY_CHALLAN']);

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const pos = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** A weight in its unit → kg. */
export function toKg(value: unknown, unit: WeightUnit | string | undefined): number {
  const n = pos(value);
  return unit === 'g' ? n / 1000 : n;
}

/* ── Weights from the masters ─────────────────────────────────── */

export interface ItemWeight {
  net_kg: number;
  gross_kg?: number;
}

type Weighed = { name?: string; aliases?: string[]; net_weight?: number; gross_weight?: number; weight_unit?: WeightUnit };

/** Name (lower-case) → weight of one base unit. Stock items first, then catalogue rows fill gaps. */
export function weightIndex(stockItems: readonly Weighed[], catalog: readonly Weighed[]): Map<string, ItemWeight> {
  const out = new Map<string, ItemWeight>();
  const add = (row: Weighed, name: string | undefined) => {
    const key = (name ?? '').trim().toLowerCase();
    if (!key || out.has(key)) return;
    const net = toKg(row.net_weight, row.weight_unit);
    const gross = toKg(row.gross_weight, row.weight_unit);
    if (!net && !gross) return;
    out.set(key, { net_kg: net || gross, ...(gross > net ? { gross_kg: gross } : {}) });
  };
  for (const s of stockItems) {
    add(s, s.name);
    for (const a of s.aliases ?? []) add(s, a);
  }
  for (const c of catalog) add(c, c.name);
  return out;
}

/** Snapshot the document lines that carry a quantity (free text / zero-quantity lines are left out). */
export function linesFromDocument(items: readonly InvoiceItem[], weights: ReadonlyMap<string, ItemWeight>): PackingLine[] {
  const out: PackingLine[] = [];
  items.forEach((it, i) => {
    const quantity = pos(it.quantity);
    if (!quantity || !(it.name ?? '').trim()) return;
    const w = weights.get(it.name.trim().toLowerCase());
    const factor = lineFactor(it);
    out.push({
      line_id: it.id || `line-${i + 1}`,
      name: it.name.trim(),
      ...(it.hsn ? { hsn: it.hsn } : {}),
      ...(it.unit ? { unit: it.unit } : {}),
      quantity,
      ...(factor !== 1 ? { unit_factor: factor } : {}),
      net_kg: r6(w?.net_kg ?? 0),
      ...(w?.gross_kg ? { gross_kg: r6(w.gross_kg) } : {}),
    });
  });
  return out;
}

/* ── Packages ─────────────────────────────────────────────────── */

export type AutoFill = 'per-line' | 'all-in-one';

export function blankPackage(fromNo: number, type?: PackageType): PackingPackage {
  return {
    id: generateId(),
    from_no: fromNo,
    count: 1,
    ...(type ? { type_id: type.id } : {}),
    type_name: type?.name ?? 'Box',
    length_cm: type?.length_cm ?? 0,
    breadth_cm: type?.breadth_cm ?? 0,
    height_cm: type?.height_cm ?? 0,
    tare_kg: type?.tare_kg ?? 0,
    contents: [],
  };
}

/** "One line per box" or "all in one" starting point; box numbers run on from 1. */
export function autoPackages(lines: readonly PackingLine[], mode: AutoFill, type?: PackageType, newId: () => string = generateId): PackingPackage[] {
  if (!lines.length) return [];
  if (mode === 'all-in-one') return [{ ...blankPackage(1, type), id: newId(), contents: lines.map((l) => ({ line_id: l.line_id, qty: l.quantity })) }];
  return lines.map((l, i) => ({ ...blankPackage(i + 1, type), id: newId(), contents: [{ line_id: l.line_id, qty: l.quantity }] }));
}

/** Box numbers re-run in order (1…n), each row taking `count` numbers. */
export function renumber(packages: readonly PackingPackage[]): PackingPackage[] {
  let next = 1;
  return packages.map((p) => {
    const count = Math.max(1, Math.floor(pos(p.count)) || 1);
    const row = { ...p, count, from_no: next };
    next += count;
    return row;
  });
}

export const boxRange = (p: Pick<PackingPackage, 'from_no' | 'count'>): string =>
  p.count > 1 ? `${p.from_no}–${p.from_no + p.count - 1}` : String(p.from_no);

/** Quantity of each line packed across all packages (count × qty per package). */
export function packedQty(packages: readonly PackingPackage[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of packages) for (const c of p.contents) m.set(c.line_id, r6((m.get(c.line_id) ?? 0) + pos(p.count) * pos(c.qty)));
  return m;
}

export interface PackageFigures {
  net_kg: number;
  gross_kg: number;
  cbm: number;
}

/** Figures for ONE package of a row. */
export function packageFigures(p: PackingPackage, lines: readonly PackingLine[]): PackageFigures {
  const byId = new Map(lines.map((l) => [l.line_id, l]));
  let net = 0;
  let packaging = 0;
  for (const c of p.contents) {
    const l = byId.get(c.line_id);
    if (!l) continue;
    const base = pos(c.qty) * (l.unit_factor && l.unit_factor > 0 ? l.unit_factor : 1);
    net += base * l.net_kg;
    if (l.gross_kg && l.gross_kg > l.net_kg) packaging += base * (l.gross_kg - l.net_kg);
  }
  const cbm = (pos(p.length_cm) * pos(p.breadth_cm) * pos(p.height_cm)) / 1e6;
  return { net_kg: r3(net), gross_kg: r3(net + packaging + pos(p.tare_kg)), cbm: r6(cbm) };
}

export interface PackingTotals extends PackageFigures {
  packages: number;
}

export function packingTotals(packages: readonly PackingPackage[], lines: readonly PackingLine[]): PackingTotals {
  const t = { packages: 0, net_kg: 0, gross_kg: 0, cbm: 0 };
  for (const p of packages) {
    const n = Math.max(1, Math.floor(pos(p.count)) || 1);
    const f = packageFigures(p, lines);
    t.packages += n;
    t.net_kg += n * f.net_kg;
    t.gross_kg += n * f.gross_kg;
    t.cbm += n * f.cbm;
  }
  return { packages: t.packages, net_kg: r3(t.net_kg), gross_kg: r3(t.gross_kg), cbm: r6(t.cbm) };
}

export interface PackingIssue {
  line_id?: string;
  message: string;
}

/** Every line packed exactly once (no shortfall, no excess), and no package left empty. */
export function validatePacking(lines: readonly PackingLine[], packages: readonly PackingPackage[]): PackingIssue[] {
  const issues: PackingIssue[] = [];
  if (!packages.length) issues.push({ message: 'Add at least one package.' });
  const packed = packedQty(packages);
  for (const l of lines) {
    const q = packed.get(l.line_id) ?? 0;
    const diff = r6(q - l.quantity);
    if (Math.abs(diff) > 1e-6) {
      issues.push({ line_id: l.line_id, message: diff < 0 ? `${l.name}: ${r6(-diff)} not packed yet` : `${l.name}: ${r6(diff)} packed more than the document` });
    }
  }
  const known = new Set(lines.map((l) => l.line_id));
  for (const p of packages) {
    if (!p.contents.some((c) => pos(c.qty) > 0)) issues.push({ message: `Package ${boxRange(p)} is empty.` });
    if (p.contents.some((c) => !known.has(c.line_id))) issues.push({ message: `Package ${boxRange(p)} holds a line that is not on the document.` });
  }
  return issues;
}

/* ── Storage ─────────────────────────────────────────────────── */

export function normalizePackageTypes(rows: unknown[]): PackageType[] {
  const out: PackageType[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.name !== 'string' || !o.name.trim()) continue;
    out.push({
      id: o.id,
      name: o.name.trim(),
      length_cm: round2(pos(o.length_cm)),
      breadth_cm: round2(pos(o.breadth_cm)),
      height_cm: round2(pos(o.height_cm)),
      tare_kg: r3(pos(o.tare_kg)),
      ...(typeof o.created_at === 'string' ? { created_at: o.created_at } : {}),
    });
  }
  return out;
}

export const packageTypesDb = {
  all: (): PackageType[] => normalizePackageTypes(getTable<unknown>(PACKAGE_TYPES_TABLE)),
  save(input: Omit<PackageType, 'id' | 'created_at'> & { id?: string }): PackageType {
    requireAccess('master.edit');
    const name = (input.name ?? '').trim();
    if (!name) throw new Error('Give the package type a name.');
    const all = packageTypesDb.all();
    if (all.some((t) => t.id !== input.id && t.name.toLowerCase() === name.toLowerCase())) throw new Error(`A package type called “${name}” already exists.`);
    const prev = input.id ? all.find((t) => t.id === input.id) : undefined;
    const row = normalizePackageTypes([{ ...input, name, id: prev?.id ?? generateId(), created_at: prev?.created_at ?? new Date().toISOString() }])[0];
    setTable(PACKAGE_TYPES_TABLE, prev ? all.map((t) => (t.id === row.id ? row : t)) : [...all, row]);
    return row;
  },
  remove(id: string): void {
    requireAccess('master.edit');
    setTable(PACKAGE_TYPES_TABLE, packageTypesDb.all().filter((t) => t.id !== id));
  },
};

export function loadPackingLists(): PackingList[] {
  return getTable<PackingList>(PACKING_TABLE).filter((r) => r && typeof r.id === 'string' && Array.isArray(r.packages) && Array.isArray(r.lines));
}

export function packingListsFor(sourceId: string, rows: readonly PackingList[] = loadPackingLists()): PackingList[] {
  return rows.filter((r) => r.source?.id === sourceId).sort((a, b) => a.number.localeCompare(b.number));
}

export function nextPackingNumber(date: string, rows: readonly PackingList[] = loadPackingLists()): string {
  return nextSeriesNumberFor(PACKING_PREFIX, date, rows.map((r) => r.number));
}

export class PackingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackingError';
  }
}

export type PackingInput = Omit<PackingList, 'id' | 'number' | 'created_at' | 'updated_at'> & { id?: string; number?: string };

/** Build the input for a new packing list from a saved document (snapshot of its lines and party). */
export function packingFromDocument(inv: InvoiceRecord, weights: ReadonlyMap<string, ItemWeight>, date: string): PackingInput {
  const ship = inv.ship_to;
  const shipText = ship ? [ship.name, ship.address, ship.city, ship.zip].filter(Boolean).join(', ') : '';
  return {
    date,
    source: { kind: inv.doc_type === 'DELIVERY_CHALLAN' ? 'challan' : 'invoice', id: inv.id, number: inv.invoice_number, doc_type: inv.doc_type },
    party: inv.client?.company || inv.client?.name || '',
    ...(shipText ? { ship_to: shipText } : {}),
    lines: linesFromDocument(inv.items ?? [], weights),
    packages: [],
  };
}

/** Save (create or update). Throws PackingError when a line is not packed exactly once. */
export function savePackingList(input: PackingInput): PackingList {
  requireAccess('doc.create');
  const date = isoDay(input.date);
  if (!date) throw new PackingError('Enter the packing list date.');
  if (!input.lines.length) throw new PackingError('The document has no lines with a quantity to pack.');
  const packages = renumber(input.packages.map((p) => ({ ...p, contents: p.contents.filter((c) => pos(c.qty) > 0) })));
  const issues = validatePacking(input.lines, packages);
  if (issues.length) throw new PackingError(issues[0].message);
  const all = loadPackingLists();
  const prev = input.id ? all.find((r) => r.id === input.id) : undefined;
  const others = all.filter((r) => r.id !== prev?.id);
  let number = (input.number ?? '').trim() || prev?.number || nextPackingNumber(date, others);
  if (!numberFitsFy(number, date)) number = nextPackingNumber(date, others);
  if (others.some((r) => r.number.toLowerCase() === number.toLowerCase())) throw new PackingError(`Packing list ${number} already exists.`);
  const now = new Date().toISOString();
  const row: PackingList = {
    id: prev?.id ?? generateId(),
    number,
    date,
    source: input.source,
    party: input.party,
    ...(input.ship_to ? { ship_to: input.ship_to } : {}),
    lines: input.lines.map((l) => ({ ...l })),
    packages,
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    created_at: prev?.created_at ?? now,
    ...(prev ? { updated_at: now } : {}),
  };
  setTable(PACKING_TABLE, prev ? all.map((r) => (r.id === row.id ? row : r)) : [...all, row]);
  recordSeries(number);
  const t = packingTotals(packages, row.lines);
  audit.record({
    entity: 'invoice',
    entity_id: row.id,
    parent_id: row.source.id,
    action: prev ? 'update' : 'create',
    doc_number: number,
    summary: `${prev ? 'Edited' : 'Created'} packing list ${number} for ${row.source.number}: ${t.packages} package(s), net ${t.net_kg} kg, gross ${t.gross_kg} kg`,
  });
  return row;
}

export function deletePackingList(id: string): void {
  requireAccess('doc.create');
  const all = loadPackingLists();
  const row = all.find((r) => r.id === id);
  if (!row) return;
  setTable(PACKING_TABLE, all.filter((r) => r.id !== id));
  audit.record({ entity: 'invoice', entity_id: id, parent_id: row.source.id, action: 'delete', doc_number: row.number, summary: `Deleted packing list ${row.number} (${row.source.number})` });
}

/** Read the masters once for a dialog. */
export function loadWeightIndex(): Map<string, ItemWeight> {
  return weightIndex(getTable<StockItem>('stock_items'), getTable<InvoiceItem>('items_catalog'));
}

/** Patch the weights on a catalogue row (used by the catalogue editor after its own save). */
export function setCatalogWeights(itemId: string, w: { net_weight?: number; gross_weight?: number; weight_unit?: WeightUnit }): void {
  const rows = getTable<InvoiceItem>('items_catalog');
  const idx = rows.findIndex((r) => r.id === itemId);
  if (idx < 0) return;
  const row: InvoiceItem = { ...rows[idx] };
  const net = pos(w.net_weight);
  const gross = pos(w.gross_weight);
  if (net) row.net_weight = r6(net);
  else delete row.net_weight;
  if (gross) row.gross_weight = r6(gross);
  else delete row.gross_weight;
  if ((net || gross) && w.weight_unit === 'g') row.weight_unit = 'g';
  else delete row.weight_unit;
  const same = rows[idx].net_weight === row.net_weight && rows[idx].gross_weight === row.gross_weight && rows[idx].weight_unit === row.weight_unit;
  if (same) return;
  setTable('items_catalog', rows.map((r, i) => (i === idx ? row : r)));
}

/** XLSX rows: header block, package rows, then line summary. */
export function packingSheetRows(pl: PackingList): (string | number)[][] {
  const t = packingTotals(pl.packages, pl.lines);
  const byId = new Map(pl.lines.map((l) => [l.line_id, l]));
  const rows: (string | number)[][] = [
    ['Packing list', pl.number, 'Date', pl.date, 'Against', pl.source.number],
    ['Consignee', pl.party, 'Ship to', pl.ship_to ?? ''],
    [],
    ['Box no.', 'Count', 'Package', 'L (cm)', 'B (cm)', 'H (cm)', 'Marks & numbers', 'Contents', 'Net kg (each)', 'Gross kg (each)', 'CBM (each)'],
  ];
  for (const p of pl.packages) {
    const f = packageFigures(p, pl.lines);
    const contents = p.contents.map((c) => `${byId.get(c.line_id)?.name ?? c.line_id} × ${c.qty}${byId.get(c.line_id)?.unit ? ` ${byId.get(c.line_id)?.unit}` : ''}`).join('; ');
    rows.push([boxRange(p), p.count, p.type_name, p.length_cm, p.breadth_cm, p.height_cm, p.marks ?? '', contents, f.net_kg, f.gross_kg, f.cbm]);
  }
  rows.push([], ['Total packages', t.packages, 'Net weight (kg)', t.net_kg, 'Gross weight (kg)', t.gross_kg, 'CBM', t.cbm]);
  return rows;
}
