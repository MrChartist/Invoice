/** R19-A1: the logistics picker's strings (setup wizard card and Settings → Features; kept out of the `f-logistics` chunk). */
import { defineArea } from '../area';

export const lgPickT = defineArea(
  {
    card: 'Freight forwarding, customs clearance, courier or warehouse', cardHint: 'Job files, freight billing, duty deposits.',
    title: 'Logistics profile', custom: 'Custom', lorries: 'We also run our own lorries / issue LRs', extra: 'Also:',
    'kind.forwarder': 'Freight forwarder / NVOCC / air-cargo agent', 'kind.cha': 'Customs broker (CHA)', 'kind.courier': 'Courier franchise', 'kind.warehouse': 'Warehouse / 3PL / CFS', 'kind.multi': 'Forwarder + customs broker',
  } as const,
  {
    card: 'फ्रेट फ़ॉरवर्डिंग, कस्टम क्लियरेंस, कूरियर या वेयरहाउस', cardHint: 'जॉब फ़ाइलें, भाड़ा बिलिंग, ड्यूटी जमा।',
    title: 'लॉजिस्टिक्स प्रोफ़ाइल', custom: 'कस्टम', lorries: 'हम अपनी लॉरी भी चलाते हैं / LR जारी करते हैं', extra: 'साथ में:',
    'kind.forwarder': 'फ्रेट फ़ॉरवर्डर / NVOCC / एयर-कार्गो एजेंट', 'kind.cha': 'कस्टम ब्रोकर (CHA)', 'kind.courier': 'कूरियर फ़्रैंचाइज़ी', 'kind.warehouse': 'वेयरहाउस / 3PL / CFS', 'kind.multi': 'फ़ॉरवर्डर + कस्टम ब्रोकर',
  },
);
