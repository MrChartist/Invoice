/**
 * R18-A: housing-society core strings (Society desk, units and members, charge heads and the preview). Words used by
 * more than one package (unit, flat, wing, member, owner, tenant, head, period, arrears, fund, maintenance) live here
 * once; B–D import them. Lists (`uses`, `occs`, `slots`, `kinds`, `bases`, `cycles`) are comma-separated, in the order
 * of their ids.
 */
import { defineArea } from '../area';

export const hsT = defineArea(
  {
    society: 'Society', units: 'Units', heads: 'Tariff', unit: 'Unit', flat: 'Flat', wing: 'Wing', floor: 'Floor', member: 'Member', members: 'Members', owner: 'Owner', joint: 'Joint owners', tenant: 'Tenant',
    head: 'Head', period: 'Period', arrears: 'Arrears', fund: 'Fund', maintenance: 'Maintenance bill', all: 'All',
    code: 'Code', use: 'Use', carpet: 'Carpet area', super: 'Super area', undivided: 'Undivided %', cost: 'Construction cost', inlets: 'Inlets', lifted: 'Lifted building',
    occupancy: 'Occupancy', parking: 'Parking', slot: 'Slot', addSlot: 'Add slot', typed: 'Amounts for this unit', status: 'Status',
    newUnit: 'New unit', open: 'Open', save: 'Save', saved: 'Unit saved.', del: 'Delete', deleted: 'Unit deleted.', cancel: 'Cancel', remove: 'Remove',
    none: 'No units yet. Add them one by one or import your sheet.', total: 'Total', slotsN: '{n} slots',
    newMember: 'New member', name: 'Name', phone: 'Phone', email: 'E-mail', addMember: 'Add member', pick: '— pick —',
    import: 'Import units (CSV / XLSX)', importHint: 'Columns: code, wing, use, carpet_area, super_area, undivided_pct, construction_cost, owner, phone, email, occupancy, tenant, parking.',
    importConfirm: 'Add {n} units', createOwners: 'Create the {n} members not found', unmatched: 'Not matched to a member: {c}', skipped: 'Skipped: {c}', imported: '{n} units added, {m} members created.',
    state: 'State', cycle: 'Billing cycle', billDay: 'Bill day', dueDays: 'Due in (days)', areaUnit: 'Area in', applyDefaults: 'Apply State defaults', addHead: 'Add head',
    kind: 'Kind', basis: 'Basis', rate: 'Rate', sac: 'SAC', active: 'On', saveTariff: 'Save tariff', savedTariff: 'Tariff saved.',
    preview: 'Monthly bill preview', memberCharges: 'Member charges', statutory: 'Statutory dues (outside GST)', firstN: 'First {n} units shown; totals cover all {m}.',
    sinkingLow: 'Sinking fund {v} % is below the {s} minimum {m} % ({ca}).', repairLow: 'Repair fund {v} % is below the {s} minimum {m} % ({ca}).', nocHigh: 'Non-occupancy {v} % is above the {s} cap {m} % ({ca}).',
    proposed: 'Proposed rules for {s} — confirm they are in force before they apply ({ca}).', confirm: 'They are in force for us', noState: 'No State rules held: type your rates.',
    uses: 'Residential,Commercial,Garage,Other', occs: 'Owner,Let out,Vacant', slots: 'Covered,Open,Stilt,Two-wheeler',
    kinds: 'Service charges,Sinking fund,Repair fund,Major repair fund,Statutory dues (pass-through),Society-provided supply,Parking,Non-occupancy,Education,Election,Insurance,Lease rent,Non-member income,Other',
    bases: 'Per unit,Carpet area,Super area,Undivided %,% a year of cost,Per slot,Per inlet,Per lifted unit,% of service charges,Typed per unit,Per member',
    cycles: 'Monthly,Quarterly,Half-yearly',
    wp: 'Working papers — verify with your CA.',
  } as const,
  {
    society: 'सोसाइटी', units: 'यूनिट', heads: 'शुल्क सूची', unit: 'यूनिट', flat: 'फ़्लैट', wing: 'विंग', floor: 'मंज़िल', member: 'सदस्य', members: 'सदस्य', owner: 'मालिक', joint: 'संयुक्त मालिक', tenant: 'किरायेदार',
    head: 'शीर्ष', period: 'अवधि', arrears: 'बकाया', fund: 'निधि', maintenance: 'रखरखाव बिल (मेंटेनेंस)', all: 'सभी',
    code: 'कोड', use: 'उपयोग', carpet: 'कारपेट क्षेत्र', super: 'सुपर क्षेत्र', undivided: 'अविभाजित %', cost: 'निर्माण लागत', inlets: 'इनलेट', lifted: 'लिफ़्ट वाली इमारत',
    occupancy: 'अधिवास', parking: 'पार्किंग', slot: 'स्लॉट', addSlot: 'स्लॉट जोड़ें', typed: 'इस यूनिट की राशियाँ', status: 'स्थिति',
    newUnit: 'नई यूनिट', open: 'खोलें', save: 'सहेजें', saved: 'यूनिट सहेजी गई।', del: 'हटाएँ', deleted: 'यूनिट हटाई गई।', cancel: 'रद्द करें', remove: 'हटाएँ',
    none: 'अभी कोई यूनिट नहीं। एक-एक कर जोड़ें या अपनी शीट आयात करें।', total: 'कुल', slotsN: '{n} स्लॉट',
    newMember: 'नया सदस्य', name: 'नाम', phone: 'फ़ोन', email: 'ई-मेल', addMember: 'सदस्य जोड़ें', pick: '— चुनें —',
    import: 'यूनिट आयात करें (CSV / XLSX)', importHint: 'कॉलम: code, wing, use, carpet_area, super_area, undivided_pct, construction_cost, owner, phone, email, occupancy, tenant, parking।',
    importConfirm: '{n} यूनिट जोड़ें', createOwners: 'न मिले {n} सदस्य बनाएँ', unmatched: 'किसी सदस्य से नहीं मिला: {c}', skipped: 'छोड़े गए: {c}', imported: '{n} यूनिट जोड़ी गईं, {m} सदस्य बनाए गए।',
    state: 'राज्य', cycle: 'बिलिंग चक्र', billDay: 'बिल का दिन', dueDays: 'देय (दिन)', areaUnit: 'क्षेत्र की इकाई', applyDefaults: 'राज्य के डिफ़ॉल्ट लगाएँ', addHead: 'शीर्ष जोड़ें',
    kind: 'प्रकार', basis: 'आधार', rate: 'दर', sac: 'SAC', active: 'चालू', saveTariff: 'शुल्क सूची सहेजें', savedTariff: 'शुल्क सूची सहेजी गई।',
    preview: 'मासिक बिल पूर्वावलोकन', memberCharges: 'सदस्य शुल्क', statutory: 'वैधानिक देय (GST से बाहर)', firstN: 'पहली {n} यूनिट दिखाई गईं; कुल सभी {m} का है।',
    sinkingLow: 'सिंकिंग फ़ंड {v} % {s} के न्यूनतम {m} % से कम है ({ca})।', repairLow: 'मरम्मत निधि {v} % {s} के न्यूनतम {m} % से कम है ({ca})।', nocHigh: 'गैर-अधिवास शुल्क {v} % {s} की सीमा {m} % से अधिक है ({ca})।',
    proposed: '{s} के प्रस्तावित नियम — लागू होने से पहले पुष्टि करें कि वे प्रभावी हैं ({ca})।', confirm: 'हमारे लिए ये प्रभावी हैं', noState: 'राज्य के नियम उपलब्ध नहीं: अपनी दरें लिखें।',
    uses: 'आवासीय,व्यावसायिक,गैराज,अन्य', occs: 'मालिक,किराये पर,ख़ाली', slots: 'ढकी,खुली,स्टिल्ट,दोपहिया',
    kinds: 'सेवा शुल्क,सिंकिंग फ़ंड,मरम्मत निधि,बड़ी मरम्मत निधि,वैधानिक देय (पास-थ्रू),सोसाइटी द्वारा आपूर्ति,पार्किंग शुल्क,गैर-अधिवास शुल्क (नॉन-ऑक्युपेंसी),शिक्षा,चुनाव,बीमा,लीज़ किराया,गैर-सदस्य आय,अन्य',
    bases: 'प्रति यूनिट,कारपेट क्षेत्र,सुपर क्षेत्र,अविभाजित %,लागत का वार्षिक %,प्रति स्लॉट,प्रति इनलेट,लिफ़्ट वाली प्रति यूनिट,सेवा शुल्क का %,यूनिट-वार लिखी राशि,प्रति सदस्य',
    cycles: 'मासिक,तिमाही,छमाही',
    wp: 'कार्य-पत्र — अपने CA से जाँचें।',
  },
);

/** The label of `id` in the comma-separated list `key` whose ids are `ids`. */
export const hsList = (key: 'uses' | 'occs' | 'slots' | 'kinds' | 'bases' | 'cycles', ids: readonly string[], id: string): string => hsT(key).split(',')[ids.indexOf(id)] ?? id;
