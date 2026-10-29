/** R21-D: credit slips, Rule 42 for pumps (OMC account and LPG cut at the D cap) (shared pump words live in `fuel-r21a.ts`). */
import { defineArea } from '../area';

export const dT = defineArea(
  {
    r42: 'Pump duties left out of E and F: ₹{d} (excise + VAT on {l} L; {m} L without a typed build-up). Verify with your CA.', r42off: 'Pump duties left in E and F.', r42x: 'Fuel sales ₹{f} differ from GSTR-3B 3.1(e) non-GST ₹{g}.', leaveIn: 'Leave duties in (pumps)',
    day: 'Date', slipNo: 'Slip no.', customer: 'Customer', vehicle: 'Vehicle no.', driver: 'Driver', amount: 'Amount (₹)', addSlip: 'Add slip', through: 'Bill slips up to', bill: 'Bill slips', billed: '{n} bills issued.', unbilled: 'Unbilled slips: {n} · ₹{a}',
    limitL: 'Limit L / month', limitA: 'Limit ₹ / month', addVehicle: 'Add vehicle',
  } as const,
  {
    r42: 'E और F से पंप शुल्क हटाए: ₹{d} ({l} L पर उत्पाद शुल्क + VAT; {m} L बिना दर-विवरण)। अपने CA से जाँच कराएँ।', r42off: 'पंप शुल्क E और F में रखे गए।', r42x: 'ईंधन बिक्री ₹{f} GSTR-3B 3.1(e) गैर-GST ₹{g} से अलग है।', leaveIn: 'शुल्क शामिल रखें (पंप)',
    day: 'तारीख़', slipNo: 'पर्ची नं.', customer: 'ग्राहक', vehicle: 'गाड़ी नं.', driver: 'ड्राइवर', amount: 'राशि (₹)', addSlip: 'पर्ची जोड़ें', through: 'इस तारीख़ तक की पर्चियाँ', bill: 'पर्चियों का बिल बनाएँ', billed: '{n} बिल बने।', unbilled: 'बिना बिल पर्चियाँ: {n} · ₹{a}',
    limitL: 'सीमा L / माह', limitA: 'सीमा ₹ / माह', addVehicle: 'गाड़ी जोड़ें',
  },
);
