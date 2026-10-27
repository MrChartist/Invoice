/**
 * Round 10 (service businesses) — persisted shapes and additive fields of the four packages (docs/prd/round-10.md §6).
 * `invoice.ts`, `localDb.ts` and `inventory.ts` are not edited: the new optional fields arrive here by declaration
 * merging. Every Round 10 snapshot on a document lives under ONE record key `sv` and ONE line key `sv`
 * (`R9_RECORD_KEYS` / `R9_LINE_KEYS` in `src/store/invoice-defaults.ts`), so `normalizeRecord` keeps them verbatim.
 * The sub-field types of record / line `sv` are declared here by SV-A for all four packages, so SV-B … SV-D never
 * edit SV-A's block; each package fills only its own block (`// SV-A` … `// SV-D`) with its table shapes.
 * Types only (0 bytes). Everything here is a working paper — verify with your CA (docs/CA_REVIEW.md §10, SV1–SV24).
 */

/* ════════════════════════════════════════ SV-A ════════════════════════════════════════ */

/** The service business picked under the `services` business type (settings `service_kind`). */
export type ServiceKind = 'clinic' | 'lab' | 'salon' | 'fitness' | 'coaching' | 'workshop' | 'appliance' | 'professional' | 'other';

/** Service tax class of an item / line (suggests rate, SAC and the exempt column by document date; a typed rate wins). */
export type SvClass =
  | 'health_exempt' | 'health_cosmetic' | 'hospital_room_low' | 'hospital_room_high'
  | 'beauty_9997' | 'fitness_9997' | 'education_exempt' | 'coaching' | 'repair_9987' | 'charitable_yoga';

/** Table 8 column of an untaxed line on a tax invoice (absent = nil-rated, as before Round 10). */
export type SvExempt = 'EXEMPT' | 'NIL' | 'NON_GST';

export interface SvResource {
  id: string;
  name: string;
  kind: 'room' | 'chair' | 'bay' | 'other';
  active?: boolean;
}

/** Opening hours of one weekday (index 0 = Monday … 6 = Sunday). */
export interface SvDayHours {
  open: string;
  close: string;
  closed?: boolean;
}

/** `wa.me` text templates: `{name}`, `{date}`, `{time}`, `{staff}`, `{business}`. */
export interface SvMessages {
  confirm?: string;
  reminder?: string;
  birthday?: string;
}

/** Company object `mrchartist_inv_service_settings` (`settings.manage`, audited on save, synced as a singleton). */
export interface ServiceSettings {
  resources?: SvResource[];
  /** Seven rows, Monday first; absent = 10:00–20:00 every day. */
  hours?: SvDayHours[];
  slot_step?: 5 | 10 | 15 | 30;
  messages?: SvMessages;
  /** Print the staff first name after a line (default off). */
  print_staff?: boolean;
  /** Salon: a staff member is required on service lines at the POS. */
  staff_required?: boolean;
  /** Tips (default off; SV16). */
  tips?: 'off' | 'pass-through';
  /** Rule 46A "Invoice-cum-Bill of Supply" title for a GSTIN-less recipient with taxable + exempt lines. */
  rule46a?: boolean;
  /** Rule 42: count 5%-no-ITC turnover as exempt-like (default on; SV12). */
  no_itc_as_exempt?: boolean;
  /** Caution on purchase bills with ITC when no-ITC services are sold (SV12). */
  itc_caution?: boolean;
  /** The one-time "6% composition vs 5%" notice was dismissed (SV13). */
  composition_note_seen?: boolean;
  /** SV-C: check-in gate for expired memberships. */
  checkin_gate?: 'off' | 'warn' | 'block';
  updated_at?: string;
}

export type AppointmentStatus = 'booked' | 'confirmed' | 'arrived' | 'in_service' | 'done' | 'billed' | 'no_show' | 'cancelled';
export type AppointmentSource = 'call' | 'walk-in' | 'whatsapp' | 'online-typed';

