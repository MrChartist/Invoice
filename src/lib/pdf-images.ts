/**
 * Images embedded in a PDF (8.46): the e-invoice QR on a supplier's PDF is usually an image XObject (a JPEG, or
 * Flate-compressed gray / RGB / 1-bit pixels). This finds those images WITHOUT a PDF engine — no page rendering,
 * no new dependency: the file's image streams are read as they are, Flate is undone with the browser's own
 * `DecompressionStream`, PNG row predictors are reversed, and the pixels are handed back as RGBA for the
 * BarcodeDetector (`capture-browser.ts`). A QR drawn as vector paths, an encrypted PDF, an image inside a compressed
 * object stream or another filter (CCITT, JBIG2, JPX, LZW) is not found — the PDF is then kept as before.
 * Untrusted input: sizes are capped and every problem just skips that image. Pure except the decompressor.
 */

export type PdfImage =
  | { kind: 'jpeg'; bytes: Uint8Array; width: number; height: number }
  | { kind: 'pixels'; rgba: Uint8ClampedArray; width: number; height: number };

const MAX_PIXELS = 16_000_000;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Undo PNG predictors (Predictor ≥ 10): each row starts with its filter type. */
function unpredict(src: Uint8Array, rowBytes: number, rows: number, bpp: number): Uint8Array | null {
  const out = new Uint8Array(rowBytes * rows);
  for (let y = 0; y < rows; y++) {
    const s = y * (rowBytes + 1);
    if (s + rowBytes >= src.length + 1) return null;
    const type = src[s];
    for (let x = 0; x < rowBytes; x++) {
      const raw = src[s + 1 + x] ?? 0;
      const a = x >= bpp ? out[y * rowBytes + x - bpp] : 0;
      const b = y ? out[(y - 1) * rowBytes + x] : 0;
      const c = x >= bpp && y ? out[(y - 1) * rowBytes + x - bpp] : 0;
      let p = 0;
      if (type === 1) p = a;
      else if (type === 2) p = b;
      else if (type === 3) p = (a + b) >> 1;
      else if (type === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * rowBytes + x] = (raw + p) & 255;
    }
  }
  return out;
}

const num = (dict: string, key: string): number => {
  const m = new RegExp(`/${key}\\s+(\\d+)(?!\\s+\\d+\\s+R)`).exec(dict);
  return m ? Number(m[1]) : NaN;
};

/** Image XObjects of a PDF (at most `max`), in file order. Never throws. */
export async function pdfImages(pdf: Uint8Array, max = 12, minSide = 21): Promise<PdfImage[]> {
  // A one-byte-per-char string keeps byte offsets (TextDecoder 'latin1' is windows-1252 and would not).
  let text = '';
  for (let i = 0; i < pdf.length; i += 0x8000) text += String.fromCharCode(...pdf.subarray(i, i + 0x8000));
  const out: PdfImage[] = [];
  const re = /<<((?:[^<>]|<<(?:[^<>]|<<[^<>]*>>)*>>)*)>>\s*stream\r?\n/g;
  for (let m = re.exec(text); m && out.length < max; m = re.exec(text)) {
    const dict = m[1];
    if (!/\/Subtype\s*\/Image\b/.test(dict)) continue;
    const start = m.index + m[0].length;
    let len = num(dict, 'Length');
    if (!(len > 0) || text.slice(start + len, start + len + 12).search(/^\s*endstream/) < 0) {
      const end = text.indexOf('endstream', start);
      if (end < 0) continue;
      len = end - start;
      while (len > 0 && (text[start + len - 1] === '\n' || text[start + len - 1] === '\r')) len--;
    }
    const data = pdf.subarray(start, start + len);
    const w = num(dict, 'Width');
    const h = num(dict, 'Height');
    if (!(w >= minSide && h >= minSide) || w * h > MAX_PIXELS) continue;
    const filters = (/\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(dict)?.[1] ?? '').match(/\/\w+/g) ?? [];
    try {
      if (filters.length === 1 && filters[0] === '/DCTDecode') {
        out.push({ kind: 'jpeg', bytes: data.slice(), width: w, height: h });
        continue;
      }
      if (filters.length > 1 || (filters.length === 1 && filters[0] !== '/FlateDecode')) continue;
      let raw = filters.length ? await inflate(data) : data;
      const mask = /\/ImageMask\s+true/.test(dict);
      const bpc = mask ? 1 : num(dict, 'BitsPerComponent');
      if (bpc !== 1 && bpc !== 8) continue;
      const pred = num(dict, 'Predictor');
      const per = pred >= 10 ? raw.length / h - 1 : raw.length / h;
      const comps = mask ? 1 : /\/DeviceGray/.test(dict) ? 1 : /\/DeviceRGB/.test(dict) ? 3 : Math.round((per * 8) / bpc / w);
      if (comps !== 1 && comps !== 3) continue;
      const rowBytes = Math.ceil((w * comps * bpc) / 8);
      if (pred >= 10) {
        const un = unpredict(raw, rowBytes, h, Math.max(1, (comps * bpc) >> 3));
        if (!un) continue;
        raw = un;
      }
      if (raw.length < rowBytes * h) continue;
      const invert = /\/Decode\s*\[\s*1(?:\.0)?\s+0/.test(dict);
      const rgba = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          if (bpc === 1) {
            const bit = (raw[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
            const v = (bit ^ (invert ? 1 : 0)) ? 255 : 0;
            rgba[o] = rgba[o + 1] = rgba[o + 2] = v;
          } else if (comps === 1) {
            const v = raw[y * rowBytes + x];
            rgba[o] = rgba[o + 1] = rgba[o + 2] = invert ? 255 - v : v;
          } else {
            const i = y * rowBytes + x * 3;
            rgba[o] = raw[i];
            rgba[o + 1] = raw[i + 1];
            rgba[o + 2] = raw[i + 2];
          }
          rgba[o + 3] = 255;
        }
      }
      out.push({ kind: 'pixels', rgba, width: w, height: h });
    } catch {
      /* a broken stream: skip this image */
    }
  }
  return out;
}
