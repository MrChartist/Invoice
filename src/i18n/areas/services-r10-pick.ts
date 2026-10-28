/** R10 (SV-A1) service picker strings (wizard + Settings → Features), apart from `services-r10a.ts` so those screens stay small. */
import { defineArea } from '../area';

export const svPickT = defineArea(
  {
    title: 'Your kind of service', lede: 'Pick what you do: it switches on your desk (appointments, staff, members or job cards) and the right tax classes. You can change it later in Settings → Features.',
    'kind.clinic': 'Clinic / doctor / dentist / physiotherapy', 'kind.lab': 'Diagnostic lab / imaging centre', 'kind.salon': 'Salon / spa / beauty parlour', 'kind.fitness': 'Gym / fitness / yoga / dance studio', 'kind.coaching': 'Coaching / tuition / training institute', 'kind.workshop': 'Vehicle workshop / garage', 'kind.appliance': 'AC / appliance service centre', 'kind.professional': 'Professional services (CA, consultant, agency, freelancer)', 'kind.other': 'Other services', 'kind.travel': 'Travel, tours and events', 'kind.manpower': 'Security, housekeeping and manpower supply',
    'hint.clinic': 'Appointments, OPD tokens, exempt consultations, rate list.', 'hint.lab': 'Tests, orders and reports, referrals.', 'hint.salon': 'Appointment book, stylist per line, commission, 5% without ITC.', 'hint.fitness': 'Memberships, check-in, classes, 5% without ITC.', 'hint.coaching': 'Batches, attendance, fees and refunds.', 'hint.workshop': 'Job cards, estimates, parts and labour, insurance claims.', 'hint.appliance': 'Job cards, site visits, AMC.', 'hint.professional': 'Timesheets, retainers, recurring — as today.', 'hint.other': 'Invoices and a counter.', 'hint.travel': 'Trips, bookings, tour GST regimes.', 'hint.manpower': 'Sites, posts, duties, RCM on guards.',
    pharmacy: 'Do you sell medicines from the clinic?', custom: 'Custom (keep packs as set)',
  } as const,
  {
    title: 'आपकी सेवा का प्रकार', lede: 'आप क्या करते हैं चुनें: इससे आपका डेस्क (अपॉइंटमेंट, स्टाफ, सदस्य या जॉब कार्ड) और सही कर वर्ग चालू होंगे। बाद में सेटिंग्स → फ़ीचर में बदल सकते हैं।',
    'kind.clinic': 'क्लिनिक / डॉक्टर / डेंटिस्ट / फ़िज़ियोथेरेपी', 'kind.lab': 'डायग्नोस्टिक लैब / इमेजिंग सेंटर', 'kind.salon': 'सैलून / स्पा / ब्यूटी पार्लर', 'kind.fitness': 'जिम / फ़िटनेस / योग / डांस स्टूडियो', 'kind.coaching': 'कोचिंग / ट्यूशन / ट्रेनिंग संस्थान', 'kind.workshop': 'वाहन वर्कशॉप / गैराज', 'kind.appliance': 'AC / उपकरण सर्विस सेंटर', 'kind.professional': 'पेशेवर सेवाएँ (CA, सलाहकार, एजेंसी, फ़्रीलांसर)', 'kind.other': 'अन्य सेवाएँ', 'kind.travel': 'यात्रा, टूर और इवेंट', 'kind.manpower': 'सुरक्षा, हाउसकीपिंग और मानव-शक्ति आपूर्ति',
    'hint.clinic': 'अपॉइंटमेंट, OPD टोकन, छूट वाला परामर्श, रेट सूची।', 'hint.lab': 'जाँच, ऑर्डर और रिपोर्ट, रेफ़रल।', 'hint.salon': 'अपॉइंटमेंट बुक, हर पंक्ति पर स्टाइलिस्ट, कमीशन, 5% बिना ITC।', 'hint.fitness': 'सदस्यता, चेक-इन, क्लास, 5% बिना ITC।', 'hint.coaching': 'बैच, हाज़िरी, फ़ीस और रिफ़ंड।', 'hint.workshop': 'जॉब कार्ड, एस्टिमेट, पुर्ज़े और लेबर, बीमा क्लेम।', 'hint.appliance': 'जॉब कार्ड, साइट विज़िट, AMC।', 'hint.professional': 'टाइमशीट, रिटेनर, आवर्ती बिल — पहले जैसा।', 'hint.other': 'इनवॉइस और काउंटर।', 'hint.travel': 'यात्रा फ़ाइल, बुकिंग, टूर GST व्यवस्था।', 'hint.manpower': 'साइट, पोस्ट, ड्यूटी, गार्ड सेवा पर RCM।',
    pharmacy: 'क्या आप क्लिनिक से दवाइयाँ भी बेचते हैं?', custom: 'कस्टम (पैक जैसे हैं वैसे रहें)',
  },
);
