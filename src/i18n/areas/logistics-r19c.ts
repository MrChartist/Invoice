/**
 * R19-C: customs broker (CHA) desk strings — disbursements on the client's behalf (Rule 33), duty deposits, the CBLR
 * Reg 10(k) job register and the client KYC fields. Shared words (job, client, status, date …) come from `lgT`
 * (`logistics-r19a.ts`). `kinds` / `kyc_methods` are comma-separated in the order of their ids.
 */
import { defineArea } from '../area';

export const lgcT = defineArea(
  {
    customs: 'Customs', job: 'Job', pick: 'Choose a job.', disb: 'Disbursements', deps: 'Duty deposits', register: 'CB register (Reg 10(k))',
    kind: 'Paid for', kinds: 'Customs duty,CFS,Port,DO,Shipping line,Insurance,Other', payee: 'Paid to', ref: 'Challan / invoice no.', amount: 'Amount', date: 'Date', method: 'Mode', paid: 'Paid from our account now',
    l1: '(i) Paid on the client\'s authorisation', l2: '(ii) Shown separately on our invoice', l3: '(iii) In addition to our own services', l4: '(iv) Actual amount, in the client\'s name; no title or own use',
    auth: 'Authorisation ref', authDate: 'Authorisation date', saveAuth: 'Save authorisation and KYC',
    addDisb: 'Add disbursement', addDep: 'Add deposit', apply: 'Apply deposit', refund: 'Refund excess', wo: 'Write off', reason: 'Reason', invoice: 'Invoice',
    received: 'Received', unapplied: 'Unapplied', unrec: 'Unrecovered', owed: 'Invoiced, unpaid', short: 'Short by {a}', excess: 'Excess {a}', billed: 'Billed', off: 'Written off', toRecover: 'To recover', age: 'Unrecovered by age (days)',
    from: 'From', to: 'To', print: 'Print', csv: 'CSV',
    iec: 'IEC', verified: 'KYC verified on', how: 'How', kyc_methods: 'Documents,Visit,Both',
    noKyc: 'KYC of {c} is not recorded (CBLR Reg 10(n)): numbers and dates only, no document copies.',
    wLimb: 'Rule 33 limb {n} not ticked: this recovery may be part of our taxable value.', hDep: 'Duty paid beyond the client\'s deposit by {a}.',
    eAmount: 'Enter an amount above zero.', ePayee: 'Type who was paid.', eDate: 'Choose the date.', noInv: 'No issued rupee invoice of this job is open.', done: 'Saved.',
    importRefs: 'Import SB / BOE numbers (CSV)', imported: '{n} jobs updated.',
    seam: 'Billing → Bill job puts each unrecovered disbursement on the job\'s bill as a Rule 33 line.',
    eWo: 'Give the date and a reason.', eNotOpen: 'Not an open disbursement.', eClient: 'Client not found.',
    rJob: 'Row {r}: job not found', rNo: 'Row {r}: no SB / BOE number', rDate: 'Row {r}: date not read',
  } as const,
  {
    customs: 'सीमा शुल्क', job: 'जॉब', pick: 'एक जॉब चुनें।', disb: 'वितरण व्यय (डिस्बर्समेंट)', deps: 'ड्यूटी जमा', register: 'CB रजिस्टर (विनियम 10(k))',
    kind: 'किसके लिए', kinds: 'सीमा शुल्क (ड्यूटी),CFS,पोर्ट,DO,शिपिंग लाइन,बीमा,अन्य', payee: 'किसे भुगतान', ref: 'चालान / बिल नं.', amount: 'राशि', date: 'तिथि', method: 'माध्यम', paid: 'अभी हमारे खाते से भुगतान',
    l1: '(i) ग्राहक की अनुमति से भुगतान', l2: '(ii) हमारे बिल पर अलग से दिखाया', l3: '(iii) हमारी अपनी सेवाओं के अतिरिक्त', l4: '(iv) वास्तविक राशि, ग्राहक के नाम पर; न स्वामित्व न अपना उपयोग',
    auth: 'अनुमति संदर्भ', authDate: 'अनुमति तिथि', saveAuth: 'अनुमति और KYC सहेजें',
    addDisb: 'डिस्बर्समेंट जोड़ें', addDep: 'जमा जोड़ें', apply: 'जमा समायोजित करें', refund: 'अतिरिक्त लौटाएँ', wo: 'बट्टे खाते डालें', reason: 'कारण', invoice: 'बिल',
    received: 'प्राप्त', unapplied: 'असमायोजित', unrec: 'न वसूला', owed: 'बिल किया, अदत्त', short: '{a} कम', excess: '{a} अधिक', billed: 'बिल किया', off: 'बट्टे खाते', toRecover: 'वसूलना है', age: 'न वसूली राशि आयु अनुसार (दिन)',
    from: 'से', to: 'तक', print: 'प्रिंट', csv: 'CSV',
    iec: 'IEC', verified: 'KYC जाँच तिथि', how: 'कैसे', kyc_methods: 'दस्तावेज़,दौरा,दोनों',
    noKyc: '{c} का KYC दर्ज नहीं है (CBLR विनियम 10(n)): केवल नंबर और तिथियाँ, दस्तावेज़ की प्रतियाँ नहीं।',
    wLimb: 'नियम 33 की शर्त {n} पर टिक नहीं: यह वसूली हमारे कर-योग्य मूल्य में गिनी जा सकती है।', hDep: 'ग्राहक की जमा से {a} अधिक ड्यूटी चुकाई गई।',
    eAmount: 'शून्य से अधिक राशि लिखें।', ePayee: 'किसे भुगतान किया, लिखें।', eDate: 'तिथि चुनें।', noInv: 'इस जॉब का कोई जारी रुपया बिल बकाया नहीं है।', done: 'सहेजा गया।',
    importRefs: 'SB / BOE नंबर आयात करें (CSV)', imported: '{n} जॉब अपडेट हुईं।',
    seam: 'बिलिंग → जॉब का बिल बनाएँ: हर न वसूला डिस्बर्समेंट नियम 33 पंक्ति के रूप में बिल पर जुड़ता है।',
    eWo: 'तिथि और कारण लिखें।', eNotOpen: 'यह खुला डिस्बर्समेंट नहीं है।', eClient: 'ग्राहक नहीं मिला।',
    rJob: 'पंक्ति {r}: जॉब नहीं मिली', rNo: 'पंक्ति {r}: SB / BOE नंबर नहीं', rDate: 'पंक्ति {r}: तिथि नहीं पढ़ी गई',
  },
);

/** The label of `id` in the comma-separated list `key` whose ids are `ids`. */
export const lgcList = (key: 'kinds' | 'kyc_methods', ids: readonly string[], id: string): string => lgcT(key).split(',')[ids.indexOf(id)] ?? id;
