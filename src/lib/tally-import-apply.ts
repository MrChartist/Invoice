/**
 * Applying a Tally import plan (WP-7, P0-7) through the WP-1 / ledger APIs, so every row is validated,
 * period-lock checked and audited exactly as if typed:
 *   groups → `saveUserGroup`; ledgers → `saveUserAccount` / `localDb.clients.upsert` / `vendorsDb.save`;
 *   openings → `saveBooksBegin` + `saveOpenings`; bill-wise → `saveOpeningBillsFor`;
 *   stock → `godownsDb.save` / `stockDb.saveItem`; cost centres → `saveCostCentre`;
 *   vouchers → `saveVoucher` (manual vouchers only — never invoices or bills).
 *
 * Owner only (`data.restore`): an import rewrites the books like a restore does. The screen takes the
 * safety snapshot (`saveSafetySnapshot('import')`) first, so the whole import can be undone in one step
 * (Settings → Data, or the import screen). If anything throws half-way the previous data is put back
 * at once (`restoreBackup` of the copy taken here), so a failed import never leaves half the books.
 */

import { requireAccess } from './access';
import { audit } from './audit';
import { restoreBackup } from './backup';
import { saveCostCentre, loadCostCentres } from './cost-centres';
import { godownsDb } from './godowns';
import { stockDb, type StockItem } from './inventory';
import { A, chartOf, loadUserAccounts, loadUserGroups, saveUserAccount } from './ledger/accounts';
import { clientPartyName, partyLedgerId, saveUserGroup } from './ledger/groups';
import { loadOpenings, saveBooksBegin, saveOpenings, storedBooksBegin, type OpeningEntry } from './ledger/openings';
import { loadVouchers, saveVoucher, type ManualVoucherLine } from './ledger/vouchers';
import { localDb } from './localDb';
import { saveOpeningBillsFor, type OpeningBillDraft } from './opening-bills';
import { getLockUntil } from './period-lock';
import { DB_PREFIX, SYNC_META_KEYS, collectAppData, generateId, getTable } from './storage';
import { DEVICE_LOCAL_KEYS } from './auth';
import { stateCodeOf, type ExistingBooks, type ImportPlan, type PlannedLedger } from './tally-import';
import { vendorsDb } from './vendors';
import { isValidGstin } from './gstin';
import type { Client } from '../types/invoice';

/** Snapshot of what the books already hold, for `planTallyImport` (reads storage, fail-soft). */
export function loadExistingBooks(): ExistingBooks {
  const safe = <T,>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  return {
    userGroups: safe(loadUserGroups, []),
    chart: safe(() => chartOf(loadUserAccounts()), chartOf()),
    clients: safe(() => localDb.clients.getAll(), []),
    vendors: safe(() => vendorsDb.all(), []),
    vouchers: safe(loadVouchers, []),
    openings: safe(loadOpenings, []),
    stockItems: safe(() => stockDb.items(), []),
    godowns: safe(() => godownsDb.stored(), []),
    costCentres: safe(loadCostCentres, []),
    lockUntil: safe(getLockUntil, ''),
  };
}

export interface ImportResult {
  groups: number;
  accounts: number;
  clients: number;
  vendors: number;
  openings: number;
  openingBills: number;
  stockItems: number;
  godowns: number;
  costCentres: number;
  vouchers: number;
  /** Rows the APIs refused (validation, lock): reported, the rest of the import stands. */
  failed: string[];
  /** Tally ledger name (lower case) → ledger id in this app (account id or party ledger id). */
  ledgerIds: Record<string, string>;
}

const lower = (s: string) => s.trim().toLowerCase();

function localBackupCopy(): Record<string, string> {
  const data = collectAppData();
  const leave = new Set<string>([...DEVICE_LOCAL_KEYS, ...SYNC_META_KEYS]);
  for (const k of Object.keys(data)) if (leave.has(k) || !k.startsWith(DB_PREFIX)) delete data[k];
  return data;
}

/**
 * Write the plan. Throws (after putting the previous data back) only on an unexpected failure;
 * individual refusals are listed in `failed`.
 */
