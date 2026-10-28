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
export type ServiceKind = 'clinic' | 'lab' | 'salon' | 'fitness' | 'coaching' | 'workshop' | 'appliance' | 'professional' | 'other' | 'travel' | 'manpower'; // R15-B1: travel; R17-A1: manpower

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
  /** SV-C3 (PENDING #21): a booking of one meeting of this class (`sv-class-bookings.ts`); no services. */
  class_id?: string;
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
  /** SV-A follow-up: tips inside `amount` (passed through in full, outside the TDS base — SV70). */
  tips?: number;
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
  /** SV-A follow-up: the staff name printed under the line (snapshot taken while "staff names on the bill" is on). */
  staff_print?: string;
  /** SV-A follow-up: a tip line passed through to `staff_id` (0%, non-GST — SV70); never earns commission. */
  tip?: boolean;
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

/** `membership` = time-based, `package` = n sessions, `wallet` = prepaid value (an advance), `combo` = time + sessions. */
export type MemberPlanKind = 'membership' | 'package' | 'wallet' | 'combo';

/** Table `member_plans` (`master.edit`, audited "Membership plan"). */
export interface MemberPlan {
  id: string;
  name: string;
  kind: MemberPlanKind;
  /** Membership / combo term. */
  months?: number;
  days?: number;
  /** Package / combo sessions and the package validity in days (from the start). */
  sessions?: number;
  validity_days?: number;
  /** Items (names) or categories a session covers; empty = any service. */
  covers?: string[];
  /** Price before GST (the sale line's rate). */
  price: number;
  tax_rate?: number;
  sac?: string;
  cls?: SvClass;
  freeze?: { max_days?: number; max_times?: number; min_days?: number; fee?: number };
  transferable?: boolean;
  transfer_fee?: number;
  /** Refund on cancellation: none (default) or pro rata of the unused value. */
  refund?: 'none' | 'pro_rata';
  /** Wallet: bonus value on a top-up (%), a discount on later use, never cash. */
  bonus_pct?: number;
  /** Package: a check-in redeems one session. */
  redeem_on_checkin?: boolean;
  /** PT package: the trainer (service staff). */
  trainer_id?: string;
  active?: boolean;
  created_at: string;
  updated_at?: string;
}

export interface MembershipEvent {
  date: string;
  kind: 'upgrade' | 'transfer' | 'renew' | 'cancel' | 'forfeit';
  note: string;
  invoice_id?: string;
  credit_note_id?: string;
}

/** Table `memberships` (`doc.create`, audited "Membership", dated `start`, numbered `MEM/FY…`). */
export interface Membership {
  id: string;
  number: string;
  client_id?: string;
  client_name: string;
  phone?: string;
  plan: Omit<MemberPlan, 'created_at' | 'updated_at'>;
  start: string;
  /** Last day (freezes included); stored, re-derived on every change. */
  end: string;
  /** Terminal states are stored; active / frozen / expired are derived by date. */
  closed?: 'cancelled' | 'transferred' | 'upgraded';
  freezes?: { from: string; to: string; reason?: string; invoice_id?: string }[];
  history?: MembershipEvent[];
  invoice_ids: string[];
  trainer_id?: string;
  auto_renew?: boolean;
  /** Renewal / upgrade successor. */
  next_id?: string;
  wallet?: { topups: { advance_id: string; date: string; amount: number; bonus: number }[]; bonus_used?: number };
  created_at: string;
  updated_at?: string;
}

export interface CheckinEntry {
  client_id?: string;
  name: string;
  /** `HH:MM`. */
  time: string;
  membership_id?: string;
  /** User who checked the member in. */
  by?: string;
  class_id?: string;
  /** A package session was redeemed by this check-in. */
  redeem?: boolean;
}

/** Table `checkins` (`doc.create`, audited "Check-ins", dated `date`): ONE row per day. */
export interface CheckinDay {
  id: string;
  date: string;
  entries: CheckinEntry[];
  updated_at?: string;
}

