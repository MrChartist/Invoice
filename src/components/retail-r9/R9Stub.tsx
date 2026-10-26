import { useT } from '../../i18n';
import { rtaT } from '../../i18n/areas/retail-r9a';

/** RT-A1: placeholder for a Round 9 pack desk whose package (RT-B … RT-E) has not merged yet. Each desk file re-exports it. */
export default function R9Stub(props: { view?: string; onDone?: (msg: string, error?: boolean) => void }) {
  useT();
  void props;
  return <p data-r9-stub>{rtaT('soon')}</p>;
}
