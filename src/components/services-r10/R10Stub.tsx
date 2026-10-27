/**
 * R10 placeholder for a service desk whose package has not merged yet (Time → Clinic for SV-B, Members for SV-C,
 * Workshop for SV-D). Each package replaces its lazy target in `Time.tsx`. Renders one line, so every landing URL of
 * the service profiles always opens; the shared front desk (appointments, staff, commission) already works.
 */
import { useT } from '../../i18n';
import { defineArea } from '../../i18n/area';

const stubT = defineArea(
  { stub: 'This desk arrives with the next services update. Appointments, staff and commission already work under Time → Appointments.' } as const,
  { stub: 'यह डेस्क अगले सेवा अपडेट में आएगा। अपॉइंटमेंट, स्टाफ और कमीशन समय → अपॉइंटमेंट में पहले से काम करते हैं।' },
);

export default function R10Stub({ title }: { title: string }) {
  useT();
  return (
    <section data-r10-stub>
      <h3>{title}</h3>
      <p>{stubT('stub')}</p>
    </section>
  );
}