/** Table `class_schedules` (`master.edit`, audited "Class / batch"). */
export interface ClassSchedule {
  id: string;
  name: string;
  kind: 'class' | 'batch';
  staff_id?: string;
  resource_id?: string;
  /** Weekdays, 0 = Monday … 6 = Sunday. */
  days: number[];
  start: string;
  minutes: number;
  from?: string;
  to?: string;
  capacity?: number;
  /** Member plans that cover it (fitness) or the R5-C fee plan (coaching batch). */
  plan_ids?: string[];
  fee_plan_id?: string;
  holidays?: string[];
  /** Enrolled members (client ids) and the wait-list, in order (students are on `Enrolment.class_id`). */
  members?: string[];
  waitlist?: string[];
  active?: boolean;
  created_at: string;
  updated_at?: string;
}

export type AttendanceMark = 'P' | 'A' | 'L';

/** Table `class_attendance` (`doc.create`, audited "Attendance", dated `date`): one row per class × date. */
export interface ClassAttendance {
  id: string;
  class_id: string;
  date: string;
  marks: Record<string, AttendanceMark>;
  updated_at?: string;
}

/** A coaching refund request on the student's enrolment (SV-C3). */
export interface CoachingRefundRecord {
  requested: string;
  leave: string;
  due: string;
  amount: number;
  note_ids: string[];
  paid_on?: string;
}

/** SV-C switches on the service settings object (interfaces merge within this module). */
export interface ServiceSettings {
  /** Upgrade: one invoice for the difference (default) or a credit note on the old bill + a full bill (SV14). */
  upgrade_mode?: 'difference' | 'credit_note';
  /** Package income kept deferred: a monthly "Package income recognised" journal (`sv-deferral.ts`, PENDING #20). */
  defer_package_income?: boolean;
  /** The day the switch went on: packages sold before it are never deferred. */
  defer_package_from?: string;
}

declare module './institutions-r5' {
  interface Enrolment {
    /** SV-C3: the batch (class_schedules row) of this student on the plan. */
    class_id?: string;
    /** SV-C3: refund on leaving midway. */
    refund?: CoachingRefundRecord;
  }
  interface FeeHead {
    /** SV-C3: never refunded on leaving (default: once-heads are not refunded, per-instalment heads are). */
    no_refund?: boolean;
  }
}

/* ════════════════════════════════════════ SV-D ════════════════════════════════════════ */
// SV-D: service_assets, labour_ops, workshop_settings; RT-D4 `service_jobs` fields; AMC `asset_ids`, visit `job_id`;
// client `sv_insurer_invoice`; `TimeEntry.job_id`.

/** Vehicle class: picks a labour op's standard hours and the labour rate (`workshop_settings.classes`). */
export type VehicleClass = 'hatch' | 'sedan' | 'suv' | '2W' | '3W' | 'commercial';

/** Table `service_assets` (`master.edit`, audited "Vehicle / appliance"): one row per vehicle or appliance. */
export interface ServiceAsset {
  id: string;
  kind: 'vehicle' | 'appliance';
  /** Vehicle: registration no., normalised (`MH12AB1234`), unique. */
  reg_no?: string;
  /** Make / brand. */
  make?: string;
  model: string;
  variant?: string;
  fuel?: string;
  year?: number;
  vin?: string;
  engine_no?: string;
  colour?: string;
  vclass?: VehicleClass;
  /** Appliance: serial no. and the site address it is installed at. */
  serial?: string;
  site?: string;
  client_id?: string;
  owner_name: string;
  phone?: string;
  insurer?: string;
  policy_no?: string;
  policy_expiry?: string;
  amc_id?: string;
  /** Odometer readings (km) in date order; the last one is the current reading. */
  odometer?: { date: string; km: number }[];
  next_service_date?: string;
  next_service_km?: number;
  created_at: string;
  updated_at?: string;
}

