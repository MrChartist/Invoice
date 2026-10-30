/**
 * Sales channels (R5-A2): one row per marketplace the seller sells on — its operator GSTINs (Sec 52 TCS
 * registrations), TAN (194-O), the operator as a party, the default / damaged godowns, the saved import mappings and
 * a settlement CLEARING account.
 *
 * The clearing account is an ordinary `bank_accounts` row with `clearing: true`, so it is its own ledger under Cash
 * & bank (`bank:<id>`): order receipts land there, the payout moves it to the real bank (`settlement-post.ts`), and a
 * fully posted settlement leaves it at 0.00. Clearing accounts are hidden from cheque printing, bulk e-payment and
 * BRS statement import (`pickableBankAccounts`).
 *
 * Every table this package owns is named here once. Pure helpers + small guarded stores (no DOM).
 */
import type { ChannelPlatform, SalesChannel } from '../../types/marketplace-r5';
import { checkEcoGstin } from '../eco';
import { isValidTan } from '../validators';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { bankAccountsDb, type BankAccount } from '../bank-accounts';
import { localDb } from '../localDb';
import { round2 } from '../invoice-calc';

export const CHANNELS_TABLE = 'sales_channels';
export const CHANNEL_SKUS_TABLE = 'channel_skus';
export const MARKETPLACE_IMPORTS_TABLE = 'marketplace_imports';
export const SETTLEMENTS_TABLE = 'settlements';
export const ECO_CREDITS_TABLE = 'eco_credits';
export const MARKETPLACE_RETURNS_TABLE = 'marketplace_returns';

/** Every R5-A table (registries, the "no pack, no read" test). */
export const MARKETPLACE_TABLES = [CHANNELS_TABLE, CHANNEL_SKUS_TABLE, MARKETPLACE_IMPORTS_TABLE, SETTLEMENTS_TABLE, ECO_CREDITS_TABLE, MARKETPLACE_RETURNS_TABLE] as const;

export const PLATFORMS: readonly ChannelPlatform[] = ['amazon', 'flipkart', 'meesho', 'other'];

/** Operator legal names offered when a channel is created (the user may type another). Verify against the fee invoice. */
export const OPERATOR_NAMES: Readonly<Record<ChannelPlatform, string>> = {
  amazon: 'Amazon Seller Services Pvt Ltd',
  flipkart: 'Flipkart Internet Pvt Ltd',
  meesho: 'Fashnear Technologies Pvt Ltd',
  other: '',
};

/** Default payout cycle (days after the order) before an order counts as unsettled — typed on the channel. */
export const DEFAULT_PAYOUT_CYCLE = 14;

export class ChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChannelError';
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isPlatform = (v: unknown): v is ChannelPlatform => typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v);

/** Tolerant read of one stored channel (unknown fields dropped). */
export function normalizeChannel(raw: unknown): SalesChannel | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  const gstins = Array.isArray(o.gstins)
    ? (o.gstins as unknown[]).flatMap((g) => {
      const r = g as Record<string, unknown> | null;
      const gstin = str(r?.gstin).toUpperCase();
      return gstin ? [{ state: str(r?.state) || gstin.slice(0, 2), gstin }] : [];
    })
    : [];
  return {
    ...(o as unknown as SalesChannel),
    id,
    name: str(o.name) || 'Channel',
    platform: isPlatform(o.platform) ? o.platform : 'other',
    gstins,
    party_id: str(o.party_id),
    clearing_bank_id: str(o.clearing_bank_id),
    active: o.active !== false,
  };
}

export function loadChannels(): SalesChannel[] {
  return peekTable<unknown>(CHANNELS_TABLE).flatMap((r) => normalizeChannel(r) ?? []);
}

export function channelById(id: string | undefined): SalesChannel | undefined {
  return id ? loadChannels().find((c) => c.id === id) : undefined;
}

/** Problems with a channel's operator GSTINs / TAN (empty = fine). Warnings (non-TCS GSTIN) are prefixed "Note:". */
export function validateChannel(c: Pick<SalesChannel, 'name' | 'gstins' | 'tan'>): { errors: string[]; notes: string[] } {
  const errors: string[] = [];
  const notes: string[] = [];
  if (!str(c.name)) errors.push('Give the channel a name.');
  const seen = new Set<string>();
  for (const g of c.gstins ?? []) {
    const chk = checkEcoGstin(g.gstin);
    if (!chk.valid) errors.push(`${g.gstin || '(blank)'}: ${chk.message}`);
    else if (!chk.tcsRegistration) notes.push(`${g.gstin}: place 14 is not "C", an operator's TCS registration usually has "C". Check the GSTIN on the operator's TCS statement.`);
    const st = g.gstin.slice(0, 2);
    if (seen.has(st)) errors.push(`Two operator GSTINs for state ${st}.`);
    seen.add(st);
  }
  if (c.tan && !isValidTan(c.tan.trim().toUpperCase())) errors.push(`${c.tan}: TAN must look like AAAA99999A.`);
  return { errors, notes };
}

