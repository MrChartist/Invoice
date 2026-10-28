/** RT-A1 shop picker strings (wizard + Settings → Features), apart from `retail-r9a.ts` so those screens stay small. */
import { defineArea } from '../area';

export const pickT = defineArea(
  {
    retailTitle: 'Your shop', retailLede: 'Pick what you sell: it switches on the right tabs and checks. You can change it later in Settings → Features.',
    'kind.grocery': 'Grocery / supermarket', 'kind.pharmacy': 'Medical store / pharmacy', 'kind.apparel': 'Garments / footwear / textiles', 'kind.electronics': 'Electronics / mobiles', 'kind.jewellery': 'Jewellery', 'kind.general': 'Other retail',
    'hint.grocery': 'Loose goods, scale labels, MRP check, delivery, short book.', 'hint.pharmacy': 'Prescriptions, doctors, expiry and MRP blocks, H1 / X registers.', 'hint.apparel': 'GST by price per piece, size × colour grid, alterations.', 'hint.electronics': 'IMEI at the counter, EMI, buy-back, repairs.', 'hint.jewellery': 'Metal rates, tags with HUID, old gold, karigar.', 'hint.general': 'Quick bills, stock and the MRP check.',
    custom: 'Custom (keep packs as set)',
  } as const,
  {
    retailTitle: 'आपकी दुकान', retailLede: 'आप क्या बेचते हैं चुनें: इससे सही टैब और जाँच चालू होंगी। बाद में सेटिंग्स → फ़ीचर में बदल सकते हैं।',
    'kind.grocery': 'किराना / सुपरमार्केट', 'kind.pharmacy': 'मेडिकल स्टोर / फ़ार्मेसी', 'kind.apparel': 'कपड़े / जूते / टेक्सटाइल', 'kind.electronics': 'इलेक्ट्रॉनिक्स / मोबाइल', 'kind.jewellery': 'ज्वेलरी', 'kind.general': 'अन्य रिटेल',
    'hint.grocery': 'खुला सामान, तराज़ू लेबल, MRP जाँच, डिलीवरी, शॉर्ट बुक।', 'hint.pharmacy': 'दवा पर्ची, डॉक्टर, एक्सपायरी व MRP रोक, H1 / X रजिस्टर।', 'hint.apparel': 'प्रति पीस कीमत से GST, साइज़ × रंग ग्रिड, आल्टरेशन।', 'hint.electronics': 'काउंटर पर IMEI, EMI, बाय-बैक, रिपेयर।', 'hint.jewellery': 'धातु रेट, HUID टैग, पुराना सोना, कारीगर।', 'hint.general': 'झटपट बिल, स्टॉक और MRP जाँच।',
    custom: 'कस्टम (पैक जैसे हैं वैसे रहें)',
  },
);