/** One service on an appointment (price / duration snapshot from the catalogue at booking). */
export interface AppointmentService {
  item_id?: string;
  name: string;
  minutes: number;
  price: number;
  tax_rate?: number;
  hsn?: string;
  sv_class?: SvClass;
  /** Staff for this service (else the appointment's). */
  staff_id?: string;
}

/** Table `appointments` (`doc.create`, audited "Appointment", dated `date`). */
export interface Appointment {
  id: string;
  date: string;
  /** `HH:MM`, local. */
  start: string;
  minutes: number;
  client_id?: string;
  client_name: string;
  phone?: string;
  services: AppointmentService[];
  staff_id?: string;
  resource_id?: string;
  status: AppointmentStatus;
  /** Cancellation / no-show reason. */
  reason?: string;
  source?: AppointmentSource;
  notes?: string;
  /** Deposit: an existing advance receipt. */
  advance_id?: string;
  /** Linked bill (also derivable from the bill's lines `sv.appointment_id`). */
  invoice_id?: string;
  /** `visit` for clinics (SV-B), `job` for workshops (SV-D creates the job on arrival). */
  kind?: 'visit' | 'job';
  /** Walk-in queue token of the day (resets daily) and its queue state. */
  token?: number;
  queue?: 'waiting' | 'called' | 'served';
  created_at: string;
  updated_at?: string;
}

export type StaffRole = 'stylist' | 'therapist' | 'trainer' | 'doctor' | 'technician' | 'teacher' | 'other';

/** Table `service_staff` (`master.edit`, audited "Service staff"). Not the confidential payroll employee row. */
export interface ServiceStaff {
  id: string;
  name: string;
  phone?: string;
  role: StaffRole;
  /** Item ids or categories this person does (empty = everything). */
  skills?: string[];
  bookable?: boolean;
  colour?: string;
  /** Weekly offs (0 = Monday … 6 = Sunday) and daily breaks (`HH:MM`). */
  hours?: { off_days?: number[]; breaks?: { from: string; to: string }[] };
  employment: 'employee' | 'freelance';
  /** Payroll link (employee) — the payout becomes a payroll adjustment. */
  employee_id?: string;
  /** Freelance: the vendor paid, and the TDS section (opt-in; 194J doctors, 194H others). */
  vendor_id?: string;
  tds_section?: string;
  plan_id?: string;
  /** RT-B1 `doctors` row (SV-B). */
  doctor_id?: string;
  active?: boolean;
  created_at: string;
  updated_at?: string;
}

export type CommissionKind = 'service' | 'product' | 'package_sale' | 'membership_sale' | 'package_redemption';

/** One rule: by item, else category, else kind (nearest wins). `pct` of the line taxable value or `per_unit` ₹. */
export interface CommissionRule {
  item_id?: string;
  category?: string;
  kind?: CommissionKind;
  pct?: number;
  per_unit?: number;
}

/** Monthly slab: above `target` of the base, `add` % on top or `replace` the rate of the lines past the target. */
export interface CommissionSlab {
  target: number;
  base: 'service' | 'all';
  pct: number;
  mode: 'add' | 'replace';
}

/** Table `commission_plans` (`master.edit`, audited "Commission plan"). */
export interface CommissionPlan {
  id: string;
  name: string;
  rules: CommissionRule[];
  slab?: CommissionSlab;
  basis: 'invoice' | 'receipt';
  created_at: string;
  updated_at?: string;
}

/** Table `staff_payouts` (`books.edit`, audited "Staff payout", dated `date`): one per staff × month. */
export interface StaffPayout {
  id: string;
  staff_id: string;
  staff_name: string;
  /** `YYYY-MM`. */
  month: string;
  date: string;
  amount: number;
  route: 'payroll' | 'journal';
  adjustment_id?: string;
  voucher_id?: string;
  voucher_number?: string;
  tds?: number;
  tds_row_id?: string;
  created_at: string;
}

export type ClaimKind = 'motor' | 'health_tpa' | 'corporate' | 'other';
export type ClaimStatus = 'intimated' | 'survey' | 'approved' | 'billed' | 'paid' | 'short_paid' | 'rejected';

