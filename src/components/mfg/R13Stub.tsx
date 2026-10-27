/**
 * R13 placeholder for a manufacturing desk / view whose package has not merged yet (Shop, Moulding, Press for MF-B;
 * Garments for MF-C; Food, Statutory and Floor → WIP for MF-D). Each package replaces its file (`ShopDesk.tsx` …,
 * `WipView.tsx`) with the same default export and props; `Manufacturing.tsx` is not edited again.
 */
import { useT } from '../../i18n';
import { defineArea } from '../../i18n/area';

const stubT = defineArea(
  { stub: 'This desk arrives with the next manufacturing update. Work centres, routings and job cards already work under Manufacturing → Floor.' } as const,
  { stub: 'यह डेस्क अगले मैन्युफैक्चरिंग अपडेट में आएगा। कार्य केंद्र, रूटिंग और जॉब कार्ड मैन्युफैक्चरिंग → फ़्लोर में पहले से काम करते हैं।' },
);

export default function R13Stub({ desk }: { desk: string }) {
  useT();
  return <p data-r13-stub={desk}>{stubT('stub')}</p>;
}
