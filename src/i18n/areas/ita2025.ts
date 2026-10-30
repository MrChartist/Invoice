/**
 * Income-tax Act 2025 labels (R5 §7 Q1): the words around a date-keyed section / form reference
 * (`src/lib/ita2025.ts`). Section and form numbers stay in Latin letters; "verify with your CA" stays English.
 * English + Hindi.
 */
import { defineArea } from '../area';
import type { ActWords } from '../../lib/ita2025';

export const ita25T = defineArea(
  {
    old: '[old {code}]',
    verify: '(verify with your CA)',
    form: 'Form {n}',
    kindTds: 'TDS ({form})',
    kindTcs: 'TCS ({form})',
    formData: '{form} data',
    annex1: '{form}: Annexure I',
    annex2: '{form}: Annexure II',
    partB: '{form} Part B working',
    note: 'From 1 Apr 2026 the Income-tax Act 2025 applies (earlier of credit or payment). Section and form labels follow each document’s date: older records keep the 1961 references, newer ones show the 2025-Act reference with the old code in brackets. Stored codes are unchanged. Working papers: verify with your CA.',
  } as const,
  {
    old: '[पूर्व {code}]',
    verify: '(verify with your CA)',
    form: 'फ़ॉर्म {n}',
    kindTds: 'TDS ({form})',
    kindTcs: 'TCS ({form})',
    formData: '{form} डेटा',
    annex1: '{form}: एनेक्सचर I',
    annex2: '{form}: एनेक्सचर II',
    partB: '{form} पार्ट B वर्किंग',
    note: '1 अप्रैल 2026 से आयकर अधिनियम 2025 लागू है (क्रेडिट या भुगतान, जो पहले हो)। सेक्शन और फ़ॉर्म के नाम हर दस्तावेज़ की तारीख से तय होते हैं: पुराने रिकॉर्ड 1961 के संदर्भ दिखाते रहते हैं, नए रिकॉर्ड 2025 अधिनियम का संदर्भ और कोष्ठक में पुराना कोड दिखाते हैं। सहेजे गए कोड नहीं बदलते। कार्य-पत्र: verify with your CA.',
  },
);

/** The label words in the active language, for `sectionText` / `formText`. */
export function ita25Words(): ActWords {
  return { old: ita25T('old'), verify: ita25T('verify'), form: ita25T('form') };
}
