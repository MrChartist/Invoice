/**
 * R6-A2 help topics: every GST tab, every TDS tab, every Payroll tab and the practice desk (lazy).
 * These describe what the app does and cite `docs/CA_REVIEW.md` ids; they never promise a statutory value.
 * Working papers — verify with your CA.
 */
import { ca, rel, t, type HelpTopic } from './types';

const G1_DUE = 'GSTR-1 due date: see the Compliance tab (as the app applies the calendar; notified extensions are not tracked).';
const G3_DUE = 'GSTR-3B due date: see the Compliance tab (as the app applies the calendar).';

export const TOPICS: readonly HelpTopic[] = [
  t('gst-reports', 'GST reports', 'GST रिपोर्ट', 'GSTR-1, GSTR-3B and related working papers built from your saved invoices, notes and bills for the chosen period. A working paper, not a filed return: the page\'s "Scope and limits" lists what is included.', 'Each month (or quarter under QRMP) before you file on the GST portal.', {
    steps: ['Pick the period and your GSTIN.', 'Run "Check" on the filing strip and fix what it lists.', 'Download the GSTR-1 / 3B JSON and upload it on the portal.', 'Mark the return filed.'],
    statutory: ca(['G1', 'G14', 'G24', 'G27'], 'GSTR-1, GSTR-3B, IFF', G1_DUE),
    related: rel(['Compliance calendar', '/gst-reports?tab=compliance'], ['GST guards', '/gst-reports?tab=guards']),
  }),
  t('gst-reports:overview', 'Overview', 'सारांश', 'Totals of each GSTR-1 section for the period, with links into each section.', 'First look at a period.', { statutory: ca(['G14']) }),
  t('gst-reports:b2b', 'B2B', 'B2B', 'GSTR-1 Table 4: invoices to registered buyers (with a GSTIN), invoice by invoice.', 'Every return period; buyers see these in their GSTR-2B.', {
    steps: ['Check every buyer GSTIN and place of supply.', 'Reverse-charge invoices are flagged.'],
    statutory: ca(['G13', 'G14'], 'GSTR-1 Table 4', G1_DUE),
  }),
  t('gst-reports:b2cl', 'B2CL', 'B2CL', 'GSTR-1 Table 5: large inter-State invoices to unregistered buyers, above the threshold as the app applies it by invoice date.', 'Every return period that has such invoices.', {
    statutory: ca(['G1'], 'GSTR-1 Table 5', G1_DUE),
    related: rel(['B2CS', '/gst-reports?tab=b2cs']),
  }),
  t('gst-reports:b2cs', 'B2CS', 'B2CS', 'GSTR-1 Table 7: other sales to unregistered buyers, summed by place of supply and rate.', 'Every return period.', { statutory: ca(['G1', 'G12'], 'GSTR-1 Table 7', G1_DUE) }),
  t('gst-reports:cdnr', 'CDNR', 'CDNR', 'GSTR-1 Table 9B: credit and debit notes to registered buyers.', 'In the period the note is issued.', { statutory: ca(['G8', 'G21', 'G26'], 'GSTR-1 Table 9B', G1_DUE) }),
  t('gst-reports:cdnur', 'CDNUR', 'CDNUR', 'GSTR-1 Table 9B: credit and debit notes to unregistered buyers where the original was B2CL or an export. Notes on small B2C sales reduce B2CS instead.', 'In the period the note is issued.', {
    steps: ['Check the original invoice type (B2CL / EXPWP / EXPWOP).', 'A note linked to a B2CS invoice is not listed here.'],
    statutory: ca(['G8', 'G21'], 'GSTR-1 Table 9B (unregistered)', G1_DUE),
    related: rel(['CDNR', '/gst-reports?tab=cdnr'], ['B2CL', '/gst-reports?tab=b2cl']),
  }),
  t('gst-reports:exp', 'Exports', 'निर्यात', 'GSTR-1 Table 6A: exports with or without payment of tax (LUT), with shipping-bill details.', 'Every period with an export or SEZ supply.', { statutory: ca(['X1', 'X2', 'X8'], 'GSTR-1 Table 6A / 6B') }),
  t('gst-reports:nil', 'Nil / exempt', 'निल / छूट', 'GSTR-1 Table 8: nil-rated, exempt and non-GST supplies, split inter- / intra-State and registered / unregistered.', 'Every period with such supplies.', { statutory: ca(undefined, 'GSTR-1 Table 8') }),
  t('gst-reports:at', 'Advances 11A', 'अग्रिम 11A', 'GSTR-1 Table 11A: tax on advances received for services where no invoice was issued in the same period.', 'In the month an advance is received.', { statutory: ca(['G3', 'G4'], 'GSTR-1 Table 11A') }),
  t('gst-reports:txpd', 'Adjusted 11B', 'समायोजित 11B', 'GSTR-1 Table 11B: advances of earlier periods adjusted against invoices of this period.', 'When an advance is set off against an invoice.', { statutory: ca(['G3', 'G4'], 'GSTR-1 Table 11B') }),
  t('gst-reports:hsn', 'HSN summary', 'HSN सारांश', 'GSTR-1 Table 12: sales summed by HSN / SAC and rate, with UQC and quantity. Digits needed depend on turnover, as the app applies it.', 'Every return period.', { statutory: ca(['G16', 'G17'], 'GSTR-1 Table 12') }),
  t('gst-reports:docs', 'Documents issued', 'जारी दस्तावेज़', 'GSTR-1 Table 13: number ranges of each document series, cancelled numbers and gaps.', 'Every return period.', { statutory: ca(['G20'], 'GSTR-1 Table 13') }),
  t('gst-reports:amend', 'Amendments', 'संशोधन', 'Changes to documents of earlier, already reported periods (B2BA, B2CLA, CDNRA …).', 'In the period you change an old document.', { statutory: ca(['G14', 'G27']) }),
  t('gst-reports:eco', 'E-commerce 14', 'ई-कॉमर्स 14', 'GSTR-1 Table 14: supplies made through e-commerce operators, by operator GSTIN.', 'If you sell through a marketplace or aggregator.', { statutory: ca(['G19', 'I34'], 'GSTR-1 Table 14') }),
  t('gst-reports:gstr3b', 'GSTR-3B', 'GSTR-3B', 'The monthly summary return: outward tax (3.1), inter-State B2C (3.2), ITC (4), exempt inward (5) and payment (6.1), from the same documents.', 'Every month (or quarter under QRMP).', {
    steps: ['Compare 3.1 with GSTR-1.', 'Check ITC in 4(A) against your GSTR-2B.', 'Go to Set-off & payment for the cash to pay.'],
    statutory: ca(['G15', 'G21', 'G22', 'G28'], 'GSTR-3B', G3_DUE),
    related: rel(['Set-off & payment', '/gst-reports?tab=setoff'], ['2B match', '/gst-reports?tab=gstr2b']),
  }),
  t('gst-reports:setoff', 'Set-off & payment', 'सेट-ऑफ़ और भुगतान', 'Uses ITC against output tax in the order the app applies, shows the cash to pay and records PMT-06 challans.', 'After GSTR-3B, before paying.', { statutory: ca(['G28', 'G29', 'G30', 'G32'], 'PMT-06', G3_DUE) }),
  t('gst-reports:gstr2b', '2B match', '2B मिलान', 'Matches the GSTR-2B file from the portal with your bills: matched, only in 2B, only in books.', 'Monthly, before claiming ITC in 3B.', { statutory: ca(['G26', 'G37'], 'GSTR-2B') }),
  t('gst-reports:purhsn', 'Purchase HSN', 'ख़रीद HSN', 'Purchases summed by HSN and rate.', 'For annual returns and stock checks.', { statutory: ca(['G16']) }),
  t('gst-reports:recon', '1 vs 3B vs books', '1 बनाम 3B बनाम खाते', 'Month by month: GSTR-1, GSTR-3B and the books side by side, with differences.', 'Before the annual return, or when numbers do not agree.', { statutory: ca(['G40']) }),
  t('gst-reports:compliance', 'Compliance', 'अनुपालन', 'Due dates of your returns, filed marks, and estimated interest and late fee.', 'Any time, to see what is due or late.', {
    // R16-D5 (PF13)
    steps: ['GSTR-3B Table 5.1 interest is filled in by the portal and cannot be lowered (from the Jan / Feb 2026 periods): take it as the minimum and reconcile this estimate to it.'],
    statutory: ca(['G24', 'G25', 'G30', 'G31', 'PF13', 'PF3'], 'GSTR-1, 3B, IFF, CMP-08, GSTR-9'),
  }),
  t('gst-reports:composition', 'Composition (CMP-08 / GSTR-4)', 'कंपोज़िशन (CMP-08 / GSTR-4)', 'Quarterly statement and annual return for a composition dealer, at the rates as the app applies them.', 'Each quarter and year, if your profile is composition.', { statutory: ca(['G41', 'G42'], 'CMP-08, GSTR-4') }),
  t('gst-reports:hsnmaster', 'HSN master', 'HSN मास्टर', 'Your HSN / SAC codes with default rates, used to fill lines in the editors.', 'Once, then when you add a new kind of item.'),
  t('gst-reports:gstr9c', 'GSTR-9C', 'GSTR-9C', 'Reconciliation of the annual return with audited books.', 'Once a year, if your turnover requires it.', { statutory: ca(['G39', 'G40'], 'GSTR-9 / 9C') }),
  t('gst-reports:rcmdocs', 'RCM self-invoice', 'RCM स्व-इनवॉइस', 'Self-invoices and payment vouchers for purchases where you pay tax under reverse charge.', 'When you buy under RCM from an unregistered supplier.', { statutory: ca(['G35', 'AC4']) }),
  t('gst-reports:cashref', 'Cash ledger & refunds', 'कैश लेजर और रिफ़ंड', 'Your electronic cash ledger, PMT-09 transfers and refund claims.', 'When cash sits in the wrong head or you claim a refund.', { statutory: ca(['G33'], 'PMT-09, RFD-01') }),
  t('gst-reports:isd', 'ISD / GSTR-6', 'ISD / GSTR-6', 'Input service distributor: distributing common input-service credit to branches.', 'Monthly, if you have an ISD registration.', { statutory: ca(['G34'], 'GSTR-6') }),
  t('gst-reports:ewbcons', 'Consolidated e-Way', 'समेकित ई-वे', 'One consolidated e-Way bill for many consignments in one vehicle.', 'When one vehicle carries several e-Way bills.', { statutory: ca(['G46']) }),
  t('gst-reports:bygstin', 'By GSTIN', 'GSTIN के अनुसार', 'GSTR-1 and 3B figures per registration when you have more than one GSTIN.', 'For multi-State businesses.', { statutory: ca(['G48']) }),
  t('gst-reports:guards', 'GST guards', 'GST जाँच', 'Checks before filing: rates outside the slab list, missing GSTINs, e-Invoice window, Table 3.2 and more.', 'Before every download.', { statutory: ca(['G2', 'G15', 'G45']) }),
  t('gst-reports:portal-files', 'Portal files', 'पोर्टल फ़ाइलें', 'GSTR-1 JSON files you uploaded and the error files the portal sent back.', 'After an upload, to fix portal errors.', { statutory: ca(['G27']) }),
  t('gst-reports:eway-desk', 'e-Way desk', 'ई-वे डेस्क', 'e-Way bills to make, extend or close, with validity as the app applies it.', 'Before goods move.', {
    // R16-D5 (PF12)
    steps: ['The mandatory Ship-to GSTIN ("URP" for unregistered) in e-Invoice / e-Way is on hold since 29 Jul 2026: nothing changes here. The e-Invoice JSON already writes ShipDtls.Gstin when the consignee has a GSTIN.'],
    statutory: ca(['G46', 'PF12'], 'e-Way bill'),
  }),
  t('gst-reports:hotel-gst', 'Hotel GST', 'होटल GST', 'Hotel pack: room-night bands, specified-premises status with its evidence, the declarations register, the band report for the common-credit working, and checks.', 'Monthly before GSTR-1 / 3B; 1 Jan – 31 Mar for declarations.', {
    statutory: ca(['HT1', 'HT2', 'HT3', 'HT4', 'HT5', 'HT6', 'HT14', 'HT16'], 'Annexure VII / VIII / IX'),
    related: rel(['Common credit', '/gst-reports?tab=common-credit'], ['Front desk', '/tables?tab=frontdesk']),
  }),
  t('gst-reports:export-desk', 'Export desk', 'एक्सपोर्ट डेस्क', 'Export realisation, IRM / e-BRC, incentives and imports by bill of entry.', 'If you export or import.', { statutory: ca(['X1', 'X2', 'X3', 'X9']) }),
  t('tds', 'TDS & TCS', 'TDS और TCS', 'Tax you deduct from suppliers (TDS) and collect from customers (TCS): deductions, challans, quarterly return papers and certificates.', 'Monthly deposit and quarterly returns.', {
    steps: ['Mark TDS on supplier bills or payments.', 'Record the challan when you deposit.', 'Prepare the quarterly return paper and Form 16A.'],
    statutory: ca(['T1', 'T2', 'T4', 'T5', 'T16'], '26Q, 27Q, 27EQ, 16A', 'Due dates: see the Overview calendar (as the app applies it).'),
    related: rel(['Bills', '/expenses?tab=bills']),
  }),
  t('tds:overview', 'Overview', 'सारांश', 'Deducted against deposited per quarter, interest on late items and the due calendar.', 'Monthly, before the deposit date.', { statutory: ca(['T4', 'T5']) }),
  t('tds:deductions', 'Deductions', 'कटौतियाँ', 'Every TDS deduction from bills and payments, with section, PAN and interest if late.', 'To check a deduction or add one by hand.', { statutory: ca(['T1', 'T2', 'T3', 'T10', 'T14']) }),
  t('tds:challans', 'Challans', 'चालान', 'Tax deposited (ITNS 281) and which deductions each challan covers.', 'After every deposit.', { statutory: ca(['T5'], 'ITNS 281') }),
  t('tds:returns', 'Returns', 'रिटर्न', 'Quarterly return working papers (26Q for TDS, 27EQ for TCS) and filed marks.', 'Each quarter.', { statutory: ca(['T5', 'T8', 'T17', 'T18'], '26Q, 27EQ') }),
  t('tds:27q', 'Form 27Q', 'फ़ॉर्म 27Q', 'TDS on payments to non-residents, quarterly.', 'If you pay a non-resident.', { statutory: ca(['T9'], '27Q') }),
  t('tds:f16a', 'Form 16A', 'फ़ॉर्म 16A', 'TDS certificate data for each supplier, per quarter.', 'After the quarterly return is processed.', { statutory: ca(['T5', 'T17'], '16A') }),
  t('tds:traces', 'TRACES', 'TRACES', 'Import TRACES justification reports and match defaults to deductions.', 'When TRACES shows a default.', { statutory: ca(['T8']) }),
  t('payroll', 'Payroll', 'पेरोल', 'Employees, salary structures, attendance, the monthly run, payments and statutory papers (EPF, ESI, PT, TDS on salary).', 'Every month.', {
    steps: ['Add employees and their salary structure.', 'Enter attendance and leave.', 'Run payroll, check payslips, then pay.'],
    statutory: ca(['P1', 'P5', 'P6', 'P7', 'P21']),
  }),
  t('payroll:employees', 'Employees', 'कर्मचारी', 'Employee master: PAN, UAN, ESI number, regime and joining date.', 'When someone joins or details change.'),
  t('payroll:heads', 'Pay heads', 'पे हेड', 'Earnings and deductions (basic, HRA, PF, ESI, PT, TDS) and how each is worked out.', 'Once at start.', { statutory: ca(['P5', 'P6', 'P7', 'P20']) }),
  t('payroll:structures', 'Salary structures', 'वेतन संरचना', 'Which pay heads each employee or grade gets.', 'When a salary is set or revised.'),
  t('payroll:attendance', 'Attendance', 'उपस्थिति', 'Days present, absent and overtime for the month.', 'Before the monthly run.'),
  t('payroll:leave', 'Leave', 'छुट्टी', 'Leave types, balances and leave taken.', 'Monthly.', { statutory: ca(['P10']) }),
  t('payroll:run', 'Payroll run', 'पेरोल रन', 'Works out pay, PF, ESI, PT and salary TDS for the month and posts the payroll voucher.', 'Once a month.', { statutory: ca(['P1', 'P5', 'P6', 'P7', 'P19', 'AC18']) }),
  t('payroll:arrears', 'Arrears', 'बकाया', 'Back pay from a revision, spread over the months it belongs to.', 'After a salary revision.', { statutory: ca(['P8', 'P14']) }),
  t('payroll:extras', 'Extras', 'अतिरिक्त', 'One-off items: bonus, incentives, perquisites.', 'When a one-off amount is paid.', { statutory: ca(['P11', 'P15', 'P16', 'P17', 'P18']) }),
  t('payroll:loans', 'Employee loans', 'कर्मचारी लोन', 'Loans and advances to employees and their recovery.', 'When you lend to an employee.', { statutory: ca(['P12']) }),
  t('payroll:payments', 'Payments', 'भुगतान', 'Salary paid, bank files and statutory deposits.', 'After the run.', { statutory: ca(['P21']) }),
  t('payroll:fnf', 'Full & final', 'फ़ुल एंड फ़ाइनल', 'Settlement when someone leaves: gratuity, leave encashment, notice pay.', 'When an employee leaves.', { statutory: ca(['P9', 'P10', 'P20']) }),
  t('payroll:reports', 'Reports', 'रिपोर्ट', 'Payslips, registers, PF ECR, ESI and Form 24Q / 16 papers.', 'Monthly and quarterly.', { statutory: ca(['P21'], 'ECR, ESI return, 24Q, Form 16') }),
  t('payroll:more', 'More', 'और', 'Relief u/s 89, perquisite valuation, actuarial valuations, PT option and payroll access.', 'Occasionally.', { statutory: ca(['P14', 'P22']) }),
  t('practice', 'Practice desk', 'प्रैक्टिस डेस्क', "For a CA's office: every company's returns, DSC expiry and the monthly client checklist on one board.", 'Daily, if you look after several companies.', { statutory: ca(['G24']) }),
];
