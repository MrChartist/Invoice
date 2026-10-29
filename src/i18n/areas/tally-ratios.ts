/**
 * PENDING 51 (QA19 §2): Ratio analysis row labels and formulas, keyed by `RatioItem.id` (`src/lib/ledger/ratios.ts`
 * keeps its English labels for the CSV). `f.<id>` is the formula exactly as the library writes it, with `{days}` /
 * `{method}` where it interpolates; a formula that does not match is shown as written. Used by `RatioTab`.
 */
import { defineArea } from '../area';

export const ratioT = defineArea(
  {
    workingCapital: 'Working capital',
    cash: 'Cash-in-hand',
    bank: 'Bank accounts',
    bankOd: 'Bank OD / cash credit',
    debtors: 'Sundry debtors',
    creditors: 'Sundry creditors',
    sales: 'Sales accounts',
    purchases: 'Purchase accounts',
    stock: 'Stock-in-hand',
    netProfit: 'Net profit',
    wcTurnover: 'Working capital turnover',
    inventoryTurnover: 'Inventory turnover',
    currentRatio: 'Current ratio',
    quickRatio: 'Quick ratio',
    debtEquity: 'Debt / equity',
    grossProfitPct: 'Gross profit %',
    netProfitPct: 'Net profit %',
    operatingCostPct: 'Operating cost %',
    receivableDays: 'Receivable turnover in days',
    payableDays: 'Payable turnover in days',
    roi: 'Return on investment %',
    rowc: 'Return on working capital %',
    'f.workingCapital': 'Current assets − current liabilities',
    'f.cash': 'Closing balance of cash accounts',
    'f.bank': 'Closing balance of bank accounts',
    'f.bankOd': 'Closing balance of short-term borrowings',
    'f.debtors': 'Closing trade receivables',
    'f.creditors': 'Closing trade payables',
    'f.sales': 'Net sales (sales − returns + charges recovered) in the period',
    'f.purchases': 'Purchases in the period',
    'f.stock': 'Closing inventories (as journalised)',
    'f.stockValued': 'Closing inventories (journalised + closing stock, {method})',
    'f.netProfit': 'Income − expenses in the period',
    'f.wcTurnover': 'Sales ÷ working capital (Tally)',
    'f.inventoryTurnover': 'Sales ÷ closing stock (Tally)',
    'f.currentRatio': 'Current assets ÷ current liabilities',
    'f.quickRatio': '(Current assets − stock) ÷ current liabilities',
    'f.debtEquity': 'Loans ÷ (capital + reserves + net profit) (Tally: loans ÷ capital + net profit)',
    'f.grossProfitPct': '(Sales − direct costs) ÷ sales × 100',
    'f.netProfitPct': 'Net profit ÷ sales × 100',
    'f.operatingCostPct': '(Sales − net profit) ÷ sales × 100 (Tally)',
    'f.receivableDays': 'Closing debtors ÷ sales × {days} days (Tally)',
    'f.payableDays': 'Closing creditors ÷ purchases × {days} days',
    'f.roi': 'Net profit ÷ (capital + reserves + net profit) × 100 (Tally)',
    'f.rowc': 'Net profit ÷ working capital × 100 (Tally)',
    days: '{n} days',
    times: '{n} times',
  } as const,
  {
    workingCapital: 'कार्यशील पूँजी',
    cash: 'हाथ में नकद',
    bank: 'बैंक खाते',
    bankOd: 'बैंक OD / कैश क्रेडिट',
    debtors: 'विविध देनदार',
    creditors: 'विविध लेनदार',
    sales: 'बिक्री खाते',
    purchases: 'खरीद खाते',
    stock: 'हाथ में स्टॉक',
    netProfit: 'शुद्ध मुनाफ़ा',
    wcTurnover: 'कार्यशील पूँजी टर्नओवर',
    inventoryTurnover: 'स्टॉक टर्नओवर',
    currentRatio: 'चालू अनुपात',
    quickRatio: 'त्वरित अनुपात',
    debtEquity: 'ऋण / इक्विटी',
    grossProfitPct: 'सकल मुनाफ़ा %',
    netProfitPct: 'शुद्ध मुनाफ़ा %',
    operatingCostPct: 'परिचालन लागत %',
    receivableDays: 'प्राप्य टर्नओवर (दिनों में)',
    payableDays: 'देय टर्नओवर (दिनों में)',
    roi: 'निवेश पर प्रतिफल %',
    rowc: 'कार्यशील पूँजी पर प्रतिफल %',
    'f.workingCapital': 'चालू संपत्तियाँ − चालू देनदारियाँ',
    'f.cash': 'नकद खातों का क्लोज़िंग बैलेंस',
    'f.bank': 'बैंक खातों का क्लोज़िंग बैलेंस',
    'f.bankOd': 'अल्पकालिक उधारों का क्लोज़िंग बैलेंस',
    'f.debtors': 'क्लोज़िंग व्यापार प्राप्य',
    'f.creditors': 'क्लोज़िंग व्यापार देय',
    'f.sales': 'अवधि में शुद्ध बिक्री (बिक्री − वापसी + वसूले गए शुल्क)',
    'f.purchases': 'अवधि में खरीद',
    'f.stock': 'क्लोज़िंग स्टॉक (जैसा जर्नल किया गया)',
    'f.stockValued': 'क्लोज़िंग स्टॉक (जर्नल किया गया + क्लोज़िंग स्टॉक, {method})',
    'f.netProfit': 'अवधि में आय − खर्च',
    'f.wcTurnover': 'बिक्री ÷ कार्यशील पूँजी (Tally)',
    'f.inventoryTurnover': 'बिक्री ÷ क्लोज़िंग स्टॉक (Tally)',
    'f.currentRatio': 'चालू संपत्तियाँ ÷ चालू देनदारियाँ',
    'f.quickRatio': '(चालू संपत्तियाँ − स्टॉक) ÷ चालू देनदारियाँ',
    'f.debtEquity': 'ऋण ÷ (पूँजी + रिज़र्व + शुद्ध मुनाफ़ा) (Tally: ऋण ÷ पूँजी + शुद्ध मुनाफ़ा)',
    'f.grossProfitPct': '(बिक्री − प्रत्यक्ष लागत) ÷ बिक्री × 100',
    'f.netProfitPct': 'शुद्ध मुनाफ़ा ÷ बिक्री × 100',
    'f.operatingCostPct': '(बिक्री − शुद्ध मुनाफ़ा) ÷ बिक्री × 100 (Tally)',
    'f.receivableDays': 'क्लोज़िंग देनदार ÷ बिक्री × {days} दिन (Tally)',
    'f.payableDays': 'क्लोज़िंग लेनदार ÷ खरीद × {days} दिन',
    'f.roi': 'शुद्ध मुनाफ़ा ÷ (पूँजी + रिज़र्व + शुद्ध मुनाफ़ा) × 100 (Tally)',
    'f.rowc': 'शुद्ध मुनाफ़ा ÷ कार्यशील पूँजी × 100 (Tally)',
    days: '{n} दिन',
    times: '{n} गुना',
  },
);

type RatioKey = Parameters<typeof ratioT>[0];
const has = (k: string): k is RatioKey => Object.hasOwn(ratioT.en, k);

/** A ratio row's label in the interface language (an unknown id keeps the library's label). */
export function ratioLabel(x: { id: string; label: string }): string {
  return has(x.id) && ratioT.en[x.id] === x.label ? ratioT(x.id) : x.label;
}

/** A ratio row's formula in the interface language, when it matches its English template; else as written. */
export function ratioFormula(x: { id: string; formula: string }): string {
  for (const k of [`f.${x.id}`, `f.${x.id}Valued`]) {
    if (!has(k)) continue;
    const names: string[] = [];
    const src = ratioT.en[k].split(/\{(\w+)\}/).map((p, i) => (i % 2 ? (names.push(p), '(.+?)') : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('');
    const m = new RegExp(`^${src}$`).exec(x.formula);
    if (m) return ratioT(k, Object.fromEntries(names.map((n, i) => [n, m[i + 1]])));
  }
  return x.formula;
}
