import { BookOpen } from 'lucide-react';
import { openHelp } from '../../lib/help-event';
import { discoverT } from '../../i18n/areas/discover-r6';
import controls from '../../styles/controls.module.css';

/** R6-A2's topic registry, if it is part of this build (a guarded glob: empty before R6-A merges). */
const HAS_HELP = Object.keys(import.meta.glob('../../lib/help/{registry,index}.ts')).length > 0;

/** R6-B3: "Learn more" on an empty state opens Help on a topic; hidden while the build has no help registry. */
export function LearnMore({ topic }: { topic: string }) {
  if (!HAS_HELP) return null;
  return (
    <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => openHelp(topic)} data-learn-more={topic}>
      <BookOpen size={14} aria-hidden="true" /> {discoverT('learnMore')}
    </button>
  );
}