/** Table `payer_claims` (`doc.create`, audited "Payer claim", dated `date`, numbered `CLM/FY…`). */
export interface PayerClaim {
  id: string;
  number: string;
  date: string;
  kind: ClaimKind;
  payer_id?: string;
  payer_name: string;
  beneficiary_id?: string;
  beneficiary_name: string;
  policy_no?: string;
  claim_no?: string;
  /** Surveyor / TPA reference. */
  reference?: string;
  /** Where the bill lines come from (job / admission / appointment / a draft invoice). */
  source?: { kind: 'job' | 'admission' | 'appointment' | 'invoice'; id: string };
  estimate: number;
  approved: number;
  status: ClaimStatus;
  payer_invoice_id?: string;
  beneficiary_invoice_id?: string;
  /** Rejection: the beneficiary's re-bill. */
  rebill_invoice_id?: string;
  /** Attachments (asset refs): claim form, survey report, approval letter — never printed. */
  attachments?: string[];
  notes?: string;
  created_at: string;
  updated_at?: string;
}

/** Why a beneficiary line exists on a split claim bill. */
export type SvClaimPart = 'approved' | 'depreciation' | 'excess' | 'non_covered' | 'disallowed';

/** Line snapshot `item.sv` (every package's sub-fields, declared once by SV-A). */
export interface SvLine {
  /** SV-A3: staff on the line, optional assistant and the assistant's split %. */
  staff_id?: string;
  staff_name?: string;
  assist_id?: string;
  assist_pct?: number;
  /** SV-A4: Table 8 column of an untaxed line, and the class the line was priced by. */
  exempt?: SvExempt;
  cls?: SvClass;
  /** SV-A2: the appointment this line bills. */
  appointment_id?: string;
  /** SV-A5: what part of a claim split the line is. */
  claim_part?: SvClaimPart;
  /** SV-C1: a prepaid package / membership session redeemed on this line. */
  redeem?: { membership_id: string; session: number; of: number; value?: number };
  /** SV-C4: back-bar consumption per stock item id (service recipe snapshot). */
  recipe_qty?: Record<string, number>;
  /** SV-D2: labour operation / part issued for a job. */
  labour_op_id?: string;
}

/** Record snapshot `invoice.sv` (every package's sub-objects, declared once by SV-A). */
export interface SvRecord {
  /** SV-A4: the Rule 46A title was on when the document was saved (`service_settings.rule46a`). */
  rule46a?: boolean;
  /** SV-A5: the document is one part of a payer claim. */
  claim?: { id: string; number: string; role: 'payer' | 'beneficiary'; policy_no?: string; claim_no?: string; beneficiary?: string; payer?: string };
  /** SV-B1: OPD visit (UHID, doctor, registration no., token). */
  visit?: { id: string; number?: string; uhid?: string; doctor_id?: string; doctor_name?: string; doctor_reg?: string; token?: number };
  /** SV-B2: in-patient admission. */
  admission?: { id: string; number?: string; admit_date?: string; discharge_date?: string };
  /** SV-B3: lab order. */
  lab_order?: { id: string; number?: string };
  /** SV-B4: referring doctor. */
  referrer?: { doctor_id?: string; name?: string };
  /** SV-C1: membership sold on this document. */
  membership?: { id: string; number?: string; start?: string; end?: string };
  /** SV-D1: job card. */
  job?: { id: string; number?: string; asset?: string; odometer?: number };
}

declare module './invoice' {
  interface InvoiceItem {
    /** Round 10 line snapshot (see `SvLine`). */
    sv?: SvLine;
    /** SV-A4 catalogue rows: the service class of the item (suggests rate / SAC on new lines). */
    sv_class?: SvClass;
  }
  interface InvoiceRecord {
    /** Round 10 record snapshot (see `SvRecord`). */
    sv?: SvRecord;
  }
  interface Client {
    /** SV-A2: birthday / anniversary, `MM-DD` or `YYYY-MM-DD` (optional, never printed). */
    dob?: string;
    anniversary?: string;
  }
  interface Payment {
    /** SV-A3: a tip receipt row passed through to this staff member (read only by SV code). */
    tip_staff?: string;
  }
}

