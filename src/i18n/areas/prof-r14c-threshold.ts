/** Round 14 PS-C5 registration-threshold card (Time → Firm → Threshold, Dashboard for freelancers) — English and Hindi. Lazy. */
import { defineArea } from '../area';

export const thT = defineArea(
  {
    title: 'GST registration threshold',
    of: '{turnover} of {limit} this year ({pct}%), exports {exports} included',
    ok: 'Below the threshold.',
    warn: 'Over {pct}% of the threshold — plan the registration.',
    over: 'Above the threshold since {date}: register.',
    steps: 'Next: 1. Apply for GST registration. 2. File the LUT for exports (Settings → Business → Export). 3. From the registration date issue tax invoices (add the GSTIN to the profile).',
    notes: 'Aggregate turnover counts taxable, exempt, export and inter-State supplies, without tax; purchases under reverse charge do not. Inter-State services below it need no registration (N 10/2017-IT). Check the compulsory cases in Sec 24 (e.g. supplies through an e-commerce operator). Verify with your CA (PS13).',
    unreg: 'Your documents print “Supplier not registered under GST”, carry no tax and stay out of GST returns; exports still reach the FEMA register.',
  } as const,
  {
    title: 'GST पंजीकरण सीमा',
    of: 'इस वर्ष {limit} में से {turnover} ({pct}%), निर्यात {exports} सहित',
    ok: 'सीमा से नीचे।',
    warn: 'सीमा का {pct}% पार — पंजीकरण की योजना बनाएँ।',
    over: '{date} से सीमा पार: पंजीकरण कराएँ।',
    steps: 'आगे: 1. GST पंजीकरण के लिए आवेदन करें। 2. निर्यात के लिए LUT दाखिल करें (सेटिंग्स → व्यवसाय → निर्यात)। 3. पंजीकरण की तारीख से कर बीजक जारी करें (प्रोफ़ाइल में GSTIN जोड़ें)।',
    notes: 'कुल टर्नओवर में कर-योग्य, छूट, निर्यात और अंतर-राज्यीय आपूर्ति, कर के बिना; रिवर्स चार्ज की खरीद नहीं। इससे कम अंतर-राज्यीय सेवाओं पर पंजीकरण ज़रूरी नहीं (N 10/2017-IT)। धारा 24 के अनिवार्य मामले देखें (जैसे ई-कॉमर्स ऑपरेटर के ज़रिए आपूर्ति)। अपने CA से जाँच लें (PS13)।',
    unreg: 'आपके दस्तावेज़ों पर “आपूर्तिकर्ता GST में पंजीकृत नहीं” छपता है, कर नहीं लगता और वे GST रिटर्न में नहीं जाते; निर्यात फिर भी FEMA रजिस्टर में जाता है।',
  },
);
