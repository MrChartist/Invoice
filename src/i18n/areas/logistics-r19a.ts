/**
 * R19-A: logistics core strings (Shipments desk, job files, charge heads and rate sheets). Words used by more than one
 * package (job, shipment, mode, sea, air, container, shipper, consignee, agent, freight, duty, deposit, disbursement,
 * chargeable weight) live here once; B–D import them and add their own. Lists (`modes`, `dirs`, `statuses`, `kinds`,
 * `roles`, `units`) are comma-separated, in the order of their ids.
 */
import { defineArea } from '../area';

export const lgT = defineArea(
  {
    jobs: 'Jobs', rates: 'Rates', job: 'Job', shipment: 'Shipment', mode: 'Mode', dir: 'Direction', status: 'Status', date: 'Date', client: 'Client', agent: 'Overseas agent', salesperson: 'Salesperson', branch: 'Branch', fy: 'Year', all: 'All', total: 'Total',
    origin: 'Origin', destination: 'Destination', country: 'Destination country (ISO)', incoterm: 'Incoterm', etd: 'ETD', eta: 'ETA', shipper: 'Shipper', consignee: 'Consignee', legs: 'Legs',
    mbl: 'MBL', hbl: 'HBL', mawb: 'MAWB', hawb: 'HAWB', vessel: 'Vessel', voyage: 'Voyage', flight: 'Flight', igm: 'IGM', sbNo: 'Shipping bill', sbDate: 'SB date', boeNo: 'Bill of entry', boeDate: 'BOE date',
    containers: 'Containers', container: 'Container no.', size: 'Size', seal: 'Seal', addRow: 'Add row', pkgs: 'Packages', gross: 'Gross kg', cbm: 'CBM', dims: 'Dimensions (cm): L × W × H × pieces', chargeable: 'Chargeable', teu: 'TEU', note: 'Note', duty: 'Duty', deposit: 'Deposit', disbursement: 'Disbursement', freight: 'Freight',
    newJob: 'New job', open: 'Open', dup: 'Duplicate', save: 'Save', saved: 'Saved.', del: 'Delete', cancel: 'Cancel', close: 'Close job', reopen: 'Re-open', none: 'No jobs yet.',
    heads: 'Charge heads', head: 'Head', kind: 'Kind', role: 'Role', unit: 'Unit', rate: 'Rate', currency: 'Currency', sac: 'SAC', active: 'On', addHead: 'Add head', defaults: 'Default heads', name: 'Name',
    sheets: 'Rate sheets', newSheet: 'New rate sheet', validFrom: 'Valid from', validTo: 'Valid to', min: 'Minimum {v}', minimum: 'Minimum', quote: 'Quote from sheet', quoted: 'Quotation {n} saved as a draft.', quotes: 'Quotations', makeJob: 'Make job', noSheets: 'No rate sheets yet.',
    volumetric: 'volumetric', wp: 'Working papers — verify with your CA.',
    modes: 'Sea FCL,Sea LCL,Air,Road,Rail,Multimodal,Courier', dirs: 'Export,Import,Domestic,Cross-trade', statuses: 'Enquiry,Booked,In transit,Arrived,Delivered,Closed,Cancelled', legList: 'Road,Rail,Sea,Air,Inland water',
    kinds: 'Sea freight,Air freight,Road freight,Rail freight,Multimodal freight,Courier,Origin charges,Destination charges,Documentation,Customs clearance (CHA),Clearing and forwarding,Handling,Storage,Transport by GTA,Insurance,Customs duty,CFS charges,Port charges,DO charges,Demurrage / detention,Commission,Other',
    roles: 'Own supply,Pure agent (Rule 33),Exempt', units: 'Per kg,Per CBM,Per W/M,Per container,Per shipment,Per bill,Per package,Per day,% of value,Typed',
    eDate: 'Choose the job date.', eClient: 'Choose the client.', ePorts: 'Type the origin and the destination.', eKind: 'Choose the mode, direction and status.', eCountry: 'An export by sea or air needs the destination country (2 letters).',
    eBox: 'Container {c}: 4 letters and 7 digits.', hDigit: 'Container {c}: the check digit does not match (ISO 6346) — check the number.', eHouse: 'This house bill is already on job {n}.', hDoc: 'The shipping bill / bill of entry date is more than 30 days before the job date.',
    eNum: 'Amounts and weights: 0 or more.', eValid: 'Valid to is before valid from.', eNoJob: 'Job not found.', eBilled: 'A document of this job is live; cancel it first.', eCurrency: 'One currency per quotation: split the sheet.',
  } as const,
  {
    jobs: 'जॉब', rates: 'दरें', job: 'जॉब फ़ाइल', shipment: 'शिपमेंट', mode: 'माध्यम', dir: 'दिशा', status: 'स्थिति', date: 'तिथि', client: 'ग्राहक', agent: 'विदेशी एजेंट', salesperson: 'विक्रेता', branch: 'शाखा', fy: 'वर्ष', all: 'सभी', total: 'कुल',
    origin: 'मूल स्थान', destination: 'गंतव्य', country: 'गंतव्य देश (ISO)', incoterm: 'इनकोटर्म', etd: 'प्रस्थान (ETD)', eta: 'आगमन (ETA)', shipper: 'शिपर', consignee: 'कंसाइनी', legs: 'चरण',
    mbl: 'MBL', hbl: 'HBL', mawb: 'MAWB', hawb: 'HAWB', vessel: 'जहाज़', voyage: 'यात्रा', flight: 'उड़ान', igm: 'IGM', sbNo: 'शिपिंग बिल', sbDate: 'SB तिथि', boeNo: 'बिल ऑफ़ एंट्री', boeDate: 'BOE तिथि',
    containers: 'कंटेनर', container: 'कंटेनर नं.', size: 'आकार', seal: 'सील', addRow: 'पंक्ति जोड़ें', pkgs: 'पैकेज', gross: 'कुल वज़न kg', cbm: 'CBM', dims: 'माप (cm): L × W × H × नग', chargeable: 'देय वज़न (चार्जेबल)', teu: 'TEU', note: 'टिप्पणी', duty: 'सीमा शुल्क (ड्यूटी)', deposit: 'ड्यूटी जमा', disbursement: 'वितरण व्यय (डिस्बर्समेंट)', freight: 'भाड़ा (फ्रेट)',
    newJob: 'नई जॉब', open: 'खोलें', dup: 'प्रतिलिपि', save: 'सहेजें', saved: 'सहेजा गया।', del: 'हटाएँ', cancel: 'रद्द करें', close: 'जॉब बंद करें', reopen: 'फिर खोलें', none: 'अभी कोई जॉब नहीं।',
    heads: 'शुल्क शीर्ष', head: 'शीर्ष', kind: 'प्रकार', role: 'भूमिका', unit: 'इकाई', rate: 'दर', currency: 'मुद्रा', sac: 'SAC', active: 'चालू', addHead: 'शीर्ष जोड़ें', defaults: 'डिफ़ॉल्ट शीर्ष', name: 'नाम',
    sheets: 'दर पत्रक', newSheet: 'नया दर पत्रक', validFrom: 'से मान्य', validTo: 'तक मान्य', min: 'न्यूनतम {v}', minimum: 'न्यूनतम', quote: 'पत्रक से कोटेशन', quoted: 'कोटेशन {n} ड्राफ़्ट के रूप में सहेजा गया।', quotes: 'कोटेशन', makeJob: 'जॉब बनाएँ', noSheets: 'अभी कोई दर पत्रक नहीं।',
    volumetric: 'आयतनी (वॉल्यूमेट्रिक)', wp: 'कार्य-पत्र — अपने CA से जाँचें।',
    modes: 'समुद्री FCL,समुद्री LCL,हवाई,सड़क,रेल,मल्टीमोडल,कूरियर', dirs: 'निर्यात,आयात,घरेलू,क्रॉस-ट्रेड', statuses: 'पूछताछ,बुक,रास्ते में,पहुँचा,डिलीवर,बंद,रद्द', legList: 'सड़क,रेल,समुद्र,हवाई,अंतर्देशीय जल',
    kinds: 'समुद्री भाड़ा,हवाई भाड़ा,सड़क भाड़ा,रेल भाड़ा,मल्टीमोडल भाड़ा,कूरियर,मूल स्थान शुल्क,गंतव्य शुल्क,दस्तावेज़ शुल्क,सीमा शुल्क निकासी (CHA),क्लियरिंग और फ़ॉरवर्डिंग,हैंडलिंग शुल्क,भंडारण शुल्क,GTA से परिवहन,बीमा,सीमा शुल्क (ड्यूटी),CFS शुल्क,पोर्ट शुल्क,DO शुल्क,डेमरेज / डिटेंशन,कमीशन,अन्य',
    roles: 'अपनी आपूर्ति,शुद्ध एजेंट (नियम 33),छूट', units: 'प्रति kg,प्रति CBM,प्रति W/M,प्रति कंटेनर,प्रति शिपमेंट,प्रति बिल,प्रति पैकेज,प्रति दिन,मूल्य का %,लिखी राशि',
    eDate: 'जॉब की तिथि चुनें।', eClient: 'ग्राहक चुनें।', ePorts: 'मूल स्थान और गंतव्य लिखें।', eKind: 'माध्यम, दिशा और स्थिति चुनें।', eCountry: 'समुद्री या हवाई निर्यात के लिए गंतव्य देश (2 अक्षर) ज़रूरी है।',
    eBox: 'कंटेनर {c}: 4 अक्षर और 7 अंक।', hDigit: 'कंटेनर {c}: चेक अंक मेल नहीं खाता (ISO 6346) — नंबर जाँचें।', eHouse: 'यह हाउस बिल पहले से जॉब {n} पर है।', hDoc: 'शिपिंग बिल / बिल ऑफ़ एंट्री की तिथि जॉब तिथि से 30 दिन से अधिक पहले की है।',
    eNum: 'राशि और वज़न: 0 या अधिक।', eValid: '"तक मान्य" तिथि "से मान्य" से पहले है।', eNoJob: 'जॉब नहीं मिली।', eBilled: 'इस जॉब का एक दस्तावेज़ चालू है; पहले उसे रद्द करें।', eCurrency: 'एक कोटेशन में एक मुद्रा: पत्रक अलग करें।',
  },
);

/** The label of `id` in the comma-separated list `key` whose ids are `ids`. */
export const lgList = (key: 'modes' | 'dirs' | 'statuses' | 'legList' | 'kinds' | 'roles' | 'units', ids: readonly string[], id: string): string => lgT(key).split(',')[ids.indexOf(id)] ?? id;
