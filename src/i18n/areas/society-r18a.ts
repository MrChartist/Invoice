/**
 * R18-A: housing-society core strings (Society desk, units and members, charge heads and the preview). Words used by
 * more than one package (unit, wing, member, owner, tenant, head, total) live here once; B–D import them and add their
 * own. Lists (`uses`, `occs`, `kinds`, `bases`, `cycles`) are comma-separated, in the order of their ids.
 */
import { defineArea } from '../area';

export const hsT = defineArea(
  {
    units: 'Units', heads: 'Tariff', unit: 'Unit', wing: 'Wing', member: 'Member', owner: 'Owner', tenant: 'Tenant', head: 'Head', total: 'Total', all: 'All',
    code: 'Code', use: 'Use', carpet: 'Carpet area', super: 'Super area', undivided: 'Undivided %', cost: 'Construction cost', occupancy: 'Occupancy', parking: 'Parking slots', typed: 'Amounts for this unit',
    newUnit: 'New unit', open: 'Open', save: 'Save', saved: 'Saved.', del: 'Delete', cancel: 'Cancel', none: 'No units yet.',
    state: 'State', cycle: 'Billing cycle', dueDays: 'Due in (days)', applyDefaults: 'Apply State defaults', addHead: 'Add head', kind: 'Kind', basis: 'Basis', rate: 'Rate', active: 'On',
    preview: 'Bill preview', memberCharges: 'Member charges', statutory: 'Statutory dues (outside GST)',
    fundLow: '{h} {v} % is below the {s} minimum {m} % ({ca}).', nocHigh: '{h} {v} % is above the {s} cap {m} % ({ca}).',
    proposed: '{s}: proposed rules ({ca}).', confirm: 'In force for us',
    uses: 'Residential,Commercial,Garage,Other', occs: 'Owner,Let out,Vacant',
    kinds: 'Service,Sinking fund,Repair fund,Major repair fund,Statutory,Supply,Parking,Non-occupancy,Education,Election,Insurance,Lease rent,Non-member,Other',
    bases: 'Per unit,Carpet area,Super area,Undivided %,% a year of cost,Per slot,% of service,Typed,Per member',
    cycles: 'Monthly,Quarterly,Half-yearly',
    wp: 'Working papers — verify with your CA.',
    eCode: 'Type the unit code (A-101).', eTaken: 'Unit {c} already exists.', eNum: '{f}: 0 or more.', eUndiv: 'Undivided % above 100.', wUndiv: 'Undivided % adds up to {s}, not 100.',
    imp: 'Import CSV / XLSX', impTpl: 'Template', impNoCode: 'The sheet needs a code (unit / flat no.) column.', impBad: '{f}: "{v}" is not known.', impDup: 'Unit {c} is twice in the sheet.', impPhone: '{n} has another phone; the client is kept.',
    impSum: '{c} new, {u} updated, {e} with errors. New members: {m}.', impGo: 'Import', impFix: 'Fix the rows with errors in the sheet and choose it again.', impDone: 'Imported: {c} new, {u} updated, {m} new members.',
    impUndo: 'Undo import', impUndone: 'Import undone.', impNoCopy: 'An undo copy could not be saved. Import anyway?', row: 'Row', error: 'Error',
  } as const,
  {
    units: 'यूनिट', heads: 'शुल्क सूची', unit: 'यूनिट', wing: 'विंग', member: 'सदस्य', owner: 'मालिक', tenant: 'किरायेदार', head: 'शीर्ष', total: 'कुल', all: 'सभी',
    code: 'कोड', use: 'उपयोग', carpet: 'कारपेट क्षेत्र', super: 'सुपर क्षेत्र', undivided: 'अविभाजित %', cost: 'निर्माण लागत', occupancy: 'अधिवास', parking: 'पार्किंग स्लॉट', typed: 'इस यूनिट की राशियाँ',
    newUnit: 'नई यूनिट', open: 'खोलें', save: 'सहेजें', saved: 'सहेजा गया।', del: 'हटाएँ', cancel: 'रद्द करें', none: 'अभी कोई यूनिट नहीं।',
    state: 'राज्य', cycle: 'बिलिंग चक्र', dueDays: 'देय (दिन)', applyDefaults: 'राज्य के डिफ़ॉल्ट लगाएँ', addHead: 'शीर्ष जोड़ें', kind: 'प्रकार', basis: 'आधार', rate: 'दर', active: 'चालू',
    preview: 'बिल पूर्वावलोकन', memberCharges: 'सदस्य शुल्क', statutory: 'वैधानिक देय (GST से बाहर)',
    fundLow: '{h} {v} % {s} के न्यूनतम {m} % से कम है ({ca})।', nocHigh: '{h} {v} % {s} की सीमा {m} % से अधिक है ({ca})।',
    proposed: '{s}: प्रस्तावित नियम ({ca})।', confirm: 'हमारे लिए प्रभावी',
    uses: 'आवासीय,व्यावसायिक,गैराज,अन्य', occs: 'मालिक,किराये पर,ख़ाली',
    kinds: 'सेवा शुल्क,सिंकिंग फ़ंड,मरम्मत निधि,बड़ी मरम्मत निधि,वैधानिक देय,सोसाइटी द्वारा आपूर्ति,पार्किंग शुल्क,गैर-अधिवास शुल्क (नॉन-ऑक्युपेंसी),शिक्षा,चुनाव,बीमा,लीज़ किराया,गैर-सदस्य आय,अन्य',
    bases: 'प्रति यूनिट,कारपेट क्षेत्र,सुपर क्षेत्र,अविभाजित %,लागत का वार्षिक %,प्रति स्लॉट,सेवा शुल्क का %,यूनिट-वार लिखी राशि,प्रति सदस्य',
    cycles: 'मासिक,तिमाही,छमाही',
    wp: 'कार्य-पत्र — अपने CA से जाँचें।',
    eCode: 'यूनिट कोड लिखें (A-101)।', eTaken: 'यूनिट {c} पहले से है।', eNum: '{f}: 0 या अधिक।', eUndiv: 'अविभाजित % 100 से अधिक।', wUndiv: 'अविभाजित % का जोड़ {s} है, 100 नहीं।',
    imp: 'CSV / XLSX इम्पोर्ट', impTpl: 'टेम्पलेट', impNoCode: 'शीट में कोड (यूनिट / फ़्लैट नं.) का कॉलम चाहिए।', impBad: '{f}: "{v}" पहचाना नहीं गया।', impDup: 'यूनिट {c} शीट में दो बार है।', impPhone: '{n} का फ़ोन अलग है; क्लाइंट वही रखा गया।',
    impSum: '{c} नई, {u} अपडेट, {e} में त्रुटि। नए सदस्य: {m}।', impGo: 'इम्पोर्ट करें', impFix: 'त्रुटि वाली पंक्तियाँ शीट में ठीक करें और फिर से चुनें।', impDone: 'इम्पोर्ट हुआ: {c} नई, {u} अपडेट, {m} नए सदस्य।',
    impUndo: 'इम्पोर्ट वापस लें', impUndone: 'इम्पोर्ट वापस लिया गया।', impNoCopy: 'वापसी की कॉपी नहीं बन सकी। फिर भी इम्पोर्ट करें?', row: 'पंक्ति', error: 'त्रुटि',
  },
);

/** The label of `id` in the comma-separated list `key` whose ids are `ids`. */
export const hsList = (key: 'uses' | 'occs' | 'kinds' | 'bases' | 'cycles', ids: readonly string[], id: string): string => hsT(key).split(',')[ids.indexOf(id)] ?? id;
