/** R21-C: dips, density, tank-lorry receipts, the stock register and licence due dates (shared pump words in `fuel-r21a`). */
import { defineArea } from '../area';

export const fcT = defineArea(
  {
    water: 'Water dip (mm)', stock: 'Stock', addDip: 'Save dip', densH: 'Density at 15 °C', addDens: 'Save density',
    rcpH: 'Tank-lorry receipt', bill: 'OMC bill', before: 'Dip before', after: 'Dip after', sold: 'Sold while decanting', invL: 'Invoice L', invD: 'Invoice density', obsD: 'Observed density', addRcp: 'Save receipt',
    chk: 'Morning checklist', chkOk: 'All done today.', 'm.dip': 'Tank {n}: no dip', 'm.test': 'Nozzle {n}: no 5-litre test', 'm.density': '{n}: no morning density',
    time: 'Time', where: 'Tank / nozzle', diff: 'Difference', flag: 'Density outside ± {t} kg/m³ (MDG hint).', short: 'Short by {l} L: suggest a debit note of ₹{a} to the oil company.', recv: '{i} L invoiced, {r} L received.',
    month: 'Month', open: 'Opening', receipts: 'Receipts', sales: 'Sales', book: 'Book', physical: 'Physical', pct: '%', mtd: 'Month', ytd: 'Year',
    band: 'MDG band: evaporation {r} % of {s} L = {e} L + 4 % of stock = {b} L.', out: 'Variation {v} L is outside the band (a hint).', in: 'Variation {v} L is within the band.',
    post: 'Post the month\'s loss / gain', posted: 'Posted as {n}.', engine: 'Stock summary: {q}.', noRows: 'No dips yet.',
    licH: 'Licences & due dates', ref: 'Licence no.', validTo: 'Valid to', addLic: 'Add licence', wm: 'W&M stamping, nozzle {n}', cal: 'Calibration, {n}', left: '{n} days',
    'lk.peso': 'PESO licence', 'lk.wm_du': 'W&M stamping', 'lk.fire': 'Fire NOC', 'lk.calibration': 'Tank calibration', 'lk.dealership': 'Dealership', 'lk.other': 'Licence',
  } as const,
  {
    water: 'पानी का डिप (mm)', stock: 'स्टॉक', addDip: 'डिप सहेजें', densH: '15 °C पर घनत्व', addDens: 'घनत्व सहेजें',
    rcpH: 'टैंक-लॉरी प्राप्ति', bill: 'तेल कंपनी का बिल', before: 'पहले का डिप', after: 'बाद का डिप', sold: 'उतारते समय बिक्री', invL: 'बिल L', invD: 'बिल घनत्व', obsD: 'मापा घनत्व', addRcp: 'प्राप्ति सहेजें',
    chk: 'सुबह की सूची', chkOk: 'आज सब हो गया।', 'm.dip': 'टैंक {n}: डिप नहीं', 'm.test': 'नोज़ल {n}: 5 लीटर टेस्ट नहीं', 'm.density': '{n}: सुबह का घनत्व नहीं',
    time: 'समय', where: 'टैंक / नोज़ल', diff: 'अंतर', flag: 'घनत्व ± {t} kg/m³ से बाहर (MDG संकेत)।', short: '{l} L कम: तेल कंपनी को ₹{a} का डेबिट नोट सुझाया।', recv: '{i} L बिल में, {r} L मिला।',
    month: 'महीना', open: 'आरंभिक', receipts: 'प्राप्ति', sales: 'बिक्री', book: 'बही', physical: 'वास्तविक', pct: '%', mtd: 'महीना', ytd: 'साल',
    band: 'MDG सीमा: वाष्पीकरण {r} % × {s} L = {e} L + स्टॉक का 4 % = {b} L।', out: 'अंतर {v} L सीमा से बाहर है (संकेत)।', in: 'अंतर {v} L सीमा के भीतर है।',
    post: 'महीने की कमी / बढ़त पोस्ट करें', posted: '{n} के रूप में पोस्ट हुआ।', engine: 'स्टॉक सारांश: {q}।', noRows: 'अभी कोई डिप नहीं।',
    licH: 'लाइसेंस और देय तिथियाँ', ref: 'लाइसेंस नं.', validTo: 'वैध तक', addLic: 'लाइसेंस जोड़ें', wm: 'माप-तौल मुहर, नोज़ल {n}', cal: 'कैलिब्रेशन, {n}', left: '{n} दिन',
    'lk.peso': 'PESO लाइसेंस', 'lk.wm_du': 'माप-तौल मुहर', 'lk.fire': 'फ़ायर NOC', 'lk.calibration': 'टैंक कैलिब्रेशन', 'lk.dealership': 'डीलरशिप', 'lk.other': 'लाइसेंस',
  },
);