/** The operator GSTIN for a ship-from state (falls back to the only / first GSTIN). */
export function operatorGstinFor(c: Pick<SalesChannel, 'gstins'>, stateCode: string | undefined): string {
  const st = str(stateCode);
  return c.gstins.find((g) => g.gstin.slice(0, 2) === st || g.state === st)?.gstin ?? c.gstins[0]?.gstin ?? '';
}

/** The channel's clearing bank account, created once ("<name> settlement clearing"); idempotent. */
export function ensureClearingAccount(channel: Pick<SalesChannel, 'name' | 'clearing_bank_id'>): BankAccount {
  const all = bankAccountsDb.all();
  const existing = channel.clearing_bank_id ? all.find((a) => a.id === channel.clearing_bank_id) : undefined;
  if (existing) return existing.clearing ? existing : bankAccountsDb.save({ ...existing, clearing: true });
  const name = `${str(channel.name) || 'Marketplace'} settlement clearing`;
  const byName = all.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (byName) return byName.clearing ? byName : bankAccountsDb.save({ ...byName, clearing: true });
  return bankAccountsDb.save({ id: generateId(), name, active: true, clearing: true });
}

/** The operator as a party (`clients` row), created by name once. */
export function ensureChannelParty(name: string, gstin?: string): string {
  const n = str(name);
  if (!n) throw new ChannelError('Give the operator (party) name.');
  const found = localDb.clients.getAll().find((c) => c.name?.trim().toLowerCase() === n.toLowerCase());
  if (found?.id) return found.id;
  return localDb.clients.upsert({ name: n, email: '', address: '', city: '', zip: '', ...(gstin ? { gstin, state_code: gstin.slice(0, 2) } : {}) });
}

export interface ChannelInput extends Partial<Omit<SalesChannel, 'id'>> {
  id?: string;
  name: string;
  platform: ChannelPlatform;
  /** Operator party name (created on save when new). */
  party_name?: string;
}

/** Create / update a channel: validates, creates the party and the clearing account once. All or nothing. */
export function saveChannel(input: ChannelInput): SalesChannel {
  requireAccess('master.edit');
  const gstins = (input.gstins ?? []).map((g) => ({ state: str(g.state) || str(g.gstin).slice(0, 2), gstin: str(g.gstin).toUpperCase() })).filter((g) => g.gstin);
  const tan = str(input.tan).toUpperCase() || undefined;
  const { errors } = validateChannel({ name: input.name, gstins, tan });
  if (errors.length) throw new ChannelError(errors[0]);
  const all = getTable<SalesChannel>(CHANNELS_TABLE);
  const prev = input.id ? all.find((c) => c.id === input.id) : undefined;
  if (all.some((c) => c.id !== prev?.id && str(c.name).toLowerCase() === str(input.name).toLowerCase())) throw new ChannelError('A channel with this name already exists.');
  return withTablesRollback([CHANNELS_TABLE, 'bank_accounts', 'clients'], () => {
    const party_id = (prev?.party_id && localDb.clients.getById(prev.party_id) ? prev.party_id : '') || ensureChannelParty(input.party_name || OPERATOR_NAMES[input.platform] || input.name, gstins[0]?.gstin);
    const clearing = ensureClearingAccount({ name: input.name, clearing_bank_id: prev?.clearing_bank_id ?? '' });
    const { party_name: _p, ...rest } = input;
    void _p;
    const cycle = Number(input.payout_cycle_days);
    const row: SalesChannel = {
      ...(prev ?? {}),
      ...rest,
      id: prev?.id ?? input.id ?? generateId(),
      name: str(input.name),
      platform: input.platform,
      gstins,
      ...(tan ? { tan } : { tan: undefined }),
      party_id,
      clearing_bank_id: clearing.id,
      eco_section: input.eco_section === 'PAY_9_5' ? 'PAY_9_5' : 'TCS_52',
      ...(Number.isFinite(cycle) && cycle > 0 ? { payout_cycle_days: Math.round(cycle) } : {}),
      active: input.active !== false,
      created_at: prev?.created_at ?? new Date().toISOString(),
    };
    setTable(CHANNELS_TABLE, prev ? all.map((c) => (c.id === row.id ? row : c)) : [...all, row]);
    return row;
  });
}

/** Patch stored channel fields (saved mappings, bucket rules) — a master edit. */
export function patchChannel(id: string, patch: Partial<SalesChannel>): SalesChannel {
  requireAccess('master.edit');
  const all = getTable<SalesChannel>(CHANNELS_TABLE);
  const prev = all.find((c) => c.id === id);
  if (!prev) throw new ChannelError('Channel not found.');
  const row = { ...prev, ...patch, id };
  setTable(CHANNELS_TABLE, all.map((c) => (c.id === id ? row : c)));
  return row;
}

/** Expected fee % for an item group (the channel-wide row has no `group_id`). */
export function expectedFeePct(c: Pick<SalesChannel, 'expected_fee_pct'>, groupId?: string): number | undefined {
  const rows = c.expected_fee_pct ?? [];
  const hit = (groupId ? rows.find((r) => r.group_id === groupId) : undefined) ?? rows.find((r) => !r.group_id);
  return hit && Number.isFinite(hit.pct) ? round2(hit.pct) : undefined;
}
