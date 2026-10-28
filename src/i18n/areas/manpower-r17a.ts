/**
 * R17-A: manpower core strings (Deploy desk, sites and posts, regime chip, editor row). Words used by more than one
 * package (site, post, duty, muster, shift, reliever, service charge, client, month, compliance) live here once; B–D
 * import them. Lists (`sts`, `bases`, `regs`, `deds`, `secs`) are comma-separated, in the order of their ids.
 */
import { defineArea } from '../area';

export const mpT = defineArea(
  {
    deploy: 'Deploy', sites: 'Sites', site: 'Site', post: 'Post', posts: 'Posts', client: 'Client', month: 'Month',
    duty: 'Duty', duties: 'Duties', muster: 'Duty register (muster)', shift: 'Shift (h)', reliever: 'Reliever', serviceCharge: 'Service charge', compliance: 'Compliance',
    code: 'Code', name: 'Name', address: 'Address', state: 'State code', from: 'From', to: 'To', ref: 'Contract ref.', status: 'Status',
    basis: 'Basis', heads: 'Heads', rate: 'Rate', sac: 'SAC', addPost: 'Add post', remove: 'Remove', save: 'Save', newSite: 'New site', open: 'Open',
    value: 'Value / month', ends: 'Contract ends', none: 'No sites yet.', saved: 'Site saved.', deployed: 'Deployed', deployEmp: 'Deploy employee',
    flags: 'Client flags', tdsOnly: 'Government client registered only for GST TDS', composition: 'Composition taxpayer', school: 'School (pre-school to higher secondary)',
    tdsSec: 'Client TDS section', deductee: 'We are',
    regime: 'GST regime', note: 'Reason (audited)', split: 'Security and other posts: bill them on two invoices (MP1).',
    'reg.rcm': 'Reverse charge — client pays GST', 'reg.fwd': 'Forward charge {r} %', 'reg.exempt66': 'Exempt — school (Sl. 66)', 'reg.manual_exempt': 'Exempt — reason typed',
    sts: 'Active,Paused,Closed', bases: 'Per month,Per duty,Per hour,Cost-plus', regs: 'Auto,Forward charge,Reverse charge,Exempt (school),Exempt (reason)',
    deds: 'Company,Individual / HUF / firm', secs: '194C,194J,None',
    wp: 'Working papers — verify with your CA.',
  } as const,
  {
    deploy: 'तैनाती', sites: 'साइटें', site: 'साइट', post: 'पोस्ट', posts: 'पोस्ट', client: 'ग्राहक', month: 'महीना',
    duty: 'ड्यूटी', duties: 'ड्यूटी', muster: 'ड्यूटी रजिस्टर (मस्टर)', shift: 'शिफ्ट (घंटे)', reliever: 'रिलीवर', serviceCharge: 'सेवा शुल्क', compliance: 'अनुपालन',
    code: 'कोड', name: 'नाम', address: 'पता', state: 'राज्य कोड', from: 'से', to: 'तक', ref: 'अनुबंध संदर्भ', status: 'स्थिति',
    basis: 'आधार', heads: 'व्यक्ति', rate: 'दर', sac: 'SAC', addPost: 'पोस्ट जोड़ें', remove: 'हटाएँ', save: 'सहेजें', newSite: 'नई साइट', open: 'खोलें',
    value: 'मासिक मूल्य', ends: 'अनुबंध समाप्ति', none: 'अभी कोई साइट नहीं।', saved: 'साइट सहेजी गई।', deployed: 'तैनात', deployEmp: 'कर्मचारी तैनात करें',
    flags: 'ग्राहक की जानकारी', tdsOnly: 'केवल GST TDS के लिए पंजीकृत सरकारी ग्राहक', composition: 'कंपोज़िशन करदाता', school: 'स्कूल (प्री-स्कूल से उच्चतर माध्यमिक)',
    tdsSec: 'ग्राहक की TDS धारा', deductee: 'हम हैं',
    regime: 'GST व्यवस्था', note: 'कारण (ऑडिट होगा)', split: 'सुरक्षा और अन्य पोस्ट: इन्हें दो इनवॉइस पर बिल करें (MP1)।',
    'reg.rcm': 'रिवर्स चार्ज (ग्राहक GST देगा)', 'reg.fwd': 'फ़ॉरवर्ड चार्ज {r} %', 'reg.exempt66': 'छूट — स्कूल (क्रम 66)', 'reg.manual_exempt': 'छूट — लिखा कारण',
    sts: 'सक्रिय,रुकी,बंद', bases: 'प्रति माह,प्रति ड्यूटी,प्रति घंटा,लागत-आधारित', regs: 'स्वतः,फ़ॉरवर्ड चार्ज,रिवर्स चार्ज,छूट (स्कूल),छूट (कारण)',
    deds: 'कंपनी,व्यक्ति / HUF / फ़र्म', secs: '194C,194J,कोई नहीं',
    wp: 'कार्य-पत्र — अपने CA से जाँचें।',
  },
);

/** The label of `id` in the comma-separated list `key` whose ids are `ids`. */
export const mpList = (key: 'sts' | 'bases' | 'regs' | 'deds' | 'secs', ids: readonly string[], id: string): string => mpT(key).split(',')[ids.indexOf(id)] ?? id;
