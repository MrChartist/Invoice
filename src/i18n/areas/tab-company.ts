/** QA7 G1: the stale-tab banner (lazy `CrossTabBanner`): another tab switched the device's company. */
import { defineArea } from '../area';

export const tabCompanyT = defineArea(
  {
    title: 'This tab is on another company — reload',
    desc: 'Another tab opened a different company. Reload before you change anything here, so nothing is saved into the wrong company.',
  } as const,
  {
    title: 'यह टैब दूसरी कंपनी पर है — दोबारा लोड करें',
    desc: 'किसी दूसरे टैब ने दूसरी कंपनी खोली है। यहाँ कुछ भी बदलने से पहले दोबारा लोड करें, ताकि कुछ भी गलत कंपनी में सेव न हो।',
  },
);