export function applyTallyImport(plan: ImportPlan): ImportResult {
  requireAccess('data.restore');
  const before = localBackupCopy();
  const result: ImportResult = {
    groups: 0, accounts: 0, clients: 0, vendors: 0, openings: 0, openingBills: 0, stockItems: 0, godowns: 0, costCentres: 0, vouchers: 0,
    failed: [], ledgerIds: {},
  };
  const importId = generateId();
  audit.record({
    entity: 'system', entity_id: 'tally_import', action: 'import',
    summary: `Tally import started${plan.company ? ` (${plan.company})` : ''}: ${plan.ledgers.length} ledgers, ${plan.counts.vouchersOk} vouchers, books from ${plan.booksBegin}`,
    changes: [{ field: 'Import id', from: null, to: importId }],
  });
  try {
    run(plan, result);
  } catch (err) {
    restoreBackup(before);
    audit.record({
      entity: 'system', entity_id: 'tally_import', action: 'import',
      summary: `Tally import stopped and rolled back: ${(err as Error)?.message ?? String(err)}`,
      changes: [{ field: 'Import id', from: null, to: importId }],
    });
    throw err;
  }
  audit.record({
    entity: 'system', entity_id: 'tally_import', action: 'import',
    summary: `Tally import finished: ${result.groups} groups, ${result.accounts} ledgers, ${result.clients} clients, ${result.vendors} suppliers, ${result.openings} openings, ${result.vouchers} vouchers${result.failed.length ? `, ${result.failed.length} refused` : ''}`,
    changes: [
      { field: 'Import id', from: null, to: importId },
      { field: 'Vouchers', from: null, to: String(result.vouchers) },
      { field: 'Refused', from: null, to: String(result.failed.length) },
    ],
  });
  return result;
}

