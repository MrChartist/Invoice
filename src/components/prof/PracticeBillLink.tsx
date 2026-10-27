/** PS-D5: the practice board's "Bill" link for a company linked to a client (CA desk → Work to bill). Read-only board. */
import { Link } from 'react-router-dom';
import { caT } from '../../i18n/areas/prof-r14d-ca';
import { readCaSettings } from '../../lib/prof/ps-d-settings';
import controls from '../../styles/controls.module.css';

export default function PracticeBillLink({ companyId }: { companyId: string }) {
  if (!(readCaSettings().company_clients ?? []).some((l) => l.company_id === companyId)) return null;
  return <Link to="/time?tab=cadesk&view=events" className={`${controls.btnGhost} ${controls.btnSm}`} data-ps-bill-link>{caT('bill')}</Link>;
}
