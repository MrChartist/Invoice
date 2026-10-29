/** R21-A1: the fuel picker's strings (setup wizard card and Settings → Features; kept out of the `f-fuel` chunk). */
import { defineArea } from '../area';

export const fuPickT = defineArea(
  {
    card: 'Petrol pump, CNG station or LPG distributor', cardHint: 'Nozzles, tanks, fuel prices; non-GST fuel.',
    title: 'Fuel profile', custom: 'Custom',
    'kind.pump': 'Petrol / diesel pump', 'kind.cng': 'CNG station', 'kind.pump_cng': 'Pump with CNG', 'kind.lpg': 'LPG distributor', 'kind.pump_lpg': 'Pump with LPG',
  } as const,
  {
    card: 'पेट्रोल पंप, CNG स्टेशन या LPG वितरक', cardHint: 'नोज़ल, टैंक, ईंधन दरें; गैर-GST ईंधन।',
    title: 'ईंधन प्रोफ़ाइल', custom: 'कस्टम',
    'kind.pump': 'पेट्रोल / डीज़ल पंप', 'kind.cng': 'CNG स्टेशन', 'kind.pump_cng': 'CNG सहित पंप', 'kind.lpg': 'LPG वितरक', 'kind.pump_lpg': 'LPG सहित पंप',
  },
);
