/**
 * Small 7S strings used outside the 7S screens: the bell's job-work clock notices (lazy stock-alerts provider),
 * the Books branch-stock note, the stock-transfer Sec 25(4) prompt and the bill godown Alt+C hint. Kept apart from
 * `inventory-7s.ts` so those chunks stay small.
 */
import { defineArea } from '../area';

export const s7mT = defineArea({
  expiredTitle: 'Job work: {n} challan(s) past the return clock',
  expiredDetail: '{list}: goods still with {party} after {date} are a deemed supply on the challan date (Sec 143). Raise an invoice and pay the tax with interest; verify with your CA.',
  soonTitle: 'Job work: {n} challan(s) due back within 30 days',
  soonDetail: '{list}: goods with {party} are due back by {date} (Sec 143).',
  cta: 'Return clocks',
  branchStockNote: 'Branch view: only this branch’s documents, bills and vouchers. Closing stock is the stock lying in this branch’s godowns at the company-wide cost; “No branch” takes the rest, so branches add up to the company.',
  transferTaxPrompt: 'This transfer moves goods between two GSTINs (distinct persons, Sec 25(4)): raise the tax invoice and the matching bill now. Verify the value with your CA.',
  godownAltC: 'Alt+C creates a godown',
}, {
  expiredTitle: 'जॉब वर्क: {n} चालान वापसी की समय-सीमा पार',
  expiredDetail: '{list}: {date} के बाद भी {party} के पास रखा माल चालान की तारीख पर आपूर्ति माना जाएगा (धारा 143)। बिल बनाएँ और ब्याज सहित कर जमा करें; अपने CA से पुष्टि करें।',
  soonTitle: 'जॉब वर्क: {n} चालान 30 दिन में वापस आने हैं',
  soonDetail: '{list}: {party} के पास रखा माल {date} तक वापस आना है (धारा 143)।',
  cta: 'वापसी समय-सीमा',
  branchStockNote: 'शाखा दृश्य: केवल इस शाखा के दस्तावेज़, बिल और वाउचर। अंतिम स्टॉक इस शाखा के गोदामों में पड़ा स्टॉक है (कंपनी-स्तर की लागत पर); बाकी “कोई शाखा नहीं” में, ताकि सभी शाखाओं का जोड़ कंपनी के बराबर रहे।',
  transferTaxPrompt: 'यह ट्रांसफ़र दो अलग GSTIN के बीच माल ले जाता है (अलग व्यक्ति, धारा 25(4)): अभी कर बिल और उससे मेल खाता खरीद बिल बनाएँ। मूल्य की पुष्टि अपने CA से करें।',
  godownAltC: 'Alt+C से नया गोदाम बनाएँ',
});