function run(plan: ImportPlan, result: ImportResult): void {
  /* 1. Groups, parents first (the plan lists them in that order). */
  const groupId = new Map<string, string>();
  for (const g of plan.groups) {
    if (g.existingId) {
      groupId.set(lower(g.name), g.existingId);
      continue;
    }
    const parent = g.parentIsPrimary ? g.parent : (groupId.get(lower(g.parent)) ?? g.primary);
    const row = saveUserGroup({ name: g.name, parent });
    groupId.set(lower(g.name), row.id);
    result.groups++;
  }

  /* 2. Ledgers. */
  const ids = result.ledgerIds;
  const partyName = new Map<string, string>();
  for (const l of plan.ledgers) {
    const key = lower(l.rec.name);
    const t = l.target;
    try {
      if (t.kind === 'account') {
        if (t.existing === true) ids[key] = t.accountId;
        else {
          const under = t.underGroup ? groupId.get(lower(t.underGroup)) : undefined;
          const row = saveUserAccount({ code: t.code, name: l.rec.name, group: under ?? t.group, ...(l.rec.alias ? { alias: l.rec.alias } : {}) });
          ids[key] = row.id;
          result.accounts++;
        }
      } else if (t.kind === 'client') {
        const id = t.existingId ?? createClient(l, t.groupName ? groupId.get(lower(t.groupName)) : undefined);
        if (!t.existingId) result.clients++;
        ids[key] = partyLedgerId('debtor', id);
        const c = localDb.clients.getById(id);
        partyName.set(key, c ? clientPartyName(c) : l.rec.name);
      } else {
        const id = t.existingId ?? createVendor(l, t.groupName ? groupId.get(lower(t.groupName)) : undefined);
        if (!t.existingId) result.vendors++;
        ids[key] = partyLedgerId('creditor', id);
        partyName.set(key, vendorsDb.get(id)?.name ?? l.rec.name);
      }
    } catch (err) {
      result.failed.push(`Ledger ${l.rec.name}: ${(err as Error).message}`);
    }
  }

  /* 3. Openings + bill-wise openings. */
  const hasOpenings = plan.ledgers.some((l) => l.rec.opening !== 0) || plan.stockOpening > 0;
  if (hasOpenings && plan.counts.openings > 0) {
    if (storedBooksBegin() !== plan.booksBegin) saveBooksBegin(plan.booksBegin);
    // Two Tally ledgers mapped onto one account (e.g. "CGST" and "Output CGST") add up.
    const byLedger = new Map<string, OpeningEntry>();
    const add = (ledger_id: string, amount: number, party_name?: string) => {
      const prev = byLedger.get(ledger_id);
      byLedger.set(ledger_id, { ledger_id, amount: (prev?.amount ?? 0) + amount, ...(party_name ? { party_name } : prev?.party_name ? { party_name: prev.party_name } : {}) });
    };
    for (const l of plan.ledgers) {
      const id = ids[lower(l.rec.name)];
      if (id && l.rec.opening) add(id, l.rec.opening, partyName.get(lower(l.rec.name)));
    }
    if (plan.stockOpening > 0) add(A.stock, plan.stockOpening);
    const entries = [...byLedger.values()].filter((e) => e.amount !== 0);
    saveOpenings(entries);
    result.openings = entries.length;
    for (const l of plan.ledgers) {
      if (!l.rec.bills.length || (l.target.kind !== 'client' && l.target.kind !== 'vendor')) continue;
      const id = ids[lower(l.rec.name)];
      if (!id) continue;
      const partyId = id.split(':').slice(2).join(':');
      const drafts: OpeningBillDraft[] = l.rec.bills.map((b) => ({
        ref_no: b.ref,
        date: b.date || plan.booksBegin,
        amount: Math.abs(b.paise) / 100,
        dr_cr: b.paise >= 0 ? 'Dr' : 'Cr',
        ...(b.creditDays ? { credit_days: b.creditDays } : {}),
      }));
      try {
        saveOpeningBillsFor({ id: partyId, name: partyName.get(lower(l.rec.name)) ?? l.rec.name, side: l.target.kind === 'client' ? 'receivable' : 'payable' }, drafts);
        result.openingBills += drafts.length;
      } catch (err) {
        result.failed.push(`Opening bills of ${l.rec.name}: ${(err as Error).message}`);
      }
    }
  }

  /* 4. Stock: godowns, items (opening quantity + rate). */
  for (const g of plan.godowns) {
    if (g.existingId) continue;
    try {
      godownsDb.save({ name: g.name });
      result.godowns++;
    } catch (err) {
      result.failed.push(`Godown ${g.name}: ${(err as Error).message}`);
    }
  }
  for (const s of plan.stock) {
    if (s.existingId) continue;
    const r = s.rec;
    const item: StockItem = {
      id: generateId(),
      name: r.name,
      unit: r.unit,
      track_stock: true,
      opening_qty: r.openingQty,
      opening_rate: r.openingQty > 0 ? Math.round(r.openingValue / r.openingQty) / 100 : 0,
      reorder_level: 0,
      ...(r.hsn ? { hsn: r.hsn } : {}),
      ...(r.gstRate !== undefined ? { tax_rate: r.gstRate } : {}),
      created_at: new Date().toISOString(),
    };
    stockDb.saveItem(item);
    result.stockItems++;
  }

  /* 5. Cost centres used by the vouchers. */
  const centreId = new Map<string, string>();
  for (const c of plan.costCentres) {
    if (c.existingId) centreId.set(lower(c.name), c.existingId);
    else {
      try {
        const row = saveCostCentre({ name: c.name, kind: 'project', active: true });
        centreId.set(lower(c.name), row.id);
        result.costCentres++;
      } catch (err) {
        result.failed.push(`Cost centre ${c.name}: ${(err as Error).message}`);
      }
    }
  }

  /* 6. Vouchers (manual vouchers; lock and validation by saveVoucher). */
  const chart = chartOf(loadUserAccounts());
  const byName = new Map(chart.map((a) => [lower(a.name), a.id]));
  const clients = getTable<Client>('clients');
  for (const v of plan.vouchers) {
    if (v.status !== 'ok') continue;
    try {
      const lines: ManualVoucherLine[] = v.lines.map((l) => {
        const key = lower(l.ledger);
        const lid = ids[key];
        let account = lid ?? byName.get(key);
        let party: string | undefined;
        if (lid?.startsWith('party:debtor:')) {
          account = A.debtors;
          party = partyName.get(key);
        } else if (lid?.startsWith('party:creditor:')) {
          account = A.creditors;
          party = partyName.get(key);
        } else if (!account) {
          const c = clients.find((x) => lower(clientPartyName(x)) === key || lower(x.name) === key);
          const vnd = vendorsDb.all().find((x) => lower(x.name) === key);
          if (c) {
            account = A.debtors;
            party = clientPartyName(c);
          } else if (vnd) {
            account = A.creditors;
            party = vnd.name;
          }
        }
        if (!account) throw new Error(`ledger ${l.ledger} is not in the books`);
        const cc = l.costCentre ? centreId.get(lower(l.costCentre)) : undefined;
        return { account_id: account, dr: l.dr, cr: l.cr, ...(party ? { party } : {}), ...(cc ? { cost_centre_id: cc } : {}) };
      });
      saveVoucher({
        type: v.type,
        date: v.rec.date,
        narration: v.narration,
        lines,
        ...(v.variant ? { variant: v.variant } : {}),
        ...(v.postDated ? { post_dated: true } : {}),
        voucher_class: 'Tally import',
      }, chart);
      result.vouchers++;
    } catch (err) {
      result.failed.push(`${v.rec.vtype} ${v.rec.number || ''} (${v.rec.date}): ${(err as Error).message}`);
    }
  }
}

