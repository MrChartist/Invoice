/**
 * Printable gift-voucher slips (R4-B1): one card per voucher with the value, number, expiry and the code as a Code128
 * barcode (`barcode.ts`), in a script-free print window. Not a tax invoice — the sale of a voucher is not a supply
 * (Circular 243/37/2024-GST; verify with your CA).
 */
import type { GiftVoucher } from '../../types/stores-r4';
import { barcodeSvg } from '../../lib/barcode';
import { codeKey } from '../../lib/retail/gift-voucher-core';
import { esc, printHtmlDocument } from '../../lib/voucher-print';
import { downloadText } from '../../lib/download';
import { formatCurrency, formatDate } from '../../lib/utils';
import { PRINT_FONT, PRINT_FONT_FACE } from '../../lib/print-fonts';

const CSS = `
  body { font-family: ${PRINT_FONT}; color: #111; margin: 0; padding: 16px; }
  .s { width: 86mm; border: 1px dashed #333; border-radius: 6px; padding: 10px 12px; margin: 0 8px 10px 0; display: inline-block; vertical-align: top; break-inside: avoid; }
  .b { font-size: 12px; font-weight: 600; }
  .v { font-size: 24px; font-weight: 600; margin: 4px 0; }
  .m { font-size: 12px; color: #444; }
  svg { width: 100%; height: 46px; margin-top: 6px; }
  @media print { body { padding: 0; } }
`;

export function giftVoucherSlipHtml(vouchers: readonly GiftVoucher[], business: string): string {
  const card = (v: GiftVoucher) => `<div class="s"><div class="b">${esc(business || 'Gift voucher')}</div>
<div class="m">${v.promo ? 'Promotional voucher' : 'Gift voucher'} · ${esc(v.number)}</div>
<div class="v">${esc(formatCurrency(v.face_value))}</div>
<div class="m">Valid till ${esc(formatDate(v.expires_on))} · usable at any of our stores${v.promo ? ' · not exchangeable for cash' : ''}</div>
${barcodeSvg(codeKey(v.code), { height: 36, text: false })}
<div class="m" style="text-align:center;font-variant-numeric:tabular-nums;letter-spacing:0.08em;font-size:12px">${esc(v.code)}</div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Gift vouchers</title><style>${PRINT_FONT_FACE}${CSS}</style></head><body>${vouchers.map(card).join('\n')}</body></html>`;
}

export function printGiftVoucherSlips(vouchers: readonly GiftVoucher[], business: string): void {
  printHtmlDocument(giftVoucherSlipHtml(vouchers, business), (h) => downloadText(`gift-vouchers-${vouchers[0]?.number.replace(/[^\w-]+/g, '-') ?? 'slips'}.html`, h, 'text/html'));
}
