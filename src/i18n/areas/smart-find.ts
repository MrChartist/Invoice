/**
 * SmartFind (8G, 8.103): the command palette's universal search. Kept apart from the invoicing-ux area
 * so the palette chunk stays small.
 */
import { defineArea } from '../area';

export const sfT = defineArea(
  {
    allCompanies: 'Search all companies (read-only)',
    switchTo: 'Switch to {name} (Settings → Companies) to open this record.',
  },
  {
    allCompanies: 'सभी कंपनियों में खोजें (केवल देखने के लिए)',
    switchTo: 'यह रिकॉर्ड खोलने के लिए {name} पर जाएँ (सेटिंग्स → कंपनियाँ)।',
  },
);
