/** Round 14 PS-C5 registration-threshold card (Time → Firm → Threshold, Dashboard for freelancers) — English and Hindi. Lazy. */
import { defineArea } from '../area';

export const thT = defineArea(
  {
    title: 'GST registration threshold',
    of: '{turnover} of {limit} this FY ({pct}%), exports {exports} included',
    ok: 'Below the threshold.',
    warn: 'Over {pct}%: plan the registration.',
    over: 'Above the threshold since {date}.',
    steps: 'Next: register for GST, file the LUT for exports, then issue tax invoices from the registration date.',
    notes: 'Taxable, exempt, export and inter-State supplies count, without tax; reverse-charge purchases do not (N 10/2017-IT, Sec 24: check). Verify with your CA (PS13).',
  } as const,
  {
    title: 'GST पंजीकरण सीमा',
    of: 'इस वर्ष {limit} में से {turnover} ({pct}%), निर्यात {exports} सहित',
    ok: 'सीमा से नीचे।',
    warn: '{pct}% पार: पंजीकरण की तैयारी करें।',
    over: '{date} से सीमा पार।',
    steps: 'आगे: GST पंजीकरण, निर्यात के लिए LUT, फिर पंजीकरण की तारीख से कर बीजक।',
    notes: 'कर-योग्य, छूट, निर्यात और अंतर-राज्यीय आपूर्ति, कर के बिना; रिवर्स चार्ज की खरीद नहीं (N 10/2017-IT, धारा 24 देखें)। अपने CA से जाँच लें (PS13)।',
  },
);
