/**
 * "Client copy": one self-contained HTML file of a document that the client can open in any
 * browser, print, or pay from (a tappable upi:// link works on phones). It is static — no
 * scripts, no network — so it is safe to send and opens offline. The page body is the
 * rendered preview (already escaped by the DOM); everything added here is escaped.
 */

export interface ClientCopyPay {
  amountText: string;
  upiLink: string | null;
  upiId?: string;
  /** PNG data URL of the payment QR, if one was rendered. */
  qrDataUrl?: string;
}

export interface ClientCopyInput {
  title: string;
  /** Serialized document markup (outerHTML of the rendered paper). */
  paperHtml: string;
  /** App CSS needed by the paper markup. */
  css: string;
  business: string;
  pay?: ClientCopyPay | null;
  generatedOn: string;
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Only real UPI deep links and image data URLs may end up in attributes. */
const safeUpi = (u: string | null | undefined) => (u && /^upi:\/\/pay\?[^"'<>\s]+$/.test(u) ? u : null);
const safeImg = (u: string | undefined) => (u && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : null);

/** Strip anything executable from the serialized paper (defence in depth; the preview has none). */
export function sanitizePaper(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

export function buildClientCopyHtml(input: ClientCopyInput): string {
  const upi = safeUpi(input.pay?.upiLink);
  const qr = safeImg(input.pay?.qrDataUrl);
  const payPanel = input.pay
    ? `<section class="cc-pay" aria-label="Pay this invoice">
  <div><div class="cc-label">Amount due</div><div class="cc-amount">${esc(input.pay.amountText)}</div>
  ${input.pay.upiId ? `<div class="cc-label">UPI ID: <strong>${esc(input.pay.upiId)}</strong></div>` : ''}</div>
  ${upi ? `<a class="cc-btn" href="${esc(upi)}">Pay with UPI</a>` : ''}
  ${qr ? `<img class="cc-qr" src="${qr}" alt="UPI payment QR code" width="132" height="132">` : ''}
</section>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
<title>${esc(input.title)}</title>
<style>${input.css.replace(/<\/style/gi, '<\\/style')}</style>
<style>
  html, body { margin: 0; background: #e9e9ec; }
  .cc-wrap { max-width: 860px; margin: 0 auto; padding: 16px; }
  .cc-page { background: #fff; box-shadow: 0 2px 16px rgba(0,0,0,.12); overflow-x: auto; }
  .cc-pay { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; justify-content: space-between;
    background: #fff; border: 1px solid #d7d7dc; border-radius: 10px; padding: 14px 16px; margin-bottom: 14px;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; }
  .cc-label { font-size: 12px; color: #555; }
  .cc-amount { font-size: 26px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 2px 0 6px; }
  .cc-btn { display: inline-block; background: #1a4d94; color: #fff; text-decoration: none; font-weight: 700;
    padding: 12px 20px; border-radius: 8px; font-size: 16px; }
  .cc-foot { font: 12px system-ui, sans-serif; color: #666; text-align: center; margin: 12px 0 24px; }
  @media print { html, body { background: #fff; } .cc-wrap { padding: 0; max-width: none; } .cc-pay, .cc-foot { display: none; } .cc-page { box-shadow: none; } }
</style></head>
<body><main class="cc-wrap">
${payPanel}
<div class="cc-page">${sanitizePaper(input.paperHtml)}</div>
<p class="cc-foot">Sent by ${esc(input.business)} · generated ${esc(input.generatedOn)} · print this page for a paper copy</p>
</main></body></html>`;
}
