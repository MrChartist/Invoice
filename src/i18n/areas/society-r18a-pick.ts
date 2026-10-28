/** R18-A1: the society picker's strings (setup wizard card and Settings → Features; kept out of the `f-society` chunk). */
import { defineArea } from '../area';

export const hsPickT = defineArea(
  {
    card: 'Housing society / apartment association / RWA', cardHint: 'Maintenance bills per flat, funds, dues and the ₹7,500 GST test.',
    title: 'Society profile', lede: 'Which body are you?', custom: 'Custom',
    'kind.chs': 'Co-operative housing society', 'kind.aoa': "Apartment owners' association", 'kind.rwa': 'Resident welfare association (RWA)', 'kind.commercial': 'Commercial premises society', 'kind.agency': 'Maintenance agency / builder',
    'hint.chs': 'Members, shares, J register, State co-op rules.', 'hint.aoa': 'Undivided-interest or area shares, dues certificate.', 'hint.rwa': 'Member billing and funds.', 'hint.commercial': 'Shops and offices: same engine.', 'hint.agency': 'Bills owners at 18 % (not the members\' own body).',
  } as const,
  {
    card: 'आवास सहकारी संस्था / अपार्टमेंट मालिक संघ / RWA', cardHint: 'फ़्लैट-वार रखरखाव बिल, निधियाँ, बकाया और ₹7,500 GST जाँच।',
    title: 'सोसाइटी प्रोफ़ाइल', lede: 'आपकी संस्था कौन-सी है?', custom: 'कस्टम',
    'kind.chs': 'आवास सहकारी संस्था (सोसाइटी)', 'kind.aoa': 'अपार्टमेंट मालिक संघ', 'kind.rwa': 'रेज़िडेंट वेलफ़ेयर एसोसिएशन (RWA)', 'kind.commercial': 'व्यावसायिक परिसर सोसाइटी', 'kind.agency': 'रखरखाव एजेंसी / बिल्डर',
    'hint.chs': 'सदस्य, शेयर, J रजिस्टर, राज्य सहकारी नियम।', 'hint.aoa': 'अविभाजित हिस्सा या क्षेत्र के अनुसार, बकाया प्रमाणपत्र।', 'hint.rwa': 'सदस्य बिल और निधियाँ।', 'hint.commercial': 'दुकानें और दफ़्तर: वही व्यवस्था।', 'hint.agency': 'मालिकों को 18 % पर बिल (सदस्यों की अपनी संस्था नहीं)।',
  },
);
