import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-r8c';

/** R8-C: placeholder for a Round 8 tab whose package (TR-A / TR-B) has not merged yet. Each stub file re-exports this. */
export default function R8Stub(props: { onDone?: (msg: string, error?: boolean) => void }) {
  useT();
  void props;
  return <p data-r8-stub>{trT('soon')}</p>;
}
