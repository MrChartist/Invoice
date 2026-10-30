/** R21-A: the fuel desk's strings and the round's shared pump words (B–D add their own `fuel-r21b` … `fuel-r21d` areas). */
import { defineArea } from '../area';

export const fuT = defineArea(
  {
    'v.tanks': 'Tanks & nozzles', 'v.prices': 'Prices', 'v.shift': 'Shift', 'v.dsr': 'Daily sales', 'v.dips': 'Dips & density', 'v.stock': 'Stock register', 'v.credit': 'Credit slips', 'v.omc': 'OMC account', 'v.lpg': 'LPG', wp: 'Working papers: verify with your CA.',
    tank: 'Tank', product: 'Product', kind: 'Kind', capacity: 'Capacity', chart: 'Calibration chart: one "dip mm, litres" row per line (paste from a sheet)', calDue: 'Calibration due', addTank: 'Add tank', noTanks: 'No tanks yet.',
    nozzle: 'Nozzle', du: 'DU no.', nozzleNo: 'Nozzle no.', totaliser: 'Totaliser', wmDue: 'W&M stamping due', addNozzle: 'Add nozzle', del: 'Delete', saved: 'Saved.',
    price: 'Price (₹)', date: 'From date', time: 'Time (HH:MM)', addPrice: 'Add price', copy: 'Copy yesterday', copied: '{n} prices copied.', board: 'Prices now', excise: 'Excise / L', vat: 'VAT / L',
    amount: '₹', line: '{l} {u} @ ₹{rsp} (price of {at})', noPrice: 'No price for {name} at {at}: add it on Inventory → Fuel → Prices.', split: 'A buyer with a GSTIN: bill the fuel (Bill of Supply) and the other items (tax invoice) separately.',
    'p.ms': 'Petrol (MS)', 'p.hsd': 'Diesel (HSD)', 'p.ms_branded': 'Branded petrol', 'p.hsd_branded': 'Branded diesel', 'p.cng': 'CNG', 'p.auto_lpg': 'Auto LPG', 'p.lube': 'Lubricant', 'p.other': 'Other',
    litres: 'Litres', dip: 'Dip (mm)', shift: 'Shift', test: 'Testing', density: 'Density', meter: 'Meter reading', slip: 'Slip', variation: 'Variation', attendant: 'Attendant',
  } as const,
  {
    'v.tanks': 'टैंक और नोज़ल', 'v.prices': 'दरें', 'v.shift': 'शिफ्ट', 'v.dsr': 'दैनिक बिक्री', 'v.dips': 'डिप और घनत्व', 'v.stock': 'स्टॉक रजिस्टर', 'v.credit': 'उधार पर्चियाँ', 'v.omc': 'तेल कंपनी खाता', 'v.lpg': 'LPG', wp: 'कार्य-पत्र: अपने CA से जाँच कराएँ।',
    tank: 'टैंक', product: 'उत्पाद', kind: 'प्रकार', capacity: 'क्षमता', chart: 'कैलिब्रेशन चार्ट: हर पंक्ति में "डिप mm, लीटर" (शीट से चिपकाएँ)', calDue: 'कैलिब्रेशन देय', addTank: 'टैंक जोड़ें', noTanks: 'अभी कोई टैंक नहीं।',
    nozzle: 'नोज़ल', du: 'DU नं.', nozzleNo: 'नोज़ल नं.', totaliser: 'टोटलाइज़र', wmDue: 'माप-तौल मुहर देय', addNozzle: 'नोज़ल जोड़ें', del: 'हटाएँ', saved: 'सहेजा गया।',
    price: 'दर (₹)', date: 'तारीख़ से', time: 'समय (HH:MM)', addPrice: 'दर जोड़ें', copy: 'कल की दरें लें', copied: '{n} दरें कॉपी हुईं।', board: 'अभी की दरें', excise: 'उत्पाद शुल्क / L', vat: 'VAT / L',
    amount: '₹', line: '{l} {u} @ ₹{rsp} ({at} की दर)', noPrice: '{at} पर {name} की दर नहीं: इन्वेंटरी → ईंधन → दरें में जोड़ें।', split: 'GSTIN वाला ख़रीदार: ईंधन (बिल ऑफ़ सप्लाई) और बाकी सामान (टैक्स इनवॉइस) अलग-अलग बिल करें।',
    'p.ms': 'पेट्रोल (MS)', 'p.hsd': 'डीज़ल (HSD)', 'p.ms_branded': 'ब्रांडेड पेट्रोल', 'p.hsd_branded': 'ब्रांडेड डीज़ल', 'p.cng': 'CNG', 'p.auto_lpg': 'ऑटो LPG', 'p.lube': 'लुब्रिकेंट', 'p.other': 'अन्य',
    litres: 'लीटर', dip: 'डिप (mm)', shift: 'शिफ्ट', test: 'टेस्टिंग', density: 'घनत्व', meter: 'मीटर रीडिंग', slip: 'पर्ची', variation: 'अंतर', attendant: 'कर्मचारी',
  },
);
