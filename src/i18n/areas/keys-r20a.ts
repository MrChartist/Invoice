/**
 * R20-A6: every key row's label for the whole of Round 20 (A–D), plus the cheat sheet, Key bar and Vouchers sheet.
 * Row labels are keyed by the row's `plain` / `tally` key in `src/lib/keys/registry.ts` (plain name first, Tally name
 * second, U3). B–D never edit this file: their dialogs' strings go in keys-r20b / c / d; a missing row label is a lead fix.
 */
import { defineArea } from '../area';
export const keysT = defineArea(
  {
    // rows — this app
    palette: 'Command palette', search: 'Search', keys: 'Keyboard cheat sheet', help: 'Help for this screen', back: 'Back / close',
    save: 'Save', print: 'Preview / print', pos: 'POS counter', repeat: "Repeat the party's last bill", undo: 'Undo',
    goDash: 'Go to Dashboard', goNew: 'Go to New invoice', goInv: 'Go to Invoices', goCli: 'Go to Clients', goSet: 'Go to Settings',
    // going places
    goto: 'Go to any screen', switch: 'Switch to a screen', date: 'Change date', period: 'Change period', vouchers: 'List of vouchers',
    // vouchers
    contra: 'Bank ↔ cash', payment: 'Money paid out', receipt: 'Money received', journal: 'Adjustment', sales: 'New invoice',
    purchase: 'Supplier bill', creditNote: 'Credit note (sales return)', debitNote: 'Debit note', salesOrder: 'Sales order',
    purchaseOrder: 'Purchase order', deliveryNote: 'Delivery challan', receiptNote: 'Goods received (GRN)', stockJournal: 'Stock journal',
    physicalStock: 'Stock count', payroll: 'Payroll', rejOut: 'Goods sent back to supplier', rejIn: 'Goods back from customer',
    // while entering
    accept: 'Save (accept)', next: 'Next field', create: 'Create new here', alterMaster: 'Edit this party / item', delete: 'Delete',
    cancel: 'Cancel document', dup: 'Duplicate', rmLine: 'Remove line', postDated: 'Post-dated', optional: 'Optional (not in books yet)',
    mode: 'Change entry mode', more: 'More details', stockQuery: 'Stock of this item', related: 'Party facts', gstAnalysis: 'Tax break-up',
    narrType: 'Last narration of this type', narrParty: "Party's last narration", editLog: 'Edit history',
    prevV: 'Previous entry', nextV: 'Next entry',
    // reports and lists
    drill: 'Open (drill down)', drillUp: 'Back one level', detail: 'Detailed / short', options: 'Report options', basis: 'Show values as',
    views: 'Saved views', saveView: 'Save this view', except: 'Exceptions', filter: 'Filter', select: 'Tick a row', extend: 'Tick the next rows',
    invert: 'Invert ticks', expand: 'Expand / collapse', alterRow: 'Open its master', hide: 'Hide row', unhide: 'Show the last hidden row',
    unhideAll: 'Show all rows', stepNext: 'Next period', stepPrev: 'Previous period', autoCols: 'Period columns', addCol: 'Add a column',
    delCol: 'Remove a column', insert: 'New entry on that day', printReport: 'Print', export: 'Export', share: 'Share', move: 'Move in the list',
    // company and data
    company: 'Switch company', companies: 'Companies', lock: 'Lock now', menuCompany: 'Company menu', menuData: 'Data menu',
    menuImport: 'Import', notify: 'Notifications', repair: 'Check data', about: 'About this app', features: 'Features on / off', configure: 'Settings',
    // Tally names
    t_back: 'Quit', t_accept: 'Accept',
    t_goto: 'Go To', t_switch: 'Switch To', t_helpCtx: 'Help topic', t_vouchers: 'Other vouchers',
    t_contra: 'Contra', t_payment: 'Payment', t_receipt: 'Receipt', t_journal: 'Journal', t_sales: 'Sales', t_purchase: 'Purchase',
    t_deliveryNote: 'Delivery Note', t_receiptNote: 'Receipt Note', t_physicalStock: 'Physical Stock',
    t_rejOut: 'Rejection Out', t_rejIn: 'Rejection In', t_create: 'Create master', t_alterMaster: 'Alter master',
   
    t_stockQuery: 'Stock query', t_related: 'Related reports', t_gstAnalysis: 'Tax analysis',
    t_editLog: 'Edit log', t_prevV: 'Previous voucher', t_nextV: 'Next voucher',
    t_drillUp: 'Drill up', t_detail: 'Detailed / Condensed', t_options: 'Configure', t_basis: 'Basis of values', t_views: 'Change view',
    t_except: 'Exception reports', t_select: 'Select', t_extend: 'Extend selection',
    t_invert: 'Invert selection', t_hide: 'Remove line', t_unhide: 'Restore line', t_unhideAll: 'Restore all', t_step: 'Next / previous (+ / −)',
    t_autoCols: 'Auto repeat columns', t_delCol: 'Delete column', t_insert: 'Insert voucher',
    t_share: 'E-mail / share', t_whatsapp: 'WhatsApp', t_company: 'Select company', t_companies: 'Company info', t_lock: 'Shut company',
    t_repair: 'Rewrite data',
    t_about: 'Build information', t_features: 'Company features', t_configure: 'Configure',
    // never claimed (what to use instead)
    nc_calc: 'Ctrl+N calculator: type 120*3 in an amount', nc_postDated: 'Ctrl+T post-dated: Alt+T',
    nc_lang: 'Ctrl+W entry language: your keyboard', nc_payroll: 'Ctrl+F4 payroll: Ctrl+Shift+F4 or F10',
    nc_quit: 'Alt+F4 quit: closes the browser', nc_quitScreen: 'Ctrl+Q quit screen: Esc',
    nc_find: 'Alt+F find: Ctrl+F on a report', nc_export: 'Alt+E export: Ctrl+E on a report',
    // cheat sheet, Key bar, Vouchers sheet
    title: 'Keyboard cheat sheet', sub: 'Plain name · Tally name · key', find: 'Search: payment, F5, Contra …', screen: 'This screen', all: 'All',
    g_goto: 'Go to', g_vouchers: 'Vouchers', g_entry: 'While entering', g_reports: 'Reports & lists', g_company: 'Company & data', g_app: 'This app',
    g_never: 'Not in a browser', then: 'then',
    switch_: 'Tally keys', switchHint: "Off: the app's own keys only (F5 reloads). On: Tally's keys.", layout: 'Key layout',
    prime: 'TallyPrime', erp9: 'Tally.ERP 9', needOn: 'Switch on Tally keys to use', printBtn: 'Print', none: 'No key matches.',
    fn: 'On a Mac, hold fn for F-keys.', other: '{layout}: {key}', reload: "Reload: the browser's ⟳ button", on: 'Tally keys on', off: 'Tally keys off',
    bar: 'Keys of this screen', keysBtn: 'Keys', hideBar: 'Hide keys', vTitle: 'Vouchers (F10)', vSub: 'Press a letter, or click.', pMode: 'Tally keys on / off', pLayout: 'Key layout: TallyPrime / Tally.ERP 9',
  } as const,
  {
    palette: 'कमांड पैलेट', search: 'खोजें', keys: 'कीबोर्ड कुंजी सूची', help: 'इस स्क्रीन की मदद', back: 'वापस / बंद करें',
    save: 'सेव करें', print: 'प्रीव्यू / प्रिंट', pos: 'POS काउंटर', repeat: 'पार्टी का पिछला बिल दोहराएँ', undo: 'पूर्ववत करें',
    goDash: 'डैशबोर्ड पर जाएँ', goNew: 'नए इनवॉइस पर जाएँ', goInv: 'इनवॉइस सूची पर जाएँ', goCli: 'ग्राहकों पर जाएँ', goSet: 'सेटिंग्स पर जाएँ',
    goto: 'कोई भी स्क्रीन खोलें', switch: 'स्क्रीन बदलें', date: 'तिथि बदलें', period: 'अवधि बदलें', vouchers: 'वाउचरों की सूची',
    contra: 'बैंक ↔ नकद', payment: 'भुगतान किया (पैसा गया)', receipt: 'पैसा मिला (प्राप्ति)', journal: 'समायोजन', sales: 'नया इनवॉइस',
    purchase: 'सप्लायर का बिल', creditNote: 'क्रेडिट नोट (बिक्री वापसी)', debitNote: 'डेबिट नोट', salesOrder: 'बिक्री ऑर्डर',
    purchaseOrder: 'खरीद ऑर्डर', deliveryNote: 'डिलीवरी चालान', receiptNote: 'माल प्राप्ति (GRN)', stockJournal: 'स्टॉक जर्नल',
    physicalStock: 'स्टॉक गिनती', payroll: 'पेरोल', rejOut: 'सप्लायर को माल वापस', rejIn: 'ग्राहक से माल वापस',
    accept: 'सेव करें (स्वीकार)', next: 'अगला खाना', create: 'यहीं नया बनाएँ', alterMaster: 'इस पार्टी / आइटम को बदलें', delete: 'हटाएँ',
    cancel: 'दस्तावेज़ रद्द करें', dup: 'प्रतिलिपि बनाएँ', rmLine: 'पंक्ति हटाएँ', postDated: 'आगे की तिथि (पोस्ट-डेटेड)', optional: 'वैकल्पिक (अभी खातों में नहीं)',
    mode: 'एंट्री का तरीका बदलें', more: 'और विवरण', stockQuery: 'इस आइटम का स्टॉक', related: 'पार्टी की जानकारी', gstAnalysis: 'टैक्स का ब्योरा',
    narrType: 'इस प्रकार का पिछला विवरण', narrParty: 'पार्टी का पिछला विवरण', editLog: 'बदलाव का इतिहास',
    prevV: 'पिछली एंट्री', nextV: 'अगली एंट्री',
    drill: 'खोलें (ड्रिल डाउन)', drillUp: 'एक स्तर पीछे', detail: 'विस्तृत / संक्षिप्त', options: 'रिपोर्ट विकल्प', basis: 'मान ऐसे दिखाएँ',
    views: 'सेव्ड व्यू', saveView: 'यह व्यू सेव करें', except: 'अपवाद', filter: 'फ़िल्टर', select: 'पंक्ति पर टिक', extend: 'अगली पंक्तियों पर टिक',
    invert: 'टिक उलटें', expand: 'खोलें / समेटें', alterRow: 'इसका मास्टर खोलें', hide: 'पंक्ति छिपाएँ', unhide: 'पिछली छिपी पंक्ति दिखाएँ',
    unhideAll: 'सभी पंक्तियाँ दिखाएँ', stepNext: 'अगली अवधि', stepPrev: 'पिछली अवधि', autoCols: 'अवधि के कॉलम', addCol: 'कॉलम जोड़ें',
    delCol: 'कॉलम हटाएँ', insert: 'उसी दिन नई एंट्री', printReport: 'प्रिंट', export: 'एक्सपोर्ट', share: 'शेयर करें', move: 'सूची में चलें',
    company: 'कंपनी बदलें', companies: 'कंपनियाँ', lock: 'अभी लॉक करें', menuCompany: 'कंपनी मेनू', menuData: 'डेटा मेनू',
    menuImport: 'इम्पोर्ट', notify: 'सूचनाएँ', repair: 'डेटा जाँचें', about: 'ऐप के बारे में', features: 'सुविधाएँ चालू / बंद', configure: 'सेटिंग्स',
    t_back: 'बाहर निकलें', t_accept: 'स्वीकार',
    t_goto: 'गो टू', t_switch: 'स्विच टू', t_helpCtx: 'मदद विषय', t_vouchers: 'अन्य वाउचर',
    t_contra: 'कॉन्ट्रा', t_payment: 'पेमेंट', t_receipt: 'रसीद (रिसीट)', t_journal: 'जर्नल', t_sales: 'बिक्री (सेल्स)', t_purchase: 'खरीद (पर्चेज़)',
    t_deliveryNote: 'डिलीवरी नोट', t_receiptNote: 'रिसीट नोट', t_physicalStock: 'फ़िज़िकल स्टॉक',
    t_rejOut: 'रिजेक्शन आउट', t_rejIn: 'रिजेक्शन इन', t_create: 'मास्टर बनाएँ', t_alterMaster: 'मास्टर बदलें',
   
    t_stockQuery: 'स्टॉक क्वेरी', t_related: 'संबंधित रिपोर्ट', t_gstAnalysis: 'टैक्स विश्लेषण',
    t_editLog: 'एडिट लॉग', t_prevV: 'पिछला वाउचर', t_nextV: 'अगला वाउचर',
    t_drillUp: 'ड्रिल अप', t_detail: 'विस्तृत / संक्षिप्त', t_options: 'कॉन्फ़िगर', t_basis: 'मानों का आधार', t_views: 'व्यू बदलें',
    t_except: 'अपवाद रिपोर्ट', t_select: 'चुनें', t_extend: 'चयन बढ़ाएँ',
    t_invert: 'चयन उलटें', t_hide: 'पंक्ति हटाएँ', t_unhide: 'पंक्ति वापस लाएँ', t_unhideAll: 'सभी वापस लाएँ', t_step: 'अगला / पिछला (+ / −)',
    t_autoCols: 'कॉलम दोहराएँ', t_delCol: 'कॉलम हटाएँ', t_insert: 'वाउचर डालें',
    t_share: 'ई-मेल / शेयर', t_whatsapp: 'व्हाट्सऐप', t_company: 'कंपनी चुनें', t_companies: 'कंपनी जानकारी', t_lock: 'कंपनी बंद करें',
    t_repair: 'डेटा दोबारा लिखें',
    t_about: 'बिल्ड जानकारी', t_features: 'कंपनी सुविधाएँ', t_configure: 'कॉन्फ़िगर',
    nc_calc: 'Ctrl+N कैलकुलेटर: रकम में 120*3 लिखें', nc_postDated: 'Ctrl+T पोस्ट-डेटेड: Alt+T',
    nc_lang: 'Ctrl+W एंट्री भाषा: अपना कीबोर्ड', nc_payroll: 'Ctrl+F4 पेरोल: Ctrl+Shift+F4 या F10',
    nc_quit: 'Alt+F4 बंद: ब्राउज़र बंद करता है', nc_quitScreen: 'Ctrl+Q स्क्रीन बंद: Esc',
    nc_find: 'Alt+F खोज: रिपोर्ट पर Ctrl+F', nc_export: 'Alt+E एक्सपोर्ट: रिपोर्ट पर Ctrl+E',
    title: 'कीबोर्ड कुंजी सूची', sub: 'आसान नाम · Tally नाम · कुंजी', find: 'खोजें: भुगतान, payment, F5', screen: 'यह स्क्रीन', all: 'सभी',
    g_goto: 'कहीं जाएँ', g_vouchers: 'वाउचर', g_entry: 'एंट्री करते समय', g_reports: 'रिपोर्ट और सूचियाँ', g_company: 'कंपनी और डेटा', g_app: 'यह ऐप',
    g_never: 'ब्राउज़र में नहीं', then: 'फिर',
    switch_: 'Tally कुंजियाँ', switchHint: 'बंद: केवल ऐप की कुंजियाँ (F5 रीलोड)। चालू: Tally की कुंजियाँ।', layout: 'कुंजी लेआउट',
    prime: 'TallyPrime', erp9: 'Tally.ERP 9', needOn: 'उपयोग के लिए Tally कुंजियाँ चालू करें', printBtn: 'प्रिंट', none: 'कोई कुंजी नहीं मिली।',
    fn: 'Mac पर F-कुंजियों के लिए fn दबाए रखें।', other: '{layout}: {key}', reload: 'रीलोड: ब्राउज़र का ⟳ बटन', on: 'Tally कुंजियाँ चालू', off: 'Tally कुंजियाँ बंद',
    bar: 'इस स्क्रीन की कुंजियाँ', keysBtn: 'कुंजियाँ', hideBar: 'कुंजियाँ छिपाएँ', vTitle: 'वाउचर (F10)', vSub: 'कोई अक्षर दबाएँ या क्लिक करें।', pMode: 'टैली कुंजियाँ चालू / बंद', pLayout: 'कुंजी लेआउट: TallyPrime / Tally.ERP 9',
  },
);
export type KeysKey = Parameters<typeof keysT>[0];
