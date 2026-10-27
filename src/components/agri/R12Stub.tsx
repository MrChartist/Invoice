/**
 * R12 placeholder for an agri desk whose package has not merged yet (Dairy for AG-B, Mill for AG-C, Cold storage /
 * Inputs / Members for AG-D). Each package replaces its desk file (`DairyDesk.tsx` …); `Inventory.tsx` is not edited
 * again. Renders one line, so every landing URL of the agri profiles always opens; the Farm desk already works.
 */
import { useT } from '../../i18n';
import { defineArea } from '../../i18n/area';

const stubT = defineArea(
  { stub: 'This desk arrives with the next agri update. Farmers, vouchers and payment cycles already work under Inventory → Farm.', dairy: 'Dairy', mill: 'Mill', cold: 'Cold storage', inputs: 'Input dealer', members: 'Members' } as const,
  { stub: 'यह डेस्क अगले कृषि अपडेट में आएगा। किसान, वाउचर और भुगतान चक्र इन्वेंटरी → खेती में पहले से काम करते हैं।', dairy: 'डेयरी', mill: 'मिल', cold: 'शीतगृह', inputs: 'खाद-बीज विक्रेता', members: 'सदस्य' },
);

export default function R12Stub({ desk }: { desk: 'dairy' | 'mill' | 'cold' | 'inputs' | 'members' }) {
  useT();
  return (
    <section data-r12-stub={desk}>
      <h3>{stubT(desk)}</h3>
      <p>{stubT('stub')}</p>
    </section>
  );
}
