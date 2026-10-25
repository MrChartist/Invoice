/**
 * Time tracking, mileage and billing preferences (roadmap 6.13 / 6.14).
 * Persisted field names are snake_case and additive-only, like every other table.
 */

/** One block of work. Persisted in table `time_entries`. */
export interface TimeEntry {
  id: string;
  /** `clients` row id (absent for a client typed by name only). */
  client_id?: string;
  /** Snapshot of the client's name, so the entry still reads after the client is renamed or removed. */
  client_name: string;
  /** Optional free-text project label, e.g. "Website revamp". */
  project?: string;
  description: string;
  /** yyyy-mm-dd (local day). */
  date: string;
  /** Raw minutes worked (rounding is applied when billing, never stored). */
  minutes: number;
  /** Hourly rate in the invoice currency. */
  hourly_rate: number;
  billable: boolean;
  /**
   * Additive (6.16): `cost_centres` row id. Billing copies it onto the invoice line; when absent, a
   * `project` text that matches an active cost centre's name (case-insensitive) is used instead.
   */
  cost_centre_id?: string;
  /**
   * Id of the invoice this entry was billed on. The entry is "billed" only while that invoice
   * still exists and is not cancelled — deleting the invoice frees the entry again.
   */
  invoiced_in?: string;
  created_at?: string;
  updated_at?: string;
}

/** One trip. Persisted in table `mileage`. */
export interface MileageEntry {
  id: string;
  client_id?: string;
  client_name: string;
  /** yyyy-mm-dd (local day). */
  date: string;
  from: string;
  to: string;
  purpose: string;
  km: number;
  /** Rate per km captured when the trip was logged (from the preference at the time). */
  rate_per_km: number;
  /** Same derived-billing rule as `TimeEntry.invoiced_in`. */
  invoiced_in?: string;
  /** Additive (6.16): `cost_centres` row id, copied onto the mileage line when billed. */
  cost_centre_id?: string;
  created_at?: string;
  updated_at?: string;
}

export type MinuteRounding = 'none' | 'nearest' | 'up';

/** Preferences (singleton JSON at `mrchartist_inv_time_prefs`). */
export interface TimePrefs {
  /** Rounding step in minutes (0 = exact). Applied per entry when billing. */
  round_increment: number;
  round_mode: MinuteRounding;
  /** Hourly rate pre-filled on new entries and the timer. */
  default_rate: number;
  /** SAC printed on billed time lines (998311 = management consulting). */
  sac: string;
  /** GST rate on billed time, mileage and re-billed (non pure-agent) expenses. */
  gst_rate: number;
  /** Rate per km pre-filled on new trips. */
  mileage_rate: number;
}

export const DEFAULT_TIME_PREFS: TimePrefs = {
  round_increment: 0,
  round_mode: 'none',
  default_rate: 0,
  sac: '998311',
  gst_rate: 18,
  mileage_rate: 10,
};
