import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { contactPickerSupported, pickContact, type ContactFields } from '../../lib/contact-pick';
import { useT } from '../../i18n';
import { phoneT } from '../../i18n/areas/phone';
import controls from '../../styles/controls.module.css';

/** "Add from contacts" (8.24): renders nothing unless the browser has the Contact Picker API (Android Chrome). */
export function ContactPickButton({ onPick }: { onPick: (fields: ContactFields) => void }) {
  useT();
  const [error, setError] = useState('');
  if (!contactPickerSupported()) return null;
  const pick = async () => {
    setError('');
    try {
      const fields = await pickContact();
      if (fields) onPick(fields);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') setError(phoneT('contactsFailed'));
    }
  };
  return (
    <div>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={pick} aria-label={phoneT('contactsAria')}>
        <UserPlus size={14} aria-hidden="true" /> {phoneT('contacts')}
      </button>
      {error && <p className={controls.error} role="alert">{error}</p>}
    </div>
  );
}
