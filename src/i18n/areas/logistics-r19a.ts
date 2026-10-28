/**
 * R19-A: logistics core strings (Shipments desk, job files, charge heads). Words used by more than one
 * package (job, shipment, mode, container, shipper, consignee, agent, chargeable weight) live here once; B–D import
 * them and add their own (freight, duty, deposit, disbursement). Lists (`modes`, `dirs`, `statuses`, `kinds`,
 * `roles`, `units`) are comma-separated, in the order of their ids.
 */
import { defineArea } from '../area';

export const lgT = defineArea(
  {
    jobs: 'Jobs', rates: 'Rates', job: 'Job', shipment: 'Shipment', mode: 'Mode', dir: 'Direction', status: 'Status', date: 'Date', client: 'Client', agent: 'Overseas agent', salesperson: 'Salesperson', branch: 'Branch', fy: 'Year', all: 'All', total: 'Total',
    origin: 'Origin', destination: 'Destination', route: 'Route', dest_country: 'Destination country (ISO)', incoterm: 'Incoterm', shipper: 'Shipper', consignee: 'Consignee', legs: 'Legs',
    mbl: 'MBL', hbl: 'HBL', mawb: 'MAWB', hawb: 'HAWB', vessel: 'Vessel', voyage: 'Voyage', flight: 'Flight', igm: 'IGM', sb_no: 'Shipping bill', sb_date: 'SB date', boe_no: 'Bill of entry', boe_date: 'BOE date',
    containers: 'Containers', container: 'Container no.', size: 'Size', addRow: 'Add row', pkgs: 'Packages', gross_kg: 'Gross kg', cbm: 'CBM', dims: 'L × W × H (cm) × pcs', chargeable: 'Chargeable', teu: 'TEU', note: 'Note',     newJob: 'New job', open: 'Open', dup: 'Duplicate', saved: 'Saved.', close: 'Close job', reopen: 'Re-open', none: 'No jobs yet.',
    kind: 'Kind', role: 'Role', unit: 'Unit', rate: 'Rate', currency: 'Currency', sac: 'SAC', active: 'On', addHead: 'Add head', defaults: 'Default heads', name: 'Name',
        volumetric: 'volumetric', wp: 'Working papers — verify with your CA.',
    modes: 'Sea FCL,Sea LCL,Air,Road,Rail,Multimodal,Courier', dirs: 'Export,Import,Domestic,Cross-trade', statuses: 'Enquiry,Booked,In transit,Arrived,Delivered,Closed,Cancelled', legList: 'Road,Rail,Sea,Air,Inland water',
    kinds: 'Sea freight,Air freight,Road freight,Rail freight,Multimodal,Courier,Origin,Destination,Documentation,Clearance (CHA),C&F,Handling,Storage,GTA leg,Insurance,Customs duty,CFS,Port,DO,Demurrage,Commission,Other',
    roles: 'Own supply,Pure agent (Rule 33),Exempt', units: 'kg,CBM,W/M,Container,Shipment,Bill,Package,Day,% of value,Typed',
    eDate: 'Choose the job date.', eClient: 'Choose the client.', ePorts: 'Type the origin and the destination.', eCountry: 'Export by sea / air: type the destination country (2 letters).',
    eBox: 'Container {c}: 4 letters and 7 digits.', hDigit: 'Container {c}: check digit does not match (ISO 6346).', eHouse: 'This house bill is already on job {n}.', hDoc: 'SB / BOE date is over 30 days before the job date.',
    eNoJob: 'Job not found.', eBilled: 'This job has a live document; cancel it first.',   } as const,
  {
    jobs: 'जॉब', rates: 'दरें', job: 'जॉब फ़ाइल', shipment: 'शिपमेंट', mode: 'माध्यम', dir: 'दिशा', status: 'स्थिति', date: 'तिथि', client: 'ग्राहक', agent: 'विदेशी एजेंट', salesperson: 'विक्रेता', branch: 'शाखा', fy: 'वर्ष', all: 'सभी', total: 'कुल',
    origin: 'मूल स्थान', destination: 'गंतव्य', route: 'मार्ग', dest_country: 'गंतव्य देश (ISO)', incoterm: 'इनकोटर्म', shipper: 'शिपर', consignee: 'कंसाइनी', legs: 'चरण',
    mbl: 'MBL', hbl: 'HBL', mawb: 'MAWB', hawb: 'HAWB', vessel: 'जहाज़', voyage: 'यात्रा', flight: 'उड़ान', igm: 'IGM', sb_no: 'शिपिंग बिल', sb_date: 'SB तिथि', boe_no: 'बिल ऑफ़ एंट्री', boe_date: 'BOE तिथि',
    containers: 'कंटेनर', container: 'कंटेनर नं.', size: 'आकार', addRow: 'पंक्ति जोड़ें', pkgs: 'पैकेज', gross_kg: 'कुल वज़न kg', cbm: 'CBM', dims: 'माप (cm): L × W × H × नग', chargeable: 'देय वज़न (चार्जेबल)', teu: 'TEU', note: 'टिप्पणी',     newJob: 'नई जॉब', open: 'खोलें', dup: 'प्रतिलिपि', saved: 'सहेजा गया।', close: 'जॉब बंद करें', reopen: 'फिर खोलें', none: 'अभी कोई जॉब नहीं।',
    kind: 'प्रकार', role: 'भूमिका', unit: 'इकाई', rate: 'दर', currency: 'मुद्रा', sac: 'SAC', active: 'चालू', addHead: 'शीर्ष जोड़ें', defaults: 'डिफ़ॉल्ट शीर्ष', name: 'नाम',
        volumetric: 'आयतनी (वॉल्यूमेट्रिक)', wp: 'कार्य-पत्र — अपने CA से जाँचें।',
    modes: 'समुद्री FCL,समुद्री LCL,हवाई,सड़क,रेल,मल्टीमोडल,कूरियर', dirs: 'निर्यात,आयात,घरेलू,क्रॉस-ट्रेड', statuses: 'पूछताछ,बुक,रास्ते में,पहुँचा,डिलीवर,बंद,रद्द', legList: 'सड़क,रेल,समुद्र,हवाई,अंतर्देशीय जल',
    kinds: 'समुद्री भाड़ा,हवाई भाड़ा,सड़क भाड़ा,रेल भाड़ा,मल्टीमोडल भाड़ा,कूरियर,मूल स्थान शुल्क,गंतव्य शुल्क,दस्तावेज़ शुल्क,सीमा शुल्क निकासी (CHA),क्लियरिंग और फ़ॉरवर्डिंग,हैंडलिंग शुल्क,भंडारण शुल्क,GTA से परिवहन,बीमा,सीमा शुल्क (ड्यूटी),CFS शुल्क,पोर्ट शुल्क,DO शुल्क,डेमरेज / डिटेंशन,कमीशन,अन्य',
    roles: 'अपनी आपूर्ति,शुद्ध एजेंट (नियम 33),छूट', units: 'kg,CBM,W/M,कंटेनर,शिपमेंट,बिल,पैकेज,दिन,मूल्य का %,लिखी राशि',
    eDate: 'जॉब की तिथि चुनें।', eClient: 'ग्राहक चुनें।', ePorts: 'मूल स्थान और गंतव्य लिखें।', eCountry: 'समुद्री या हवाई निर्यात के लिए गंतव्य देश (2 अक्षर) ज़रूरी है।',
    eBox: 'कंटेनर {c}: 4 अक्षर और 7 अंक।', hDigit: 'कंटेनर {c}: चेक अंक मेल नहीं खाता (ISO 6346) — नंबर जाँचें।', eHouse: 'यह हाउस बिल पहले से जॉब {n} पर है।', hDoc: 'शिपिंग बिल / बिल ऑफ़ एंट्री की तिथि जॉब तिथि से 30 दिन से अधिक पहले की है।',
    eNoJob: 'जॉब नहीं मिली।', eBilled: 'इस जॉब का एक दस्तावेज़ चालू है; पहले उसे रद्द करें।',   },
);

/** The label of `id` in the comma-separated list `key` whose ids are `ids`. */
export const lgList = (key: 'modes' | 'dirs' | 'statuses' | 'legList' | 'kinds' | 'roles' | 'units', ids: readonly string[], id: string): string => lgT(key).split(',')[ids.indexOf(id)] ?? id;