/** A GSTIN that fails the check digit is left out (the plan says so); everything else is kept. */
const goodGstin = (g: string | undefined) => (g && isValidGstin(g) ? g : undefined);

function createClient(l: PlannedLedger, groupId: string | undefined): string {
  const r = { ...l.rec, gstin: goodGstin(l.rec.gstin) };
  const state = stateCodeOf(r);
  return localDb.clients.upsert({
    name: r.name,
    email: r.email ?? '',
    address: r.address ?? '',
    city: '',
    zip: r.pincode ?? '',
    ...(r.gstin ? { gstin: r.gstin } : {}),
    ...(state ? { state_code: state } : {}),
    ...(r.stateName ? { state: r.stateName } : {}),
    ...(r.phone ? { phone: r.phone } : {}),
    ...(r.pan ? { pan: r.pan } : {}),
    ...(r.creditDays ? { credit_days: r.creditDays } : {}),
    ...(groupId ? { group_id: groupId } : {}),
  });
}

function createVendor(l: PlannedLedger, groupId: string | undefined): string {
  const r = { ...l.rec, gstin: goodGstin(l.rec.gstin) };
  const state = stateCodeOf(r);
  return vendorsDb.save({
    name: r.name,
    ...(r.gstin ? { gstin: r.gstin } : {}),
    ...(state ? { state_code: state } : {}),
    ...(r.email ? { email: r.email } : {}),
    ...(r.phone ? { phone: r.phone } : {}),
    ...(r.address ? { address: r.address } : {}),
    ...(r.pan ? { pan: r.pan } : {}),
    ...(groupId ? { group_id: groupId } : {}),
  }).id;
}

/** After an import: Tally's opening per ledger vs what the books now hold (debit-positive paise). */
export interface OpeningCheckRow {
  ledger: string;
  tally: number;
  books: number;
}

export function openingCheck(plan: ImportPlan, ledgerIds: Record<string, string>): { rows: OpeningCheckRow[]; matches: boolean } {
  const books = new Map(loadOpenings().map((o) => [o.ledger_id, o.dr - o.cr]));
  const rows: OpeningCheckRow[] = [];
  const perLedger = new Map<string, number>();
  for (const l of plan.ledgers) {
    const id = ledgerIds[lower(l.rec.name)];
    if (id && l.rec.opening) perLedger.set(id, (perLedger.get(id) ?? 0) + l.rec.opening);
  }
  for (const l of plan.ledgers) {
    if (!l.rec.opening) continue;
    const id = ledgerIds[lower(l.rec.name)];
    rows.push({ ledger: l.rec.name, tally: l.rec.opening, books: id ? (books.get(id) ?? 0) : 0 });
  }
  if (plan.stockOpening) rows.push({ ledger: 'Stock-in-hand (stock items)', tally: plan.stockOpening, books: books.get(A.stock) ?? 0 });
  // Two Tally ledgers mapped onto one account: compare the account against their sum.
  const matches = rows.every((r) => {
    const l = plan.ledgers.find((x) => x.rec.name === r.ledger);
    const id = l ? ledgerIds[lower(l.rec.name)] : A.stock;
    const expected = l && id ? perLedger.get(id)! : r.tally;
    return r.books === expected;
  });
  return { rows, matches };
}
