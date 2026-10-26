import { createContext, useContext } from 'react';
import { currencySymbol, formatCurrency, formatDate, formatMoney } from '../../lib/utils';
import {
  activeArt,
  fontCss,
  formatDatePref,
  docTitleText,
  formatNumberPref,
  paperSize,
  type DesignPrefs,
  type LetterheadPrefs,
  type PaperKind,
  type PaperSize,
} from '../../lib/design-prefs';
import { makeLabels, type Labeller } from './labels';
import type { TemplateLayout } from './registry';
import type { DocumentType } from '../../types/invoice';

/**
 * Everything a part needs to know about the active design, resolved once by
 * TemplateEngine. With no `design` every flag is "legacy": the output is the
 * same as before design preferences existed.
 */
export interface PaperConfig {
  design: DesignPrefs | null;
  layout: TemplateLayout;
  paper: PaperKind;
  size: PaperSize;
  t: Labeller;
  bilingual: boolean;
  /** Grouped number, no symbol. */
  money: (amount: number, currency?: string) => string;
  /** Grouped number with the currency symbol. */
  currency: (amount: number, currency?: string) => string;
  date: (value: string | Date) => string;
  col: { hsn: boolean; unit: boolean; discount: boolean; taxRate: boolean; taxable: boolean };
  show: { qr: boolean; signature: boolean; bank: boolean; terms: boolean; words: boolean; place: boolean; tracking: boolean; partyBalance: boolean };
  logoSize: 's' | 'm' | 'l';
  logoPosition: 'auto' | 'left' | 'right' | 'center';
  headerNote: string;
  footerText: string;
  fontOverride?: string;
  /** R2-C5: printed title for a document type — the statutory title plus the design's suffix, if any. */
  title: (baseTitle: string, docType?: DocumentType) => string;
  /** R3-C2: print catalogue photos on item lines (design toggle; never the GST grid / thermal roll). */
  itemImages: boolean;
  /** R3-C3: letterhead / footer artwork to print (null without it, or on pre-printed stationery). */
  art: { letterhead?: LetterheadPrefs; footer?: string } | null;
}

export function buildPaperConfig(
  design: DesignPrefs | null | undefined,
  layout: TemplateLayout,
  bilingual: boolean,
): PaperConfig {
  const d = design ?? null;
  const international = d?.number_format === 'international';
  return {
    design: d,
    layout,
    paper: d?.paper ?? 'A4',
    size: paperSize(d),
    t: makeLabels(bilingual, d?.labels),
    bilingual,
    money: international
      ? (n, cur = 'INR') => formatNumberPref(n, cur, 'international')
      : (n, cur = 'INR') => formatMoney(n, cur),
    currency: international
      ? (n, cur = 'INR') => {
          const symbol = currencySymbol(cur) || `${(cur || 'INR').toUpperCase()} `;
          const body = formatNumberPref(Math.abs(n), cur, 'international');
          return `${n < 0 ? '-' : ''}${symbol}${body}`;
        }
      : (n, cur = 'INR') => formatCurrency(n, cur),
    date: d && d.date_format !== 'dd MMM yyyy' ? (v) => formatDatePref(v, d.date_format) : (v) => formatDate(v),
    col: {
      hsn: d ? d.show_columns.hsn : true,
      unit: d ? d.show_columns.unit : true,
      discount: d ? d.show_columns.discount : true,
      taxRate: d ? d.show_columns.tax_rate : true,
      taxable: d ? d.show_columns.taxable : true,
    },
    show: {
      qr: d ? d.show_qr : true,
      signature: d ? d.show_signature : true,
      bank: d ? d.show_bank : true,
      terms: d ? d.show_terms : true,
      words: d ? d.show_amount_in_words : true,
      place: d ? d.show_place_of_supply : true,
      tracking: d ? d.show_tracking !== false : true,
      // 8.5: off unless the design turns it on (legacy and no-design renders never print it).
      partyBalance: d?.show_party_balance === true,
    },
    logoSize: d?.logo_size ?? 'm',
    logoPosition: d?.logo_position ?? 'auto',
    headerNote: d?.header_note?.trim() ?? '',
    footerText: d?.footer_text?.trim() ?? '',
    fontOverride: fontCss(d?.font),
    title: (baseTitle, docType) => docTitleText(baseTitle, d, docType),
    itemImages: d?.show_item_images === true && layout !== 'gst' && layout !== 'receipt' && d.paper !== 'thermal80',
    art: activeArt(d),
  };
}

export const PaperContext = createContext<PaperConfig>(buildPaperConfig(null, 'classic', false));

export function usePaper(): PaperConfig {
  return useContext(PaperContext);
}
