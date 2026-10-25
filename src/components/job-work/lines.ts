import type { MfgContext } from '../manufacturing/context';
import type { JobWorkLine, JobWorkOrder, JobWorkReceiptKind, MaterialIn, MaterialOut, PrincipalMovement } from '../../types/job-work';
import type { Godown } from '../../types/stock';
import type { UnitMaster } from '../../lib/units';
import type { ChallanBalances } from '../../lib/job-work';
import { generateId } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';

export type JwGridLine = JobWorkLine & { kind?: JobWorkReceiptKind };

export const blankJwLine = (extra: Partial<JwGridLine> = {}): JwGridLine => ({ id: generateId(), item_id: '', qty: 1, ...extra });

/** Lines with an item and a quantity, numbers coerced. */
export const cleanJw = <T extends JwGridLine>(ls: T[]): T[] => ls.filter((l) => l.item_id && num(l.qty) > 0).map((l) => ({ ...l, qty: num(l.qty) }));

export const qtyText = (n: number) => String(Math.round((n + Number.EPSILON) * 1000) / 1000);

/** Everything the job-work panels read, loaded once per change by JobWorkTab. */
export interface JwData {
  ctx: MfgContext;
  orders: JobWorkOrder[];
  outs: MaterialOut[];
  ins: MaterialIn[];
  principal: PrincipalMovement[];
  balances: ChallanBalances;
  units: UnitMaster[];
  /** Our own godowns (not a job worker's). */
  ownGodowns: Godown[];
  jwGodowns: Godown[];
  parties: { id: string; name: string; gstin?: string; state_code?: string }[];
  clients: { id: string; name: string; gstin?: string; state_code?: string }[];
  today: string;
}

export interface PartyValue {
  party_name: string;
  vendor_id?: string;
  client_id?: string;
  party_gstin?: string;
  party_state_code?: string;
}
