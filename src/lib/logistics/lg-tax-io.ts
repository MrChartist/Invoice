/**
 * R19-B2 bridge to the tax values that live outside the round (never copied into `logistics-rules.ts`): the R14
 * intermediary rule (`prof-rules.ts`, LG4), the R14 Sec 2(6) export check (`ps-export-check.ts`, LG3), the R5-B GTA
 * option and rate (`gta-option.ts` / `transport-works-rules.ts`, LG8) and the R4-C LUT register. It builds the regime
 * context of a job's client on a date. Working papers — verify with your CA.
 */
import type { Client, SenderProfile } from '../../types/invoice';
import type { GtaOptionRow } from '../../types/transport-works-r5';
import { peekTable } from '../storage';
import { getIndianFY } from '../invoice-number';
import { resolveStateCode } from '../india-states';
import { intermediaryPos } from '../prof-rules';
import { exportCheck } from '../prof/ps-export-check';
import { gtaRate } from '../transport-works-rules';
import { lutDb, pickLut } from '../trade/lut-register';
import type { RegimeCtx } from './lg-regime';

/** A client outside India: the app's "Other Country" / GSTN 96 / 97 State, or an R14 country that is not India. */
export const isForeignClient = (c: Partial<Client> | null | undefined): boolean => ['96', '97', '99'].includes(String(c?.state_code ?? '')) || (!!c?.ps?.country && !/^(in|ind|india|bharat)$/i.test(c.ps.country.trim()));

/** The regime context of billing `client` from `sender` on `date`. */
export function regimeCtx(date: string, client: Partial<Client>, sender: SenderProfile | null): RegimeCtx {
  const gstin = sender?.companyGstin?.trim() ?? '';
  const foreign = isForeignClient(client);
  const lut = pickLut(lutDb.peek(), date, gstin);
  const ok = foreign && !exportCheck({ invoice: { place_of_supply: '96', issue_date: date, sender }, client: client as Client, date }).items.some((i) => i.state === 'fail');
  return {
    date,
    sender: { state: resolveStateCode({ code: sender?.stateCode, gstin }), registered: !!gstin },
    recipient: { state: foreign ? '96' : resolveStateCode({ code: client.state_code, gstin: client.gstin, name: client.state }), registered: /^\d{2}[A-Z0-9]{13}$/i.test(client.gstin?.trim() ?? ''), foreign },
    inter: intermediaryPos(date),
    // The R5-B option of the FY (`gta_options`; no row = reverse charge), read here so the transport chunk is not split.
    gta: gtaRate(peekTable<GtaOptionRow>('gta_options').find((r) => r?.fy === getIndianFY(date).label)?.option ?? 'rcm', date).rate,
    exportOk: ok,
    lut: !!lut,
  };
}

/** The LUT in force on the date (ARN and filing date for the document), or null. */
export function lutOn(date: string, gstin?: string): { lut_number: string; lut_date: string } | null {
  const r = pickLut(lutDb.peek(), date, gstin);
  return r ? { lut_number: r.arn, lut_date: r.filed_on } : null;
}
