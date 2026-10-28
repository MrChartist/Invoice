/** R18-A1: the society picker's strings (setup wizard card and Settings → Features; kept out of the `f-society` chunk). */
import { defineArea } from '../area';

export const hsPickT = defineArea(
  {
    card: 'Housing society / apartment association / RWA', cardHint: 'Maintenance bills per flat, funds and dues.',
    title: 'Society profile', custom: 'Custom',
    'kind.chs': 'Co-operative housing society', 'kind.aoa': "Apartment owners' association", 'kind.rwa': 'Resident welfare association (RWA)', 'kind.commercial': 'Commercial premises society', 'kind.agency': 'Maintenance agency / builder',
  } as const,
  {
    card: 'आवास सहकारी संस्था / अपार्टमेंट मालिक संघ / RWA', cardHint: 'फ़्लैट-वार रखरखाव बिल, निधियाँ और बकाया।',
    title: 'सोसाइटी प्रोफ़ाइल', custom: 'कस्टम',
    'kind.chs': 'आवास सहकारी संस्था (सोसाइटी)', 'kind.aoa': 'अपार्टमेंट मालिक संघ', 'kind.rwa': 'रेज़िडेंट वेलफ़ेयर एसोसिएशन (RWA)', 'kind.commercial': 'व्यावसायिक परिसर सोसाइटी', 'kind.agency': 'रखरखाव एजेंसी / बिल्डर',
  },
);