declare module '../lib/localDb' {
  interface AppSettings {
    /** SV-A1: service profile under the `services` business type; absent = not chosen (existing companies unchanged). */
    service_kind?: ServiceKind;
  }
}

declare module '../lib/inventory' {
  interface StockItem {
    /** SV-A4: service tax class. */
    sv_class?: SvClass;
  }
}

/* ════════════════════════════════════════ SV-B ════════════════════════════════════════ */
// SV-B: clinic_settings, clinic_visits (OPD), admissions (IPD), lab_tests, lab_orders (LAB); client `patient`;
// RT-B1 doctors' additive fields (`in_house`, `speciality`, `consult_fee`, `follow_up_fee`, `follow_up_days`, `staff_id`, `share`).

/** SV-B1 patient data on a client (billing data only; the allergies note is never printed). */
export interface PatientInfo {
  /** Unique hospital id; falls back to the R5-C `roll_no` on read. */
  uhid?: string;
  /** Age in years on `age_on` (when no full `dob`). */
  age?: number;
  age_on?: string;
  sex?: 'M' | 'F' | 'O';
  guardian?: string;
  blood?: string;
  /** Referring doctor (`doctors` id). */
  referred_by?: string;
  allergies?: string;
}

export type ClinicRoomKind = 'general' | 'private' | 'icu' | 'ccu' | 'iccu' | 'nicu';
export interface ClinicRoom { id: string; name: string; kind: ClinicRoomKind; rate: number }

/** Company object `mrchartist_inv_clinic_settings` (`settings.manage`, audited on save, synced as a singleton). */
export interface ClinicSettings {
  uhid_prefix?: string;
  rooms?: ClinicRoom[];
  /** Room-days: midnight census (default) or every started 24 h. */
  room_day?: 'midnight' | '24h';
  /** Bell when charges exceed deposits by more than this (0 = off). */
  deposit_alert?: number;
  /** SV-B4: book referral payments (default off; Sec 37 caution). */
  record_referral_payments?: boolean;
  /** Rate list: second-language names by item id, the language label, and the rates last printed. */
  rate_names?: Record<string, string>;
  rate_lang?: string;
  rates_printed?: string;
  updated_at?: string;
}

/** SV-B1 table `clinic_visits` (`doc.create`, audited "OPD visit", dated `date`, numbered `OPD/FY…`). */
export interface ClinicVisit {
  id: string;
  number: string;
  date: string;
  patient_id?: string;
  patient_name: string;
  uhid?: string;
  doctor_id?: string;
  doctor_name?: string;
  /** Daily token per doctor. */
  token: number;
  kind: 'new' | 'follow-up';
  fee: number;
  /** Free text, never printed. */
  vitals?: string;
  status: 'waiting' | 'with_doctor' | 'done' | 'billed';
  appointment_id?: string;
  referrer?: { doctor_id?: string; name?: string };
  invoice_id?: string;
  created_at: string;
  updated_at?: string;
}

/** SV-B2 a charge on an admission's running bill. */
export interface IpdCharge {
  id: string;
  date: string;
  name: string;
  qty: number;
  rate: number;
  hsn?: string;
  /** Stock item (medicines / consumables) and its batch; billed as an exempt line of the composite supply. */
  item_id?: string;
  batch_no?: string;
  doctor_id?: string;
}

/** SV-B2 table `admissions` (`doc.create`, audited "Admission", dated `admit_date`, numbered `IPD/FY…`). */
export interface Admission {
  id: string;
  number: string;
  admit_date: string;
  /** `HH:MM`. */
  admit_time?: string;
  discharge_date?: string;
  discharge_time?: string;
  patient_id?: string;
  patient_name: string;
  uhid?: string;
  doctor_ids?: string[];
  /** Room snapshot at admission (name, kind, rate per day). */
  room?: Omit<ClinicRoom, 'id'> & { id?: string };
  claim_id?: string;
  /** Deposits: existing advance receipts. */
  deposits?: string[];
  charges: IpdCharge[];
  status: 'admitted' | 'discharged' | 'billed';
  referrer?: { doctor_id?: string; name?: string };
  invoice_id?: string;
  created_at: string;
  updated_at?: string;
}

