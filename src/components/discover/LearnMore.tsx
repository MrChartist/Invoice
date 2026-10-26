import { BookOpen } from 'lucide-react';
import { openHelp } from '../../lib/help-event';
import { discoverT } from '../../i18n/areas/discover-r6';
import controls from '../../styles/controls.module.css';

/** R6-B3: "Learn more" on an empty state opens Help (R6-A2's `HelpModal`) on a registry topic. */
export function LearnMore({ topic }: { topic: string }) {
  return (
    <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => openHelp(topic)} data-learn-more={topic}>
      <BookOpen size={14} aria-hidden="true" /> {discoverT('learnMore')}
    </button>
  );
}
