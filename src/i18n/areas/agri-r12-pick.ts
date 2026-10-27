/** R12 (AG-A1) agri picker strings (wizard card + Settings → Features "Agriculture profile"), apart from `agri-r12a.ts`. */
import { defineArea } from '../area';

export const agPickT = defineArea(
  {
    card: 'Farm, dairy & food processing', cardHint: 'FPOs, co-operatives, dairies, mills, cold storages, input dealers, farms.',
    title: 'Agriculture profile', lede: 'Pick what you do: it switches on your desks on Inventory (farmers, dairy, mill, cold storage, inputs, members). You can change it later in Settings → Features; nothing is deleted.',
    'kind.fpo': 'Farmer producer organisation / producer company', 'kind.coop': 'Co-operative society', 'kind.dairy': 'Dairy / milk collection centre', 'kind.mill': 'Rice / flour / dal / oil mill', 'kind.cold': 'Cold storage / agri warehouse', 'kind.inputs': 'Seed / fertiliser / pesticide dealer', 'kind.farm': 'Poultry / fishery / dairy farm / plantation', 'kind.other': 'Other (farmers and vouchers only)',
    'hint.fpo': 'Members and shares, aggregation, weekly cycles, input sales.', 'hint.coop': 'Members and shares, cycles, input sales.', 'hint.dairy': 'Fat / SNF charts, shifts, 10-day milk bills, dispatch.', 'hint.mill': 'Weighbridge, moisture cut, outturn, custom milling.', 'hint.cold': 'Lots, gate passes, rent per bag, loans against lots.', 'hint.inputs': 'Licences, subsidised fertiliser, credit till harvest.', 'hint.farm': 'Flock / pond / herd batches with FCR.', 'hint.other': 'Adds the Farm desk to what you have.',
    mill: 'What do you mill?', 'mill.rice': 'Rice', 'mill.flour': 'Flour', 'mill.dal': 'Dal', 'mill.oil': 'Oil', custom: 'Custom (keep packs as set)',
  } as const,
  {
    card: 'खेती, डेयरी और खाद्य प्रसंस्करण', cardHint: 'FPO, सहकारी, डेयरी, मिल, शीतगृह, खाद-बीज विक्रेता, फ़ार्म।',
    title: 'कृषि प्रोफ़ाइल', lede: 'आप क्या करते हैं चुनें: इससे इन्वेंटरी पर आपके डेस्क चालू होंगे (किसान, डेयरी, मिल, शीतगृह, खाद-बीज, सदस्य)। बाद में सेटिंग्स → फ़ीचर में बदल सकते हैं; कुछ नहीं हटता।',
    'kind.fpo': 'किसान उत्पादक संगठन / उत्पादक कंपनी', 'kind.coop': 'सहकारी समिति', 'kind.dairy': 'डेयरी / दूध संग्रह केंद्र', 'kind.mill': 'चावल / आटा / दाल / तेल मिल', 'kind.cold': 'शीतगृह / कृषि गोदाम', 'kind.inputs': 'बीज / खाद / कीटनाशक विक्रेता', 'kind.farm': 'मुर्गी / मछली / डेयरी फ़ार्म / बागान', 'kind.other': 'अन्य (केवल किसान और वाउचर)',
    'hint.fpo': 'सदस्य और अंश, एकत्रीकरण, साप्ताहिक चक्र, खाद-बीज बिक्री।', 'hint.coop': 'सदस्य और अंश, चक्र, खाद-बीज बिक्री।', 'hint.dairy': 'फैट / एसएनएफ दर तालिका, पाली, दस दिनी दूध बिल, डिस्पैच।', 'hint.mill': 'कांटा पर्ची, नमी कटौती, आउटटर्न, कस्टम मिलिंग।', 'hint.cold': 'लॉट, गेट पास, बोरी किराया, लॉट पर ऋण।', 'hint.inputs': 'लाइसेंस, सब्सिडी खाद, फ़सल तक उधार।', 'hint.farm': 'FCR के साथ फ़्लॉक / तालाब / झुंड बैच।', 'hint.other': 'जो है उसमें खेती डेस्क जोड़ता है।',
    mill: 'आप क्या पीसते हैं?', 'mill.rice': 'चावल', 'mill.flour': 'आटा', 'mill.dal': 'दाल', 'mill.oil': 'तेल', custom: 'कस्टम (पैक जैसे हैं वैसे रहें)',
  },
);