/** SV-B3 reference range of a parameter (by sex and age band; `text` for non-numeric). */
export interface LabRange { sex?: 'M' | 'F'; age_from?: number; age_to?: number; low?: number; high?: number; text?: string }
export interface LabParam {
  code: string;
  name: string;
  unit?: string;
  kind: 'numeric' | 'text' | 'option';
  options?: string[];
  decimals?: number;
  ranges?: LabRange[];
  crit_low?: number;
  crit_high?: number;
}

/** SV-B3 table `lab_tests` (`master.edit`, audited "Lab test"). A panel lists other tests (`panel`). */
export interface LabTest {
  id: string;
  code: string;
  name: string;
  dept?: string;
  sample?: string;
  container?: string;
  /** Turnaround, hours. */
  tat?: number;
  price: number;
  method?: string;
  params: LabParam[];
  panel?: string[];
  outsourced?: { vendor_id?: string; vendor_name?: string; cost: number };
  /** Interpretation note (printed). */
  note?: string;
  created_at: string;
  updated_at?: string;
}

export type LabSampleStatus = 'to_collect' | 'collected' | 'received' | 'in_process' | 'done';
/** A test on an order: snapshot of the master at ordering (a later edit never changes a report). */
export type LabOrderTest = Pick<LabTest, 'id' | 'code' | 'name' | 'dept' | 'sample' | 'tat' | 'price' | 'method' | 'params' | 'note' | 'outsourced'>;

/** SV-B3 table `lab_orders` (`doc.create`, audited "Lab order", dated `date`, numbered `LAB/FY…`). */
export interface LabOrder {
  id: string;
  number: string;
  date: string;
  patient_id?: string;
  patient_name: string;
  uhid?: string;
  sex?: 'M' | 'F' | 'O';
  age?: number;
  referrer?: { doctor_id?: string; name?: string };
  tests: LabOrderTest[];
  samples: { type: string; status: LabSampleStatus; at?: string; by?: string }[];
  /** Results by `<test id>:<param code>`. */
  results: Record<string, string>;
  verified_by?: string[];
  report: 'pending' | 'partial' | 'final' | 'delivered';
  /** Earlier versions of a final report (amended reports keep them). */
  history?: { at: string; results: Record<string, string> }[];
  amended_at?: string;
  delivery?: { via: 'print' | 'whatsapp' | 'email'; at: string }[];
  invoice_id?: string;
  /** Outsourced cost billed by the reference lab (purchase bill id). */
  outsourced_bill_id?: string;
  created_at: string;
  updated_at?: string;
}

declare module './invoice' {
  interface Client {
    /** SV-B1 patient data. */
    patient?: PatientInfo;
  }
  interface SenderProfile {
    /** SV-B1 registrations printed in the header when set (CEA / state, council, NABL, PCPNDT). */
    sv_regs?: { cea?: string; cea_valid?: string; council?: string; nabl?: string; pcpndt?: string };
  }
}

declare module './retail-r9' {
  interface Doctor {
    /** SV-B1 clinic fields. */
    in_house?: boolean;
    speciality?: string;
    consult_fee?: number;
    follow_up_fee?: number;
    follow_up_days?: number;
    /** SV-A3 staff link (lines carry `sv.staff_id`). */
    staff_id?: string;
    /** SV-B4 visiting consultant fee-share: % of their lines or ₹ per visit. */
    share?: { pct?: number; per_visit?: number };
  }
}

/* ════════════════════════════════════════ SV-C ════════════════════════════════════════ */
// SV-C: member_plans, memberships (MEM), checkins, class_schedules, class_attendance; `Enrolment.class_id`.

/* ════════════════════════════════════════ SV-D ════════════════════════════════════════ */
// SV-D: service_assets, labour_ops, workshop_settings; RT-D4 `service_jobs` fields; AMC `asset_ids`, visit `job_id`;
// client `sv_insurer_invoice`; `TimeEntry.job_id`.