/** Table `labour_ops` (`master.edit`, audited "Labour operation"). */
export interface LabourOp {
  id: string;
  code: string;
  name: string;
  /** SAC (absent = `REPAIR_SAC_RULES` by the asset kind). */
  sac?: string;
  /** Standard hours per vehicle class (`hours.all` for every class). */
  hours?: Partial<Record<VehicleClass | 'all', number>>;
  /** Flat price (ex-GST) instead of hours × rate. */
  price?: number;
  /** Next-service interval this op sets (periodic service). */
  interval_days?: number;
  interval_km?: number;
  created_at: string;
  updated_at?: string;
}

/** One depreciation row of the motor-claim table (% of the approved part value the owner pays). */
export interface DepreciationRow {
  category: 'rubber' | 'plastic' | 'fibre' | 'glass' | 'metal' | 'paint' | 'other';
  pct: number;
}

/** Company object `mrchartist_inv_workshop_settings` (`settings.manage`, audited on save, synced as a singleton). */
export interface WorkshopSettings {
  /** Inspection checklist items. */
  checklists?: string[];
  /** Terms printed on the job card. */
  terms?: string;
  classes?: VehicleClass[];
  /** Labour rate per hour (ex-GST), per class (`all` for every class). */
  labour_rate?: Partial<Record<VehicleClass | 'all', number>>;
  /** Editable depreciation table (insurer practice, not statute); metal by age comes from the rules unless set here. */
  depreciation?: DepreciationRow[];
  default_interval?: { days?: number; km?: number };
  /** Parts warranty (months) printed on the bill as "Parts warranty until …". */
  parts_warranty_months?: number;
  updated_at?: string;
}

/** An estimate approval logged on a job. */
export interface JobApproval {
  quote_id: string;
  by: string;
  how: 'signature' | 'phone' | 'whatsapp' | 'in person';
  at: string;
  note?: string;
}

declare module './retail-r9' {
  interface ServiceJob {
    /** SV-D1: `service_assets` row, odometer in / out, fuel level, customer voice, inspection checklist, photos. */
    asset_id?: string;
    odometer_in?: number;
    odometer_out?: number;
    fuel?: string;
    complaints?: string[];
    checklist?: string[];
    photos?: string[];
    /** Promised date-time (`YYYY-MM-DDTHH:MM`). */
    promised?: string;
    /** Bay (SV-A2 resource id) and technicians (SV-A3 staff ids). */
    bay?: string;
    technicians?: string[];
    /** Appliance call: site visit (`YYYY-MM-DDTHH:MM`), address and the appointment booked for it. */
    visit_at?: string;
    site?: string;
    appointment_id?: string;
    /** SV-D4: the AMC contract covering this job (covered labour is not charged). */
    amc_id?: string;
    /** SV-D2: estimates (QUOTATION ids), approvals, parts issued to the job (stock transfer ids). */
    quote_ids?: string[];
    approvals?: JobApproval[];
    parts_issue?: string[];
    /** SV-D2: running technician clocks (staff id → ISO start). */
    clocks?: Record<string, string>;
    /** SV-D3: the motor claim (`payer_claims`) of this job. */
    claim_id?: string;
  }
}

/** SV-D3 motor claims (merged into SV-A's `PayerClaim`): cashless / reimbursement, surveyor, survey date, salvage note. */
export interface PayerClaim {
  mode?: 'cashless' | 'reimbursement';
  surveyor?: string;
  survey_date?: string;
  salvage?: string;
}

declare module './invoice' {
  interface Client {
    /** SV-D3: an insurer's choice on reimbursement claims (default `owner`: one invoice to the owner). */
    sv_insurer_invoice?: 'insurer' | 'owner';
  }
}

declare module './time' {
  interface TimeEntry {
    /** SV-D2: technician time on a job (not billable by itself; the job bill carries the labour). */
    job_id?: string;
    staff_id?: string;
  }
}

declare module '../lib/amc' {
  interface AmcContract {
    /** SV-D4: vehicles / appliances the contract covers. */
    asset_ids?: string[];
  }
  interface AmcVisit {
    /** SV-D4: the job card of the visit. */
    job_id?: string;
  }
}
