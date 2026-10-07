import { createElement, Fragment, type ReactNode } from 'react';
import type { DocumentType } from '../../types/invoice';
import styles from './invoice-paper.module.css';

/** English label text — identical to what the original four layouts printed. */
const EN = {
  billTo: 'Bill to',
  preparedFor: 'Prepared for',
  issueDate: 'Issue date',
  quoteDate: 'Quote date',
  dueDate: 'Due date',
  validUntil: 'Valid until',
  poRef: 'PO / Ref',
  placeOfSupply: 'Place of supply',
  currency: 'Currency',
  reverseCharge: 'Reverse charge',
  document: 'Document',
  invoiceNo: 'Invoice no.',
  desc: 'Description',
  hsn: 'HSN/SAC',
  qty: 'Qty',
  rate: 'Rate',
  disc: 'Disc',
  taxable: 'Taxable',
  gst: 'GST',
  gstRate: 'GST rate',
  amount: 'Amount',
  subtotal: 'Subtotal',
  discount: 'Discount',
  cgst: 'CGST',
  sgst: 'SGST',
  igst: 'IGST',
  tax: 'Tax',
  shipping: 'Shipping',
  other: 'Other charges',
  roundOff: 'Round off',
  total: 'Total',
  balanceDue: 'Balance due',
  words: 'Amount in words',
  payDetails: 'Payment details',
  notes: 'Notes',
  terms: 'Terms',
  notesTerms: 'Notes & terms',
  signatory: 'Authorized signatory',
  scanToPay: 'Scan to pay',
  account: 'Account',
  acNo: 'A/C No',
  ifsc: 'IFSC',
  bank: 'Bank',
  upi: 'UPI',
} as const;

export type LabelKey = keyof typeof EN;

/** Hindi second line for the bilingual layout. */
const HI: Record<LabelKey, string> = {
  billTo: 'बिल प्राप्तकर्ता',
  preparedFor: 'प्रस्तुत',
  issueDate: 'जारी तिथि',
  quoteDate: 'कोटेशन तिथि',
  dueDate: 'देय तिथि',
  validUntil: 'मान्य तिथि',
  poRef: 'ऑर्डर संदर्भ',
  placeOfSupply: 'आपूर्ति स्थान',
  currency: 'मुद्रा',
  reverseCharge: 'रिवर्स चार्ज',
  document: 'दस्तावेज़',
  invoiceNo: 'चालान संख्या',
  desc: 'विवरण',
  hsn: 'एचएसएन/एसएसी',
  qty: 'मात्रा',
  rate: 'दर',
  disc: 'छूट',
  taxable: 'कर योग्य',
  gst: 'जीएसटी',
  gstRate: 'जीएसटी दर',
  amount: 'राशि',
  subtotal: 'उप-योग',
  discount: 'छूट',
  cgst: 'सीजीएसटी',
  sgst: 'एसजीएसटी',
  igst: 'आईजीएसटी',
  tax: 'कर',
  shipping: 'ढुलाई',
  other: 'अन्य शुल्क',
  roundOff: 'पूर्णांक',
  total: 'कुल',
  balanceDue: 'शेष देय',
  words: 'शब्दों में राशि',
  payDetails: 'भुगतान विवरण',
  notes: 'टिप्पणी',
  terms: 'शर्तें',
  notesTerms: 'नोट व शर्तें',
  signatory: 'अधिकृत हस्ताक्षरकर्ता',
  scanToPay: 'भुगतान हेतु स्कैन करें',
  account: 'खाता नाम',
  acNo: 'खाता संख्या',
  ifsc: 'आईएफएससी',
  bank: 'बैंक',
  upi: 'यूपीआई',
};

export const DOC_TITLE_HI: Record<DocumentType, string> = {
  INVOICE: 'चालान',
  TAX_INVOICE: 'कर चालान',
  QUOTATION: 'कोटेशन',
  PROFORMA: 'प्रोफार्मा चालान',
  CREDIT_NOTE: 'क्रेडिट नोट',
  DELIVERY_CHALLAN: 'डिलीवरी चालान',
};

export type Labeller = (key: LabelKey) => ReactNode;

/** Plain English, or English with a small Hindi line underneath. */
export function makeLabels(bilingual: boolean): Labeller {
  if (!bilingual) return (key) => EN[key];
  return (key) =>
    createElement(
      Fragment,
      null,
      EN[key],
      createElement('span', { className: styles.biSub, lang: 'hi' }, HI[key]),
    );
}
