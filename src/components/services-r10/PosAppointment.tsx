/**
 * SV-A2: `/pos?appt=<id>` (the front desk's *Bill*) — loads the appointment's services as POS lines with the staff on
 * each (`sv.staff_id`, `sv.appointment_id`) and its client, once; the appointment shows *billed* when the bill is saved
 * (derived from the lines). Renders nothing. Lazy (Pos.tsx mounts it only with the URL parameter).
 */
import { useEffect } from 'react';
import type { Client, InvoiceItem } from '../../types/invoice';
import { localDb } from '../../lib/localDb';
import { billLines, loadAppointments } from '../../lib/services/sv-appointments';
import { loadStaff } from '../../lib/services/sv-staff';
import { todayInput } from '../../lib/utils';

export default function PosAppointment({ id, onLoad }: { id: string; onLoad: (lines: InvoiceItem[], party: { client: Client | null; name: string; phone: string }) => void }) {
  useEffect(() => {
    const a = loadAppointments().find((x) => x.id === id);
    if (!a) return;
    const client = a.client_id ? localDb.clients.getById(a.client_id) ?? null : null;
    onLoad(billLines(a, loadStaff(), todayInput()), { client, name: client?.name ?? a.client_name, phone: client?.phone ?? a.phone ?? '' });
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
