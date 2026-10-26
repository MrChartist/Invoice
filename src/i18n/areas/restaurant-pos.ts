/** R3-A: the few restaurant strings the POS counter shows (kept apart so the POS chunk stays small). */
import { defineArea } from '../area';

export const rPosT = defineArea(
  {
    tables: 'Tables',
    shareImage: 'Share as image',
    unavailable: '{name} is marked not available today. Add it anyway?',
    copyImage: 'Copy image',
    imageHint: 'JPG / PNG for WhatsApp',
    imageCopied: 'Bill image copied',
    imageFailed: 'Could not make the image — try Share PDF.',
  } as const,
  {
    tables: 'टेबल',
    shareImage: 'इमेज के रूप में भेजें',
    unavailable: '{name} आज उपलब्ध नहीं के रूप में चिह्नित है। फिर भी जोड़ें?',
    copyImage: 'इमेज कॉपी करें',
    imageHint: 'WhatsApp के लिए JPG / PNG',
    imageCopied: 'बिल की इमेज कॉपी हुई',
    imageFailed: 'इमेज नहीं बन सकी — Share PDF आज़माएँ।',
  },
);
