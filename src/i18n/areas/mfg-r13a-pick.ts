/** R13 (MF-A1) manufacturing picker strings (wizard card + Settings → Features "Manufacturing profile"), apart from the desk strings. */
import { defineArea } from '../area';

export const mfPickT = defineArea(
  {
    card: 'Factory / manufacturing', cardHint: 'Job shops, garment units, moulders, presses, food units.',
    title: 'Manufacturing profile', lede: 'Pick what you make: it switches on your desks on Manufacturing (shop floor, and your trade\'s desk). You can change it later in Settings → Features; nothing is deleted.',
    'kind.engineering': 'Engineering / fabrication job shop', 'kind.textile': 'Textiles and garments', 'kind.plastics': 'Plastics and packaging', 'kind.printing': 'Printing press', 'kind.food': 'Food / FMCG unit', 'kind.other': 'Other factory (shop floor only)',
    'hint.engineering': 'Machining, sheet metal, fabrication, foundry, tool room.', 'hint.textile': 'Spinning, weaving, processing, garments, CMT.', 'hint.plastics': 'Moulding, extrusion, film, corrugated boxes.', 'hint.printing': 'Offset, digital, flexo, labels, cartons.', 'hint.food': 'Namkeen, bakery, sweets, spices, pickles.', 'hint.other': 'Work centres, routings and job cards.',
    sub: 'Which kind?', 'sub.drawing': 'To customer drawings', 'sub.catalogue': 'Own catalogue', 'sub.garments': 'Garments / made-ups', 'sub.yarn': 'Yarn / spinning', 'sub.fabric': 'Fabric (weaving / knitting)', 'sub.processing': 'Processing house',
    'sub.moulding': 'Moulding', 'sub.extrusion': 'Extrusion', 'sub.film': 'Film / laminates', 'sub.corrugation': 'Corrugated boxes',
    udyam: 'Udyam number (optional)', category: 'Category', 'cat.MICRO': 'Micro', 'cat.SMALL': 'Small', 'cat.MEDIUM': 'Medium', custom: 'Custom (keep packs as set)',
  } as const,
  {
    card: 'कारख़ाना / मैन्युफैक्चरिंग', cardHint: 'जॉब शॉप, गारमेंट इकाई, मोल्डर, प्रेस, खाद्य इकाई।',
    title: 'मैन्युफैक्चरिंग प्रोफ़ाइल', lede: 'आप क्या बनाते हैं चुनें: इससे मैन्युफैक्चरिंग पर आपके डेस्क चालू होंगे (शॉप फ़्लोर, और आपके काम का डेस्क)। बाद में सेटिंग्स → फ़ीचर में बदल सकते हैं; कुछ नहीं हटता।',
    'kind.engineering': 'इंजीनियरिंग / फ़ैब्रिकेशन जॉब शॉप', 'kind.textile': 'कपड़ा और गारमेंट', 'kind.plastics': 'प्लास्टिक और पैकेजिंग', 'kind.printing': 'छपाई प्रेस', 'kind.food': 'खाद्य / FMCG इकाई', 'kind.other': 'अन्य कारख़ाना (केवल शॉप फ़्लोर)',
    'hint.engineering': 'मशीनिंग, शीट मेटल, फ़ैब्रिकेशन, ढलाई, टूल रूम।', 'hint.textile': 'कताई, बुनाई, प्रोसेसिंग, गारमेंट, CMT।', 'hint.plastics': 'मोल्डिंग, एक्सट्रूज़न, फ़िल्म, कोरुगेटेड बॉक्स।', 'hint.printing': 'ऑफ़सेट, डिजिटल, फ़्लेक्सो, लेबल, कार्टन।', 'hint.food': 'नमकीन, बेकरी, मिठाई, मसाले, अचार।', 'hint.other': 'कार्य केंद्र, रूटिंग और जॉब कार्ड।',
    sub: 'किस तरह का?', 'sub.drawing': 'ग्राहक की ड्रॉइंग पर', 'sub.catalogue': 'अपना कैटलॉग', 'sub.garments': 'गारमेंट / मेड-अप', 'sub.yarn': 'धागा / कताई', 'sub.fabric': 'कपड़ा (बुनाई / निटिंग)', 'sub.processing': 'प्रोसेसिंग हाउस',
    'sub.moulding': 'मोल्डिंग', 'sub.extrusion': 'एक्सट्रूज़न', 'sub.film': 'फ़िल्म / लैमिनेट', 'sub.corrugation': 'कोरुगेटेड बॉक्स',
    udyam: 'उद्यम पंजीकरण नंबर (वैकल्पिक)', category: 'श्रेणी', 'cat.MICRO': 'सूक्ष्म', 'cat.SMALL': 'लघु', 'cat.MEDIUM': 'मध्यम', custom: 'कस्टम (पैक जैसे हैं वैसे रहें)',
  },
);
