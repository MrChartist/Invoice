import { useT } from '../../i18n';
import { defineArea } from '../../i18n/area';

const stubT = defineArea({ soon: 'This desk arrives with the next Round 9 update.' } as const, { soon: 'यह डेस्क Round 9 के अगले अपडेट में आएगा।' });

/** RT-A1: placeholder for a Round 9 pack desk whose package (RT-B … RT-E) has not merged yet. Each desk file re-exports it. */
export default function R9Stub(props: { view?: string; onDone?: (msg: string, error?: boolean) => void }) {
  useT();
  void props;
  return <p data-r9-stub>{stubT('soon')}</p>;
}
