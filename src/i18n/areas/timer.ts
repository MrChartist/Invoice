/** Header timer pill (app shell, first paint — keep tiny). */
import { defineArea } from '../area';

export const timerPillT = defineArea(
  {
    timer: 'Timer',
    title: 'Timer running: {label}',
    aria: 'Timer running for {label}, {elapsed}. Open Time.',
  } as const,
  {
    timer: 'टाइमर',
    title: 'टाइमर चल रहा है: {label}',
    aria: '{label} के लिए टाइमर चल रहा है, {elapsed}। समय पेज खोलें।',
  },
);
